import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/analysis/graph.js";
import { findRisks } from "../src/analysis/risks.js";
import { ask, citations, type AskModel, type AskReply, type AskRequest } from "../src/explain/ask.js";
import { lookupError, mapPath } from "../src/query/errors.js";
import { formatImpact, impact, parseDiff } from "../src/query/impact.js";
import { MAX_SOURCE, publishToElemnt, renderElemnt } from "../src/report/elemnt.js";
import { buildReport, linkTemplate } from "../src/report/model.js";
import { buildTour, formatTour } from "../src/report/tour.js";
import { parseRepoUrl } from "../src/scan/clone.js";
import { scan } from "../src/scan/scan.js";
import { Workspace } from "../src/workspace.js";
import { PY_APP, TS_APP, repo } from "./helpers.js";

describe("repository links", () => {
  it.each([
    ["https://github.com/acme/api", { host: "github.com", path: "acme/api", cloneUrl: "https://github.com/acme/api.git" }],
    ["https://github.com/acme/api/tree/dev", { path: "acme/api", branch: "dev" }],
    ["https://bitbucket.org/team/app/src/main/", { host: "bitbucket.org", path: "team/app", branch: "main" }],
    ["https://gitlab.com/group/sub/proj/-/tree/feature", { path: "group/sub/proj", branch: "feature", cloneUrl: "https://gitlab.com/group/sub/proj.git" }],
    ["https://git.acme.com/projects/PAY/repos/ledger/browse?at=refs/heads/release", { path: "PAY/ledger", cloneUrl: "https://git.acme.com/scm/pay/ledger.git", branch: "release" }],
    ["git@bitbucket.org:team/app.git", { host: "bitbucket.org", path: "team/app", ssh: true }],
  ])("parses %s", (input, expected) => {
    expect(parseRepoUrl(input)).toMatchObject(expected);
  });

  it("refuses local and odd protocols", () => {
    expect(parseRepoUrl("file:///etc")).toBeUndefined();
    expect(parseRepoUrl("ext::sh -c touch% /tmp/x")).toBeUndefined();
    expect(parseRepoUrl("https://github.com/only-owner")).toBeUndefined();
  });

  it("links to the right page on each code host", () => {
    const t = (remote: string) => linkTemplate(remote, "abc");
    expect(t("https://bitbucket.org/team/app")).toEqual({ template: "https://bitbucket.org/team/app/src/abc/{path}{line}", anchor: "#lines-" });
    expect(t("https://gitlab.com/g/p").template).toBe("https://gitlab.com/g/p/-/blob/abc/{path}{line}");
    expect(t("https://git.acme.com/projects/PAY/repos/ledger").template).toBe("https://git.acme.com/projects/PAY/repos/ledger/browse/{path}?at=abc{line}");
  });
});

describe("TypeScript repo: v0.2 features", async () => {
  const ix = await scan(await repo(TS_APP));
  const g = buildGraph(ix);
  const risks = await findRisks(ix, g);
  const report = buildReport(ix, g, risks);

  it("maps a stack trace from compiled output back to the source", () => {
    expect(mapPath(ix, "/srv/app/dist/services/notes.js")?.path).toBe("src/services/notes.ts");
    expect(mapPath(ix, "/srv/app/node_modules/express/lib/router.js")).toBeUndefined();
    const r = lookupError(ix, g, "Error: text is required\n    at validate (/srv/app/dist/services/notes.js:17:9)\n    at saveNote (/srv/app/dist/services/notes.js:5:3)\n    at Layer.handle (/srv/app/node_modules/express/lib/router/layer.js:95:5)");
    expect(r.start).toMatchObject({ path: "src/services/notes.ts", line: 17 });
    expect(r.start?.symbol?.name).toBe("validate");
    expect(r.origins[0]).toMatchObject({ path: "src/services/notes.ts", kind: "throw" });
    expect(r.frames.filter((f) => f.file)).toHaveLength(2);
    expect(r.callers).toContain("src/app.ts");
  });

  it("finds where a log-only message comes from", () => {
    const r = lookupError(ix, g, "text is required");
    expect(r.start?.path).toBe("src/services/notes.ts");
  });

  it("works out what a diff touches", () => {
    const diff = ["diff --git a/src/services/notes.ts b/src/services/notes.ts", "--- a/src/services/notes.ts", "+++ b/src/services/notes.ts", "@@ -16,1 +16,2 @@", "+  // stricter", "diff --git a/README.md b/README.md", "new file mode 100644", "@@ -0,0 +1,3 @@"].join("\n");
    expect(parseDiff(diff)).toEqual([
      { path: "src/services/notes.ts", status: "modified", ranges: [[16, 17]] },
      { path: "README.md", status: "added", ranges: [[1, 3]] },
    ]);
    const i = impact(ix, g, diff, risks, { base: "main", head: "HEAD" });
    expect(i.files[0]!.symbols.map((s) => s.name)).toEqual(["validate"]);
    expect(i.dependents.map((d) => d.path)).toEqual(expect.arrayContaining(["src/app.ts", "scripts/seed.ts"]));
    expect(i.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/notes"]);
    expect(i.tests.map((t) => t.path)).toEqual(["test/notes.test.ts"]);
    expect(formatImpact(i)).toContain("POST /api/notes");
  });

  it("builds a first-day tour that names real files", () => {
    const steps = buildTour(report);
    expect(steps.map((s) => s.id)).toEqual(expect.arrayContaining(["what", "run", "config", "map", "entry", "flow", "debug", "tests"]));
    const paths = new Set(ix.files.map((f) => f.path));
    for (const s of steps) for (const f of s.open) expect(paths.has(f.path)).toBe(true);
    expect(steps.find((s) => s.id === "run")?.commands?.map((c) => c.command)).toContain("npm run dev");
    expect(formatTour(report, steps)).toMatch(/^# Your first day in /);
  });

  it("renders an Elemnt page and publishes it: create, then no-op, then update", async () => {
    const source = renderElemnt(report);
    expect(source.length).toBeLessThan(MAX_SOURCE);
    expect(source).toMatch(/^---\ntitle: /);
    expect(source).toContain(":::hero[");
    expect(source).toContain("```mermaid");

    const pages: { id: string; path: string; source: string; head: string }[] = [];
    const calls: string[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push(`${init.method} ${u.pathname}`);
      const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status });
      if ((init.headers as Record<string, string>).Authorization !== "Bearer elm_t") return json(401, { error: "Bad token." });
      if (init.method === "GET" && u.pathname === "/api/spaces/eng/tree") return json(200, { pages: pages.map((p) => ({ id: p.id, path: p.path })) });
      if (init.method === "POST" && u.pathname === "/api/spaces/eng/pages") {
        if (body.path.includes("/") && !pages.some((p) => p.path === body.path.split("/").slice(0, -1).join("/"))) return json(400, { error: "Create the parent page first." });
        pages.push({ id: `p${pages.length}`, path: body.path, source: body.source, head: "r1" });
        return json(201, { url: `/s/eng/${body.path}` });
      }
      const page = pages.find((p) => u.pathname === `/api/pages/${p.id}`);
      if (page && init.method === "GET") return json(200, { headRevisionId: page.head, source: page.source, url: `/s/eng/${page.path}` });
      if (page && init.method === "PUT") {
        if (body.baseRevisionId !== page.head) return json(409, { error: "Stale." });
        Object.assign(page, { source: body.source, head: "r2" });
        return json(200, {});
      }
      return json(404, { error: "Not found." });
    }) as unknown as typeof fetch;

    const o = { url: "https://docs.example.com/", token: "elm_t", space: "eng", path: "codebase/notes", fetch: fakeFetch };
    expect(await publishToElemnt(source, o)).toEqual({ action: "created", url: "https://docs.example.com/s/eng/codebase/notes" });
    expect(pages.map((p) => p.path)).toEqual(["codebase", "codebase/notes"]);
    expect((await publishToElemnt(source, o)).action).toBe("unchanged");
    expect((await publishToElemnt(`${source}\nmore`, o)).action).toBe("updated");
    expect(calls.filter((c) => c.startsWith("PUT"))).toHaveLength(1);
    await expect(publishToElemnt(source, { ...o, token: "nope" })).rejects.toThrow(/rejected the token/);
  });

  it("answers a question with tools, then cites real files", async () => {
    const ws = new Workspace(ix);
    const seen: AskRequest[] = [];
    const replies: AskReply[] = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search", input: { query: "save note" } }, { type: "tool_use", id: "t2", name: "read", input: { path: "src/services/notes.ts", start: 1, end: 9 } }] as AskReply["content"] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t3", name: "read", input: { path: "../../etc/passwd", start: 1, end: 5 } }] as AskReply["content"] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Notes are saved by `saveNote` in src/services/notes.ts:4, which validates first (src/services/notes.ts:16) and is wired up in `src/app.ts`." }] as AskReply["content"] },
    ];
    const model: AskModel = { send: async (req) => (seen.push(structuredClone(req)), replies.shift()!) };
    const steps: string[] = [];
    const r = await ask(ws, model, "How are notes saved?", { onStep: (s) => steps.push(s.label) });
    expect(steps).toEqual(['Searched for "save note"', "Read src/services/notes.ts:1-9", "Read ../../etc/passwd"]);
    const results = seen[1]!.messages.at(-1)!.content as { content: string }[];
    expect(results[1]!.content).toContain("export async function saveNote");
    const third = seen[2]!.messages.at(-1)!.content as { content: string; is_error?: boolean }[];
    expect(third[0]).toMatchObject({ is_error: true });
    expect(r.cites).toEqual([{ path: "src/services/notes.ts", line: 4 }, { path: "src/services/notes.ts", line: 16 }, { path: "src/app.ts" }]);
    expect(citations(ws, "see nowhere.ts:3")).toEqual([]);
  });

  it("stops looking after the turn limit and makes Claude answer", async () => {
    const ws = new Workspace(ix);
    const seen: AskRequest[] = [];
    const model: AskModel = {
      send: async (req) => {
        seen.push(req);
        return req.noTools ? { stop_reason: "end_turn", content: [{ type: "text", text: "Best guess." }] as AskReply["content"] } : { stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${seen.length}`, name: "search", input: { query: "x" } }] as AskReply["content"] };
      },
    };
    expect((await ask(ws, model, "?")).answer).toBe("Best guess.");
    expect(seen.at(-1)!.noTools).toBe(true);
    expect(seen.at(-1)!.tools.length).toBeGreaterThan(0);
  });
});

describe("Python repo: v0.2 features", async () => {
  const ix = await scan(await repo(PY_APP));
  const g = buildGraph(ix);

  it("reads a Python traceback innermost-first", () => {
    const tb = `Traceback (most recent call last):
  File "/usr/lib/python3.12/site-packages/starlette/routing.py", line 74, in app
  File "/code/app/api/orders.py", line 16, in create_order
    return charge(order)
  File "/code/app/services/billing.py", line 10, in charge
    return _send(order)
  File "/code/app/services/billing.py", line 17, in _send
    raise RuntimeError("declined")
RuntimeError: declined`;
    const r = lookupError(ix, g, tb);
    expect(r.start).toMatchObject({ path: "app/services/billing.py", line: 17 });
    expect(r.frames.filter((f) => f.file).map((f) => f.symbol?.name)).toEqual(["_send", "charge", "create_order"]);
  });
});

describe("scanning part of a monorepo", () => {
  it("parses only the folders asked for, and remembers them", async () => {
    const root = await repo(TS_APP);
    const ix = await scan(root, { only: ["src/services"] });
    expect(ix.files.map((f) => f.path)).toEqual(["src/services/notes.ts"]);
    expect(ix.only).toEqual(["src/services"]);
  });
});
