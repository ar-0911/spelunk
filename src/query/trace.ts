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
  /** Matched on the name alone (no import says what it binds), so it may be a different function of the same name. */
  byName?: true;
  children: CallNode[];
}

/** How the calls in a trace's flow were matched, so a reader knows how far to trust it. */
export interface CallStats {
  /** Followed through an import binding, a local definition, or `this`. */
  resolved: number;
  byName: number;
  /** Calls into an installed package (`axios.get`) or the runtime (`JSON.parse`). */
  library: number;
  /** Calls Spelunk couldn't place: built-ins, methods on values of unknown type, dynamic calls. */
  unresolved: string[];
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
  calls: CallStats;
  /** Why the flow is empty when Spelunk knows something about it (a route mapped to an action it can't find). */
  note?: string;
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
    // "POST /api/articles" also matches "POST /api/articles/:slug/comments"; when the route exists as typed, that's the one.
    const exact = out.filter((x) => x.label.toLowerCase() === t.toLowerCase().replace(/\s+/g, " "));
    if (exact.length) return exact;
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

const CALLABLE = new Set(["function", "method", "class"]);
/** Languages where a bare call inside a class can be a method of that class (implicit `this`). */
const IMPLICIT_THIS = new Set(["java", "kotlin", "csharp", "scala", "swift", "cpp", "dart"]);
const SELF = new Set(["this", "self", "cls", "static", "super"]);
/** Files that mostly pass on other files' exports. */
const BARREL = /(^|\/)(index\.[cm]?[jt]sx?|__init__\.py|mod\.rs)$/;

/** A top-level, exported definition of `name` in `path`, looking through barrel files (index.ts, __init__.py) that re-export it. */
function exportedIn(g: Graph, path: string, name: string, wantDefault: boolean, depth = 3): { path: string; symbol: SymbolInfo } | undefined {
  const f = g.files.get(path);
  if (!f) return undefined;
  const sym = f.symbols.find((s) => !s.parent && CALLABLE.has(s.kind) && (wantDefault ? s.default : s.name === name && (s.exported || s.kind === "class")));
  if (sym) return { path, symbol: sym };
  if (depth <= 0) return undefined;
  // Follow re-exports: `export { x } from "./x"`, `export * from "./x"`, or any import of a barrel file.
  const via = f.imports.filter((i) => i.targets.length && (i.namespace === "*" || i.bindings?.includes(name) || BARREL.test(path) || !f.symbols.some((s) => CALLABLE.has(s.kind))));
  for (const imp of via) {
    const original = imp.bindings ? imp.names?.[imp.bindings.indexOf(name)] ?? name : name;
    for (const t of imp.targets) {
      const hit = exportedIn(g, t, original, false, depth - 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Where a call made in `from` lands. `ref` is "name" for a bare call or
 * "recv.name" for one on a receiver. Bare calls resolve to the file's own
 * functions, then to what its imports bind under that name; `this.x()` to
 * the file's own methods; `module.x()` through the import bound to `module`;
 * `Class.x()` to that class's method. Calls on other objects (`res.json()`,
 * `items.get()`) aren't resolved: by name alone they'd land on unrelated code.
 */
export interface Definition {
  path: string;
  symbol: SymbolInfo;
  byName?: true;
}

const brokerCache = new WeakMap<Index, Map<string, Definition[]>>();

/** Moleculer actions by "svc:users.get" and event handlers by "evt:user.created", across the repo. */
function brokerTargets(index: Index): Map<string, Definition[]> {
  let m = brokerCache.get(index);
  if (!m) {
    m = new Map();
    for (const f of index.files) {
      for (const s of f.symbols) {
        if (!s.broker) continue;
        const key = s.broker === "action" ? `svc:${s.parent}.${s.name}` : `evt:${s.name}`;
        m.set(key, [...(m.get(key) ?? []), { path: f.path, symbol: s }]);
      }
    }
    brokerCache.set(index, m);
  }
  return m;
}

/** The broker ref ("svc:users.get") a Moleculer action is called by, if it is one. */
export const brokerRef = (s: SymbolInfo) => (s.broker === "action" ? `svc:${s.parent}.${s.name}` : s.broker === "event" ? `evt:${s.name}` : undefined);

export function definition(index: Index, g: Graph, from: string, ref: string): Definition | undefined {
  // Moleculer: the broker routes "users.get" to the users service's get action, wherever it lives.
  // An event can have many handlers; the first is shown, marked as a name match.
  if (ref.startsWith("svc:") || ref.startsWith("evt:")) {
    const hits = brokerTargets(index).get(ref);
    if (!hits?.length) return undefined;
    if (ref.startsWith("evt:")) return { ...hits[0]!, byName: true };
    if (hits.length === 1) return hits[0];
    // The same service name in several places (examples, tests, a benchmark): the one in this file or folder is the one this code runs with.
    const near = hits.find((h) => h.path === from) ?? hits.find((h) => posix.dirname(h.path) === posix.dirname(from));
    return near ?? { ...hits[0]!, byName: true };
  }
  const here = g.files.get(from) ?? index.files.find((f) => f.path === from);
  if (!here) return undefined;
  const dot = ref.lastIndexOf(".");
  const recv = dot > 0 ? ref.slice(0, dot) : undefined;
  const name = dot > 0 ? ref.slice(dot + 1) : ref;
  const imports = here.imports.filter((i) => i.targets.length);

  if (!recv) {
    const local = here.symbols.find((s) => s.name === name && CALLABLE.has(s.kind) && (!s.parent || IMPLICIT_THIS.has(here.language)));
    if (local) return { path: from, symbol: local };
    // Go: a package is a directory, so its other files' functions are in scope without an import.
    if (here.language === "go") {
      const dir = posix.dirname(from);
      for (const f of index.files) {
        if (f.path === from || f.role === "test" || f.language !== "go" || posix.dirname(f.path) !== dir) continue;
        const sym = f.symbols.find((s) => s.name === name && !s.parent && s.kind === "function");
        if (sym) return { path: f.path, symbol: sym };
      }
    }
    // What the imports bind under this name: `import { name }`, `from m import name`, `import name from`.
    for (const imp of imports) {
      const i = imp.bindings?.indexOf(name) ?? -1;
      const isDefault = imp.defaultBinding === name;
      if (i < 0 && !isDefault) continue;
      for (const t of imp.targets) {
        const hit = isDefault ? exportedIn(g, t, name, true) ?? exportedIn(g, t, name, false) : exportedIn(g, t, imp.names?.[i] ?? name, false);
        if (hit) return hit;
      }
    }
    // Languages whose imports don't say what they bind (C, Ruby, PHP, Rust `use`): any imported file's exported function of that name.
    for (const imp of imports) {
      if (imp.bindings || imp.namespace !== undefined || imp.defaultBinding) continue;
      for (const t of imp.targets) {
        const hit = exportedIn(g, t, name, false, 0);
        if (hit) return { ...hit, byName: true };
      }
    }
    return undefined;
  }

  if (SELF.has(recv)) {
    const own = here.symbols.find((s) => s.name === name && s.parent && CALLABLE.has(s.kind));
    return own ? { path: from, symbol: own } : undefined;
  }
  // A module or package bound to this name: `import * as pages`, `import app.pages as pages`, Go `pages.Update`.
  const bound = imports.filter((i) => i.namespace === recv || i.bindings?.includes(recv) || i.defaultBinding === recv);
  for (const imp of bound) {
    for (const t of imp.targets) {
      const hit = exportedIn(g, t, name, false);
      if (hit) return hit;
      // `import pages from "./pages"` where pages is a class or object with methods.
      const method = g.files.get(t)?.symbols.find((s) => s.name === name && s.parent && CALLABLE.has(s.kind));
      if (method) return { path: t, symbol: method };
    }
  }
  // Class.method(): a static call or a constructor, here or in an imported file.
  if (/^[A-Z]/.test(recv)) {
    for (const imp of [undefined, ...imports]) {
      // Sure when the class is here or an import binds it; otherwise only the class name matched.
      const sure = !imp || imp.bindings?.includes(recv) || imp.defaultBinding === recv;
      for (const path of imp ? imp.targets : [from]) {
        const sym = g.files.get(path)?.symbols.find((s) => s.name === name && s.parent === recv && CALLABLE.has(s.kind));
        if (sym) return sure ? { path, symbol: sym } : { path, symbol: sym, byName: true };
      }
    }
  }
  return undefined;
}

/** Globals of the JS, Python and Node runtimes: calls to them are the platform's, not unresolved code. */
const BUILTINS = new Set([
  "Array", "Object", "String", "Number", "Boolean", "Symbol", "BigInt", "Promise", "Error", "TypeError", "RangeError", "SyntaxError", "Map", "Set", "WeakMap", "WeakSet",
  "JSON", "Math", "Date", "RegExp", "Reflect", "Proxy", "Buffer", "URL", "URLSearchParams", "Infinity", "NaN", "Intl", "console", "process", "globalThis", "window", "document",
]);

/** True when the call's root name is bound by an import of an installed package, or is a runtime global. */
function libraryCall(index: Index, g: Graph, from: string, ref: string): boolean {
  const here = g.files.get(from) ?? index.files.find((f) => f.path === from);
  const head = ref.split(".")[0]!;
  if (BUILTINS.has(head)) return true;
  return Boolean(here?.imports.some((i) => !i.targets.length && i.external && (i.namespace === head || i.defaultBinding === head || i.bindings?.includes(head))));
}

function callTree(index: Index, g: Graph, from: string, refs: string[], depth: number, seen: Set<string>, stats: CallStats): CallNode[] {
  if (depth <= 0) return [];
  const out: CallNode[] = [];
  for (const ref of refs) {
    const def = definition(index, g, from, ref);
    if (!def) {
      if (libraryCall(index, g, from, ref)) stats.library++;
      // Identifiers passed as arguments are recorded too; most are plain values, not calls, so they aren't counted.
      else if (/^(svc|evt):/.test(ref)) stats.unresolved.push(`"${ref.slice(4)}"`); // a broker call to an action defined elsewhere (a mixin, another repo)
      else if (!/^[a-z_$][\w$]*$/i.test(ref) || /^[A-Z]/.test(ref)) stats.unresolved.push(ref.replace(/^\?\./, "….")); // "?" is a receiver that is itself an expression
      continue;
    }
    if (def.byName) stats.byName++;
    else stats.resolved++;
    const key = `${def.path}#${def.symbol.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = def.symbol.parent ? `${def.symbol.parent}.${def.symbol.name}` : def.symbol.name;
    out.push({ name, path: def.path, line: def.symbol.line, ...(def.byName ? { byName: true as const } : {}), children: callTree(index, g, def.path, def.symbol.calls ?? [], depth - 1, seen, stats) });
  }
  return out;
}

/**
 * What a route's handler calls. Three shapes, most specific first:
 * - the registration call itself (`app.get("/x", auth, (req, res) => …)`), whose span
 *   holds inline code and the names of handlers passed by reference;
 * - a decorated function just below the route line (Flask, FastAPI, Spring);
 * - otherwise, the lines up to the next route or the end of the enclosing function.
 */
function routeCalls(index: Index, r: RouteAt): string[] {
  const f = index.files.find((x) => x.path === r.file);
  if (!f) return [];
  const refs = (a: number, b: number) => f.callSites.filter(([, line]) => line >= a && line <= b).map(([ref]) => ref);
  const span = (f.spans ?? []).filter(([a, b]) => a <= r.line && b >= r.line).sort((x, y) => x[1] - x[0] - (y[1] - y[0]))[0];
  const enclosing = f.symbols.filter((s) => s.line <= r.line && s.endLine > r.line).sort((a, b) => a.endLine - b.endLine)[0];
  // A route written as a decorator or annotation (`@router.post("/")`) sits just above its function.
  const decorated = span ? undefined : f.symbols.find((s) => (s.kind === "function" || s.kind === "method") && s.line > r.line && s.line <= r.line + 6 && !(enclosing && enclosing.endLine < s.line));
  let out: string[];
  if (span) out = refs(span[0], span[1]);
  else if (decorated) out = refs(decorated.line, decorated.endLine);
  else {
    const later = f.routes.filter((x) => x.side === "server" && x.line > r.line).map((x) => x.line);
    out = refs(r.line, Math.min(later.length ? Math.min(...later) - 1 : Infinity, enclosing?.endLine ?? Infinity, r.line + 30));
  }
  // The handler the route detector named (`app.get("/x", getUser)`), in case its line wasn't a parsed call.
  if (r.handler) out.unshift(/^(svc|evt):/.test(r.handler) ? r.handler : r.handler.split(".").slice(-2).join("."));
  return [...new Set(out)];
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
  const viaBroker = t.symbol && brokerRef(t.symbol);
  if (viaBroker) {
    // Called by name through the broker: every `ctx.call("users.get")`, with its line.
    for (const f of index.files) for (const [ref, line] of f.callSites) if (ref === viaBroker) usedBy.push({ path: f.path, line });
    for (const r of allRoutes(index, "server")) if (r.handler === viaBroker) usedBy.push({ path: r.file, line: r.line });
  } else if (t.symbol) {
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
  const calls: CallStats = { resolved: 0, byName: 0, library: 0, unresolved: [] };
  const flow = t.kind === "file" ? [] : callTree(index, g, t.path, names, depth + 1, seen, calls);
  calls.unresolved = [...new Set(calls.unresolved)];

  let note: string | undefined;
  const handler = t.route?.handler;
  if (handler?.startsWith("svc:") && !brokerTargets(index).has(handler)) {
    const name = handler.slice(4);
    const svc = name.slice(0, name.lastIndexOf("."));
    const known = [...new Set([...brokerTargets(index).keys()].map((k) => k.slice(4, k.lastIndexOf("."))))];
    note = known.some((k) => name.startsWith(`${k}.`))
      ? `It runs the action "${name}". That service is here, but has no action by that name: it may come from a mixin (moleculer-db adds list, get, create, update, remove) or be added at runtime.`
      : `It runs the action "${name}", but no service named "${svc}" is defined in this repository${known.length ? "" : " (Spelunk found no Moleculer services at all)"}. It may live in another repository, come from a mixin, or be named differently (a service's version adds a "v1." prefix).`;
  }

  return {
    ...(note ? { note } : {}),
    target: { kind: t.kind, label: t.label, path: t.path, ...(t.line ? { line: t.line } : {}) },
    callers,
    usedBy,
    downstream: t.kind === "file" ? downstream(g, t.path, depth, undefined) : [],
    flow,
    fromEntries: fromEntries.slice(0, 5),
    calls,
  };
}
