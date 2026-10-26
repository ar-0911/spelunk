import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/analysis/graph.js";
import { findRisks } from "../src/analysis/risks.js";
import { pathMatches, methodMatches } from "../src/analysis/routes.js";
import { resolveTarget, trace } from "../src/query/trace.js";
import { where } from "../src/query/where.js";
import { scan } from "../src/scan/scan.js";
import { webUrl } from "../src/scan/walk.js";
import { GO_APP, PY_APP, TS_APP, repo } from "./helpers.js";

const file = (ix: Awaited<ReturnType<typeof scan>>, path: string) => ix.files.find((f) => f.path === path)!;

describe("TypeScript repo", async () => {
  const ix = await scan(await repo(TS_APP));
  const g = buildGraph(ix);

  it("reads symbols with docs and export flags", () => {
    const notes = file(ix, "src/services/notes.ts");
    const save = notes.symbols.find((s) => s.name === "saveNote")!;
    expect(save).toMatchObject({ kind: "function", exported: true, line: 4, doc: "Saves a note and returns it with its id." });
    expect(save.calls).toContain("validate");
    expect(notes.symbols.find((s) => s.name === "validate")?.exported).toBe(false);
  });

  it("resolves .js imports to .ts files and marks packages external", () => {
    const app = file(ix, "src/app.ts");
    expect(app.imports.find((i) => i.spec === "./services/notes.js")?.targets).toEqual(["src/services/notes.ts"]);
    expect(app.imports.find((i) => i.spec === "express")?.external).toBe("express");
  });

  it("tells server routes from client calls", () => {
    expect(file(ix, "src/app.ts").routes.map((r) => `${r.side} ${r.method} ${r.path}`)).toEqual(["server GET /api/notes", "server POST /api/notes"]);
    expect(file(ix, "src/web/client.ts").routes.map((r) => `${r.side} ${r.method} ${r.path}`)).toEqual(["client POST /api/notes", "client GET /api/notse"]);
  });

  it("finds env vars, entry points, thrown errors and roles", () => {
    expect(file(ix, "src/db.ts").env.map((e) => e.text)).toEqual(["DATABASE_URL", "SECRET_KEY"]);
    expect(file(ix, "src/main.ts").entry).toBe("server start");
    expect(file(ix, "src/services/notes.ts").throws[0]?.text).toContain("text is required");
    expect(file(ix, "test/notes.test.ts").role).toBe("test");
    expect(file(ix, "package.json").role).toBe("config");
  });

  it("traces a route from its client caller through the handler's calls", () => {
    const [t] = resolveTarget(ix, "POST /api/notes");
    const tr = trace(ix, g, t!);
    expect(tr.callers).toEqual([{ path: "src/web/client.ts", line: 2, label: "POST /api/notes" }]);
    expect(tr.flow.map((n) => n.name)).toEqual(["saveNote"]);
    expect(tr.flow[0]!.children.map((n) => n.name)).toEqual(["validate"]);
    expect(tr.fromEntries[0]).toEqual(["src/main.ts", "src/app.ts"]);
  });

  it("answers where-is questions", () => {
    expect(where(ix, "save note")[0]).toMatchObject({ kind: "symbol", name: "saveNote", path: "src/services/notes.ts" });
    expect(where(ix, "DATABASE_URL")[0]).toMatchObject({ kind: "env", path: "src/db.ts" });
  });

  it("flags risks", async () => {
    const risks = await findRisks(ix, g);
    const of = (kind: string) => risks.filter((r) => r.kind === kind).map((r) => r.title);
    expect(of("missing-route")).toEqual(["GET /api/notse has no matching route"]);
    expect(risks.find((r) => r.kind === "swallowed-error")?.locations).toEqual([{ path: "src/services/notes.ts", line: 12 }]);
    expect(of("orphan").join()).toContain("unused.ts");
    expect(of("orphan").join()).not.toContain("seed.ts"); // run by a package script
    expect(of("env-undocumented").join()).toContain("SECRET_KEY");
    expect(of("env-unused").join()).toContain("UNUSED_THING");
  });

  it("reuses unchanged files on a rescan", async () => {
    const again = await scan(ix.root);
    expect(again.files.length).toBe(ix.files.length);
    expect(file(again, "src/app.ts").hash).toBe(file(ix, "src/app.ts").hash);
  });
});

describe("Python repo", async () => {
  const ix = await scan(await repo(PY_APP));
  const g = buildGraph(ix);

  it("applies APIRouter prefixes and ignores routes in docstrings", () => {
    expect(file(ix, "app/api/orders.py").routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /orders", "GET /orders/{order_id}"]);
  });

  it("resolves absolute, relative and stdlib imports", () => {
    const orders = file(ix, "app/api/orders.py");
    expect(orders.imports.find((i) => i.spec === "app.services.billing")?.targets).toEqual(["app/services/billing.py"]);
    expect(orders.imports.find((i) => i.spec === "..models")?.targets).toEqual(["app/models.py"]);
    expect(file(ix, "app/services/billing.py").imports.find((i) => i.spec === "os")?.external).toBe("os");
  });

  it("reads classes, methods, docstrings, env and swallowed errors", () => {
    const models = file(ix, "app/models.py");
    expect(models.symbols.map((s) => `${s.parent ? `${s.parent}.` : ""}${s.name}`)).toEqual(["Order", "Order.__init__"]);
    expect(models.symbols[0]!.doc).toBe("An order a customer placed.");
    const billing = file(ix, "app/services/billing.py");
    expect(billing.env.map((e) => e.text)).toEqual(["STRIPE_KEY"]);
    expect(billing.swallowed.length).toBe(1);
    expect(file(ix, "app/main.py").entry).toBe("web app");
  });

  it("traces a route into the service layer", () => {
    const [t] = resolveTarget(ix, "POST /orders");
    const tr = trace(ix, g, t!);
    expect(tr.flow.map((n) => `${n.name} ${n.path}`)).toContain("charge app/services/billing.py");
    expect(tr.flow.find((n) => n.name === "charge")!.children.map((n) => n.name)).toEqual(["_send"]);
  });
});

describe("Go repo", async () => {
  const ix = await scan(await repo(GO_APP));
  const g = buildGraph(ix);

  it("resolves module imports to the package's files", () => {
    expect(file(ix, "main.go").imports.find((i) => i.spec === "example.com/shop/orders")?.targets.sort()).toEqual(["orders/routes.go", "orders/store.go"]);
    expect(file(ix, "orders/routes.go").routes.map((r) => `${r.method} ${r.path}`)).toEqual(["ANY /orders"]);
  });

  it("follows calls into other files of the same package", () => {
    const [t] = resolveTarget(ix, "Create");
    expect(trace(ix, g, t!).flow.map((n) => `${n.name} ${n.path}`)).toEqual(["Save orders/store.go"]);
  });
});

describe("helpers", () => {
  it("matches route patterns", () => {
    expect(pathMatches("/api/pages/:id", "/api/pages/${id}")).toBe(true);
    expect(pathMatches("/users/<int:id>", "/users/3")).toBe(true);
    expect(pathMatches("/api/pages", "/api/pages/x")).toBe(false);
    expect(methodMatches("GET,POST", "POST")).toBe(true);
    expect(methodMatches("GET", "HEAD")).toBe(true);
    expect(methodMatches("GET", "DELETE")).toBe(false);
  });

  it("turns git remotes into web URLs", () => {
    expect(webUrl("git@github.com:ar-0911/spelunk.git")).toBe("https://github.com/ar-0911/spelunk");
    expect(webUrl("https://token@github.com/a/b")).toBe("https://github.com/a/b");
    expect(webUrl("/srv/git/repo")).toBeUndefined();
  });
});
