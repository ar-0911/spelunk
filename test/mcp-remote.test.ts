import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLAUDE_MD_NOTE, setupClaude, withNote } from "../src/integrations/claude-setup.js";
import { repoLink } from "../src/mcp-http.js";
import { createRemoteServer, createServer, reportFor } from "../src/mcp.js";
import { showSource } from "../src/query/source.js";
import { startUi } from "../src/ui/server.js";
import { openWorkspace } from "../src/workspace.js";
import { repo, TS_APP } from "./helpers.js";

type Text = { content: { text: string }[]; isError?: boolean };

describe("source tool", async () => {
  const root = await repo(TS_APP);
  const { index } = await openWorkspace(root);

  it("shows one function by name with its doc comment, numbered", async () => {
    const out = await showSource(index, "saveNote");
    expect(out).toMatch(/^src\/services\/notes\.ts:4-7 {2}function saveNote/);
    expect(out).toContain("3  /** Saves a note and returns it with its id. */");
    expect(out).toContain("5    validate(input);");
    expect(out).not.toContain("listNotes");
  });

  it("shows a file's line range, and refuses paths outside the index", async () => {
    expect(await showSource(index, "src/app.ts:5-6")).toBe("src/app.ts:5-6 of 10\n5  export function createApp() {\n6    const app = express();");
    expect(await showSource(index, "../../etc/passwd")).toMatch(/^No file or symbol/);
    expect(await showSource(index, "nothingLikeThis")).toMatch(/Try symbols or where/);
  });

  it("is on the local server, without search_text", async () => {
    const server = createServer(root);
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getInstructions()).toMatch(/Prefer these tools to grep/);
    const r = (await client.callTool({ name: "source", arguments: { target: "listNotes" } })) as Text;
    expect(r.content[0]!.text).toContain("return await db.all();");
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("search_text");
  });
});

describe("remote tools", async () => {
  const root = await repo(TS_APP);
  const ws = await openWorkspace(root);
  const asked: (string | undefined)[] = [];
  const server = createRemoteServer(async (r) => {
    asked.push(r);
    if (r === "slow/repo") return "Still downloading and indexing github.com/slow/repo.";
    return { root, workspace: async () => ws, report: () => reportFor(ws) };
  });
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })) as Text).content[0]!.text;

  it("takes a repo on every tool, adds search_text, and leaves out the local-only tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_text");
    expect(names).toContain("source");
    for (const local of ["impact", "agents", "rescan"]) expect(names).not.toContain(local);
    for (const t of tools) expect(t.inputSchema.required).toContain("repo");
  });

  it("answers from the repository the call names", async () => {
    expect(await call("where", { repo: "owner/notes", query: "save note" })).toContain("src/services/notes.ts:4");
    expect(asked.at(-1)).toBe("owner/notes");
    expect(await call("overview", { repo: "owner/notes" })).toContain("src/main.ts");
    expect(await call("search_text", { repo: "owner/notes", text: "api/notse" })).toBe('src/web/client.ts:3  await fetch("/api/notse");');
    expect(await call("trace", { repo: "slow/repo", target: "x" })).toMatch(/Still downloading/);
  });
});

describe("remote MCP over HTTP (spelunk serve /mcp)", async () => {
  const ui = await startUi({ open: false, port: 0, hosted: { host: "127.0.0.1", allowedHosts: ["github.com"] } });
  const client = new Client({ name: "t", version: "0" });
  afterAll(async () => {
    await client.close();
    await ui.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(ui.url + "mcp")));
  const call = async (args: Record<string, unknown>) => (await client.callTool({ name: "overview", arguments: args })) as Text;

  it("needs no cookie, and says how to use it", async () => {
    expect(client.getInstructions()).toMatch(/Every tool takes `repo`/);
    expect((await client.listTools()).tools.length).toBeGreaterThan(10);
  });

  it("only downloads public https links from the allowed hosts", async () => {
    expect((await call({ repo: "git@github.com:a/b.git" })).content[0]!.text).toMatch(/isn't a repository link/);
    expect((await call({ repo: "https://gitlab.com/a/b" })).content[0]!.text).toMatch(/only downloads from github\.com/);
    expect((await call({ repo: "file:///etc" })).content[0]!.text).toMatch(/isn't a repository link/);
    expect(repoLink("ar-0911/spelunk")).toBe("https://github.com/ar-0911/spelunk");
    expect(repoLink("https://github.com/a/b/tree/dev")).toBe("https://github.com/a/b/tree/dev");
  });

  it("tells MCP clients there's no sign-in to discover", async () => {
    for (const path of [".well-known/oauth-protected-resource", ".well-known/oauth-protected-resource/mcp", ".well-known/oauth-authorization-server"]) expect((await fetch(ui.url + path)).status).toBe(404);
  });

  it("still serves the dashboard behind its cookie", async () => {
    expect((await fetch(ui.url + "api/state")).status).toBe(401);
  });
});

describe("spelunk setup claude", () => {
  it("adds the note once, keeps the rest of CLAUDE.md, and updates it in place", () => {
    expect(withNote("")).toBe(`${CLAUDE_MD_NOTE}\n`);
    const mine = "# Me\n\nUse tabs.\n";
    const once = withNote(mine);
    expect(once.startsWith("# Me\n\nUse tabs.\n\n<!-- spelunk:start -->")).toBe(true);
    expect(withNote(once)).toBe(once);
    const old = once.replace("Use Spelunk first", "old wording");
    expect(withNote(old)).toBe(once);
  });

  it("writes the note and prints the command when the claude CLI is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spelunk-setup-"));
    const md = join(dir, "CLAUDE.md");
    await writeFile(md, "# Mine\n");
    const r = await setupClaude({ claudeMd: md, claude: "definitely-not-claude" });
    expect(r.manual[0]).toMatch(/^definitely-not-claude mcp add --scope user spelunk -- \S+ \S+cli\.js mcp$/);
    expect(await readFile(md, "utf8")).toContain("# Mine\n\n<!-- spelunk:start -->");
    const dry = await setupClaude({ claudeMd: join(dir, "other.md"), claude: "definitely-not-claude", dryRun: true });
    expect(dry.steps[0]).toMatch(/^Would create/);
  });
});
