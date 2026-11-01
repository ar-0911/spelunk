import { basename, extname, join } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import type { Graph } from "./graph.js";
import type { Risk } from "./risks.js";
import { allRoutes, segments, type RouteAt } from "./routes.js";
import { readIndexed } from "../query/source.js";
import { trace, type CallNode } from "../query/trace.js";
import type { FileFacts, Index, SymbolInfo } from "../types.js";

/**
 * Features: what the app does, organised the way a developer asks about it
 * ("how do comments work?") rather than by folder.
 *
 * A feature is a noun the code keeps coming back to: a database table, a group
 * of API routes on one resource, or a Moleculer service. Files named after the
 * noun (comments.ts, CommentsPanel.tsx) attach to it. Its walkthrough follows
 * the main route across the layers: the screen that calls it, the route
 * handler, the service function it calls, and the table that function writes,
 * showing only the lines that matter at each step. Everything here is static;
 * Claude can rewrite the summary later, but nothing depends on it.
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
  detail?: string;
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

export interface FeatureSummary {
  id: string;
  name: string;
  routes: number;
  tables: string[];
  files: number;
  /** "service" when the feature is a Moleculer service. */
  kind: "resource" | "service";
}

export interface Feature extends FeatureSummary {
  summary: string;
  steps: FeatureStep[];
  /** Every route of the feature, with the function each one ends up in. */
  actions: { label: string; path: string; line: number; does?: { name: string; path: string; line: number } }[];
  /** Other code that reaches the same service function: an MCP tool, a job, a CLI. */
  otherWays: { label: string; path: string; line: number }[];
  /** Where to make a change, in the order you'd touch them. */
  change: { path: string; line?: number; why: string }[];
  tests: string[];
  watchOut: { title: string; path: string; line?: number }[];
  /** Other UI and source files about this feature that the walkthrough didn't visit. */
  related: string[];
}

// ---------- names

const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.\s]+/g, " ")
    .toLowerCase()
    .trim();
const singular = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : /(ss|us|is|ws)$/.test(w) ? w : /(sses|xes|ches|shes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
/** "pageQuestions", "page_questions" and "PageQuestion" all become "page question". */
export const nounKey = (s: string) => words(s).split(" ").filter(Boolean).map(singular).join(" ");
const idOf = (key: string) => key.replace(/ /g, "-");
const title = (s: string) => {
  const w = words(s);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const fileKey = (path: string) => nounKey(basename(path, extname(path)));
/** Does a file name mention the noun as whole words ("CommentsPanel" mentions "comment")? */
const mentions = (path: string, key: string) => ` ${fileKey(path)} `.includes(` ${key} `);

/** Path segments that never name a resource. */
const NOT_RESOURCES = new Set(["api", "rest", "graphql", "rpc", "internal", "public", "static", "assets", "_next", ".well-known", "healthz", "health", "ping", "favicon.ico", "robots.txt", "index", "", "app"]);

/**
 * The resource a route works on. Without parameters it's the first segment
 * (/oauth/token → oauth). With them, the last plural-looking segment, so
 * /api/pages/:id/comments/:cid/resolve is about comments and /api/pages/:id/lock
 * about pages.
 */
export function resourceOf(path: string): string | undefined {
  const segs = segments(path).filter((s) => !NOT_RESOURCES.has(s.toLowerCase()) && !/^v\d+$/i.test(s) && !/\.\w+$/.test(s));
  const statics = segs.filter((s) => s !== "*");
  if (!statics.length) return undefined;
  if (!segs.includes("*")) return statics[0];
  let res: string | undefined;
  segs.forEach((s, i) => {
    if (s === "*") return;
    const actionOnItem = i === segs.length - 1 && segs[i - 1] === "*" && !s.endsWith("s");
    if (!(actionOnItem && res)) res = s;
  });
  return res;
}

// ---------- tables

const TABLE_PATTERNS: { orm: string; test: (f: FileFacts) => boolean; find: RegExp; field: RegExp; nameGroup: number; symbolGroup: number }[] = [
  { orm: "drizzle", test: (f) => f.calls.some((c) => /^(pg|sqlite|mysql)Table$/.test(c)), find: /(?:export\s+)?const\s+(\w+)\s*=\s*(?:pg|sqlite|mysql)Table\(\s*["'`](\w+)["'`]/g, field: /^\s*(\w+)\s*:\s*\w+\(/, nameGroup: 2, symbolGroup: 1 },
  { orm: "sqlalchemy", test: (f) => f.language === "python" && f.imports.some((i) => /sqlalchemy/.test(i.external ?? i.spec)), find: /class\s+(\w+)\([^)]*\):[\s\S]{0,400}?__tablename__\s*=\s*["'](\w+)["']/g, field: /^\s*(\w+)\s*(?::\s*Mapped\[[^\]]*\])?\s*=\s*(?:\w+\.)?(?:Column|mapped_column|relationship)\(/, nameGroup: 2, symbolGroup: 1 },
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

// ---------- grouping

interface Group {
  key: string;
  names: Set<string>;
  tables: Table[];
  routes: RouteAt[];
  services: { name: string; path: string; actions: SymbolInfo[] }[];
}

const cache = new WeakMap<Index, Promise<{ groups: Group[]; tables: Table[] }>>();

async function groupsOf(index: Index): Promise<{ groups: Group[]; tables: Table[] }> {
  let p = cache.get(index);
  if (!p) {
    p = (async () => {
      const tables = await findTables(index);
      const groups = new Map<string, Group>();
      const get = (raw: string) => {
        const key = nounKey(raw);
        if (key.length < 3) return undefined;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { key, names: new Set(), tables: [], routes: [], services: [] }));
        g.names.add(raw);
        return g;
      };
      for (const t of tables) get(t.name)?.tables.push(t);
      const serverRoutes = allRoutes(index, "server").filter((r) => index.files.find((f) => f.path === r.file)?.role === "source");
      const byService = new Map<string, { path: string; actions: SymbolInfo[] }>();
      for (const f of index.files) {
        if (f.role !== "source") continue;
        for (const s of f.symbols) {
          if (s.broker !== "action" || !s.parent) continue;
          const e = byService.get(s.parent) ?? { path: f.path, actions: [] };
          e.actions.push(s);
          byService.set(s.parent, e);
        }
      }
      for (const [name, e] of byService) get(name.replace(/^v\d+\./, ""))?.services.push({ name, ...e });
      for (const r of serverRoutes) {
        // A Moleculer gateway alias belongs to the service whose action it runs.
        const svc = r.handler?.startsWith("svc:") ? r.handler.slice(4, r.handler.lastIndexOf(".")) : undefined;
        const res = svc ? svc.replace(/^v\d+\./, "") : resourceOf(r.path);
        if (res) get(res)?.routes.push(r);
      }
      return { groups: [...groups.values()], tables };
    })();
    cache.set(index, p);
  }
  return p;
}

const sourceFiles = (index: Index) => index.files.filter((f) => f.role === "source");

function filesAbout(index: Index, key: string): FileFacts[] {
  return sourceFiles(index).filter((f) => mentions(f.path, key));
}

export async function listFeatures(index: Index): Promise<FeatureSummary[]> {
  const { groups } = await groupsOf(index);
  return groups
    .map((g) => {
      const files = filesAbout(index, g.key).length;
      const score = g.tables.length * 3 + g.routes.length + g.services.reduce((n, s) => n + s.actions.length, 0) + Math.min(files, 4);
      return { g, files, score };
    })
    .filter(({ g, files }) => g.tables.length || g.services.length || g.routes.length >= 2 || (g.routes.length && files))
    .sort((a, b) => b.score - a.score || a.g.key.localeCompare(b.g.key))
    .slice(0, 60)
    .map(({ g, files }) => ({ id: idOf(g.key), name: title(pickName(g)), routes: g.routes.length, tables: g.tables.map((t) => t.name), files, kind: g.services.length ? ("service" as const) : ("resource" as const) }));
}

/** The plural, as the code spells it: "comments" over "comment". */
function pickName(g: Group): string {
  const names = [...g.names];
  return names.find((n) => /s$/i.test(n)) ?? names[0] ?? g.key;
}

// ---------- the walkthrough

const ACCESS = /auth|access|permission|role|guard|require|login|session|owner|admin|can[A-Z]|allowed/i;
const VALIDATE = /^(z\.|.*\.parse$|.*parse$|validate|.*Schema|check[A-Z])/;

async function code(index: Index, path: string, keyLines: number[], options: { lead?: number; max?: number } = {}): Promise<CodeLine[]> {
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
const nodes = (flow: CallNode[]): CallNode[] => flow.flatMap((n) => [n, ...nodes(n.children)]);

export async function explainFeature(index: Index, g: Graph, idOrName: string, risks: Risk[] = []): Promise<Feature | undefined> {
  const { groups } = await groupsOf(index);
  const key = nounKey(idOrName.replace(/-/g, " "));
  const group = groups.find((x) => x.key === key) ?? groups.find((x) => x.key.includes(key) || key.includes(x.key));
  if (!group) return undefined;
  const fileOf = (p: string) => index.files.find((f) => f.path === p);
  const about = filesAbout(index, group.key);
  const steps: FeatureStep[] = [];
  const visited = new Set<string>();
  const routeLabel = (r: RouteAt) => `${r.method} ${r.servicePath && !r.path ? r.servicePath : r.path}`;

  // The main path: the create route if the browser calls it, else any route the browser calls, else the first.
  const traced = group.routes.map((r) => ({ r, t: trace(index, g, { kind: "route", label: routeLabel(r), path: r.file, line: r.line, route: r }, { depth: 2 }) }));
  const rank = (x: (typeof traced)[number]) => (x.t.callers.length ? 2 : 0) + (x.r.method === "POST" ? 1 : 0) + (mentions(x.r.file, group.key) ? 0.5 : 0);
  const main = [...traced].sort((a, b) => rank(b) - rank(a))[0];
  const serviceOf = (x: (typeof traced)[number]) => {
    const all = nodes(x.t.flow).filter((n) => n.path !== x.r.file && fileOf(n.path)?.role === "source");
    return all.find((n) => mentions(n.path, group.key)) ?? all.find((n) => /servic|model|repo|store|db|dao|handler|action|controller|logic/i.test(n.path)) ?? all[0];
  };
  const table = group.tables[0];
  let service: CallNode | undefined;

  if (main) {
    const r = main.r;
    // Screen: the client call, and the screen that shows the component making it.
    const caller = [...main.t.callers].sort((a, b) => Number(mentions(b.path, group.key)) - Number(mentions(a.path, group.key)))[0];
    if (caller) {
      const cf = fileOf(caller.path);
      const comp = enclosing(cf, caller.line);
      const compName = comp?.parent && comp.kind === "method" ? comp.parent : comp?.name;
      // A component's own name is often only its file's default export; the file name says it as well.
      const shownAs = compName && /^[A-Z]/.test(compName) ? compName : basename(caller.path, extname(caller.path));
      for (const p of g.in.get(caller.path) ?? []) {
        const pf = fileOf(p);
        const site = pf?.callSites.find(([ref]) => ref === shownAs);
        if (pf && site && pf.role === "source") {
          steps.push({ layer: "screen", title: `${basename(p, extname(p))} shows ${shownAs}`, path: p, line: site[1], detail: `Where you find it in the app.`, code: await code(index, p, [site[1]]) });
          visited.add(p);
          break;
        }
      }
      steps.push({
        layer: "client",
        title: `${shownAs} sends ${routeLabel(r)}`,
        path: caller.path,
        line: caller.line,
        detail: comp ? `In ${comp.name}${comp.kind === "function" || comp.kind === "method" ? "()" : ""}.` : undefined,
        code: await code(index, caller.path, [caller.line], { lead: comp && caller.line - comp.line < 40 ? comp.line : undefined }),
      } as FeatureStep);
      visited.add(caller.path);
    }
    // Route: the handler, with its access checks and validation called out.
    const rf = fileOf(r.file);
    service = serviceOf(main);
    const range = (() => {
      const spans = (rf?.spans ?? []).filter(([a, b]) => a <= r.line && b >= r.line).sort((x, y) => x[1] - x[0] - (y[1] - y[0]))[0];
      return spans ? { from: spans[0], to: spans[1] } : { from: r.line, to: r.line + 25 };
    })();
    const sites = (rf?.callSites ?? []).filter(([, l]) => l >= range.from && l <= range.to);
    const access = sites.filter(([ref]) => ACCESS.test(ref.split(".").pop() ?? ""));
    const validate = sites.filter(([ref]) => VALIDATE.test(ref));
    const svcLine = service ? sites.find(([ref]) => ref.split(".").pop() === service!.name.split(".").pop())?.[1] : undefined;
    const notes = [access.length ? `checks who you are with ${[...new Set(access.map(([x]) => `\`${x.split(".").pop()}\``))].slice(0, 2).join(" and ")}` : "", validate.length ? "validates the input" : "", service ? `calls \`${service.name}\`` : ""].filter(Boolean);
    steps.push({
      layer: "route",
      title: `${short(r.file)} handles ${routeLabel(r)}`,
      path: r.file,
      line: r.line,
      detail: notes.length ? `It ${notes.join(", ").replace(/, ([^,]*)$/, " and $1")}.` : undefined,
      code: await code(index, r.file, [access[0]?.[1], validate[0]?.[1], svcLine].filter((x): x is number => Boolean(x)), { lead: r.line }),
    } as FeatureStep);
    visited.add(r.file);
  }

  // Service: the function doing the work. Without routes (a Moleculer service, a table only), its own code.
  const svcFile = service ? fileOf(service.path) : undefined;
  const svcSym = service ? svcFile?.symbols.find((s) => s.line === service!.line) : undefined;
  if (service && svcFile && svcSym) {
    const body = await readIndexed(index, svcFile);
    const uses = table && body ? body.map((l, i) => (i + 1 >= svcSym.line && i + 1 <= svcSym.endLine && new RegExp(`\\b${table.symbol}\\b`).test(l) ? i + 1 : 0)).filter(Boolean) : [];
    const throws = svcFile.throws.filter((t) => t.line >= svcSym.line && t.line <= svcSym.endLine).map((t) => t.line);
    steps.push({
      layer: "service",
      title: `${service.name} does the work`,
      path: service.path,
      line: service.line,
      detail: [svcSym.doc ? svcSym.doc.split(/(?<=\.)\s/)[0] : "", throws.length ? `Fails with an error in ${throws.length} case${throws.length === 1 ? "" : "s"}.` : ""].filter(Boolean).join(" ") || undefined,
      code: await code(index, service.path, [...uses.slice(0, 3), ...throws.slice(0, 2)], { lead: svcSym.line }),
    } as FeatureStep);
    visited.add(service.path);
  } else if (!main && group.services.length) {
    const s = group.services[0]!;
    const a = s.actions[0]!;
    steps.push({ layer: "service", title: `The ${s.name} service`, path: s.path, line: a.line, detail: `Actions: ${s.actions.map((x) => x.name).join(", ")}.`, code: await code(index, s.path, s.actions.slice(0, 5).map((x) => x.line)) });
    visited.add(s.path);
  }

  // Data: the table and its columns.
  if (table) {
    steps.push({ layer: "data", title: `Stored in the ${table.name} table`, path: table.path, line: table.line, detail: table.fields.length ? `Columns: ${table.fields.join(", ")}.` : undefined, code: await code(index, table.path, [table.line]) });
    visited.add(table.path);
  }

  // Every route, and where each one ends up.
  const actions = traced.map((x) => {
    const s = serviceOf(x);
    return { label: routeLabel(x.r), path: x.r.file, line: x.r.line, ...(s ? { does: { name: s.name, path: s.path, line: s.line } } : {}) };
  });
  for (const s of group.services) for (const a of s.actions) if (!actions.some((x) => x.does?.line === a.line && x.does.path === s.path)) actions.push({ label: `action ${s.name}.${a.name}`, path: s.path, line: a.line });

  // Other ways in: code that calls the same service function without going through the route.
  const otherWays: Feature["otherWays"] = [];
  if (service) {
    const fn = service.name.split(".").pop()!;
    for (const f of sourceFiles(index)) {
      if (f.path === service.path || f.path === main?.r.file) continue;
      if (!(g.out.get(f.path) ?? new Set()).has(service.path)) continue;
      const site = f.callSites.find(([ref]) => ref === fn || ref.endsWith(`.${fn}`));
      if (site) otherWays.push({ label: `${short(f.path)} calls ${fn}`, path: f.path, line: site[1] });
    }
  }

  // Tests: named after the feature, calling its service, or hitting its routes.
  const testFiles = index.files.filter((f) => f.role === "test");
  const fnNames = new Set(actions.flatMap((a) => (a.does ? [a.does.name.split(".").pop()!] : [])));
  const routeBits = [...new Set(group.routes.map((r) => segments(r.path).filter((s) => s !== "*").slice(-1)[0]).filter(Boolean))] as string[];
  const tests: string[] = [];
  for (const f of testFiles) {
    if (mentions(f.path, group.key) || f.calls.some((c) => fnNames.has(c.split(".").pop()!))) {
      tests.push(f.path);
      continue;
    }
    if (!routeBits.length) continue;
    const lines = await readIndexed(index, f);
    if (lines && routeBits.some((b) => lines.some((l) => l.includes(`/${b}`)))) tests.push(f.path);
  }

  // Where to change it, in the order you'd touch the layers.
  const change: Feature["change"] = [];
  const add = (path: string, why: string, line?: number) => {
    if (!change.some((c) => c.path === path)) change.push({ path, why, ...(line ? { line } : {}) });
  };
  if (table) {
    add(table.path, `the ${table.name} table's columns`, table.line);
    const migrations = index.files.filter((f) => f.role === "migration");
    if (migrations.length) add(migrations.map((m) => m.path).sort().at(-1)!.replace(/[^/]*$/, ""), "a new migration (generate it with your ORM)");
  }
  if (service) add(service.path, `${service.name} and its neighbours`, service.line);
  if (main) add(main.r.file, "the route: input checks and access", main.r.line);
  // The type the client code uses for it (`interface Comment`).
  const typeName = group.key.split(" ").map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  for (const f of sourceFiles(index)) {
    const t = f.symbols.find((s) => (s.kind === "interface" || s.kind === "type" || s.kind === "class") && s.name === typeName);
    if (t && f.path !== table?.path) add(f.path, `the ${typeName} type`, t.line);
  }
  for (const s of steps) if (s.layer === "client" || s.layer === "screen") add(s.path, s.layer === "client" ? "the screen's code" : "where the screen is shown", s.line);

  const featureFiles = new Set([...visited, ...change.map((c) => c.path), ...about.map((f) => f.path)]);
  const watchOut = risks
    .filter((r) => ["swallowed-error", "missing-route", "cycle", "duplicate", "untested", "todo", "env-undocumented", "long-function"].includes(r.kind) && r.locations.some((l) => featureFiles.has(l.path)))
    .slice(0, 5)
    .map((r) => ({ title: r.title, path: r.locations.find((l) => featureFiles.has(l.path))!.path, ...(r.locations[0]?.line ? { line: r.locations.find((l) => featureFiles.has(l.path))!.line } : {}) }));

  const client = steps.find((s) => s.layer === "client");
  const screen = steps.find((s) => s.layer === "screen");
  const summary = [
    client ? `${client.title.replace(/ sends .*/, "")}${screen ? ` (shown in ${basename(screen.path, extname(screen.path))})` : ""} sends \`${main ? routeLabel(main.r) : ""}\`.` : main ? `\`${routeLabel(main.r)}\` is the main entry point.` : "",
    main ? `${short(main.r.file)} handles it${service ? ` and calls \`${service.name}\` in ${short(service.path)}` : ""}${table ? `, which works with the \`${table.name}\` table` : ""}.` : "",
    !main && group.services.length ? `A Moleculer service with ${group.services[0]!.actions.length} actions.` : "",
    !main && !group.services.length && table ? `A \`${table.name}\` table (${table.orm}) with ${table.fields.length} columns.` : "",
    group.routes.length > 1 ? `${group.routes.length} routes in all.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: idOf(group.key),
    name: title(pickName(group)),
    kind: group.services.length ? "service" : "resource",
    routes: group.routes.length,
    tables: group.tables.map((t) => t.name),
    files: about.length,
    summary,
    steps,
    actions,
    otherWays: otherWays.slice(0, 8),
    change,
    tests: tests.slice(0, 8),
    watchOut,
    related: about.map((f) => f.path).filter((p) => !visited.has(p) && !change.some((c) => c.path === p)).slice(0, 12),
  };
}

// ---------- text, for the CLI and MCP

export function formatFeatures(list: FeatureSummary[]): string {
  if (!list.length) return "No features found: no database tables, API routes or services Spelunk recognises. Try overview and where instead.";
  return [`${list.length} features (from database tables, API routes and services). Use explain_feature with a name for its walkthrough.`, "", ...list.map((f) => `${f.name.padEnd(28)} ${[f.routes ? `${f.routes} route${f.routes === 1 ? "" : "s"}` : "", f.tables.length ? `table ${f.tables.join(", ")}` : "", f.files ? `${f.files} file${f.files === 1 ? "" : "s"}` : "", f.kind === "service" ? "service" : ""].filter(Boolean).join(" · ")}`)].join("\n");
}

export function formatFeature(f: Feature): string {
  const out = [`# How ${f.name.toLowerCase()} work${f.name.endsWith("s") ? "" : "s"}`, "", f.summary, ""];
  f.steps.forEach((s, i) => {
    out.push(`${i + 1}. [${s.layer}] ${s.title}  ${s.path}:${s.line}`);
    if (s.detail) out.push(`   ${s.detail}`);
    for (const c of s.code) out.push(`${c.gap ? "   …\n" : ""}   ${String(c.line).padStart(5)}${c.hl ? " >" : "  "} ${c.text}`);
    out.push("");
  });
  if (f.actions.length) out.push("Actions:", ...f.actions.map((a) => `  ${a.label}  ${a.path}:${a.line}${a.does ? ` → ${a.does.name} (${a.does.path}:${a.does.line})` : ""}`), "");
  if (f.otherWays.length) out.push("Other ways in:", ...f.otherWays.map((o) => `  ${o.label}  ${o.path}:${o.line}`), "");
  if (f.change.length) out.push("To change it:", ...f.change.map((c) => `  ${c.path}${c.line ? `:${c.line}` : ""}  ${c.why}`), "");
  if (f.tests.length) out.push("Tests:", ...f.tests.map((t) => `  ${t}`), "");
  if (f.watchOut.length) out.push("Watch out:", ...f.watchOut.map((w) => `  ${w.title}  ${w.path}${w.line ? `:${w.line}` : ""}`), "");
  if (f.related.length) out.push(`Also about ${f.name.toLowerCase()}: ${f.related.join(", ")}`);
  return out.join("\n").trim();
}
