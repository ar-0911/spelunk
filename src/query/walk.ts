import { posix } from "node:path";
import type { FileFacts, Index, SymbolInfo } from "../types.js";
import { shortestPath, type Graph } from "../analysis/graph.js";
import { allRoutes, routesFor, type RouteAt } from "../analysis/routes.js";
import { brokerRef, definition, libraryCall, resolveTarget, routeHandlerRef, routeRange, type TraceTarget } from "./trace.js";

/**
 * A trace you can read like code: one function (or route handler) at a time,
 * its calls numbered in the order they run, its code beside them, and who
 * calls it. Stepping into a call opens that function's frame.
 */

export interface StepDef {
  name: string;
  path: string;
  line: number;
  endLine: number;
  kind: SymbolInfo["kind"];
  doc?: string;
  signature: string;
  /** Matched on the name alone, so it may be a different function of the same name. */
  byName?: true;
}

export interface WalkStep {
  /** 1-based, in the order the calls appear in the code. */
  n: number;
  /** The call as written: "getPage", "deps.db.transaction", "svc:users.get". */
  ref: string;
  /** Every line in this frame that makes this call; the first is where it's numbered. */
  lines: number[];
  /** "code": lands in this repository. "library": a package or the runtime. "unknown": Spelunk couldn't place it. */
  kind: "code" | "library" | "unknown";
  def?: StepDef;
  /** A small utility (ids, formatting, hashing) that a reader usually skips. */
  helper?: true;
  /** How many calls inside the definition land in this repository: what you'd see after stepping in. */
  inside?: number;
}

export interface Caller {
  /** What makes the call: a function name, a route label, or the file itself (top-level code). */
  label: string;
  kind: "function" | "route" | "file" | "client";
  path: string;
  /** The line of the call. */
  line: number;
  /** Where the calling function or route starts, to step up into it. */
  frameLine?: number;
  /** For "route": the route label to open its frame; for "function": its name. */
  target?: string;
}

export interface Frame {
  kind: "route" | "symbol";
  label: string;
  path: string;
  /** First and last line of the code shown. */
  line: number;
  endLine: number;
  doc?: string;
  signature?: string;
  /** The code from `line` to `endLine` (capped), one string per line. */
  code: string[];
  /** True when the function was longer than the cap. */
  truncated?: true;
  steps: WalkStep[];
  /** Lines in the frame that throw or raise. */
  throws: number[];
  callers: Caller[];
  /** Import chain from an entry point to this file. */
  fromEntry: string[];
  note?: string;
}

const MAX_LINES = 220;
const MAX_CALLERS = 60;
const CALLABLE = new Set(["function", "method", "class"]);
const HELPER_PATH = /(^|\/)(lib|libs|utils?|helpers?|common|shared|support)\/|(^|\/)(utils?|helpers?)\.[a-z]+$/i;

const fileOf = (index: Index, path: string) => index.files.find((f) => f.path === path);

/** The function or method that starts at `line` in `path`, or the innermost one containing it. */
export function symbolAt(f: FileFacts, line: number): SymbolInfo | undefined {
  const fns = f.symbols.filter((s) => CALLABLE.has(s.kind) && s.kind !== "class");
  return fns.find((s) => s.line === line) ?? fns.filter((s) => s.line <= line && s.endLine >= line).sort((a, b) => a.endLine - a.line - (b.endLine - b.line))[0];
}

/** Server routes in a file whose handler code covers `line`. */
function routeCovering(index: Index, f: FileFacts, line: number): RouteAt | undefined {
  for (const r of f.routes) {
    if (r.side !== "server") continue;
    const at: RouteAt = { ...r, file: f.path };
    const range = routeRange(index, at);
    if (range && line >= Math.min(r.line, range.from) && line <= range.to) return at;
  }
  return undefined;
}

const qualified = (s: SymbolInfo) => (s.parent ? `${s.parent}.${s.name}` : s.name);

/** True when a call looks like a call rather than an identifier passed as a value. */
const looksLikeCall = (ref: string) => /^(svc|evt):/.test(ref) || ref.includes(".") || /^[A-Z]/.test(ref);

function steps(index: Index, g: Graph, f: FileFacts, from: number, to: number, extra: string[], self?: string): WalkStep[] {
  const byRef = new Map<string, number[]>();
  for (const ref of extra) byRef.set(ref, [from]);
  for (const [ref, line] of f.callSites) {
    if (line < from || line > to) continue;
    const at = byRef.get(ref);
    if (at) at.includes(line) || at.push(line);
    else byRef.set(ref, [line]);
  }
  const out: WalkStep[] = [];
  for (const [ref, lines] of byRef) {
    const def = definition(index, g, f.path, ref);
    if (def) {
      const key = `${def.path}#${def.symbol.line}`;
      if (key === self) continue; // recursion: the reader is already here
      const defFile = fileOf(index, def.path);
      const inner = def.symbol.calls ?? [];
      const inside = defFile ? inner.filter((r) => definition(index, g, def.path, r)).length : 0;
      const small = def.symbol.endLine - def.symbol.line <= 4;
      const errorClass = def.symbol.kind === "class" && /(Error|Exception)$/.test(def.symbol.name);
      const helper = errorClass || (inside === 0 && (HELPER_PATH.test(def.path) || small));
      out.push({
        n: 0,
        ref,
        lines: lines.sort((a, b) => a - b),
        kind: "code",
        def: {
          name: qualified(def.symbol),
          path: def.path,
          line: def.symbol.line,
          endLine: def.symbol.endLine,
          kind: def.symbol.kind,
          signature: def.symbol.signature,
          ...(def.symbol.doc ? { doc: def.symbol.doc } : {}),
          ...(def.byName ? { byName: true as const } : {}),
        },
        ...(helper ? { helper: true as const } : {}),
        ...(inside ? { inside } : {}),
      });
    } else if (libraryCall(index, g, f.path, ref)) {
      out.push({ n: 0, ref, lines, kind: "library" });
    } else if (looksLikeCall(ref)) {
      out.push({ n: 0, ref: ref.replace(/^\?\./, "…."), lines, kind: "unknown" });
    }
  }
  out.sort((a, b) => a.lines[0]! - b.lines[0]! || a.ref.localeCompare(b.ref));
  // Numbers go to the calls worth reading first (into this repository, not helpers), so hiding the rest leaves no gaps.
  let n = 0;
  for (const s of out) if (s.kind === "code" && !s.helper) s.n = ++n;
  for (const s of out) if (s.kind === "code" && s.helper) s.n = ++n;
  for (const s of out) if (s.kind !== "code") s.n = ++n;
  return out;
}

/** Every place that calls the function `sym` in `path`: the enclosing function or route, and the line. */
export function callersOf(index: Index, g: Graph, path: string, sym: SymbolInfo): Caller[] {
  const out: Caller[] = [];
  const seen = new Set<string>();
  const add = (c: Caller) => {
    const key = `${c.path}:${c.line}`;
    if (!seen.has(key)) seen.add(key), out.push(c);
  };
  const broker = brokerRef(sym);
  const placed = (f: FileFacts, line: number) => {
    const route = routeCovering(index, f, line);
    if (route) return add({ label: `${route.method} ${route.path}`, kind: "route", path: f.path, line, frameLine: route.line, target: `${route.method} ${route.path}` });
    const fn = symbolAt(f, line);
    if (fn && !(f.path === path && fn.line === sym.line)) return add({ label: qualified(fn), kind: "function", path: f.path, line, frameLine: fn.line, target: qualified(fn) });
    if (!fn) add({ label: posix.basename(f.path), kind: "file", path: f.path, line });
  };
  for (const f of index.files) {
    if (out.length >= MAX_CALLERS) break;
    if (broker) {
      for (const [ref, line] of f.callSites) if (ref === broker) placed(f, line);
      for (const r of f.routes) if (r.side === "server" && r.handler === broker) add({ label: `${r.method} ${r.path}`, kind: "route", path: f.path, line: r.line, frameLine: r.line, target: `${r.method} ${r.path}` });
      continue;
    }
    if (!f.calls.includes(sym.name) && !f.callSites.some(([ref]) => ref.endsWith(`.${sym.name}`))) continue;
    for (const [ref, line] of f.callSites) {
      if (ref !== sym.name && !ref.endsWith(`.${sym.name}`)) continue;
      const def = definition(index, g, f.path, ref);
      if (def && def.path === path && def.symbol.line === sym.line) placed(f, line);
    }
    // A route that names this function as its handler: `router.get("/x", getUser)`.
    for (const r of f.routes) {
      if (r.side !== "server" || !r.handler) continue;
      const ref = routeHandlerRef({ ...r, file: f.path });
      const def = ref ? definition(index, g, f.path, ref) : undefined;
      if (def && def.path === path && def.symbol.line === sym.line) add({ label: `${r.method} ${r.path}`, kind: "route", path: f.path, line: r.line, frameLine: r.line, target: `${r.method} ${r.path}` });
    }
  }
  // Source before tests, then by file.
  const rank = (p: string) => (fileOf(index, p)?.role === "source" ? 0 : 1);
  return out.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path) || a.line - b.line);
}

function entryChain(index: Index, g: Graph, path: string): string[] {
  let best: string[] | undefined;
  for (const f of index.files) {
    if (!f.entry) continue;
    if (f.path === path) return [path];
    const p = shortestPath(g, [f.path], path);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best ?? [];
}

/** The frame for a resolved trace target (a route or a function). `source` is the file's text. */
export function frame(index: Index, g: Graph, t: TraceTarget, source: string): Frame | undefined {
  const f = fileOf(index, t.path);
  if (!f) return undefined;
  const text = source.split("\n");
  const cut = (a: number, b: number) => {
    const end = Math.min(b, a + MAX_LINES - 1);
    return { code: text.slice(a - 1, end), endLine: end, truncated: end < b };
  };
  const throwsIn = (a: number, b: number) => f.throws.filter((x) => x.line >= a && x.line <= b).map((x) => x.line);

  if (t.route) {
    const r = t.route;
    const range = routeRange(index, r) ?? { from: r.line, to: r.line };
    const first = Math.min(r.line, range.from);
    const handler = routeHandlerRef(r);
    const c = cut(first, range.to);
    const callers: Caller[] = [];
    for (const cl of allRoutes(index, "client")) {
      if (!routesFor([r], cl.method, cl.path).length) continue;
      const cf = fileOf(index, cl.file);
      const fn = cf && symbolAt(cf, cl.line);
      callers.push({ label: fn ? qualified(fn) : posix.basename(cl.file), kind: "client", path: cl.file, line: cl.line, ...(fn ? { frameLine: fn.line, target: qualified(fn) } : {}) });
    }
    let note: string | undefined;
    if (handler?.startsWith("svc:") && !definition(index, g, r.file, handler)) {
      note = `It runs the action "${handler.slice(4)}", which isn't defined in this repository: it may come from a mixin, another repository, or be added at runtime.`;
    }
    return {
      kind: "route",
      label: `${r.method} ${r.path}`,
      path: r.file,
      line: first,
      endLine: c.endLine,
      code: c.code,
      ...(c.truncated ? { truncated: true as const } : {}),
      steps: steps(index, g, f, range.from, range.to, handler ? [handler] : []),
      throws: throwsIn(first, range.to),
      callers: callers.slice(0, MAX_CALLERS),
      fromEntry: entryChain(index, g, r.file),
      ...(note ? { note } : {}),
    };
  }

  const sym = t.symbol;
  if (!sym) return undefined;
  const c = cut(sym.line, sym.endLine);
  return {
    kind: "symbol",
    label: qualified(sym),
    path: t.path,
    line: sym.line,
    endLine: c.endLine,
    signature: sym.signature,
    ...(sym.doc ? { doc: sym.doc } : {}),
    code: c.code,
    ...(c.truncated ? { truncated: true as const } : {}),
    steps: steps(index, g, f, sym.line, sym.endLine, [], `${t.path}#${sym.line}`),
    throws: throwsIn(sym.line, sym.endLine),
    callers: callersOf(index, g, t.path, sym),
    fromEntry: entryChain(index, g, t.path),
  };
}

/**
 * What to open for a request: an exact place (`path` and `line` of a function
 * or route), or a name typed by the reader. Several matches come back as
 * choices instead of a frame.
 */
export function pickTarget(index: Index, q: { target?: string; path?: string; line?: number }): { target?: TraceTarget; choices: TraceTarget[] } {
  if (q.path) {
    const f = fileOf(index, q.path);
    if (!f) return { choices: [] };
    const line = q.line ?? 1;
    const route = f.routes.find((r) => r.side === "server" && r.line === line);
    if (route) return { target: { kind: "route", label: `${route.method} ${route.path}`, path: f.path, line, route: { ...route, file: f.path } }, choices: [] };
    const sym = symbolAt(f, line);
    if (sym) return { target: { kind: "symbol", label: qualified(sym), path: f.path, line: sym.line, symbol: sym }, choices: [] };
    const covering = routeCovering(index, f, line);
    if (covering) return { target: { kind: "route", label: `${covering.method} ${covering.path}`, path: f.path, line: covering.line, route: covering }, choices: [] };
    return { choices: [] };
  }
  const wanted = (q.target ?? "").trim();
  if (!wanted) return { choices: [] };
  const all = resolveTarget(index, wanted).filter((t) => t.kind !== "file");
  const exact = all.filter((t) => t.label.toLowerCase() === wanted.toLowerCase());
  const list = exact.length ? exact : all;
  // One definition in source code wins over look-alikes in tests.
  const source = list.filter((t) => fileOf(index, t.path)?.role === "source");
  if (list.length === 1) return { target: list[0]!, choices: [] };
  if (source.length === 1) return { target: source[0]!, choices: list };
  return { choices: list.slice(0, 20) };
}
