import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/analysis/graph.js";
import { definition, resolveTarget, trace } from "../src/query/trace.js";
import { priceFor } from "../src/explain/claude.js";
import { callStats, formatSkipped } from "../src/format.js";
import { scan } from "../src/scan/scan.js";
import { changeStamp } from "../src/scan/walk.js";
import { repo } from "./helpers.js";

/** Shapes the first tracer missed: handlers passed by name, barrels, `export { }`, CommonJS, `new`, JSX, look-alike methods. */
const EXPRESS_APP = {
  "package.json": JSON.stringify({ name: "users" }),
  "src/routes.ts": `
import { Router } from "express";
import { getUser } from "./controllers/index.js";
import * as users from "./controllers/users.js";
import { auth } from "./auth.js";

export const router = Router();
router.get("/users/:id", auth, getUser);
router.post("/users", users.create);

function json() {
  return "not the response's json()";
}

export function unrelated() {
  return json();
}
`,
  "src/auth.ts": `export function auth(_req: unknown, _res: unknown, next: () => void) { next(); }\n`,
  "src/controllers/index.ts": `export { getUser } from "./get.js";\nexport * from "./users.js";\n`,
  "src/controllers/get.ts": `
import { UserService } from "../services/user.js";

function getUser(req: { params: { id: string } }, res: { json(x: unknown): void }) {
  const service = new UserService();
  res.json(service.find(req.params.id));
}

export { getUser };
`,
  "src/controllers/users.ts": `
import { saveUser } from "../services/save.js";

export function create(req: { body: unknown }) {
  return saveUser(req.body);
}
`,
  "src/services/user.ts": `
export class UserService {
  find(id: string) {
    return this.load(id);
  }
  load(id: string) {
    return { id };
  }
}
`,
  "src/services/save.ts": `export function saveUser(x: unknown) { return x; }\n`,
  "src/legacy.js": `
function legacy() {
  return helper();
}
function helper() {
  return 1;
}
module.exports = { legacy };
`,
  "src/uses-legacy.js": `
const { legacy } = require("./legacy");
function run() {
  return legacy();
}
module.exports = run;
`,
  "src/App.tsx": `
import { Button } from "./Button.js";
export function App() {
  return <Button label="hi" />;
}
`,
  "src/Button.tsx": `
export function Button(props: { label: string }) {
  return <button>{props.label}</button>;
}
`,
};

describe("tracing", async () => {
  const ix = await scan(await repo(EXPRESS_APP));
  const g = buildGraph(ix);
  const flow = (target: string) => {
    const [t] = resolveTarget(ix, target);
    return trace(ix, g, t!, { depth: 3 }).flow;
  };
  const names = (nodes: { name: string; children: { name: string }[] }[]): string[] => nodes.flatMap((n) => [n.name, ...names(n.children as never)]);

  it("follows a handler passed by name, through a barrel and `export { }`, into `new` and a class's own methods", () => {
    const f = flow("GET /users/:id");
    expect(f.map((n) => `${n.name} ${n.path}`)).toEqual(["auth src/auth.ts", "getUser src/controllers/get.ts"]);
    expect(names(f)).toEqual(expect.arrayContaining(["UserService", "UserService.find", "UserService.load"]));
  });

  it("follows `module.fn` through a namespace import", () => {
    expect(names(flow("POST /users"))).toEqual(["users.create".split(".").pop()!, "saveUser"]);
  });

  it("doesn't send `res.json()` to an unrelated local function named json", () => {
    expect(definition(ix, g, "src/controllers/get.ts", "res.json")).toBeUndefined();
    expect(definition(ix, g, "src/routes.ts", "json")?.path).toBe("src/routes.ts");
  });

  it("stops a route's code at the end of its registration, not 80 lines on", () => {
    expect(names(flow("POST /users"))).not.toContain("json");
  });

  it("resolves CommonJS exports and requires", () => {
    expect(ix.files.find((f) => f.path === "src/legacy.js")!.symbols.find((s) => s.name === "legacy")!.exported).toBe(true);
    expect(names(flow("run"))).toEqual(["legacy", "helper"]);
  });

  it("treats a JSX element as a call to its component", () => {
    expect(names(flow("App"))).toEqual(["Button"]);
  });

  it("says how much of a flow it could follow", () => {
    const [t] = resolveTarget(ix, "GET /users/:id");
    const { calls } = trace(ix, g, t!, { depth: 3 });
    expect(calls.resolved).toBeGreaterThanOrEqual(5);
    expect(calls.byName).toBe(0);
    expect(calls.unresolved).toContain("res.json");
    expect(callStats(calls)).toMatch(/^\d+ calls resolved, .*unresolved \(.*res\.json/);
  });
});

describe("which files are read", () => {
  it("keeps code in folders named like build output, and says what it skipped", async () => {
    const root = await repo({
      "package.json": "{}",
      "src/build/plan.ts": "export const plan = 1;\n",
      "src/env/config.ts": "export const env = 1;\n",
      "lib/out/report.ts": "export const report = 1;\n",
      "dist/index.js": "module.exports = 1;\n",
      "packages/api/package.json": "{}",
      "packages/api/dist/index.js": "module.exports = 1;\n",
      "packages/api/src/index.ts": "export const api = 1;\n",
    });
    const ix = await scan(root);
    expect(ix.files.map((f) => f.path).filter((p) => p.endsWith(".ts"))).toEqual(["lib/out/report.ts", "packages/api/src/index.ts", "src/build/plan.ts", "src/env/config.ts"]);
    expect(ix.skipped.filter((s) => s.path.endsWith("/"))).toEqual([
      { path: "dist/", reason: "build or dependency output (1 file)" },
      { path: "packages/api/dist/", reason: "build or dependency output (1 file)" },
    ]);
  });

  it("skips a Python virtualenv by its pyvenv.cfg, whatever it's called", async () => {
    const root = await repo({ "app.py": "x = 1\n", "env/pyvenv.cfg": "home = /usr\n", "env/lib/x.py": "y = 2\n", "tools/env/run.py": "z = 3\n" });
    expect((await scan(root)).files.map((f) => f.path)).toEqual(["app.py", "tools/env/run.py"]);
  });

  it("never follows a symlink out of the repository", async () => {
    const outside = await repo({ "secret.ts": "export const secret = 'do not index';\n" });
    const root = await repo({ "src/a.ts": "export const a = 1;\n" });
    symlinkSync(join(outside, "secret.ts"), join(root, "src/leak.ts"));
    execFileSync("git", ["init", "-q", root]);
    const ix = await scan(root);
    expect(ix.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(ix.skipped).toContainEqual({ path: "src/leak.ts", reason: "symbolic link" });
  });

  it("skips files under a symlinked folder that leads out of the repository", async () => {
    const outside = await repo({ "passwd.ts": "export const root = 'x';\n" });
    const root = await repo({ "src/a.ts": "export const a = 1;\n" });
    symlinkSync(outside, join(root, "src/vendor"));
    const ix = await scan(root);
    expect(ix.files.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  it("prints what was skipped and why, grouped", () => {
    expect(formatSkipped([])).toBe("Skipped nothing.");
    expect(
      formatSkipped([
        { path: "dist/", reason: "build or dependency output (40 files)" },
        { path: "web/dist/", reason: "build or dependency output (2 files)" },
        { path: "src/leak.ts", reason: "symbolic link" },
      ]),
    ).toBe("Skipped 43 files: 42 build or dependency output (dist/, web/dist/), 1 symbolic link.");
  });

  it("notices a second edit to an already-modified file without rescanning", async () => {
    const root = await repo({ "a.ts": "export const a = 1;\n" });
    const git = (...a: string[]) => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a]);
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "init");
    const clean = await changeStamp(root);
    expect(await changeStamp(root)).toBe(clean);
    writeFileSync(join(root, "a.ts"), "export const a = 2;\n");
    const dirty = await changeStamp(root);
    expect(dirty).not.toBe(clean);
    writeFileSync(join(root, "a.ts"), "export const a = 33;\n");
    expect(await changeStamp(root)).not.toBe(dirty);
    mkdirSync(join(root, "b"));
    writeFileSync(join(root, "b/new.ts"), "x\n");
    expect(await changeStamp(root)).not.toBe(dirty);
    expect(await changeStamp(await repo({ "x.ts": "" }))).toBeUndefined();
  });

  it("reuses an unchanged file without reading it, going by size and modification time", async () => {
    const root = await repo({ "src/a.ts": "export function one() {}\n" });
    const file = join(root, "src/a.ts");
    const old = new Date(Date.now() - 60_000);
    utimesSync(file, old, old);
    const first = await scan(root);
    const { saveIndex } = await import("../src/scan/scan.js");
    await saveIndex(first);
    // Same size and time, different text: only a reread would notice, so a stat match proves no reread.
    writeFileSync(file, "export function two() {}\n");
    utimesSync(file, old, old);
    expect((await scan(root)).files[0]!.symbols[0]!.name).toBe("one");
    // A real edit changes the time, and is picked up.
    writeFileSync(file, "export function three() {}\n");
    expect((await scan(root)).files[0]!.symbols[0]!.name).toBe("three");
  });
});

describe("pricing", () => {
  it("knows the current models, dated ids included, and refuses to guess for others", () => {
    expect(priceFor("claude-opus-5-5")).toEqual({ input: 4, output: 20, cacheRead: 0.2 });
    expect(priceFor("claude-opus-5-5-20261001")?.input).toBe(4);
    expect(priceFor("claude-opus-5")?.input).toBe(5);
    expect(priceFor("claude-sonnet-5-5")?.output).toBe(10);
    expect(priceFor("some-new-model")).toBeUndefined();
    process.env.SPELUNK_PRICE_IN = "3";
    process.env.SPELUNK_PRICE_OUT = "15";
    expect(priceFor("some-new-model")).toEqual({ input: 3, output: 15, cacheRead: 0.3 });
    delete process.env.SPELUNK_PRICE_IN;
    delete process.env.SPELUNK_PRICE_OUT;
  });
});
