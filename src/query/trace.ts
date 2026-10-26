import { posix } from "node:path";
import type { Index, SymbolInfo } from "../types.js";
import { shortestPath, usedNames, type Graph } from "../analysis/graph.js";
import { allRoutes, findRoutes, routesFor, type RouteAt } from "../analysis/routes.js";

/**
 * How a piece of code connects: what a route, symbol or file pulls in
 * (downstream) and how execution reaches it from an entry point (upstream).
 */

export interface Step {
  path: string;
  line?: number;
  /** Names used across this edge, e.g. ["updatePage", "readRevision"]. */
  via: string[];
  depth: number;
  children: Step[];
}

/** One resolved call: the function it lands in and what that calls in turn. */
export interface CallNode {
  name: string;
  path: string;
  line: number;
  children: CallNode[];
}

export interface Trace {
  target: { kind: "route" | "symbol" | "file"; label: string; path: string; line?: number };
  /** Client code that calls this route. */
  callers: { path: string; line: number; label: string }[];
  /** Files whose calls include this symbol and that import its file (or, unresolved, just call the name). */
  usedBy: { path: string; line?: number }[];
  downstream: Step[];
  /** Calls made by the route handler or symbol, resolved to their definitions, a few levels deep. */
  flow: CallNode[];
  /** Import chains from entry points to the target, shortest first. */
  fromEntries: string[][];
}

export interface TraceTarget {
  kind: "route" | "symbol" | "file";
  label: string;
  path: string;
  line?: number;
  symbol?: SymbolInfo;
  route?: RouteAt;
}

/** Everything `target` could mean: a route, a symbol name, or a file path. */
export function resolveTarget(index: Index, target: string): TraceTarget[] {
  const out: TraceTarget[] = [];
  const t = target.trim();
  if (/^([A-Z]+\s+)?\//.test(t)) {
    for (const r of findRoutes(index, t)) out.push({ kind: "route", label: `${r.method} ${r.path}`, path: r.file, line: r.line, route: r });
    if (out.length) return out;
  }
  const file = index.files.find((f) => f.path === t) ?? index.files.find((f) => f.path.endsWith(`/${t}`));
  if (file) return [{ kind: "file", label: file.path, path: file.path }];
  const [owner, name] = t.includes(".") && !t.includes("/") ? [t.slice(0, t.lastIndexOf(".")), t.slice(t.lastIndexOf(".") + 1)] : [undefined, t];
  for (const f of index.files) {
    for (const s of f.symbols) {
      if (s.name === name && (!owner || s.parent === owner)) out.push({ kind: "symbol", label: s.parent ? `${s.parent}.${s.name}` : s.name, path: f.path, line: s.line, symbol: s });
    }
  }
  if (!out.length) {
    const lower = name!.toLowerCase();
    for (const f of index.files) for (const s of f.symbols) if (s.name.toLowerCase() === lower) out.push({ kind: "symbol", label: s.name, path: f.path, line: s.line, symbol: s });
  }
  // Definitions in source beat tests and fixtures.
  const rank = (p: string) => (index.files.find((f) => f.path === p)?.role === "source" ? 0 : 1);
  return out.sort((a, b) => rank(a.path) - rank(b.path));
}

function downstream(g: Graph, from: string, maxDepth: number, onlyUsed: string[] | undefined): Step[] {
  const seen = new Set([from]);
  const expand = (path: string, depth: number, filter?: string[]): Step[] => {
    if (depth > maxDepth) return [];
    const steps: Step[] = [];
    for (const to of g.out.get(path) ?? []) {
      const f = g.files.get(to);
      if (!f || f.role !== "source" || seen.has(to)) continue;
      const via = usedNames(g, path, to);
      // At the first hop from a symbol, follow only edges that symbol's file uses at all.
      if (filter && via.length === 0) continue;
      seen.add(to);
      steps.push({ path: to, via, depth, children: [] });
    }
    for (const s of steps) s.children = expand(s.path, depth + 1);
    return steps.sort((a, b) => b.via.length - a.via.length);
  };
  return expand(from, 1, onlyUsed);
}

/** Where `name`, called from `from`, is defined: the same file first, then files it imports. */
function definition(index: Index, g: Graph, from: string, name: string): { path: string; symbol: SymbolInfo } | undefined {
  const here = index.files.find((f) => f.path === from);
  const local = here?.symbols.find((s) => s.name === name && (s.kind === "function" || s.kind === "method" || s.kind === "class"));
  if (local) return { path: from, symbol: local };
  // Go: a package is a directory, so its other files' functions are in scope without an import.
  if (here?.language === "go") {
    const dir = posix.dirname(from);
    for (const f of index.files) {
      if (f.path === from || f.role === "test" || f.language !== "go" || posix.dirname(f.path) !== dir) continue;
      const sym = f.symbols.find((s) => s.name === name && !s.parent && s.kind === "function");
      if (sym) return { path: f.path, symbol: sym };
    }
  }
  for (const to of g.out.get(from) ?? []) {
    const f = g.files.get(to);
    // Top-level only: a method name like `get` or `put` matches too many unrelated classes across files.
    const sym = f?.symbols.find((s) => s.name === name && s.exported && !s.parent && (s.kind === "function" || s.kind === "class"));
    if (sym) return { path: to, symbol: sym };
  }
  return undefined;
}

function callTree(index: Index, g: Graph, from: string, names: string[], depth: number, seen: Set<string>): CallNode[] {
  if (depth <= 0) return [];
  const out: CallNode[] = [];
  for (const name of names) {
    const def = definition(index, g, from, name);
    if (!def) continue;
    const key = `${def.path}#${def.symbol.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: def.symbol.parent ? `${def.symbol.parent}.${name}` : name, path: def.path, line: def.symbol.line, children: callTree(index, g, def.path, def.symbol.calls ?? [], depth - 1, seen) });
  }
  return out;
}

/** Calls inside a route registration: from its line to the next route or the end of the enclosing function. */
function routeCalls(index: Index, r: RouteAt): string[] {
  const f = index.files.find((x) => x.path === r.file);
  if (!f) return [];
  const later = f.routes.filter((x) => x.side === "server" && x.line > r.line).map((x) => x.line);
  const enclosing = f.symbols.filter((s) => s.line <= r.line && s.endLine >= r.line && s.endLine > r.line).sort((a, b) => a.endLine - b.endLine)[0];
  const end = Math.min(later.length ? Math.min(...later) - 1 : Infinity, enclosing?.endLine ?? Infinity, r.line + 80);
  return [...new Set(f.callSites.filter(([, line]) => line >= r.line && line <= end).map(([name]) => name))];
}

export function trace(index: Index, g: Graph, t: TraceTarget, options: { depth?: number } = {}): Trace {
  const depth = options.depth ?? 2;
  const callers: Trace["callers"] = [];
  const usedBy: Trace["usedBy"] = [];

  if (t.route) {
    for (const c of allRoutes(index, "client")) {
      if (routesFor([t.route], c.method, c.path).length) callers.push({ path: c.file, line: c.line, label: `${c.method} ${c.path}` });
    }
  }
  if (t.symbol) {
    const name = t.symbol.name;
    for (const f of index.files) {
      if (f.path === t.path || !f.calls.includes(name)) continue;
      const imports = (g.out.get(f.path) ?? new Set()).has(t.path);
      const resolvedLanguage = f.imports.some((i) => i.targets.length);
      if (imports || !resolvedLanguage) usedBy.push({ path: f.path });
    }
  }
  if (t.kind === "file") for (const p of g.in.get(t.path) ?? []) usedBy.push({ path: p });

  const entries = index.files.filter((f) => f.entry && f.path !== t.path).map((f) => f.path);
  const fromEntries: string[][] = [];
  for (const e of entries) {
    const p = shortestPath(g, [e], t.path);
    if (p) fromEntries.push(p);
  }
  fromEntries.sort((a, b) => a.length - b.length);

  const seen = new Set<string>(t.symbol ? [`${t.path}#${t.symbol.line}`] : []);
  const names = t.route ? routeCalls(index, t.route) : (t.symbol?.calls ?? []);
  const flow = t.kind === "file" ? [] : callTree(index, g, t.path, names, depth + 1, seen);

  return {
    target: { kind: t.kind, label: t.label, path: t.path, ...(t.line ? { line: t.line } : {}) },
    callers,
    usedBy,
    downstream: t.kind === "file" ? downstream(g, t.path, depth, undefined) : [],
    flow,
    fromEntries: fromEntries.slice(0, 5),
  };
}
