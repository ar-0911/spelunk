import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGraph } from "../src/analysis/graph.js";
import { findRisks } from "../src/analysis/risks.js";
import { agentsOnMap, braidHere, braidState, errorTask, formatAgents, riskTask, startBraid, type BraidState } from "../src/integrations/braid.js";
import { parseFiles } from "../src/integrations/facts.js";
import { lookupError } from "../src/query/errors.js";
import { gitDiff, impact, mergeBase } from "../src/query/impact.js";
import { renderHtml } from "../src/report/html.js";
import { buildReport } from "../src/report/model.js";
import { scan } from "../src/scan/scan.js";
import { startUi } from "../src/ui/server.js";
import { TS_APP, repo } from "./helpers.js";

const FAKE = join(import.meta.dirname, "fakes", "braid.mjs");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

const STATE = (worktree: string): BraidState => ({
  schema: 1,
  repo: "/x",
  name: "notes",
  base: "main",
  daemon: 123,
  agents: [
    { name: "save-author", status: "active", task: "saveNote takes an author", branch: "agent/save-author", base: "main", worktree, running: true, ahead: 1, owns: [], intents: [], files: ["src/services/notes.ts", "src/db.ts"], needs: null },
    { name: "list-api", status: "ready", task: "list endpoint paging", branch: "agent/list-api", base: "main", worktree: "/nowhere", running: false, ahead: 2, owns: [], intents: [], files: ["src/app.ts", "src/services/notes.ts"], needs: null },
    { name: "old", status: "landed", task: "done already", branch: "agent/old", base: "main", worktree: "/nowhere", running: false, ahead: null, owns: [], intents: [], files: ["src/main.ts"], needs: null },
  ],
  risks: [{ a: "save-author", b: "list-api", severity: "semantic", files: ["src/app.ts calls saveNote(), whose parameters changed"] }],
  plans: [],
  approvals: [{ id: 1, status: "pending", agent: "list-api", title: "paging" }],
});

describe("facts (for Braid's conflict checks)", () => {
  it("parses files from stdin-shaped input without a repository", async () => {
    const out = await parseFiles({ files: [
      { path: "a.py", text: "def save(text, author=None):\n    return log(text)\n" },
      { path: "b.go", text: "package m\nfunc (s *S) Handle(w int) { s.do(w) }\n" },
      { path: "notes.txt", text: "hello" },
    ] });
    expect(out.files.map((f) => f.path)).toEqual(["a.py", "b.go"]);
    expect(out.files[0]!.symbols[0]).toMatchObject({ name: "save", kind: "function", signature: "def save(text, author=None):" });
    expect(out.files[0]!.callSites).toContainEqual(["log", 2]);
    expect(out.files[1]!.symbols[0]).toMatchObject({ name: "Handle", parent: "S" });
  });

  it("refuses input that isn't a files list", async () => {
    await expect(parseFiles({} as never)).rejects.toThrow(/files/);
  });
});

describe("with Braid", () => {
  let root: string, wt: string, saved: Record<string, string | undefined>;
  beforeAll(async () => {
    root = await repo(TS_APP);
    git(root, "init", "-q", "-b", "main");
    git(root, "add", ".");
    git(root, "commit", "-qm", "base");
    wt = `${root}.agents/save-author`;
    git(root, "worktree", "add", "-q", "-b", "agent/save-author", wt, "main");
    await writeFile(join(wt, "src/services/notes.ts"), (await readFile(join(wt, "src/services/notes.ts"), "utf8")).replace("input: { text: string })", "input: { text: string }, author: string)"));
    await mkdir(join(root, ".git", "braid"), { recursive: true });
    await writeFile(join(root, ".git", "braid", "state.db"), "");
    await writeFile(join(root, "state.json"), JSON.stringify(STATE(wt)));
    saved = { SPELUNK_BRAID: process.env.SPELUNK_BRAID, FAKE_BRAID_STATE: process.env.FAKE_BRAID_STATE, FAKE_BRAID_LOG: process.env.FAKE_BRAID_LOG };
    process.env.SPELUNK_BRAID = `${process.execPath} ${FAKE}`;
    process.env.FAKE_BRAID_STATE = join(root, "state.json");
    process.env.FAKE_BRAID_LOG = join(root, "braid-calls.jsonl");
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });

  it("finds Braid through the shared git dir, from the repo and from an agent's worktree", async () => {
    expect(await braidHere(root)).toBe(true);
    expect(await braidHere(wt)).toBe(true);
    process.env.SPELUNK_BRAID = "off";
    expect(await braidHere(root)).toBe(false);
    process.env.SPELUNK_BRAID = `${process.execPath} ${FAKE}`;
  });

  it("puts agents on the module map, with shared parts and collisions", async () => {
    const index = await scan(root);
    const g = buildGraph(index);
    const report = buildReport(index, g, await findRisks(index, g));
    const m = agentsOnMap((await braidState(root))!, report);
    expect(m.agents.find((a) => a.name === "save-author")!.modules).toEqual(["src", "src/services"]);
    expect(m.agents.find((a) => a.name === "old")!.live).toBe(false);
    const services = m.modules.find((x) => x.path === "src/services")!;
    expect(services.agents.map((a) => a.name).sort()).toEqual(["list-api", "save-author"]);
    expect(m.modules.some((x) => x.agents.some((a) => a.name === "old"))).toBe(false); // landed agents aren't on the map
    expect(m.risks[0]!.modules).toEqual(["src"]);
    expect(m.waiting).toBe(1);
    const text = formatAgents(m);
    expect(text).toContain("Parts more than one agent is changing:");
    expect(text).toContain("SEMANTIC save-author ↔ list-api");
    const html = renderHtml(report, index, m);
    expect(html).toContain('id="agents"');
    expect(html).toContain("2◆"); // two agents on src/services
  });

  it("compares an agent's worktree with where its branch split off, uncommitted edits included", async () => {
    const index = await scan(wt);
    const g = buildGraph(index);
    const base = (await mergeBase(wt, "main"))!;
    const i = impact(index, g, await gitDiff(wt, base, { includeWorkingTree: true }), [], { base: "main", head: "save-author" });
    expect(i.files.map((f) => f.path)).toEqual(["src/services/notes.ts"]);
    expect(i.routes.map((r) => `${r.method} ${r.path}`)).toContain("POST /api/notes");
  });

  it("compares a named commit with --head", async () => {
    git(wt, "commit", "-qam", "author");
    const head = git(wt, "rev-parse", "HEAD");
    const diff = await gitDiff(root, "main", { head });
    expect(diff).toContain("author: string");
    await expect(gitDiff(root, "main", { head: "--output=x" })).rejects.toThrow(/isn't a branch/);
  });

  it("turns risks and errors into tasks and hands them to braid", async () => {
    const index = await scan(root);
    const g = buildGraph(index);
    const risks = (await findRisks(index, g)).filter((r) => r.kind === "swallowed-error");
    const task = riskTask(risks);
    expect(task).toMatch(/^swallowed error fix: Spelunk found this:/);
    expect(task).toContain("src/services/notes.ts:");
    const e = errorTask("Error: text is required", lookupError(index, g, "Error: text is required"));
    expect(e).toMatch(/^Error fix: Error: text is required/);
    expect(e).toContain("src/services/notes.ts");
    const started = await startBraid(root, { tasks: [task], base: "feature/x" });
    expect(started.command).toContain("start --base feature/x");
    await expect(startBraid(root, { tasks: ["x"], base: "x; rm -rf /" })).rejects.toThrow(/branch name/);
    await expect(startBraid(root, {})).rejects.toThrow(/Say what/);
    for (let i = 0; i < 50 && !existsSync(process.env.FAKE_BRAID_LOG!); i++) await new Promise((r) => setTimeout(r, 50));
    const calls = (await readFile(process.env.FAKE_BRAID_LOG!, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { args: string[]; cwd: string });
    expect(calls[0]!.args).toEqual(["start", "--base", "feature/x", task]);
  });

  it("dashboard: agents, an agent's changes, and Fix with Braid", async () => {
    const ui = await startUi({ root, open: false });
    try {
      const token = new URL(ui.url).searchParams.get("t")!;
      const base = ui.url.replace(/\/\?t=.*/, "");
      const get = async (p: string) => (await fetch(base + p, { headers: { "x-spelunk-token": token } })).json() as Promise<Record<string, unknown>>;
      const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { "x-spelunk-token": token, "content-type": "application/json" }, body: JSON.stringify(body) });
      const st = (await get("/api/state")) as { braid: { here: boolean; canStart: boolean } };
      expect(st.braid).toMatchObject({ here: true, canStart: true });
      const agents = (await get("/api/agents")) as { here: boolean; agents: { name: string }[] };
      expect(agents.here).toBe(true);
      expect(agents.agents.map((a) => a.name)).toContain("save-author");
      expect(String((await get("/api/report")).diagram)).toContain("◆");
      const i = (await get("/api/impact?agent=save-author")) as { agent: string; files: { path: string }[] };
      expect(i.agent).toBe("save-author");
      expect(i.files.map((f) => f.path)).toEqual(["src/services/notes.ts"]);
      expect((await post("/api/braid/start", { kind: "swallowed-error" })).status).toBe(200);
      expect((await post("/api/braid/start", { kind: "no-such-kind" })).status).toBe(400);
      const r = await post("/api/braid/start", { goal: "add paging" });
      expect(((await r.json()) as { command: string }).command).toContain("do --yes");
    } finally {
      await ui.close();
    }
  });
});
