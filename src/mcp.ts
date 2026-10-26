import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { RiskKind } from "./analysis/risks.js";
import { formatEnv, formatFile, formatHits, formatModule, formatOverview, formatRisks, formatRoutes, formatSkipped, formatTrace } from "./format.js";
import { formatErrorLookup, lookupError } from "./query/errors.js";
import { defaultBase, formatImpact, gitDiff, impact } from "./query/impact.js";
import { resolveTarget, trace } from "./query/trace.js";
import { where } from "./query/where.js";
import { buildReport, type Report } from "./report/model.js";
import { buildTour, formatTour } from "./report/tour.js";
import { changeStamp } from "./scan/walk.js";
import { openWorkspace, type Workspace } from "./workspace.js";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** Outside git: how long an index is trusted before a tool call rescans (incrementally) to pick up edits. */
const FRESH_MS = 20_000;

const RISK_KINDS = ["missing-route", "swallowed-error", "cycle", "duplicate", "hotspot", "large-file", "long-function", "untested", "orphan", "env-undocumented", "env-unused", "todo", "parse-error"] as const;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/**
 * The same answers as the CLI, as MCP tools. Each call checks `git status`
 * (plus the times of dirty files) and rescans only when the tree changed, so
 * an agent editing the repo sees its own changes without paying for a scan on
 * every call. Outside git, the index is trusted for a few seconds instead.
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
    })()
      .finally(() => {
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
  const fileOf = (ws: Workspace, path: string) => ws.index.files.find((f) => f.path === path) ?? ws.index.files.find((f) => f.path.endsWith(`/${path}`));

  const server = new McpServer({ name: "spelunk", version: VERSION });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "overview",
    {
      description: "Start here. What this repository is, its languages, entry points, commands to run it, and its modules (directories) with what each depends on. Includes Claude's summaries when `spelunk explain` has been run.",
      annotations: readOnly,
    },
    async () => text(formatOverview(await report())),
  );

  server.registerTool(
    "where",
    {
      description: "Find where something lives: a feature (\"password reset\"), an error message, a route, a function or an environment variable. Ranked results with path:line and why each matched. Use before grepping in an unfamiliar repo.",
      inputSchema: { query: z.string().describe("Plain words, an error message, a symbol name or a route"), limit: z.number().int().min(1).max(50).optional() },
      annotations: readOnly,
    },
    async ({ query, limit }) => text(formatHits(query, where((await workspace()).index, query, { limit: limit ?? 15 }))),
  );

  server.registerTool(
    "trace",
    {
      description: "Follow how code connects. For a route (\"PUT /api/pages/:id\"): the client code that calls it and the handler's call tree. For a function (\"updatePage\" or \"Store.put\"): what it calls and who uses it. For a file: its imports, importers and how entry points reach it.",
      inputSchema: { target: z.string().describe("A route, a symbol name, or a file path"), depth: z.number().int().min(1).max(5).optional() },
      annotations: readOnly,
    },
    async ({ target, depth }) => {
      const ws = await workspace();
      const targets = resolveTarget(ws.index, target);
      if (!targets.length) return text(`Nothing called "${target}". Try the where tool.`);
      const out = targets.slice(0, 3).map((t) => formatTrace(trace(ws.index, ws.graph, t, { depth: depth ?? 2 })));
      if (targets.length > 3) out.push(`${targets.length - 3} more matches: ${targets.slice(3, 12).map((t) => `${t.path}${t.line ? `:${t.line}` : ""}`).join(", ")}`);
      return text(out.join("\n\n---\n\n"));
    },
  );

  server.registerTool(
    "file",
    {
      description: "Everything known about one file: its role, symbols with line numbers, routes, imports, importers, environment variables, and where it throws or logs errors. Cheaper than reading the file to decide whether you need to.",
      inputSchema: { path: z.string().describe("Repo-relative path, or a unique suffix of one") },
      annotations: readOnly,
    },
    async ({ path }) => {
      const ws = await workspace();
      const f = fileOf(ws, path);
      return text(f ? formatFile(ws, f) : `No file "${path}" in the index. Use where to find it.`);
    },
  );

  server.registerTool(
    "module",
    {
      description: "One module (directory): its files ranked by how much they're imported, what it depends on and what uses it, plus Claude's summary, responsibilities and gotchas when explained.",
      inputSchema: { path: z.string().describe('Directory path from overview, e.g. "apps/server/src"') },
      annotations: readOnly,
    },
    async ({ path }) => {
      const r = await report();
      return text(formatModule(r, path) ?? `No module "${path}". Modules: ${r.modules.map((m) => m.path || "(root)").join(", ")}`);
    },
  );

  server.registerTool(
    "dependencies",
    {
      description: "Files a file imports (inside the repo), with the names it uses from each, and its external packages.",
      inputSchema: { path: z.string() },
      annotations: readOnly,
    },
    async ({ path }) => {
      const ws = await workspace();
      const f = fileOf(ws, path);
      if (!f) return text(`No file "${path}".`);
      const lines = f.imports.filter((i) => i.targets.length).map((i) => `${i.targets.join(", ")}${i.names?.length ? `  (${i.names.join(", ")})` : ""}  [line ${i.line}]`);
      const ext = [...new Set(f.imports.flatMap((i) => (i.external ? [i.external] : [])))];
      const unresolved = f.imports.filter((i) => !i.targets.length && !i.external).map((i) => i.spec);
      return text([`${f.path} imports:`, ...(lines.length ? lines : ["(nothing in the repo)"]), ...(ext.length ? ["", `External: ${ext.join(", ")}`] : []), ...(unresolved.length ? ["", `Unresolved: ${unresolved.join(", ")}`] : [])].join("\n"));
    },
  );

  server.registerTool(
    "dependents",
    {
      description: "Files that import a file: what breaks, or needs checking, if you change it.",
      inputSchema: { path: z.string() },
      annotations: readOnly,
    },
    async ({ path }) => {
      const ws = await workspace();
      const f = fileOf(ws, path);
      if (!f) return text(`No file "${path}".`);
      const users = [...(ws.graph.in.get(f.path) ?? [])].sort();
      const twoHops = new Set(users.flatMap((u) => [...(ws.graph.in.get(u) ?? [])]).filter((p) => p !== f.path && !users.includes(p)));
      return text([`${f.path} is imported by ${users.length} files:`, ...users, ...(twoHops.size ? ["", `And indirectly by ${twoHops.size} more: ${[...twoHops].slice(0, 40).join(", ")}`] : [])].join("\n"));
    },
  );

  server.registerTool(
    "symbols",
    {
      description: "Look up functions, classes, methods and types by name across the repo, with signature, location and doc comment.",
      inputSchema: { name: z.string().describe("Exact or partial name, case-insensitive"), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
    },
    async ({ name, limit }) => {
      const ws = await workspace();
      const q = name.toLowerCase();
      const hits = ws.index.files
        .flatMap((f) => f.symbols.filter((s) => s.name.toLowerCase().includes(q)).map((s) => ({ f, s })))
        .sort((a, b) => Number(b.s.name.toLowerCase() === q) - Number(a.s.name.toLowerCase() === q) || Number(a.f.role !== "source") - Number(b.f.role !== "source") || a.s.name.length - b.s.name.length)
        .slice(0, limit ?? 30);
      if (!hits.length) return text(`No symbol matching "${name}".`);
      return text(hits.map(({ f, s }) => `${f.path}:${s.line}  ${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name}\n    ${s.signature}${s.doc ? `\n    ${s.doc.slice(0, 160)}` : ""}`).join("\n"));
    },
  );

  server.registerTool(
    "routes",
    {
      description: "HTTP routes the server defines and the client calls that hit them, with handler locations.",
      inputSchema: { filter: z.string().optional().describe("Substring of method, path or file") },
      annotations: readOnly,
    },
    async ({ filter }) => text(formatRoutes((await workspace()).index, filter)),
  );

  server.registerTool(
    "env_vars",
    {
      description: "Environment variables the code reads, where each is read, and whether the .env example documents it.",
      annotations: readOnly,
    },
    async () => text(formatEnv(await report())),
  );

  server.registerTool(
    "risks",
    {
      description: "Places likely to hide bugs: swallowed errors, client calls to routes that don't exist, import cycles, duplicated code, hotspots (big files that change often), long functions, untested modules, dead files, undocumented env vars, TODOs.",
      inputSchema: { kind: z.enum(RISK_KINDS).optional(), path: z.string().optional().describe("Only findings in files under this path"), limit: z.number().int().min(1).max(200).optional() },
      annotations: readOnly,
    },
    async ({ kind, path, limit }) => {
      const risks = await (await workspace()).risks();
      const scoped = path ? risks.filter((r) => r.locations.some((l) => l.path.startsWith(path))) : risks;
      return text(formatRisks(scoped, { ...(kind ? { kind: kind as RiskKind } : {}), limit: limit ?? 40 }));
    },
  );

  server.registerTool(
    "lookup_error",
    {
      description: "Paste an error message, log line or whole stack trace. Returns where to start reading: the repo's own frames mapped to files and functions (even from compiled or container paths), the throw or log statements that produce the message, callers, and risks nearby.",
      inputSchema: { text: z.string().min(1).describe("The error or stack trace, as printed") },
      annotations: readOnly,
    },
    async ({ text: input }) => {
      const ws = await workspace();
      return text(formatErrorLookup(lookupError(ws.index, ws.graph, input, await ws.risks())));
    },
  );

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
    async ({ base, include_uncommitted }) => {
      const ws = await workspace();
      const b = base ?? (await defaultBase(root));
      const diff = await gitDiff(root, b, { ...(include_uncommitted ? { includeWorkingTree: true } : {}) });
      return text(formatImpact(impact(ws.index, ws.graph, diff, await ws.risks(), { base: b, head: include_uncommitted ? "working tree" : "HEAD" })));
    },
  );

  server.registerTool(
    "onboarding_tour",
    {
      description: "A first-day walkthrough of this repository for someone new: what it is, how to run it, the settings it needs, the big parts, where it starts, one request end to end, the core files, where bugs hide, how to debug and test. Each step names the files to open in order.",
      annotations: readOnly,
    },
    async () => {
      const r = await report();
      return text(formatTour(r, buildTour(r)));
    },
  );

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

export async function serve(root: string): Promise<void> {
  const server = createServer(root);
  await server.connect(new StdioServerTransport());
}
