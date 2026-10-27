import { posix } from "node:path";
import { allRoutes } from "./analysis/routes.js";
import { RISK_INFO, type Risk, type RiskKind } from "./analysis/risks.js";
import type { Explanations } from "./explain/explain.js";
import type { CallNode, CallStats, Step, Trace } from "./query/trace.js";
import type { Hit } from "./query/where.js";
import type { Report } from "./report/model.js";
import type { FileFacts, Index } from "./types.js";
import type { Workspace } from "./workspace.js";

/**
 * Plain-text answers shared by the CLI and the MCP server. They're written
 * for a person reading a terminal and for an agent reading a tool result,
 * so every location is a `path:line` that both can open.
 */

const loc = (path: string, line?: number) => (line ? `${path}:${line}` : path);

export function formatHits(query: string, hits: Hit[]): string {
  if (!hits.length) return `Nothing in the index matches "${query}". Try other words, or a symbol or route name.`;
  return hits.map((h) => `${loc(h.path, h.line).padEnd(48)} ${h.kind.padEnd(6)} ${h.name ? `${h.name}: ` : ""}${h.why}`).join("\n");
}

function callTree(nodes: CallNode[], indent = "  "): string[] {
  return nodes.flatMap((n) => [`${indent}${n.name}  ${loc(n.path, n.line)}${n.byName ? "  (by name only)" : ""}`, ...callTree(n.children, `${indent}  `)]);
}

function steps(nodes: Step[], indent = "  "): string[] {
  return nodes.flatMap((s) => [`${indent}${s.path}${s.via.length ? `  (${s.via.slice(0, 6).join(", ")}${s.via.length > 6 ? ", …" : ""})` : ""}`, ...steps(s.children, `${indent}  `)]);
}

/** One line on how far to trust a flow: what was followed exactly, by name, into packages or built-ins, or not at all. */
export function callStats(c: CallStats): string {
  const parts = [`${c.resolved} call${c.resolved === 1 ? "" : "s"} resolved`];
  if (c.byName) parts.push(`${c.byName} matched by name only`);
  if (c.library) parts.push(`${c.library} into packages or built-ins`);
  const u = c.unresolved;
  if (u.length) parts.push(`${u.length} unresolved (${u.slice(0, 5).join(", ")}${u.length > 5 ? ", …" : ""})`);
  return `${parts.join(", ")}.`;
}

export function formatTrace(t: Trace): string {
  const out = [`${t.target.kind} ${t.target.label}  ${loc(t.target.path, t.target.line)}`];
  if (t.callers.length) out.push("", "Called from (client code):", ...t.callers.map((c) => `  ${loc(c.path, c.line)}  ${c.label}`));
  if (t.fromEntries.length) out.push("", "Reached from entry points:", ...t.fromEntries.map((p) => `  ${p.join(" → ")}`));
  if (t.note) out.push("", t.note);
  if (t.flow.length) out.push("", "What it calls:", ...callTree(t.flow));
  const c = t.calls;
  if (t.target.kind !== "file" && c.resolved + c.byName + c.library + c.unresolved.length) out.push("", callStats(c));
  if (t.downstream.length) out.push("", "What it imports:", ...steps(t.downstream));
  if (t.usedBy.length) out.push("", `Used by (${t.usedBy.length}):`, ...t.usedBy.slice(0, 30).map((u) => `  ${loc(u.path, u.line)}`), ...(t.usedBy.length > 30 ? [`  … and ${t.usedBy.length - 30} more`] : []));
  if (out.length === 1 && !t.note) out.push("", "No callers, calls or imports found. It may be reached dynamically (reflection, a string lookup, a framework convention).");
  return out.join("\n");
}

export function formatRisks(risks: Risk[], options: { kind?: RiskKind; limit?: number } = {}): string {
  const list = options.kind ? risks.filter((r) => r.kind === options.kind) : risks;
  if (!list.length) return options.kind ? `No ${options.kind} findings.` : "No findings.";
  const limit = options.limit ?? 60;
  const out: string[] = [];
  let last: RiskKind | undefined;
  for (const r of list.slice(0, limit)) {
    if (r.kind !== last) {
      out.push("", `## ${r.kind}: ${RISK_INFO[r.kind]}`);
      last = r.kind;
    }
    out.push(`[${r.severity}] ${r.title}`, ...(r.detail !== RISK_INFO[r.kind] ? [`    ${r.detail}`] : []), ...r.locations.slice(0, 4).map((l) => `    ${loc(l.path, l.line)}${l.endLine && l.endLine !== l.line ? `-${l.endLine}` : ""}`));
  }
  if (list.length > limit) out.push("", `… ${list.length - limit} more. Filter with a kind to see them.`);
  return out.join("\n").trim();
}

export function formatFile(ws: Workspace, f: FileFacts): string {
  const g = ws.graph;
  const out = [`${f.path}  (${f.language}, ${f.role}, ${f.lines} lines)`];
  if (f.entry) out.push(`Entry point: ${f.entry}`);
  if (f.doc) out.push("", f.doc);
  if (f.symbols.length) {
    out.push("", "Symbols:");
    for (const s of f.symbols) out.push(`  ${String(s.line).padStart(5)}  ${s.parent ? `${s.parent}.` : ""}${s.name} (${s.kind}${s.exported ? ", exported" : ""})${s.doc ? `: ${s.doc.slice(0, 100)}` : ""}`);
  }
  if (f.routes.length) out.push("", "Routes:", ...f.routes.map((r) => `  ${String(r.line).padStart(5)}  ${r.method} ${r.path} (${r.side}, ${r.framework})`));
  const imports = f.imports.filter((i) => i.targets.length);
  const external = [...new Set(f.imports.flatMap((i) => (i.external ? [i.external] : [])))];
  if (imports.length) out.push("", "Imports:", ...imports.map((i) => `  ${i.targets.join(", ")}${i.names?.length ? `  (${i.names.join(", ")})` : ""}`));
  if (external.length) out.push("", `External packages: ${external.join(", ")}`);
  const users = [...(g.in.get(f.path) ?? [])];
  if (users.length) out.push("", `Imported by (${users.length}):`, ...users.slice(0, 30).map((u) => `  ${u}`));
  if (f.env.length) out.push("", "Environment variables:", ...f.env.map((e) => `  ${String(e.line).padStart(5)}  ${e.text}`));
  if (f.throws.length || f.logs.length) out.push("", "Errors thrown and logged:", ...[...f.throws, ...f.logs].sort((a, b) => a.line - b.line).slice(0, 30).map((e) => `  ${String(e.line).padStart(5)}  ${e.text}`));
  if (f.notes.length) out.push("", "Notes:", ...f.notes.map((n) => `  ${String(n.line).padStart(5)}  ${n.text}`));
  return out.join("\n");
}

export function formatRoutes(index: Index, filter?: string): string {
  const roleOf = new Map(index.files.map((f) => [f.path, f.role]));
  const matching = allRoutes(index).filter((r) => !filter || `${r.method} ${r.path} ${r.file}`.toLowerCase().includes(filter.toLowerCase()));
  const rows = matching.filter((r) => roleOf.get(r.file) === "source");
  const hidden = matching.length - rows.length;
  if (!rows.length) return `${filter ? `No routes match "${filter}"` : "No HTTP routes found"}${hidden ? ` outside tests and examples (${hidden} there)` : ""}.`;
  const server = rows.filter((r) => r.side === "server");
  const client = rows.filter((r) => r.side === "client");
  const line = (r: (typeof rows)[number]) => `  ${r.method.padEnd(7)} ${r.path.padEnd(40)} ${loc(r.file, r.line)}${r.handler ? `  → ${r.handler}` : ""}`;
  return [
    ...(server.length ? [`Server routes (${server.length}):`, ...server.map(line)] : []),
    ...(client.length ? ["", `Client calls (${client.length}):`, ...client.map(line)] : []),
    ...(hidden ? ["", `(${hidden} more in tests and examples not shown.)`] : []),
  ].join("\n").trim();
}

export function formatEnv(r: Report): string {
  if (!r.env.length) return "No environment variables found.";
  return r.env
    .map((e) => `${e.name}${e.documented ? "" : "  (not in .env example)"}${e.readAt.length ? "" : "  (documented, never read)"}\n${e.readAt.slice(0, 6).map((l) => `  ${loc(l.path, l.line)}`).join("\n")}`.trimEnd())
    .join("\n");
}

/** The orientation an agent (or new engineer) needs first: what this is, how it's laid out, how to run it. */
export function formatOverview(r: Report): string {
  const out = [`# ${r.name}`, `${r.stats.codeFiles} code files, ${r.stats.codeLines.toLocaleString("en")} lines; ${r.languages.slice(0, 5).map((l) => `${l.language} ${l.files}`).join(", ")}.`];
  out.push(`${r.stats.routes} server routes, ${r.stats.env} environment variables, ${r.stats.tests} test files.`);
  if (r.overview) out.push("", r.overview.oneLiner, "", r.overview.whatItDoes, "", "Architecture:", r.overview.architecture);
  if (r.entries.length) out.push("", "Entry points:", ...r.entries.map((e) => `  ${e.path}  (${e.label})`));
  const rank = (c: Report["commands"][number]) => (/^(npm run|make|bin|poetry|uv|cargo|go) /.test(`${c.name} `) ? 0 : c.kind === "ci" ? 2 : 1);
  const cmds = r.commands.filter((c) => rank(c) < 2).sort((a, b) => rank(a) - rank(b)).slice(0, 25);
  if (cmds.length) out.push("", "Commands:", ...cmds.map((c) => `  ${c.name.padEnd(26)} ${c.command.slice(0, 80)}  (${c.manifest})`));
  out.push("", "Modules (directory, files, lines → depends on):");
  for (const m of r.modules) {
    const deps = m.dependsOn.map((d) => d.path || "(root)").slice(0, 5).join(", ");
    out.push(`  ${(m.path || "(root)").padEnd(34)} ${String(m.files.length).padStart(4)} ${String(m.lines).padStart(7)}${deps ? `  → ${deps}` : ""}`);
    const summary = m.explanation?.summary ?? m.files.find((f) => f.doc)?.doc;
    if (summary) out.push(`      ${summary.slice(0, 200)}`);
  }
  if (r.overview?.runLocally.length) out.push("", "Run it locally:", ...r.overview.runLocally.map((s, i) => `  ${i + 1}. ${s}`));
  const counts = r.risks.map((g) => `${g.kind} ${g.items.length}`).join(", ");
  if (counts) out.push("", `Risks: ${counts}. Ask for risks to see them.`);
  if (!r.overview) out.push("", "No Claude explanations yet; run `spelunk explain` for module summaries, flows and a debugging guide.");
  return out.join("\n");
}

export function formatModule(r: Report, path: string, explanations?: Explanations): string | undefined {
  const m = r.modules.find((x) => x.path === path) ?? r.modules.find((x) => x.path.endsWith(path)) ?? r.modules.find((x) => posix.basename(x.path) === path);
  if (!m) return undefined;
  const e = m.explanation ?? explanations?.modules[m.path];
  const out = [`${m.path || "(root)"}: ${m.files.length} files, ${m.lines} lines${m.owner ? `, package ${m.owner}` : ""}`];
  if (e) {
    out.push("", e.summary, "", "Responsibilities:", ...e.responsibilities.map((x) => `  - ${x}`), "", "Key files:", ...e.keyFiles.map((k) => `  ${k.path}: ${k.role}`));
    if (e.gotchas.length) out.push("", "Gotchas:", ...e.gotchas.map((x) => `  - ${x}`));
  }
  out.push("", "Files (most imported first):", ...[...m.files].sort((a, b) => b.usedBy - a.usedBy).map((f) => `  ${f.path}  ${f.lines} lines, used by ${f.usedBy}${f.doc ? `: ${f.doc.slice(0, 120)}` : ""}`));
  if (m.dependsOn.length) out.push("", `Depends on: ${m.dependsOn.map((d) => `${d.path || "(root)"} (${d.weight})`).join(", ")}`);
  const usedBy = r.modules.filter((x) => x.dependsOn.some((d) => d.path === m.path)).map((x) => x.path || "(root)");
  if (usedBy.length) out.push(`Used by: ${usedBy.join(", ")}`);
  if (!e) out.push("", "No Claude summary for this module yet; run `spelunk explain`.");
  return out.join("\n");
}

/** "Skipped 1,204 files: 1,180 build or dependency output (dist/, …), 20 unknown language, 4 symbolic link." Nothing is dropped without saying so. */
export function formatSkipped(skipped: { path: string; reason: string }[]): string {
  if (!skipped.length) return "Skipped nothing.";
  const groups = new Map<string, { files: number; dirs: string[] }>();
  for (const s of skipped) {
    const m = /^(.*) \((\d+) files?\)$/.exec(s.reason);
    const reason = m ? m[1]! : s.reason;
    const g = groups.get(reason) ?? { files: 0, dirs: [] };
    g.files += m ? Number(m[2]) : 1;
    if (s.path.endsWith("/")) g.dirs.push(s.path);
    groups.set(reason, g);
  }
  const total = [...groups.values()].reduce((n, g) => n + g.files, 0);
  const parts = [...groups].sort((a, b) => b[1].files - a[1].files).map(([reason, g]) => {
    const where = g.dirs.length ? ` (${g.dirs.slice(0, 3).join(", ")}${g.dirs.length > 3 ? `, ${g.dirs.length - 3} more` : ""})` : "";
    return `${g.files.toLocaleString("en-US")} ${reason}${where}`;
  });
  return `Skipped ${total.toLocaleString("en-US")} file${total === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}
