import { basename } from "node:path";
import type { Graph } from "../analysis/graph.js";
import { modules, type Module } from "../analysis/modules.js";
import { allRoutes, routesFor, type RouteAt } from "../analysis/routes.js";
import { RISK_INFO, type Risk, type RiskKind } from "../analysis/risks.js";
import type { Explanations, ModuleExplanation, Overview } from "../explain/explain.js";
import { CODE_LANGUAGES } from "../lang/languages.js";
import { resolveTarget, trace, type CallNode } from "../query/trace.js";
import type { FileFacts, Index, Manifest } from "../types.js";

/** Everything a report shows, computed once and rendered as HTML or Markdown. */
export interface Report {
  name: string;
  commit?: string;
  remote?: string;
  /** How to link a file on the code host: `template` with {path} and {line}, where {line} becomes `anchor` + number. */
  links?: { template: string; anchor: string };
  generatedAt: string;
  stats: { files: number; codeFiles: number; codeLines: number; tests: number; routes: number; env: number; symbols: number };
  languages: { language: string; files: number; lines: number }[];
  overview?: Overview;
  explainedAt?: string;
  modules: (Pick<Module, "path" | "lines" | "owner"> & {
    files: { path: string; lines: number; role: string; doc?: string; usedBy: number; symbols: number }[];
    dependsOn: { path: string; weight: number }[];
    explanation?: ModuleExplanation;
  })[];
  entries: { path: string; label: string }[];
  commands: { manifest: string; kind: Manifest["kind"]; name: string; command: string }[];
  routes: (RouteAt & { callers: { path: string; line: number }[] })[];
  /** Call trees for the busiest routes, when Claude hasn't written flows. */
  staticFlows: { label: string; path: string; line: number; callers: { path: string; line: number }[]; tree: CallNode[] }[];
  env: { name: string; readAt: { path: string; line: number }[]; documented: boolean }[];
  risks: { kind: RiskKind; info: string; items: Risk[] }[];
  tests: { path: string; covers: string[] }[];
  errorLogs: { path: string; line: number; text: string }[];
}

export function buildReport(index: Index, g: Graph, risks: Risk[], explanations?: Explanations): Report {
  const code = index.files.filter((f) => CODE_LANGUAGES.has(f.language) && f.role !== "generated");
  const langs = new Map<string, { files: number; lines: number }>();
  for (const f of code) {
    const l = langs.get(f.language) ?? { files: 0, lines: 0 };
    l.files++;
    l.lines += f.lines;
    langs.set(f.language, l);
  }
  const rootManifest = index.manifests.find((m) => !m.path.includes("/") && m.name);
  // Tests and examples define throwaway routes; the guide is about the app's own.
  const roleOf = new Map(index.files.map((f) => [f.path, f.role]));
  const server = allRoutes(index, "server").filter((r) => roleOf.get(r.file) === "source");
  const client = allRoutes(index, "client").filter((r) => roleOf.get(r.file) === "source");
  const mods = modules(index, g, { max: 40 });

  const env = new Map<string, { path: string; line: number }[]>();
  for (const f of index.files.filter((f) => f.role !== "test")) for (const e of f.env) env.set(e.text, [...(env.get(e.text) ?? []), { path: f.path, line: e.line }]);
  const documented = new Set(index.manifests.flatMap((m) => m.env ?? []));
  for (const name of documented) if (!env.has(name)) env.set(name, []);

  const grouped = new Map<RiskKind, Risk[]>();
  for (const r of risks) grouped.set(r.kind, [...(grouped.get(r.kind) ?? []), r]);

  const routeRows = server.map((r) => ({ ...r, callers: client.filter((c) => routesFor([r], c.method, c.path).length).map((c) => ({ path: c.file, line: c.line })) }));
  // Static flows: routes that change things (and have callers) first; they're what people debug.
  const picks = [...routeRows].sort((a, b) => Number(b.method !== "GET") - Number(a.method !== "GET") || b.callers.length - a.callers.length).slice(0, 6);
  const staticFlows = picks.flatMap((r) => {
    const t = resolveTarget(index, `${r.method} ${r.path}`).find((x) => x.path === r.file && x.line === r.line);
    if (!t) return [];
    const tr = trace(index, g, t, { depth: 2 });
    return tr.flow.length ? [{ label: `${r.method} ${r.path}`, path: r.file, line: r.line, callers: r.callers, tree: tr.flow }] : [];
  });

  const tests = index.files.filter((f) => f.role === "test").map((t) => ({ path: t.path, covers: [...(g.out.get(t.path) ?? [])].filter((p) => g.files.get(p)?.role === "source") }));

  return {
    name: rootManifest?.name ?? basename(index.root),
    ...(index.commit ? { commit: index.commit } : {}),
    ...(index.remote ? { remote: index.remote, links: linkTemplate(index.remote, index.commit ?? "HEAD") } : {}),
    generatedAt: new Date().toISOString(),
    stats: {
      files: index.files.length,
      codeFiles: code.length,
      codeLines: code.reduce((n, f) => n + f.lines, 0),
      tests: tests.length,
      routes: server.length,
      env: env.size,
      symbols: index.files.reduce((n, f) => n + f.symbols.length, 0),
    },
    languages: [...langs].map(([language, v]) => ({ language, ...v })).sort((a, b) => b.lines - a.lines),
    ...(explanations?.overview ? { overview: explanations.overview, explainedAt: explanations.generatedAt } : {}),
    modules: mods.map((m) => ({
      path: m.path,
      lines: m.lines,
      ...(m.owner ? { owner: m.owner } : {}),
      files: m.files.map((f: FileFacts) => ({ path: f.path, lines: f.lines, role: f.role, ...(f.doc ? { doc: f.doc } : {}), usedBy: g.in.get(f.path)?.size ?? 0, symbols: f.symbols.length })),
      dependsOn: [...m.dependsOn].map(([path, weight]) => ({ path, weight })),
      ...(explanations?.modules[m.path] ? { explanation: explanations.modules[m.path] } : {}),
    })),
    entries: index.files.filter((f) => f.entry).map((f) => ({ path: f.path, label: f.entry! })),
    // The same command in several manifests (compose overrides, workspace scripts) is listed once.
    commands: [...new Map(index.manifests.flatMap((m) => m.commands.map((c) => [`${c.name}\0${c.command}`, { manifest: m.path, kind: m.kind, ...c }] as const))).values()],
    routes: routeRows,
    staticFlows,
    env: [...env].map(([name, readAt]) => ({ name, readAt, documented: documented.has(name) })).sort((a, b) => a.name.localeCompare(b.name)),
    risks: [...grouped].map(([kind, items]) => ({ kind, info: RISK_INFO[kind], items })),
    tests,
    errorLogs: index.files.filter((f) => f.role === "source").flatMap((f) => f.logs.map((l) => ({ path: f.path, ...l }))),
  };
}

/** Each host spells "this file at this commit, this line" differently. */
export function linkTemplate(remote: string, commit: string): { template: string; anchor: string } {
  const host = new URL(remote).hostname;
  if (/\/projects\/[^/]+\/repos\//.test(remote)) return { template: `${remote}/browse/{path}?at=${commit}{line}`, anchor: "#" }; // Bitbucket Data Center
  if (host.includes("bitbucket")) return { template: `${remote}/src/${commit}/{path}{line}`, anchor: "#lines-" };
  if (host.includes("gitlab")) return { template: `${remote}/-/blob/${commit}/{path}{line}`, anchor: "#L" };
  if (host.includes("codeberg") || host.includes("gitea")) return { template: `${remote}/src/commit/${commit}/{path}{line}`, anchor: "#L" };
  return { template: `${remote}/blob/${commit}/{path}{line}`, anchor: "#L" };
}

/** A link to a file (and line) on the code host, or undefined when there's no known remote. */
export function sourceUrl(r: Pick<Report, "remote" | "commit">, path: string, line?: number): string | undefined {
  if (!r.remote) return undefined;
  const { template, anchor } = linkTemplate(r.remote, r.commit ?? "HEAD");
  return template.replace("{path}", path).replace("{line}", line ? `${anchor}${line}` : "");
}
