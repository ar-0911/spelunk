import { basename, dirname, extname, join } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import type { Graph } from "./graph.js";
import type { Risk } from "./risks.js";
import { allRoutes, segments, type RouteAt } from "./routes.js";
import { readIndexed } from "../query/source.js";
import { routeRange, trace, type CallNode, type Trace } from "../query/trace.js";
import type { FileFacts, Index, SymbolInfo } from "../types.js";

/**
 * Features: what the app does, organised the way a developer asks about it
 * ("how do comments work?") rather than by folder.
 *
 * Everything here comes from the structure of the code, never from what things
 * are called, so a repo that names `addComment` `postThing` gets the same answer:
 *
 * 1. Entry points are the server routes and Moleculer actions the code registers.
 * 2. Each is traced through resolved calls (imports, local definitions, the
 *    broker) to the functions it reaches, and to the database tables those
 *    functions use (the table's own identifier, or its name in SQL).
 * 3. Helpers that most entry points reach (an access check, `getDb()`) are
 *    shared plumbing and don't decide anything.
 * 4. Entry points whose closest table is the same form one feature. Without a
 *    table, those calling the same function do; actions of one Moleculer
 *    service do. The rest are listed as "other entry points".
 *
 * Names appear only as labels (the table's name, the service's). The same code
 * always gives the same features and steps, and a call Spelunk couldn't follow
 * is reported as such instead of being guessed.
 */

export type Layer = "screen" | "client" | "route" | "service" | "data";

export interface CodeLine {
  line: number;
  text: string;
  hl?: boolean;
  /** Lines were skipped before this one. */
  gap?: boolean;
}

export interface FeatureStep {
  layer: Layer;
  title: string;
  path: string;
  line: number;
  detail?: string | undefined;
  code: CodeLine[];
}

export interface Table {
  name: string;
  /** The name code uses for it: the Drizzle variable, the model class. */
  symbol: string;
  path: string;
  line: number;
  orm: string;
  fields: string[];
}

/** Why the entry points of a feature belong together. */
export type FeatureKind = "table" | "service" | "shared-code";

export interface FeatureSummary {
  id: string;
  name: string;
  kind: FeatureKind;
  /** Routes and actions. */
  entries: number;
  tables: string[];
  files: number;
}

export interface EntryPoint {
  label: string;
  path: string;
  line: number;
  /** The function the work happens in, when it isn't the handler itself. */
  does?: { name: string; path: string; line: number };
}

export interface Feature extends FeatureSummary {
  /** What groups these entry points, in one sentence. */
  why: string;
  summary: string;
  steps: FeatureStep[];
  actions: EntryPoint[];
  /** Other code that reaches the same function without going through a route: an MCP tool, a job, a CLI. */
  otherWays: { label: string; path: string; line: number }[];
  /** Where to make a change, in the order you'd touch them. */
  change: { path: string; line?: number; why: string }[];
  tests: string[];
  watchOut: { title: string; path: string; line?: number }[];
  /** Calls on the main path Spelunk couldn't follow, so the walkthrough may stop early. */
  gaps: string[];
  /** Other client code that calls this feature's routes. */
  related: { path: string; line: number; label: string }[];
}

export interface FeatureList {
  features: FeatureSummary[];
  /** Entry points that share no table, function or service with any other. */
  other: EntryPoint[];
}

// ---------- labels (display only)

const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.\s]+/g, " ")
    .toLowerCase()
    .trim();
const title = (s: string) => {
  const w = words(s);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const slug = (s: string) => words(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "feature";

// ---------- tables

const TABLE_PATTERNS: { orm: string; test: (f: FileFacts) => boolean; find: RegExp; field: RegExp; nameGroup: number; symbolGroup: number }[] = [
  { orm: "drizzle", test: (f) => f.calls.some((c) => /^(pg|sqlite|mysql)Table$/.test(c)), find: /(?:export\s+)?const\s+(\w+)\s*=\s*(?:pg|sqlite|mysql)Table\(\s*["'`](\w+)["'`]/g, field: /^\s*(\w+)\s*:\s*\w+\(/, nameGroup: 2, symbolGroup: 1 },
  { orm: "sqlalchemy", test: (f) => f.language === "python" && f.imports.some((i) => /sqlalchemy/.test(i.external ?? i.spec)), find: /class\s+(\w+)\([^)]*\):(?:(?!\nclass\s)[\s\S]){0,400}?__tablename__\s*=\s*["'](\w+)["']/g, field: /^\s*(\w+)\s*(?::\s*Mapped\[[^\]]*\])?\s*=\s*(?:\w+\.)?(?:Column|mapped_column|relationship)\(/, nameGroup: 2, symbolGroup: 1 },
  { orm: "django", test: (f) => f.language === "python" && /models\.py$/.test(f.path), find: /class\s+((\w+))\((?:models\.)?Model\)/g, field: /^\s*(\w+)\s*=\s*models\.\w+/, nameGroup: 2, symbolGroup: 1 },
  { orm: "mongoose", test: (f) => f.imports.some((i) => i.external === "mongoose"), find: /model\(\s*["'`]((\w+))["'`]/g, field: /^\s*(\w+)\s*:\s*[{[A-Z"']/, nameGroup: 2, symbolGroup: 1 },
  { orm: "sequelize", test: (f) => f.imports.some((i) => i.external === "sequelize"), find: /define\(\s*["'`]((\w+))["'`]/g, field: /^\s*(\w+)\s*:\s*[{A-Z]/, nameGroup: 2, symbolGroup: 1 },
  { orm: "typeorm", test: (f) => f.imports.some((i) => i.external === "typeorm"), find: /@Entity\([^)]*\)\s*(?:export\s+)?class\s+((\w+))/g, field: /^\s*(\w+)[!?]?\s*:\s*[\w[\]<>|]+;?\s*$/, nameGroup: 2, symbolGroup: 1 },
  { orm: "gorm", test: (f) => f.language === "go" && f.imports.some((i) => /gorm/.test(i.external ?? i.spec)), find: /type\s+((\w+))\s+struct\s*\{[^}]*gorm/g, field: /^\s*([A-Z]\w*)\s+[\w.*[\]]+/, nameGroup: 2, symbolGroup: 1 },
  { orm: "sql", test: (f) => /\.sql$/i.test(f.path), find: /create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?(?:\w+\.)?((\w+))/gi, field: /^\s*[`"[]?(\w+)[`"\]]?\s+[a-z]/i, nameGroup: 2, symbolGroup: 1 },
];

/** The block a definition opens: up to the bracket that closes its first `(` or `{`, at most 80 lines. */
function blockEnd(lines: string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < Math.min(lines.length, start + 80); i++) {
    for (const ch of lines[i]!.replace(/(["'`]).*?\1/g, "")) {
      if (ch === "(" || ch === "{") {
        depth++;
        opened = true;
      } else if (ch === ")" || ch === "}") depth--;
    }
    if (opened && depth <= 0) return i;
    // Python classes have no braces: they end at the next line that isn't indented.
    if (!opened && i > start && /^\S/.test(lines[i]!)) return i - 1;
  }
  return Math.min(lines.length - 1, start + 40);
}

async function readRaw(index: Index, rel: string): Promise<string[] | undefined> {
  const root = await realpath(index.root).catch(() => index.root);
  const real = await realpath(join(index.root, rel)).catch(() => undefined);
  if (!real || !real.startsWith(root)) return undefined;
  const text = await readFile(real, "utf8").catch(() => undefined);
  return text && text.length < 2_000_000 ? text.split("\n") : undefined;
}

export async function findTables(index: Index): Promise<Table[]> {
  const out: Table[] = [];
  for (const f of index.files) {
    if (f.role === "test" || f.role === "fixture" || f.role === "generated") continue;
    const kinds = TABLE_PATTERNS.filter((p) => p.test(f));
    if (!kinds.length) continue;
    const lines = await readIndexed(index, f);
    if (!lines) continue;
    const text = lines.join("\n");
    for (const p of kinds) {
      for (const m of text.matchAll(p.find)) {
        const line = text.slice(0, m.index).split("\n").length;
        const end = blockEnd(lines, line - 1);
        const fields = lines
          .slice(line, end + 1)
          .map((l) => p.field.exec(l)?.[1])
          .filter((x): x is string => Boolean(x) && !/^(constraint|primary|foreign|unique|index|key|check|class|def|return|meta)$/i.test(x!));
        out.push({ name: m[p.nameGroup]!, symbol: m[p.symbolGroup]!, path: f.path, line, orm: p.orm, fields: [...new Set(fields)].slice(0, 24) });
      }
    }
  }
  // Prisma schemas aren't parsed as code, so they're in the skipped list.
  for (const s of index.skipped.filter((x) => x.path.endsWith(".prisma"))) {
    const lines = await readRaw(index, s.path);
    if (!lines) continue;
    lines.forEach((l, i) => {
      const m = /^\s*model\s+(\w+)\s*\{/.exec(l);
      if (!m) return;
      const end = blockEnd(lines, i);
      const fields = lines.slice(i + 1, end).map((x) => /^\s*(\w+)\s+\w/.exec(x)?.[1]).filter((x): x is string => Boolean(x));
      out.push({ name: m[1]!, symbol: m[1]!, path: s.path, line: i + 1, orm: "prisma", fields });
    });
  }
  return out;
}

// ---------- entry points and what they reach

interface Use {
  table: Table;
  /** 0 is the handler's own code, 1 a function it calls, and so on. */
  depth: number;
  writes: boolean;
  /** The call chain from the handler to the function that uses the table (empty when the handler does). */
  chain: CallNode[];
  line: number;
}

interface Entry {
  key: string;
  label: string;
  path: string;
  line: number;
  route?: RouteAt;
  action?: { service: string; symbol: SymbolInfo };
  trace: Trace;
  /** Every function reached, as "path#line". */
  reached: Set<string>;
  uses: Use[];
}

interface Analysis {
  tables: Table[];
  entries: Entry[];
  /** Functions most entry points reach: plumbing, not part of any one feature. */
  shared: Set<string>;
  groups: Group[];
  other: Entry[];
  /** Each entry point's nearest table. */
  primary: Map<string, Use>;
}

interface Group {
  id: string;
  name: string;
  kind: FeatureKind;
  why: string;
  entries: Entry[];
  table?: Table;
  /** For a group formed by a shared function, that function. */
  fn?: CallNode;
}

const nodeKey = (n: { path: string; line: number }) => `${n.path}#${n.line}`;
const flatten = (flow: CallNode[]): CallNode[] => flow.flatMap((n) => [n, ...flatten(n.children)]);
const WRITES = /\b(insert|update|delete|upsert|create|save|destroy|remove|bulk_?create|merge|add|put|set|values|replace)\w*\s*\(|\b(INSERT|UPDATE|DELETE)\b/i;

/** How code refers to a table: its identifier, a Prisma client property, or its name after FROM/INTO/… in SQL. */
function tableRef(t: Table): RegExp {
  const esc = t.symbol.replace(/[$]/g, "\\$");
  if (t.orm === "prisma") return new RegExp(`\\.${t.symbol.charAt(0).toLowerCase()}${t.symbol.slice(1)}\\.\\w+\\(`);
  if (t.orm === "sql") return new RegExp(`\\b(from|into|update|join|table)\\s+[\`"\\[]?(\\w+\\.)?${esc}\\b`, "i");
  return new RegExp(`(?<![\\w$.])${esc}\\b`);
}

/**
 * The file with string literals and comments blanked to spaces, keeping every newline, so a
 * table's name in a route path ("/api/comments"), a template ("Shown on comments") or a comment
 * doesn't count as using the table.
 */
export function codeOnly(text: string, python: boolean): string {
  let out = "";
  let i = 0;
  const blank = (to: number) => {
    out += text.slice(i, to).replace(/[^\n]/g, " ");
    i = to;
  };
  while (i < text.length) {
    const c = text[i]!;
    const two = text.slice(i, i + 2);
    const three = text.slice(i, i + 3);
    if (!python && two === "//") blank(text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i));
    else if (!python && two === "/*") blank(text.indexOf("*/", i + 2) < 0 ? text.length : text.indexOf("*/", i + 2) + 2);
    else if (python && c === "#") blank(text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i));
    else if (python && (three === '"""' || three === "'''")) blank(text.indexOf(three, i + 3) < 0 ? text.length : text.indexOf(three, i + 3) + 3);
    else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && (c === "`" || text[j] !== "\n")) j += text[j] === "\\" ? 2 : 1;
      blank(Math.min(j + 1, text.length));
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const DEPTH = 4;
const analyses = new WeakMap<Index, Promise<Analysis>>();

export function analyse(index: Index, g: Graph): Promise<Analysis> {
  let p = analyses.get(index);
  if (!p) analyses.set(index, (p = build(index, g)));
  return p;
}

async function build(index: Index, g: Graph): Promise<Analysis> {
  // A table defined both in code and in a migration's SQL is one table: keep the code's, which is what code refers to.
  const found = (await findTables(index)).sort((a, b) => Number(a.orm === "sql") - Number(b.orm === "sql") || a.path.localeCompare(b.path) || a.line - b.line);
  const tables = found.filter((t, i) => found.findIndex((x) => x.name.toLowerCase() === t.name.toLowerCase()) === i);
  const refs = tables.map((t) => ({ t, re: tableRef(t) }));
  const fileOf = new Map(index.files.map((f) => [f.path, f]));
  const lineCache = new Map<string, Promise<{ raw: string[]; code: string[] } | undefined>>();
  const linesOf = (path: string) => {
    let l = lineCache.get(path);
    if (!l) {
      const f = fileOf.get(path);
      l = (async () => {
        const raw = f ? await readIndexed(index, f) : undefined;
        return raw && { raw, code: codeOnly(raw.join("\n"), f!.language === "python").split("\n") };
      })();
      lineCache.set(path, l);
    }
    return l;
  };
  /** The tables a stretch of code uses, with the first line of each. */
  const usesIn = async (path: string, from: number, to: number) => {
    const file = await linesOf(path);
    const out: { table: Table; line: number; writes: boolean }[] = [];
    if (!file) return out;
    for (const { t, re } of refs) {
      if (!canSee(path, t)) continue;
      // SQL lives in strings, so it's matched in the raw text; everything else only in code.
      const lines = t.orm === "sql" ? file.raw : file.code;
      // The first line that writes the table, else the first that uses it.
      let first: number | undefined;
      for (let i = from; i <= Math.min(to, lines.length); i++) {
        if (!re.test(lines[i - 1]!)) continue;
        first ??= i;
        // A statement often spans lines (`db.insert(comments)\n  .values(…)`): look at the next two for the verb.
        if (WRITES.test(file.code.slice(i - 1, i + 2).join(" "))) {
          out.push({ table: t, line: i, writes: true });
          first = undefined;
          break;
        }
      }
      if (first) out.push({ table: t, line: first, writes: false });
    }
    return out;
  };
  /**
   * Whether code in this file can refer to the table at all: it defines it, imports its file (directly or
   * through one re-exporting file), or the table is reached by name (SQL, Prisma). A local variable that
   * happens to be called `members` in a file that never imports the schema isn't the table.
   */
  const canSee = (path: string, t: Table) => {
    if (t.orm === "sql" || t.orm === "prisma" || path === t.path) return true;
    const f = fileOf.get(path);
    if (f?.language === "go") return dirname(path) === dirname(t.path) || f.imports.some((i) => i.targets.some((x) => dirname(x) === dirname(t.path)));
    const out = g.out.get(path) ?? new Set<string>();
    return out.has(t.path) || [...out].some((x) => g.out.get(x)?.has(t.path));
  };
  const symbolAt = (path: string, line: number) => fileOf.get(path)?.symbols.find((s) => s.line === line);

  // 1. Entry points: routes defined in source, and Moleculer actions.
  const raw: Omit<Entry, "reached" | "uses">[] = [];
  for (const r of allRoutes(index, "server")) {
    if (fileOf.get(r.file)?.role !== "source") continue;
    const label = `${r.method} ${r.servicePath && !r.path ? r.servicePath : r.path}`;
    raw.push({ key: `${r.file}:${r.line}:${label}`, label, path: r.file, line: r.line, route: r, trace: trace(index, g, { kind: "route", label, path: r.file, line: r.line, route: r }, { depth: DEPTH }) });
  }
  for (const f of index.files) {
    if (f.role !== "source") continue;
    for (const s of f.symbols) {
      if (s.broker !== "action" || !s.parent) continue;
      const label = `action ${s.parent}.${s.name}`;
      raw.push({ key: `${f.path}:${s.line}:${label}`, label, path: f.path, line: s.line, action: { service: s.parent, symbol: s }, trace: trace(index, g, { kind: "symbol", label, path: f.path, line: s.line, symbol: s }, { depth: DEPTH }) });
    }
  }

  // 2. What each reaches: functions, and the tables they use, nearest first.
  const entries: Entry[] = [];
  for (const e of raw) {
    const reached = new Set(flatten(e.trace.flow).map(nodeKey));
    const uses: Use[] = [];
    const own = e.route ? routeRange(index, e.route) : e.action ? { from: e.action.symbol.line, to: e.action.symbol.endLine } : undefined;
    if (own) for (const u of await usesIn(e.path, own.from, own.to)) uses.push({ ...u, depth: 0, chain: [] });
    const walk = async (nodes: CallNode[], chain: CallNode[]) => {
      for (const n of nodes) {
        const sym = symbolAt(n.path, n.line);
        const here = [...chain, n];
        // Constructing a model (`Order(...)`) reaches its class: that's the table's definition, not code using it.
        if (tables.some((t) => t.path === n.path && t.line === n.line)) continue;
        if (sym) for (const u of await usesIn(n.path, sym.line, sym.endLine)) uses.push({ ...u, depth: here.length, chain: here });
        await walk(n.children, here);
      }
    };
    await walk(e.trace.flow, []);
    entries.push({ ...e, reached, uses });
  }

  // 3. Shared plumbing: functions reached by many entry points.
  const fanIn = new Map<string, number>();
  for (const e of entries) for (const k of e.reached) fanIn.set(k, (fanIn.get(k) ?? 0) + 1);
  const limit = Math.max(4, Math.ceil(entries.length * 0.15));
  const shared = new Set([...fanIn].filter(([, n]) => n > limit).map(([k]) => k));
  const isShared = (u: Use) => u.chain.some((n) => shared.has(nodeKey(n)));

  // 4. Group: by nearest table, by Moleculer service, by a shared function.
  const tableReach = new Map<Table, number>();
  for (const e of entries) for (const t of new Set(e.uses.filter((u) => !isShared(u)).map((u) => u.table))) tableReach.set(t, (tableReach.get(t) ?? 0) + 1);
  const primary = (e: Entry): Use | undefined =>
    e.uses
      .filter((u) => !isShared(u))
      .sort((a, b) => a.depth - b.depth || Number(b.writes) - Number(a.writes) || (tableReach.get(a.table) ?? 0) - (tableReach.get(b.table) ?? 0) || a.table.name.localeCompare(b.table.name))[0];
  /** The first function the handler hands off to that isn't plumbing. */
  const firstFn = (e: Entry) => flatten(e.trace.flow).find((n) => !shared.has(nodeKey(n)) && n.path !== e.path && fileOf.get(n.path)?.role === "source");

  const parent = new Map<string, string>(entries.map((e) => [e.key, e.key]));
  const find = (k: string): string => (parent.get(k) === k ? k : find(parent.get(k)!));
  const union = (a: string, b: string) => {
    const [x, y] = [find(a), find(b)].sort();
    if (x !== y) parent.set(y!, x!);
  };
  const byTable = new Map<Table, Entry[]>();
  for (const e of entries) {
    const p = primary(e);
    if (p) byTable.set(p.table, [...(byTable.get(p.table) ?? []), e]);
  }
  for (const list of byTable.values()) for (const e of list.slice(1)) union(list[0]!.key, e.key);
  const actionsOf = new Map<string, Entry[]>();
  for (const e of entries) {
    // A gateway alias runs an action: it belongs with that action's service.
    const svc = e.action?.service ?? (e.route?.handler?.startsWith("svc:") ? e.route.handler.slice(4, e.route.handler.lastIndexOf(".")) : undefined);
    if (svc) actionsOf.set(svc, [...(actionsOf.get(svc) ?? []), e]);
  }
  for (const list of actionsOf.values()) for (const e of list.slice(1)) union(list[0]!.key, e.key);
  // Only entry points with no table and no service are grouped by the function they call: a helper two
  // unrelated features both use (a role check) mustn't merge them.
  const byFn = new Map<string, Entry[]>();
  for (const e of entries) {
    if (primary(e) || actionsOf.has(e.action?.service ?? "") || e.route?.handler?.startsWith("svc:")) continue;
    const fn = firstFn(e);
    if (fn) byFn.set(nodeKey(fn), [...(byFn.get(nodeKey(fn)) ?? []), e]);
  }
  for (const list of byFn.values()) for (const e of list.slice(1)) union(list[0]!.key, e.key);

  const sets = new Map<string, Entry[]>();
  for (const e of entries) sets.set(find(e.key), [...(sets.get(find(e.key)) ?? []), e]);

  const groups: Group[] = [];
  const other: Entry[] = [];
  for (const members of sets.values()) {
    const tableCount = new Map<Table, number>();
    for (const e of members) {
      const p = primary(e);
      if (p) tableCount.set(p.table, (tableCount.get(p.table) ?? 0) + 1);
    }
    const table = [...tableCount].sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))[0]?.[0];
    const svc = [...actionsOf].find(([, l]) => l.some((e) => members.includes(e)))?.[0];
    if (!table && !svc && members.length < 2) {
      other.push(...members);
      continue;
    }
    const fnCount = new Map<string, { n: CallNode; c: number }>();
    for (const e of members) {
      const f = firstFn(e);
      if (f) fnCount.set(nodeKey(f), { n: f, c: (fnCount.get(nodeKey(f))?.c ?? 0) + 1 });
    }
    const fn = [...fnCount.values()].sort((a, b) => b.c - a.c || nodeKey(a.n).localeCompare(nodeKey(b.n)))[0]?.n;
    const kind: FeatureKind = table ? "table" : svc ? "service" : "shared-code";
    const name = table ? title(table.name) : svc ? title(svc.replace(/^v\d+\./, "")) : commonPath(members) ?? title(fn?.name.split(".").pop() ?? members[0]!.label);
    const why = table
      ? `${members.length === 1 ? "This entry point uses" : `These ${members.length} entry points all use`} the \`${table.name}\` table${tableCount.size > 1 ? " (or a table used alongside it)" : ""} before any other.`
      : svc
        ? `The actions of the Moleculer service \`${svc}\`${members.some((e) => e.route) ? ", and the gateway routes that run them" : ""}.`
        : `These ${members.length} entry points all call \`${fn?.name}\` (${fn?.path}:${fn?.line}).`;
    groups.push({ id: "", name, kind, why, entries: members.sort((a, b) => a.label.localeCompare(b.label)), ...(table ? { table } : {}), ...(fn ? { fn } : {}) });
  }
  groups.sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name));
  // Two features can end up with the same label (a table and a service both called "users"): number them.
  const taken = new Map<string, number>();
  for (const gr of groups) {
    const base = slug(gr.name);
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    gr.id = n === 1 ? base : `${base}-${n}`;
    if (n > 1) gr.name = `${gr.name} (${n})`;
  }
  const primaries = new Map<string, Use>();
  for (const e of entries) {
    const p = primary(e);
    if (p) primaries.set(e.key, p);
  }
  return { tables, entries, shared, groups, other: other.sort((a, b) => a.label.localeCompare(b.label)), primary: primaries };
}

/** The deepest path segment every route shares, for naming a group of routes ("/api/billing/…" → "Billing"). */
function commonPath(members: Entry[]): string | undefined {
  const paths = members.filter((e) => e.route).map((e) => segments(e.route!.path).filter((s) => s !== "*" && !/^(api|v\d+)$/i.test(s)));
  if (paths.length < members.length || !paths.length) return undefined;
  let i = 0;
  while (paths.every((p) => p[i] !== undefined && p[i] === paths[0]![i])) i++;
  return i ? title(paths[0]![i - 1]!) : undefined;
}

const fileCount = (gr: Group, shared: Set<string>) => new Set(gr.entries.flatMap((e) => [e.path, ...[...e.reached].filter((k) => !shared.has(k)).map((k) => k.slice(0, k.lastIndexOf("#")))])).size;

export async function listFeatures(index: Index, g: Graph): Promise<FeatureList> {
  const a = await analyse(index, g);
  return {
    features: a.groups.map((gr) => ({ id: gr.id, name: gr.name, kind: gr.kind, entries: gr.entries.length, tables: gr.table ? [gr.table.name] : [], files: fileCount(gr, a.shared) })),
    other: a.other.map((e) => ({ label: e.label, path: e.path, line: e.line })),
  };
}

// ---------- the walkthrough

const ACCESS = /auth|access|permission|role|guard|require|login|session|owner|admin|can[A-Z]|allowed/i;
const VALIDATE = /^(z\.|.*\.parse$|.*parse$|validate|.*Schema|check[A-Z])/;

async function code(index: Index, path: string, keyLines: number[], options: { lead?: number | undefined; max?: number } = {}): Promise<CodeLine[]> {
  const f = index.files.find((x) => x.path === path);
  const lines = f ? await readIndexed(index, f) : await readRaw(index, path);
  if (!lines) return [];
  const want = [...new Set([...(options.lead ? [options.lead] : []), ...keyLines])].filter((n) => n >= 1 && n <= lines.length).sort((a, b) => a - b).slice(0, options.max ?? 6);
  const hl = new Set(keyLines);
  const raw = want.map((n) => ({ line: n, text: lines[n - 1]! }));
  const indent = Math.min(...raw.filter((r) => r.text.trim()).map((r) => /^\s*/.exec(r.text)![0].length));
  return raw.map((r, i) => ({ line: r.line, text: r.text.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, "").slice(0, 160), ...(hl.has(r.line) && r.line !== options.lead ? { hl: true } : {}), ...(i > 0 && r.line !== raw[i - 1]!.line + 1 ? { gap: true } : {}) }));
}

const enclosing = (f: FileFacts | undefined, line: number) => f?.symbols.filter((s) => s.line <= line && s.endLine >= line && s.kind !== "module").sort((a, b) => a.endLine - a.line - (b.endLine - b.line))[0];
const short = (p: string) => p.split("/").slice(-2).join("/");
const lastName = (n: string) => n.split(".").pop()!;

function findGroup(a: Analysis, idOrName: string): Group | undefined {
  const q = idOrName.trim().toLowerCase();
  return a.groups.find((x) => x.id === q) ?? a.groups.find((x) => x.name.toLowerCase() === q) ?? a.groups.find((x) => x.id === slug(q)) ?? a.groups.find((x) => x.table?.name.toLowerCase() === q || x.table?.symbol.toLowerCase() === q);
}

export async function explainFeature(index: Index, g: Graph, idOrName: string, risks: Risk[] = []): Promise<Feature | undefined> {
  const a = await analyse(index, g);
  const group = findGroup(a, idOrName);
  if (!group) return undefined;
  const fileOf = (p: string) => index.files.find((f) => f.path === p);
  const table = group.table;
  const primaryOf = (e: Entry) => a.primary.get(e.key);
  const useOf = (e: Entry) => (table ? e.uses.filter((u) => u.table === table && !u.chain.some((n) => a.shared.has(nodeKey(n)))).sort((x, y) => x.depth - y.depth)[0] : undefined);

  // The main path: one the browser calls, that writes the table, preferring POST; then by label so it's stable.
  const score = (e: Entry) => (table && primaryOf(e)?.table === table ? 8 : 0) + (e.trace.callers.some((c) => sameRoute(segments(c.label.slice(c.label.indexOf(" ") + 1)), segments(e.route?.path ?? ""))) ? 4 : 0) + (useOf(e)?.writes ? 2 : 0) + (e.route?.method === "POST" ? 1 : 0);
  const main = [...group.entries].sort((x, y) => score(y) - score(x) || x.label.localeCompare(y.label))[0]!;
  const use = useOf(main);
  const steps: FeatureStep[] = [];
  const visited = new Set<string>();

  // Screen and client: the call that hits the route, and the screen that shows the component making it.
  // The caller whose path spells out most of the route's own segments, so `"/api/pages/" + id` doesn't beat `/api/pages/${id}/comments`.
  const routeSegs = main.route ? segments(main.route.path) : [];
  const exactness = (label: string) => {
    const cs = segments(label.slice(label.indexOf(" ") + 1));
    return (cs.length === routeSegs.length ? 100 : 0) + cs.filter((x, i) => x !== "*" && x === routeSegs[i]).length;
  };
  const caller = [...main.trace.callers].sort((x, y) => exactness(y.label) - exactness(x.label) || x.path.localeCompare(y.path) || x.line - y.line)[0];
  if (caller) {
    const cf = fileOf(caller.path);
    const comp = enclosing(cf, caller.line);
    const compName = comp?.parent && comp.kind === "method" ? comp.parent : comp?.name;
    // A component's own name is often only its file's default export; the file name says it as well.
    const shownAs = compName && /^[A-Z]/.test(compName) ? compName : basename(caller.path, extname(caller.path));
    for (const p of compName && /^[A-Z]/.test(compName) ? [...(g.in.get(caller.path) ?? [])].sort() : []) {
      const pf = fileOf(p);
      const site = pf?.callSites.find(([ref]) => ref === shownAs);
      if (pf && site && pf.role === "source") {
        steps.push({ layer: "screen", title: `${basename(p, extname(p))} shows ${shownAs}`, path: p, line: site[1], detail: "Where you find it in the app.", code: await code(index, p, [site[1]]) });
        visited.add(p);
        break;
      }
    }
    steps.push({
      layer: "client",
      title: `${shownAs} sends ${main.label}`,
      path: caller.path,
      line: caller.line,
      detail: comp ? `In ${comp.name}${comp.kind === "function" || comp.kind === "method" ? "()" : ""}.` : undefined,
      code: await code(index, caller.path, [caller.line], { lead: comp && caller.line - comp.line < 40 ? comp.line : undefined }),
    });
    visited.add(caller.path);
  }

  // The route or action: its access checks, validation, and the call that hands off the work.
  const mf = fileOf(main.path);
  const range = main.route ? routeRange(index, main.route) : main.action ? { from: main.action.symbol.line, to: main.action.symbol.endLine } : undefined;
  const sites = range ? (mf?.callSites ?? []).filter(([, l]) => l >= range.from && l <= range.to) : [];
  const access = sites.filter(([ref]) => ACCESS.test(lastName(ref)));
  const validate = sites.filter(([ref]) => VALIDATE.test(ref));
  const chain = use ? use.chain : group.fn ? pathTo(main.trace.flow, nodeKey(group.fn)) : [];
  const handOff = chain[0];
  const handOffLine = handOff ? sites.find(([ref]) => lastName(ref) === lastName(handOff.name))?.[1] : undefined;
  const notes = [access.length ? `checks who you are with ${[...new Set(access.map(([x]) => `\`${lastName(x)}\``))].slice(0, 2).join(" and ")}` : "", validate.length ? "validates the input" : "", handOff ? `calls \`${handOff.name}\`` : "", use?.depth === 0 ? `${use.writes ? "writes" : "reads"} the \`${use.table.name}\` table itself` : ""].filter(Boolean);
  steps.push({
    layer: "route",
    title: `${short(main.path)} handles ${main.label}`,
    path: main.path,
    line: main.line,
    detail: notes.length ? `It ${notes.join(", ").replace(/, ([^,]*)$/, " and $1")}.` : undefined,
    code: await code(index, main.path, [access[0]?.[1], validate[0]?.[1], handOffLine, use?.depth === 0 ? use.line : undefined].filter((x): x is number => Boolean(x)), { lead: main.line }),
  });
  visited.add(main.path);

  // Each function on the way to the table (or to the shared function), at most three.
  const hops = chain.length > 3 ? [chain[0]!, ...chain.slice(-2)] : chain;
  for (const [i, n] of hops.entries()) {
    const nf = fileOf(n.path);
    const sym = nf?.symbols.find((s) => s.line === n.line);
    if (!nf || !sym) continue;
    const last = i === hops.length - 1;
    const next = hops[i + 1];
    const keyLines = [
      ...(last && use ? [use.line] : []),
      ...(next ? nf.callSites.filter(([ref, l]) => l >= sym.line && l <= sym.endLine && lastName(ref) === lastName(next.name)).map(([, l]) => l).slice(0, 1) : []),
      ...nf.throws.filter((t) => t.line >= sym.line && t.line <= sym.endLine).map((t) => t.line).slice(0, 2),
    ];
    const throws = nf.throws.filter((t) => t.line >= sym.line && t.line <= sym.endLine).length;
    steps.push({
      layer: "service",
      title: last && use ? `${n.name} ${use.writes ? "writes" : "reads"} ${use.table.name}` : next ? `${n.name} passes it on` : `${n.name} does the work`,
      path: n.path,
      line: n.line,
      detail: [sym.doc ? sym.doc.split(/(?<=\.)\s/)[0] : "", throws ? `Fails with an error in ${throws} case${throws === 1 ? "" : "s"}.` : "", n.byName ? "Matched by name only: no import says which function this is." : "", hops.length < chain.length && i === 0 ? `${chain.length - hops.length} more call${chain.length - hops.length === 1 ? "" : "s"} in between.` : ""].filter(Boolean).join(" ") || undefined,
      code: await code(index, n.path, keyLines, { lead: sym.line }),
    });
    visited.add(n.path);
  }

  // The table and its columns.
  if (table) {
    steps.push({ layer: "data", title: `Stored in the ${table.name} table`, path: table.path, line: table.line, detail: table.fields.length ? `Columns: ${table.fields.join(", ")}.` : undefined, code: await code(index, table.path, [table.line]) });
    visited.add(table.path);
  }

  // Every entry point, and the function where its work happens.
  const actions: EntryPoint[] = group.entries.map((e) => {
    const u = useOf(e);
    const d = u?.chain.at(-1) ?? flatten(e.trace.flow).find((n) => !a.shared.has(nodeKey(n)) && n.path !== e.path);
    return { label: e.label, path: e.path, line: e.line, ...(d ? { does: { name: d.name, path: d.path, line: d.line } } : {}) };
  });

  // Other ways in: code that imports the working function's file and calls it, outside any route.
  const target = chain.at(-1);
  const otherWays: Feature["otherWays"] = [];
  if (target) {
    const fn = lastName(target.name);
    for (const p of [...(g.in.get(target.path) ?? [])].sort()) {
      const f = fileOf(p);
      if (!f || f.role !== "source" || group.entries.some((e) => e.path === p)) continue;
      const site = f.callSites.find(([ref]) => lastName(ref) === fn);
      if (site) otherWays.push({ label: `${short(p)} calls ${fn}`, path: p, line: site[1] });
    }
  }

  // Tests: those that call the feature's functions, or request its routes.
  const fnNames = new Set(actions.flatMap((x) => (x.does ? [lastName(x.does.name)] : [])));
  const routePaths = group.entries.flatMap((e) => (e.route ? [segments(e.route.path)] : []));
  const tests: string[] = [];
  for (const f of index.files.filter((x) => x.role === "test").sort((x, y) => x.path.localeCompare(y.path))) {
    if (f.calls.some((c) => fnNames.has(lastName(c)))) {
      tests.push(f.path);
      continue;
    }
    if (!routePaths.length) continue;
    const lines = await readIndexed(index, f);
    const hits = lines?.some((l) => [...l.matchAll(/["'`](\/[^"'`\s]*)["'`]/g)].some((m) => routePaths.some((rp) => sameRoute(segments(m[1]!), rp))));
    if (hits) tests.push(f.path);
  }

  // Where to change it, in the order you'd touch the layers.
  const change: Feature["change"] = [];
  const add = (path: string, why: string, line?: number) => {
    if (!change.some((c) => c.path === path)) change.push({ path, why, ...(line ? { line } : {}) });
  };
  if (table) {
    add(table.path, `the ${table.name} table's columns`, table.line);
    const migrations = index.files.filter((f) => f.role === "migration");
    const latest = migrations.map((m) => m.path).filter((x) => !/\.json$/.test(x)).sort().at(-1);
    if (latest) add(dirname(latest) + "/", "a new migration (generate it with your ORM)");
  }
  if (target) add(target.path, `${target.name} and its neighbours`, target.line);
  add(main.path, main.route ? "the route: input checks and access" : "the action", main.line);
  for (const s of steps) if (s.layer === "client" || s.layer === "screen") add(s.path, s.layer === "client" ? "the screen's code" : "where the screen is shown", s.line);

  const featureFiles = new Set([...visited, ...change.map((c) => c.path), ...group.entries.map((e) => e.path)]);
  const watchOut = risks
    .filter((r) => ["swallowed-error", "missing-route", "cycle", "duplicate", "untested", "todo", "env-undocumented", "long-function"].includes(r.kind) && r.locations.some((l) => featureFiles.has(l.path)))
    .slice(0, 5)
    .map((r) => {
      const at = r.locations.find((l) => featureFiles.has(l.path))!;
      return { title: r.title, path: at.path, ...(at.line ? { line: at.line } : {}) };
    });

  // What the main path couldn't follow, so nobody mistakes a short walkthrough for the whole story.
  const gaps = [...(main.trace.note ? [main.trace.note] : []), ...(!use && !group.fn && main.trace.calls.unresolved.length ? [`Couldn't follow ${main.trace.calls.unresolved.slice(0, 6).map((x) => `\`${x}\``).join(", ")} from ${main.path}:${main.line}: dynamic calls, injected services or values of unknown type.`] : [])];

  const related = group.entries
    .flatMap((e) => e.trace.callers.filter((c) => sameRoute(segments(c.label.slice(c.label.indexOf(" ") + 1)), segments(e.route?.path ?? ""))).map((c) => ({ ...c, label: `${basename(c.path)} calls ${e.label}` })))
    .filter((c, i, all) => !visited.has(c.path) && all.findIndex((x) => x.path === c.path && x.line === c.line) === i)
    .sort((x, y) => x.path.localeCompare(y.path) || x.line - y.line)
    .slice(0, 12);

  const client = steps.find((s) => s.layer === "client");
  const screen = steps.find((s) => s.layer === "screen");
  const summary = [
    client ? `${client.title.replace(/ sends .*/, "")}${screen ? ` (shown in ${basename(screen.path, extname(screen.path))})` : ""} sends \`${main.label}\`.` : `\`${main.label}\` is the main entry point.`,
    `${short(main.path)} handles it${target ? ` and ${chain.length > 1 ? "through " + (chain.length - 1) + " call" + (chain.length > 2 ? "s" : "") + " reaches" : "calls"} \`${target.name}\` in ${short(target.path)}` : ""}${use ? `, which ${use.writes ? "writes" : "reads"} the \`${use.table.name}\` table` : ""}.`,
    group.entries.length > 1 ? `${group.entries.length} entry points in all.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: group.id,
    name: group.name,
    kind: group.kind,
    entries: group.entries.length,
    tables: table ? [table.name] : [],
    files: fileCount(group, a.shared),
    why: group.why,
    summary,
    steps,
    actions,
    otherWays: otherWays.slice(0, 8),
    change,
    tests: tests.slice(0, 8),
    watchOut,
    gaps,
    related,
  };
}

/** The chain of calls from the top of a flow down to the node with this key. */
function pathTo(flow: CallNode[], key: string): CallNode[] {
  for (const n of flow) {
    if (nodeKey(n) === key) return [n];
    const below = pathTo(n.children, key);
    if (below.length) return [n, ...below];
  }
  return [];
}

const sameRoute = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i] || s === "*" || b[i] === "*");

// ---------- text, for the CLI and MCP

export function formatFeatures(list: FeatureList): string {
  const { features, other } = list;
  if (!features.length && !other.length) return "No features found: Spelunk found no server routes or Moleculer actions. Try overview and where instead.";
  const out = [`${features.length} features, grouped by the table or code their routes reach. Use explain_feature with a name for its walkthrough.`, ""];
  for (const f of features) out.push(`${f.name.padEnd(28)} ${[`${f.entries} entry point${f.entries === 1 ? "" : "s"}`, f.tables.length ? `table ${f.tables.join(", ")}` : f.kind === "service" ? "Moleculer service" : "shared code", `${f.files} file${f.files === 1 ? "" : "s"}`].join(" · ")}`);
  if (other.length) out.push("", `Other entry points (${other.length}), which share no table or function with another:`, ...other.slice(0, 40).map((e) => `  ${e.label}  ${e.path}:${e.line}`), ...(other.length > 40 ? [`  … and ${other.length - 40} more`] : []));
  return out.join("\n");
}

export function formatFeature(f: Feature): string {
  const out = [`# ${f.name}`, "", f.summary, "", `Grouped because: ${f.why}`, ""];
  f.steps.forEach((s, i) => {
    out.push(`${i + 1}. [${s.layer}] ${s.title}  ${s.path}:${s.line}`);
    if (s.detail) out.push(`   ${s.detail}`);
    for (const c of s.code) out.push(`${c.gap ? "   …\n" : ""}   ${String(c.line).padStart(5)}${c.hl ? " >" : "  "} ${c.text}`);
    out.push("");
  });
  if (f.gaps.length) out.push("Couldn't follow:", ...f.gaps.map((x) => `  ${x}`), "");
  if (f.actions.length) out.push("Entry points:", ...f.actions.map((a) => `  ${a.label}  ${a.path}:${a.line}${a.does ? ` → ${a.does.name} (${a.does.path}:${a.does.line})` : ""}`), "");
  if (f.otherWays.length) out.push("Other ways in:", ...f.otherWays.map((o) => `  ${o.label}  ${o.path}:${o.line}`), "");
  if (f.change.length) out.push("To change it:", ...f.change.map((c) => `  ${c.path}${c.line ? `:${c.line}` : ""}  ${c.why}`), "");
  if (f.tests.length) out.push("Tests:", ...f.tests.map((t) => `  ${t}`), "");
  if (f.watchOut.length) out.push("Watch out:", ...f.watchOut.map((w) => `  ${w.title}  ${w.path}${w.line ? `:${w.line}` : ""}`), "");
  if (f.related.length) out.push("Also calling these routes:", ...f.related.map((r) => `  ${r.path}:${r.line}  ${r.label}`));
  return out.join("\n").trim();
}
