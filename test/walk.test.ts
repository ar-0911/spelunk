import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/analysis/graph.js";
import { diagramSvg } from "../src/report/diagram.js";
import { serviceFocus, serviceMap } from "../src/report/focus.js";
import type { Report } from "../src/report/model.js";
import { frame, pickTarget } from "../src/query/walk.js";
import { scan } from "../src/scan/scan.js";
import { repo, TS_APP } from "./helpers.js";

const APP = {
  ...TS_APP,
  "src/services/notes.ts": `
import { db } from "../db.js";
import { newId } from "../lib/ids.js";

/** Saves a note and returns it with its id. */
export async function saveNote(input: { text: string }) {
  validate(input);
  const id = newId();
  return db.insert({ id, ...input });
}

export async function listNotes() {
  return await db.all();
}

/** An orphaned comment from a function that moved away. */
/** Rejects empty notes. */
function validate(input: { text: string }) {
  if (!input.text) throw new Error("text is required");
  check(input);
}

function check(input: { text: string }) {
  return input.text.length < 1000 && input.text.trim() !== "";
}
`,
  "src/lib/ids.ts": `export function newId() {\n  return Math.random().toString(36).slice(2);\n}\n`,
};

describe("trace reader frames", async () => {
  const root = await repo(APP);
  const ix = await scan(root);
  const g = buildGraph(ix);
  const open = (q: Parameters<typeof pickTarget>[1]) => {
    const { target } = pickTarget(ix, q);
    return target && frame(ix, g, target, readFileSync(join(root, target.path), "utf8"));
  };

  it("numbers a function's calls in order, real steps before helpers, with its code", () => {
    const f = open({ target: "saveNote" })!;
    expect(f.kind).toBe("symbol");
    expect(f.code[0]).toContain("export async function saveNote");
    const code = f.steps.filter((s) => s.kind === "code");
    expect(code.map((s) => [s.n, s.def!.name, Boolean(s.helper)])).toEqual([
      [1, "validate", false],
      [2, "newId", true],
    ]);
    expect(code[0]!.inside).toBe(1);
    expect(f.steps.find((s) => s.ref === "db.insert")).toBeTruthy();
  });

  it("lists who calls a function, naming the route or function that does", () => {
    const f = open({ target: "saveNote" })!;
    expect(f.callers.map((c) => [c.kind, c.label])).toEqual(expect.arrayContaining([["route", "POST /api/notes"]]));
    // A caller can be opened as a frame: stepping up.
    const up = f.callers.find((c) => c.kind === "route")!;
    const r = open({ path: up.path, line: up.frameLine! })!;
    expect(r.kind).toBe("route");
    expect(r.label).toBe("POST /api/notes");
    expect(r.callers.map((c) => [c.kind, c.label])).toEqual([["client", "addNote"]]);
    expect(r.steps.find((s) => s.def?.name === "saveNote")?.n).toBe(1);
  });

  it("marks lines that throw and opens nested calls by exact place", () => {
    const f = open({ target: "validate" })!;
    expect(f.throws).toHaveLength(1);
    expect(f.doc).toBe("Rejects empty notes.");
    const check = f.steps.find((s) => s.def?.name === "check")!;
    const inner = open({ path: check.def!.path, line: check.def!.line })!;
    expect(inner.label).toBe("check");
    expect(inner.callers.map((c) => c.label)).toEqual(["validate"]);
  });

  it("offers choices when a name is ambiguous", () => {
    expect(pickTarget(ix, { target: "doesNotExist" })).toEqual({ choices: [] });
  });
});

describe("Moleculer service map", async () => {
  const ix = await scan(
    await repo({
      "package.json": JSON.stringify({ name: "shop", dependencies: { moleculer: "*", "moleculer-web": "*" } }),
      "services/api.service.js": `
const ApiGateway = require("moleculer-web");
module.exports = {
  name: "api",
  mixins: [ApiGateway],
  settings: {
    routes: [{
      path: "/api",
      aliases: {
        "POST /orders": "orders.create",
      },
    }],
  },
};
`,
      "services/orders.service.js": `
module.exports = {
  name: "orders",
  actions: {
    async create(ctx) {
      const user = await ctx.call("users.get", { id: ctx.params.userId });
      await ctx.call("users.get", { id: 1 });
      ctx.emit("order.created", { user });
      return user;
    },
  },
};
`,
      "services/users.service.js": `
module.exports = {
  name: "users",
  actions: { get(ctx) { return { id: ctx.params.id }; } },
  events: { "order.created"(ctx) { return ctx.params; } },
};
`,
    }),
  );

  it("draws a box per service and an arrow per broker call", () => {
    const map = serviceMap(ix)!;
    expect(map.mods.map((m) => m.path)).toEqual(["api", "orders", "users"]);
    expect(map.mods.find((m) => m.path === "orders")!.dependsOn).toEqual([{ path: "users", weight: 3 }]);
    expect(map.mods.find((m) => m.path === "api")!.dependsOn).toEqual([{ path: "orders", weight: 1 }]);
    const f = serviceFocus(ix, "orders")!;
    expect(f.usedBy.map((x) => x.path)).toEqual(["api"]);
    expect(f.uses[0]!.files.map(([, what]) => what)).toEqual(expect.arrayContaining(["users.get", "event order.created"]));
  });
});

describe("module diagram", () => {
  it("puts parts with no links in their own row and tags links for highlighting", () => {
    const mod = (path: string, deps: string[]) => ({ path, files: [], lines: 0, dependsOn: deps.map((p) => ({ path: p, weight: 2 })) }) as unknown as Report["modules"][number];
    const svg = diagramSvg([mod("a", ["b"]), mod("b", []), mod("lonely", [])]);
    expect(svg).toContain("Not linked to the other parts");
    expect(svg).toContain('data-from="a" data-to="b"');
    expect(svg).toContain('data-mod="lonely"');
  });
});
