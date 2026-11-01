import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { RiskKind } from "./analysis/risks.js";
import { formatEnv, formatFile, formatHits, formatModule, formatOverview, formatRisks, formatRoutes, formatSkipped, formatTrace } from "./format.js";
import { agentsOnMap, braidState, formatAgents } from "./integrations/braid.js";
import { formatErrorLookup, lookupError } from "./query/errors.js";
import { defaultBase, formatImpact, gitDiff, impact } from "./query/impact.js";
import { searchText, showSource } from "./query/source.js";
import { resolveTarget, trace } from "./query/trace.js";
import { where } from "./query/where.js";
import { buildReport, type Report } from "./report/model.js";
import { buildTour, formatTour } from "./report/tour.js";
import { changeStamp } from "./scan/walk.js";
import type { FileFacts } from "./types.js";
import { openWorkspace, type Workspace } from "./workspace.js";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** Outside git: how long an index is trusted before a tool call rescans (incrementally) to pick up edits. */
const FRESH_MS = 20_000;

const RISK_KINDS = ["missing-route", "swallowed-error", "cycle", "duplicate", "hotspot", "large-file", "long-function", "untested", "orphan", "env-undocumented", "env-unused", "todo", "parse-error"] as const;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError } : {}) });

/** One repository a tool call reads. */
export interface RepoHandle {
  root: string;
  workspace(): Promise<Workspace>;
  report(): Promise<Report>;
}

/**
 * Where the tools get their repository from. Local (`spelunk mcp`): the folder
 * the client started it in. Remote (`spelunk serve` at /mcp): a public link the
 * caller names in every tool call, so the tools take a `repo` argument.
 */
export interface ToolHost {
  remote: boolean;
  /** The repository, or a sentence to show instead (still downloading, not allowed, …). */
  open(repo: string | undefined): Promise<RepoHandle | string>;
}

const INSTRUCTIONS = `Spelunk has already indexed this repository (files, symbols, imports, call graph, HTTP routes, env vars, risks). Prefer these tools to grep, find and reading whole files: they answer in a few hundred tokens with path:line.

- New repo: overview, then module for the part you need.
- "Where is X": where (features, error text, routes, symbols). symbols for names.
- "How does X work": trace (route, function or file), then source for just the function you need instead of the whole file.
- Before reading a file: file lists its symbols with line numbers; source shows one symbol or a line range.
- Before changing something: dependents (who imports it) and trace (who calls it).
- Errors and stack traces: lookup_error.`;

const REMOTE_INSTRUCTIONS = `${INSTRUCTIONS}

Every tool takes \`repo\`: a public GitHub, GitLab or Bitbucket link, or "owner/name" for GitHub. The first call downloads and indexes it; if a tool says it is still indexing, wait a little and call again. search_text finds exact text when where isn't enough. Private repositories aren't available here; run \`spelunk mcp\` locally for those.`;

const REPO_ARG = { repo: z.string().min(1).describe('The repository: a public GitHub/GitLab/Bitbucket link, or "owner/name" for GitHub') };

/**
 * Registers Spelunk's tools on an MCP server. Local and remote share every
 * tool that only reads the index; the ones that need a working copy you own
 * (impact, agents) are local only, and search_text is remote only because a
 * local agent already has grep.
 */
export function registerTools(server: McpServer, host: ToolHost): void {
  const readOnly = { readOnlyHint: true, openWorldHint: host.remote };
  const repoArg = host.remote ? REPO_ARG : {};

  /** Opens the repository a call names, and turns failures into a readable result instead of a protocol error. */
  const withRepo =
    <A>(run: (r: RepoHandle, args: A) => Promise<string>) =>
    async (args: A): Promise<Result> => {
      try {
        const r = await host.open((args as { repo?: string }).repo);
        if (typeof r === "string") return text(r);
        return text(await run(r, args));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    };
  const fileOf = (ws: Workspace, path: string): FileFacts | undefined => ws.index.files.find((f) => f.path === path) ?? ws.index.files.find((f) => f.path.endsWith(`/${path}`));

  server.registerTool(
    "overview",
    {
      description: "Start here. What this repository is, its languages, entry points, commands to run it, and its modules (directories) with what each depends on. Includes Claude's summaries when `spelunk explain` has been run.",
      inputSchema: repoArg,
      annotations: readOnly,
    },
    withRepo(async (r) => formatOverview(await r.report())),
  );

  server.registerTool(
    "where",
    {
      description: "Find where something lives: a feature (\"password reset\"), an error message, a route, a function or an environment variable. Ranked results with path:line and why each matched. Use before grepping in an unfamiliar repo.",
      inputSchema: { ...repoArg, query: z.string().describe("Plain words, an error message, a symbol name or a route"), limit: z.number().int().min(1).max(50).optional() },
      annotations: readOnly,
    },
    withRepo(async (r, { query, limit }: { query: string; limit?: number | undefined }) => formatHits(query, where((await r.workspace()).index, query, { limit: limit ?? 15 }))),
  );

  server.registerTool(
    "trace",
    {
      description: "Follow how code connects. For a route (\"PUT /api/pages/:id\"): the client code that calls it and the handler's call tree. For a function (\"updatePage\" or \"Store.put\"): what it calls and who uses it. For a file: its imports, importers and how entry points reach it.",
      inputSchema: { ...repoArg, target: z.string().describe("A route, a symbol name, or a file path"), depth: z.number().int().min(1).max(5).optional() },
      annotations: readOnly,
    },
    withRepo(async (r, { target, depth }: { target: string; depth?: number | undefined }) => {
      const ws = await r.workspace();
      const targets = resolveTarget(ws.index, target);
      if (!targets.length) return `Nothing called "${target}". Try the where tool.`;
      const out = targets.slice(0, 3).map((t) => formatTrace(trace(ws.index, ws.graph, t, { depth: depth ?? 2 })));
      if (targets.length > 3) out.push(`${targets.length - 3} more matches: ${targets.slice(3, 12).map((t) => `${t.path}${t.line ? `:${t.line}` : ""}`).join(", ")}`);
      return out.join("\n\n---\n\n");
    }),
  );

  server.registerTool(
    "source",
    {
      description:
        'Show code without reading the whole file: one function, method or class by name ("saveNote", "Store.put"), or a file\'s lines ("src/app.ts", "src/app.ts:40-80"). Lines are numbered. Use after file, trace or where told you what to look at.',
      inputSchema: {
        ...repoArg,
        target: z.string().min(1).describe('A symbol name ("saveNote", "Store.put"), a path, or path:start-end'),
        path: z.string().optional().describe("When a name is defined in several places: only look in files under this path"),
      },
      annotations: readOnly,
    },
    withRepo(async (r, { target, path }: { target: string; path?: string | undefined }) => showSource((await r.workspace()).index, target, { ...(path ? { path } : {}) })),
  );

  server.registerTool(
    "file",
    {
      description: "Everything known about one file: its role, symbols with line numbers, routes, imports, importers, environment variables, and where it throws or logs errors. Cheaper than reading the file to decide whether you need to.",
      inputSchema: { ...repoArg, path: z.string().describe("Repo-relative path, or a unique suffix of one") },
      annotations: readOnly,
    },
    withRepo(async (r, { path }: { path: string }) => {
      const ws = await r.workspace();
      const f = fileOf(ws, path);
      return f ? formatFile(ws, f) : `No file "${path}" in the index. Use where to find it.`;
    }),
  );

  server.registerTool(
    "module",
    {
      description: "One module (directory): its files ranked by how much they're imported, what it depends on and what uses it, plus Claude's summary, responsibilities and gotchas when explained.",
      inputSchema: { ...repoArg, path: z.string().describe('Directory path from overview, e.g. "apps/server/src"') },
      annotations: readOnly,
    },
    withRepo(async (r, { path }: { path: string }) => {
      const rep = await r.report();
      return formatModule(rep, path) ?? `No module "${path}". Modules: ${rep.modules.map((m) => m.path || "(root)").join(", ")}`;
    }),
  );

  server.registerTool(
    "dependencies",
    {
      description: "Files a file imports (inside the repo), with the names it uses from each, and its external packages.",
      inputSchema: { ...repoArg, path: z.string() },
      annotations: readOnly,
    },
    withRepo(async (r, { path }: { path: string }) => {
      const f = fileOf(await r.workspace(), path);
      if (!f) return `No file "${path}".`;
      const lines = f.imports.filter((i) => i.targets.length).map((i) => `${i.targets.join(", ")}${i.names?.length ? `  (${i.names.join(", ")})` : ""}  [line ${i.line}]`);
      const ext = [...new Set(f.imports.flatMap((i) => (i.external ? [i.external] : [])))];
      const unresolved = f.imports.filter((i) => !i.targets.length && !i.external).map((i) => i.spec);
      return [`${f.path} imports:`, ...(lines.length ? lines : ["(nothing in the repo)"]), ...(ext.length ? ["", `External: ${ext.join(", ")}`] : []), ...(unresolved.length ? ["", `Unresolved: ${unresolved.join(", ")}`] : [])].join("\n");
    }),
  );

  server.registerTool(
    "dependents",
    {
      description: "Files that import a file: what breaks, or needs checking, if you change it.",
      inputSchema: { ...repoArg, path: z.string() },
      annotations: readOnly,
    },
    withRepo(async (r, { path }: { path: string }) => {
      const ws = await r.workspace();
      const f = fileOf(ws, path);
      if (!f) return `No file "${path}".`;
      const users = [...(ws.graph.in.get(f.path) ?? [])].sort();
      const twoHops = new Set(users.flatMap((u) => [...(ws.graph.in.get(u) ?? [])]).filter((p) => p !== f.path && !users.includes(p)));
      return [`${f.path} is imported by ${users.length} files:`, ...users, ...(twoHops.size ? ["", `And indirectly by ${twoHops.size} more: ${[...twoHops].slice(0, 40).join(", ")}`] : [])].join("\n");
    }),
  );

  server.registerTool(
    "symbols",
    {
      description: "Look up functions, classes, methods and types by name across the repo, with signature, location and doc comment.",
      inputSchema: { ...repoArg, name: z.string().describe("Exact or partial name, case-insensitive"), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
    },
    withRepo(async (r, { name, limit }: { name: string; limit?: number | undefined }) => {
      const ws = await r.workspace();
      const q = name.toLowerCase();
      const hits = ws.index.files
        .flatMap((f) => f.symbols.filter((s) => s.name.toLowerCase().includes(q)).map((s) => ({ f, s })))
        .sort((a, b) => Number(b.s.name.toLowerCase() === q) - Number(a.s.name.toLowerCase() === q) || Number(a.f.role !== "source") - Number(b.f.role !== "source") || a.s.name.length - b.s.name.length)
        .slice(0, limit ?? 30);
      if (!hits.length) return `No symbol matching "${name}".`;
      return hits.map(({ f, s }) => `${f.path}:${s.line}  ${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name}\n    ${s.signature}${s.doc ? `\n    ${s.doc.slice(0, 160)}` : ""}`).join("\n");
    }),
  );

  server.registerTool(
    "routes",
    {
      description: "HTTP routes the server defines and the client calls that hit them, with handler locations.",
      inputSchema: { ...repoArg, filter: z.string().optional().describe("Substring of method, path or file") },
      annotations: readOnly,
    },
    withRepo(async (r, { filter }: { filter?: string | undefined }) => formatRoutes((await r.workspace()).index, filter)),
  );

  server.registerTool(
    "env_vars",
    {
      description: "Environment variables the code reads, where each is read, and whether the .env example documents it.",
      inputSchema: repoArg,
      annotations: readOnly,
    },
    withRepo(async (r) => formatEnv(await r.report())),
  );

  server.registerTool(
    "risks",
    {
      description: "Places likely to hide bugs: swallowed errors, client calls to routes that don't exist, import cycles, duplicated code, hotspots (big files that change often), long functions, untested modules, dead files, undocumented env vars, TODOs.",
      inputSchema: { ...repoArg, kind: z.enum(RISK_KINDS).optional(), path: z.string().optional().describe("Only findings in files under this path"), limit: z.number().int().min(1).max(200).optional() },
      annotations: readOnly,
    },
    withRepo(async (r, { kind, path, limit }: { kind?: (typeof RISK_KINDS)[number] | undefined; path?: string | undefined; limit?: number | undefined }) => {
      const risks = await (await r.workspace()).risks();
      const scoped = path ? risks.filter((x) => x.locations.some((l) => l.path.startsWith(path))) : risks;
      return formatRisks(scoped, { ...(kind ? { kind: kind as RiskKind } : {}), limit: limit ?? 40 });
    }),
  );

  server.registerTool(
    "lookup_error",
    {
      description: "Paste an error message, log line or whole stack trace. Returns where to start reading: the repo's own frames mapped to files and functions (even from compiled or container paths), the throw or log statements that produce the message, callers, and risks nearby.",
      inputSchema: { ...repoArg, text: z.string().min(1).describe("The error or stack trace, as printed") },
      annotations: readOnly,
    },
    withRepo(async (r, { text: input }: { text: string }) => {
      const ws = await r.workspace();
      return formatErrorLookup(lookupError(ws.index, ws.graph, input, await ws.risks()));
    }),
  );

  server.registerTool(
    "onboarding_tour",
    {
      description: "A first-day walkthrough of this repository for someone new: what it is, how to run it, the settings it needs, the big parts, where it starts, one request end to end, the core files, where bugs hide, how to debug and test. Each step names the files to open in order.",
      inputSchema: repoArg,
      annotations: readOnly,
    },
    withRepo(async (r) => {
      const rep = await r.report();
      return formatTour(rep, buildTour(rep));
    }),
  );

  if (host.remote) {
    server.registerTool(
      "search_text",
      {
        description: "Find exact text in the repository's files (case-insensitive), like grep: path:line and the line. Use where first; this is for strings where doesn't find.",
        inputSchema: { ...repoArg, text: z.string().min(2).describe("The text to find, as written"), path: z.string().optional().describe("Only files under this path"), limit: z.number().int().min(1).max(100).optional() },
        annotations: readOnly,
      },
      withRepo(async (r, { text: needle, path, limit }: { text: string; path?: string | undefined; limit?: number | undefined }) => searchText((await r.workspace()).index, needle, { ...(path ? { path } : {}), limit: limit ?? 40 })),
    );
    return;
  }

  server.registerTool(
    "impact",
    {
      description: "What the current branch changes compared with a base branch: changed functions, files that depend on them, HTTP routes whose handlers reach the change, tests to run, changed files no test reaches, settings read in changed lines, and risks in the changed lines. Use before review or before pushing.",
      inputSchema: {
        base: z.string().optional().describe("Branch or commit to compare with; default the remote's main branch"),
        include_uncommitted: z.boolean().optional().describe("Also count uncommitted edits"),
      },
      annotations: readOnly,
    },
    withRepo(async (r, { base, include_uncommitted }: { base?: string | undefined; include_uncommitted?: boolean | undefined }) => {
      const ws = await r.workspace();
      const b = base ?? (await defaultBase(r.root));
      const diff = await gitDiff(r.root, b, { ...(include_uncommitted ? { includeWorkingTree: true } : {}) });
      return formatImpact(impact(ws.index, ws.graph, diff, await ws.risks(), { base: b, head: include_uncommitted ? "working tree" : "HEAD" }));
    }),
  );

  server.registerTool(
    "agents",
    {
      description: "Only in repositories run with Braid (several coding agents at once): which parts of the code each Braid agent is changing, files included, the parts more than one agent is in, and the collisions Braid predicts. Use it before editing a shared module.",
      inputSchema: {},
      annotations: readOnly,
    },
    withRepo(async (r) => {
      const state = await braidState(r.root);
      if (!state) return "Braid isn't running agents in this repository.";
      return formatAgents(agentsOnMap(state, await r.report()));
    }),
  );
}

/**
 * The local server (`spelunk mcp`). Each call checks `git status` (plus the
 * times of dirty files) and rescans only when the tree changed, so an agent
 * editing the repo sees its own changes without paying for a scan on every
 * call. Outside git, the index is trusted for a few seconds instead.
 */
export function createServer(root: string): McpServer {
  let current: { ws: Workspace; at: number; stamp: string | undefined; report?: Report } | undefined;
  let pending: Promise<Workspace> | undefined;

  const workspace = async (force = false): Promise<Workspace> => {
    if (current && !force && !pending) {
      if (current.stamp === undefined ? Date.now() - current.at < FRESH_MS : (await changeStamp(root)) === current.stamp) return current.ws;
    }
    pending ??= (async () => {
      // Stamped before the scan, so an edit made while it runs is caught by the next call.
      const stamp = await changeStamp(root);
      const ws = await openWorkspace(root, { refresh: true });
      current = { ws, at: Date.now(), stamp };
      return ws;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const report = async (): Promise<Report> => {
    const ws = await workspace();
    if (current?.ws === ws && current.report) return current.report;
    const r = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
    if (current?.ws === ws) current.report = r;
    return r;
  };

  const server = new McpServer({ name: "spelunk", version: VERSION }, { instructions: INSTRUCTIONS });
  const handle: RepoHandle = { root, workspace: () => workspace(), report };
  // Registered for every project (`spelunk setup claude`), Claude Code may also start it in the home folder;
  // indexing all of that would be slow and useless, so the tools say so instead.
  const notAProject = root === resolve(homedir()) || root === dirname(root);
  registerTools(server, { remote: false, open: async () => (notAProject ? `Spelunk is running in ${root}, which isn't a project folder. Start Claude Code inside a repository to use it.` : handle) });

  server.registerTool(
    "rescan",
    {
      description: "Re-index the repository now. Other tools already rescan when the index is a few seconds old, so this is only needed after large changes like a branch switch.",
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const ws = await workspace(true);
      return text(`Indexed ${ws.index.files.length} files. ${formatSkipped(ws.index.skipped)}`);
    },
  );

  return server;
}

/** The remote server (`spelunk serve` at /mcp): the same tools, each naming a public repository. */
export function createRemoteServer(open: ToolHost["open"]): McpServer {
  const server = new McpServer({ name: "spelunk", version: VERSION }, { instructions: REMOTE_INSTRUCTIONS });
  registerTools(server, { remote: true, open });
  return server;
}

/** Reports cached per scan, for hosts that hand out shared workspaces. */
const reports = new WeakMap<Workspace, Promise<Report>>();
export function reportFor(ws: Workspace): Promise<Report> {
  let r = reports.get(ws);
  if (!r) {
    r = (async () => buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations()))();
    reports.set(ws, r);
    r.catch(() => reports.delete(ws));
  }
  return r;
}

export async function serve(root: string): Promise<void> {
  const server = createServer(root);
  await server.connect(new StdioServerTransport());
}
