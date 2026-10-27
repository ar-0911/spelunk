import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/analysis/graph.js";
import { allRoutes } from "../src/analysis/routes.js";
import { resolveTarget, trace } from "../src/query/trace.js";
import { scan } from "../src/scan/scan.js";
import { repo } from "./helpers.js";

/** The shapes of moleculerjs/moleculer-realworld-example-app: a runner, an API gateway, services that call each other by name. */
const MOLECULER_APP = {
  "package.json": JSON.stringify({ name: "realworld", scripts: { dev: "moleculer-runner --repl --hot services", start: "moleculer-runner services" } }),
  "moleculer.config.js": `module.exports = { nodeID: "node-1", logger: true };\n`,
  "services/api.service.js": `
const ApiGateway = require("moleculer-web");

module.exports = {
	name: "api",
	mixins: [ApiGateway],
	settings: {
		port: 3000,
		routes: [{
			path: "/api",
			aliases: {
				// Login
				"POST /users/login": "users.login",
				"REST /articles": "articles",
				"GET /articles/:slug/comments": ["auth", "articles.comments"],
				"GET /health"(req, res) { res.end("ok"); },
			},
		}],
	},
};
`,
  "services/users.service.js": `
module.exports = {
	name: "users",
	actions: {
		/** Log a user in. */
		login: {
			params: { email: "string" },
			handler(ctx) {
				return this.findByEmail(ctx.params.email);
			}
		},
		get(ctx) {
			return this.findByEmail(ctx.params.id);
		},
	},
	events: {
		"user.created"(ctx) {
			return this.findByEmail(ctx.params.email);
		},
	},
	methods: {
		findByEmail(email) {
			return { email };
		},
	},
};
`,
  "services/articles.service.js": `
module.exports = {
	name: "articles",
	version: 2,
	actions: {
		create: {
			handler(ctx) {
				ctx.emit("user.created", { email: "x" });
				return ctx.call("users.get", { id: ctx.meta.user }).then((user) => this.transform(user));
			}
		},
		list() {
			return this.actions.create({});
		},
		comments(ctx) {
			return this.broker.call("users.get", {});
		},
	},
	methods: {
		transform(x) {
			return x;
		},
	},
};
`,
};

describe("Moleculer services", async () => {
  const ix = await scan(await repo(MOLECULER_APP));
  const g = buildGraph(ix);
  const file = (p: string) => ix.files.find((f) => f.path === p)!;
  const flat = (n: { name: string; byName?: true; children: never[] }[]): string[] => n.flatMap((x) => [`${x.name}${x.byName ? "?" : ""}`, ...flat(x.children)]);

  it("names actions, events and methods after their service, not `handler`", () => {
    const syms = file("services/users.service.js").symbols.map((s) => `${s.parent}.${s.name}${s.exported ? "*" : ""}${s.broker ? ` (${s.broker})` : ""}`);
    expect(syms).toEqual(["users.login* (action)", "users.get* (action)", "users.user.created (event)", "users.findByEmail"]);
    expect(file("services/users.service.js").symbols[0]!.doc).toBe("Log a user in.");
    expect(file("services/articles.service.js").symbols.map((s) => `${s.parent}.${s.name}`)).toContain("v2.articles.create");
  });

  it("finds where it starts: the services moleculer-runner loads, and its config", () => {
    expect(file("services/users.service.js").entry).toBe("moleculer service (npm run dev)");
    expect(file("moleculer.config.js").entry).toMatch(/^moleculer config/);
  });

  it("reads the gateway's aliases as routes, REST included, under the route's path", () => {
    const routes = allRoutes(ix, "server").map((r) => `${r.method} ${r.path} ${r.handler ?? ""}`.trim());
    expect(routes).toEqual([
      "POST /api/users/login svc:users.login",
      "GET /api/articles svc:articles.list",
      "GET /api/articles/:id svc:articles.get",
      "POST /api/articles svc:articles.create",
      "PUT /api/articles/:id svc:articles.update",
      "PATCH /api/articles/:id svc:articles.patch",
      "DELETE /api/articles/:id svc:articles.remove",
      "GET /api/articles/:slug/comments svc:articles.comments",
      "GET /api/health",
    ]);
  });

  it("traces a route into its action, and `ctx.call` / `this.actions` / methods from there", () => {
    const [t] = resolveTarget(ix, "POST /api/users/login");
    expect(flat(trace(ix, g, t!, { depth: 3 }).flow as never)).toEqual(["users.login", "users.findByEmail"]);
    const [create] = resolveTarget(ix, "v2.articles.create");
    expect(flat(trace(ix, g, create!, { depth: 3 }).flow as never)).toEqual(["users.user.created?", "users.findByEmail", "users.get", "v2.articles.transform"]);
    const [list] = resolveTarget(ix, "v2.articles.list");
    expect(flat(trace(ix, g, list!, { depth: 0 }).flow as never)).toEqual(["v2.articles.create"]);
  });

  it("lists who calls an action by name, with lines", () => {
    const [get] = resolveTarget(ix, "users.get");
    expect(trace(ix, g, get!).usedBy).toEqual([
      { path: "services/articles.service.js", line: 8 },
      { path: "services/articles.service.js", line: 15 },
    ]);
    const [login] = resolveTarget(ix, "users.login");
    expect(trace(ix, g, login!).usedBy).toEqual([{ path: "services/api.service.js", line: 12 }]);
  });
});

describe("minified bundles", () => {
  it("treats a hash-named bundle with very long lines as generated", async () => {
    const ix = await scan(await repo({ "public/static/js/main.41b57957.js": `!function(e){${"var a=1;".repeat(300)}function t(){}}();\n`, "src/a.js": "function a() {}\n" }));
    expect(ix.files.find((f) => f.path.startsWith("public"))!.role).toBe("generated");
    expect(ix.files.find((f) => f.path.startsWith("public"))!.symbols).toEqual([]);
  });
});

describe("comparing two branches", () => {
  it("reads the other branch's own code, without touching the checkout", async () => {
    const { execFileSync } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { gitDiff, impact, listBranches, snapshotRef } = await import("../src/query/impact.js");
    const { openWorkspace } = await import("../src/workspace.js");
    const root = await repo({ "src/a.ts": "export function one() {\n  return 1;\n}\n" });
    const git = (...a: string[]) => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-qm", "init");
    git("checkout", "-qb", "feature");
    writeFileSync(join(root, "src/a.ts"), "export function one() {\n  return 1;\n}\n\nexport function two() {\n  return 2;\n}\n");
    git("commit", "-qam", "two");
    git("checkout", "-q", "main");

    expect(await listBranches(root)).toEqual({ current: "main", branches: expect.arrayContaining(["main", "feature"]) });
    expect(await snapshotRef(root, "main")).toBeUndefined();
    const snap = (await snapshotRef(root, "feature"))!;
    const sw = await openWorkspace(snap.dir, { refresh: true });
    const i = impact(sw.index, sw.graph, await gitDiff(root, "main", { head: snap.commit }), [], { base: "main", head: "feature" });
    expect(i.files.map((f) => [f.path, f.symbols.map((s) => s.name)])).toEqual([["src/a.ts", ["two"]]]);
    expect(git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    await expect(snapshotRef(root, "nope")).rejects.toThrow(/Can't find "nope"/);
  });
});
