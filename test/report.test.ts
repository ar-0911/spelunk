import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { JsonClient, JsonRequest } from "../src/explain/claude.js";
import { explain, explanationsPath, plan, type ModuleExplanation, type Overview } from "../src/explain/explain.js";
import { createServer } from "../src/mcp.js";
import { renderHtml } from "../src/report/html.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { buildReport } from "../src/report/model.js";
import { openWorkspace } from "../src/workspace.js";
import { TS_APP, repo } from "./helpers.js";

/** Stands in for Claude: answers from the schema's shape and records what it was sent. */
class FakeClaude implements JsonClient {
  requests: JsonRequest[] = [];
  async json<T>(req: JsonRequest): Promise<T> {
    this.requests.push(req);
    const isOverview = "flows" in ((req.schema.properties as object) ?? {});
    if (!isOverview) {
      const m: ModuleExplanation = { summary: "Business logic for notes.", responsibilities: ["Saves notes"], keyFiles: [{ path: "src/services/notes.ts", role: "Note service" }], gotchas: ["listNotes hides database errors"] };
      return m as T;
    }
    const o: Overview = {
      oneLiner: "A tiny notes API.",
      whatItDoes: "Stores notes.",
      architecture: "Express routes call a service that calls the db.",
      flows: [{ name: "Saving a note", summary: "POST to the API.", steps: [{ what: "Client posts", path: "src/web/client.ts" }, { what: "Service saves", path: "src/services/notes.ts", symbol: "saveNote" }, { what: "Invented", path: "src/nope.ts" }] }],
      runLocally: ["npm run dev"],
      debugging: { firstChecks: ["Is DATABASE_URL set?"], logs: ["stdout"], failurePoints: [{ symptom: "Empty list", likelyCause: "Swallowed db error", whereToLook: "src/services/notes.ts" }] },
      glossary: [{ term: "Note", meaning: "A piece of text" }],
    };
    return o as T;
  }
}

describe("explain and reports", async () => {
  const root = await repo(TS_APP);
  const ws = await openWorkspace(root);

  it("estimates cost before calling Claude", async () => {
    const p = await plan(ws.index, ws.graph);
    expect(p.modules.length).toBeGreaterThan(0);
    expect(p.estimate.dollars).toBeGreaterThan(0);
  });

  it("explains modules, then the whole repo, and checks Claude's paths", async () => {
    const fake = new FakeClaude();
    const e = await explain(ws.index, ws.graph, await ws.risks(), fake);
    expect(fake.requests.length).toBe(Object.keys(e.modules).length + 1);
    expect(fake.requests.some((r) => r.prompt.includes("export async function saveNote"))).toBe(true);
    const steps = e.overview!.flows[0]!.steps;
    expect(steps.map((s) => s.path)).toEqual(["src/web/client.ts", "src/services/notes.ts"]); // invented path dropped
    expect(steps[1]!.line).toBe(4); // line filled in from the index
    expect(JSON.parse(await readFile(explanationsPath(root), "utf8")).overview.oneLiner).toBe("A tiny notes API.");
  });

  it("renders HTML and Markdown guides with the explanations", async () => {
    const r = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
    expect(r.routes.map((x) => `${x.method} ${x.path} ${x.callers.length}`)).toEqual(["GET /api/notes 0", "POST /api/notes 1"]);
    const html = renderHtml(r, ws.index);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("A tiny notes API.");
    expect(html).toContain("<svg");
    expect(html).toContain("listNotes hides database errors");
    const md = renderMarkdown(r);
    expect(md).toContain("```mermaid");
    expect(md).toContain("### Saving a note");
    expect(md).toContain("| Empty list | Swallowed db error |");
  });
});

describe("MCP server", async () => {
  const root = await repo(TS_APP);
  const server = createServer(root);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => ((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]!.text;

  it("lists its tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["dependencies", "dependents", "env_vars", "file", "module", "overview", "rescan", "risks", "routes", "symbols", "trace", "where"]);
  });

  it("answers with path:line locations", async () => {
    expect(await call("overview")).toContain("src/main.ts  (server start)");
    expect(await call("where", { query: "save note" })).toContain("src/services/notes.ts:4");
    expect(await call("trace", { target: "POST /api/notes" })).toContain("src/web/client.ts:2");
    expect(await call("dependents", { path: "src/db.ts" })).toContain("src/services/notes.ts");
    expect(await call("symbols", { name: "listnotes" })).toContain("src/services/notes.ts:9");
    expect(await call("risks", { kind: "missing-route" })).toContain("GET /api/notse");
    expect(await call("file", { path: "nope.ts" })).toContain('No file "nope.ts"');
  });
});
