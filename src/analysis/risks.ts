import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { CODE_LANGUAGES } from "../lang/languages.js";
import type { FileFacts, Index } from "../types.js";
import { cycles, type Graph } from "./graph.js";
import { allRoutes, routesFor } from "./routes.js";

export type RiskKind =
  | "missing-route"
  | "swallowed-error"
  | "cycle"
  | "duplicate"
  | "hotspot"
  | "large-file"
  | "long-function"
  | "untested"
  | "orphan"
  | "env-undocumented"
  | "env-unused"
  | "todo"
  | "parse-error";

export interface Risk {
  kind: RiskKind;
  severity: "high" | "medium" | "low";
  title: string;
  /** Why it matters and what to do, in a sentence or two. */
  detail: string;
  locations: { path: string; line?: number; endLine?: number }[];
}

/** One-line explanations of each kind, shown once per group in reports. */
export const RISK_INFO: Record<RiskKind, string> = {
  "missing-route": "The client calls an endpoint no server route matches. Often a typo, a renamed route, or a route that was never written.",
  "swallowed-error": "An empty catch or `except: pass`. Failures here leave no trace, which makes bugs very hard to find.",
  cycle: "Files that import each other in a loop. Changes ripple both ways and load order can break.",
  duplicate: "The same block of code in several places. A fix in one copy is easy to miss in the others.",
  hotspot: "Big files that change often. Most bugs live here; read these first.",
  "large-file": "Files long enough that they likely do several jobs.",
  "long-function": "Functions long enough to be hard to test and reason about.",
  untested: "Modules with source code and no test that imports them.",
  orphan: "Source files nothing imports and that aren't entry points. Possibly dead code.",
  "env-undocumented": "Environment variables the code reads that the .env example doesn't list. New setups will miss them.",
  "env-unused": "Variables in the .env example the code never reads.",
  todo: "TODO, FIXME and HACK comments.",
  "parse-error": "Files the parser couldn't fully read, so facts about them may be incomplete.",
};

const RESOLVES_IMPORTS = new Set(["typescript", "tsx", "javascript", "python", "go", "rust", "java", "kotlin", "scala", "ruby"]);
const isSource = (f: FileFacts) => f.role === "source" && CODE_LANGUAGES.has(f.language);

export interface RiskOptions {
  /** Read file text, for duplicate detection. Defaults to reading from the index root. */
  read?(path: string): Promise<string | undefined>;
}

export async function findRisks(index: Index, g: Graph, options: RiskOptions = {}): Promise<Risk[]> {
  const risks: Risk[] = [];
  const read = options.read ?? ((p: string) => readFile(join(index.root, p), "utf8").catch(() => undefined));
  const source = index.files.filter(isSource);

  // Client calls with no server route
  const server = allRoutes(index, "server");
  if (server.length) {
    for (const f of index.files) {
      for (const r of f.routes.filter((r) => r.side === "client")) {
        if (routesFor(server, r.method, r.path).length === 0) {
          // Tests often call missing routes on purpose (404 checks), so those rank low.
          risks.push({ kind: "missing-route", severity: f.role === "source" ? "high" : "low", title: `${r.method} ${r.path} has no matching route`, detail: RISK_INFO["missing-route"], locations: [{ path: f.path, line: r.line }] });
        }
      }
    }
  }

  for (const f of index.files) {
    for (const s of f.swallowed) {
      risks.push({ kind: "swallowed-error", severity: f.role === "source" ? "medium" : "low", title: `Error swallowed in ${posix.basename(f.path)}`, detail: RISK_INFO["swallowed-error"], locations: [{ path: f.path, line: s.line }] });
    }
  }

  for (const c of cycles(g, (p) => isSource(g.files.get(p)!))) {
    risks.push({ kind: "cycle", severity: c.length > 3 ? "medium" : "low", title: `Import cycle across ${c.length} files`, detail: RISK_INFO.cycle, locations: c.map((path) => ({ path })) });
  }

  risks.push(...(await duplicates(source, read)));

  // Hotspots: churn × size, top ten
  const scored = source
    .map((f) => ({ f, score: (index.churn[f.path] ?? 0) * Math.log2(Math.max(2, f.lines)) }))
    .filter((x) => (index.churn[x.f.path] ?? 0) >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  for (const { f } of scored) {
    risks.push({ kind: "hotspot", severity: "medium", title: `${f.path} changed ${index.churn[f.path]} times this year (${f.lines} lines)`, detail: RISK_INFO.hotspot, locations: [{ path: f.path }] });
  }

  for (const f of source) {
    if (f.lines > 800) risks.push({ kind: "large-file", severity: f.lines > 1500 ? "medium" : "low", title: `${f.path} is ${f.lines} lines`, detail: RISK_INFO["large-file"], locations: [{ path: f.path }] });
    for (const s of f.symbols) {
      const len = s.endLine - s.line + 1;
      if ((s.kind === "function" || s.kind === "method") && len > 100) {
        risks.push({ kind: "long-function", severity: len > 250 ? "medium" : "low", title: `${s.parent ? `${s.parent}.` : ""}${s.name} is ${len} lines`, detail: RISK_INFO["long-function"], locations: [{ path: f.path, line: s.line, endLine: s.endLine }] });
      }
    }
  }

  // Untested modules: only meaningful when the repo has tests at all.
  const tests = index.files.filter((f) => f.role === "test");
  if (tests.length) {
    const tested = new Set<string>();
    for (const t of tests) {
      const stack = [...(g.out.get(t.path) ?? [])];
      // Count what tests reach within two hops: test → helper → code.
      for (let depth = 0; depth < 2 && stack.length; depth++) {
        for (const p of stack.splice(0)) {
          if (tested.has(p)) continue;
          tested.add(p);
          stack.push(...(g.out.get(p) ?? []));
        }
      }
    }
    const testedNames = new Set(tests.map((t) => posix.basename(t.path).replace(/^test_|[._-](test|spec)(?=\.)|_test(?=\.)|Tests?(?=\.)/g, "").replace(/\.[^.]+$/, "")));
    const byDir = new Map<string, FileFacts[]>();
    for (const f of source) byDir.set(posix.dirname(f.path), [...(byDir.get(posix.dirname(f.path)) ?? []), f]);
    for (const [dir, files] of byDir) {
      const covered = files.some((f) => tested.has(f.path) || testedNames.has(posix.basename(f.path).replace(/\.[^.]+$/, "")));
      const lines = files.reduce((n, f) => n + f.lines, 0);
      if (!covered && lines >= 150) {
        risks.push({ kind: "untested", severity: lines > 1000 ? "medium" : "low", title: `${dir === "." ? "(root)" : dir}: ${files.length} files, ${lines} lines, no tests`, detail: RISK_INFO.untested, locations: files.map((f) => ({ path: f.path })) });
      }
    }
  }

  // Orphans, only for languages whose imports we resolve. Files a script or Dockerfile runs aren't orphans.
  const commandText = index.manifests.flatMap((m) => m.commands.map((c) => c.command)).join("\n");
  for (const f of source) {
    if (commandText.includes(posix.basename(f.path).replace(/\.[^.]+$/, ""))) continue;
    if (!RESOLVES_IMPORTS.has(f.language) || f.entry || f.routes.some((r) => r.side === "server")) continue;
    if ((g.in.get(f.path)?.size ?? 0) > 0) continue;
    const base = posix.basename(f.path);
    if (/^(index|main|mod|lib|__init__|__main__|app|server|cli|manage|setup|conftest|wsgi|asgi)\.\w+$/.test(base) || /\.(config|d)\.\w+$/.test(base)) continue;
    if (/(^|\/)(scripts?|bin|tools|migrations?|seeds?)\//.test(f.path)) continue;
    risks.push({ kind: "orphan", severity: "low", title: `Nothing imports ${f.path}`, detail: RISK_INFO.orphan, locations: [{ path: f.path }] });
  }

  // Environment variables vs the .env example
  const documented = new Set(index.manifests.flatMap((m) => m.env ?? []));
  if (documented.size) {
    const read = new Map<string, { path: string; line: number }>();
    for (const f of index.files.filter((f) => f.role !== "test")) for (const e of f.env) if (!read.has(e.text)) read.set(e.text, { path: f.path, line: e.line });
    const common = /^(NODE_ENV|PORT|HOME|PATH|CI|DEBUG|TZ|LANG|PWD|USER|SHELL|TERM|HOSTNAME|PYTHONPATH|VERCEL|NETLIFY)$/;
    for (const [name, at] of read) {
      if (!documented.has(name) && !common.test(name)) risks.push({ kind: "env-undocumented", severity: "low", title: `${name} isn't in the .env example`, detail: RISK_INFO["env-undocumented"], locations: [at] });
    }
    for (const name of documented) {
      if (!read.has(name)) {
        const m = index.manifests.find((m) => m.env?.includes(name))!;
        risks.push({ kind: "env-unused", severity: "low", title: `${name} is documented but never read`, detail: RISK_INFO["env-unused"], locations: [{ path: m.path }] });
      }
    }
  }

  for (const f of index.files.filter((f) => f.notes.length && f.role !== "generated")) {
    for (const n of f.notes) {
      risks.push({ kind: "todo", severity: /FIXME|HACK|XXX/.test(n.text) ? "low" : "low", title: n.text, detail: RISK_INFO.todo, locations: [{ path: f.path, line: n.line }] });
    }
  }
  for (const f of index.files.filter((f) => (f.parseErrors ?? 0) > 3)) {
    risks.push({ kind: "parse-error", severity: "low", title: `${f.path}: ${f.parseErrors} parse errors`, detail: RISK_INFO["parse-error"], locations: [{ path: f.path }] });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.severity] - order[b.severity]);
}

const WINDOW = 6;

/** 32-bit FNV-1a, as base 36. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
const MIN_CHARS = 160;

/** Normalised lines: no indentation, comments, blank or brace-only lines. */
function normalise(text: string): { text: string; line: number }[] {
  return text
    .split("\n")
    .map((t, i) => ({ text: t.trim().replace(/\s+/g, " "), line: i + 1 }))
    .filter((l) => l.text.length > 2 && !/^(\/\/|#|\*|\/\*|--)/.test(l.text) && !/^[{}()[\];,]+$/.test(l.text) && !/^(import|from|use|using|package|require|#include)\b/.test(l.text));
}

async function duplicates(files: FileFacts[], read: (p: string) => Promise<string | undefined>): Promise<Risk[]> {
  const seen = new Map<string, { path: string; line: number; end: number }[]>();
  // Reads run 64 at a time (a big repo is mostly waiting on disk); hashing stays in file order.
  const texts: (string | undefined)[] = new Array(files.length);
  for (let i = 0; i < files.length; i += 64) {
    const batch = await Promise.all(files.slice(i, i + 64).map((f) => read(f.path)));
    batch.forEach((t, j) => (texts[i + j] = t));
  }
  for (const [n, f] of files.entries()) {
    const text = texts[n];
    texts[n] = undefined;
    if (!text) continue;
    const lines = normalise(text);
    // Each line is hashed once; a window's key is its six line hashes, so no window text is rebuilt.
    const hashes = lines.map((l) => fnv(l.text));
    for (let i = 0; i + WINDOW <= lines.length; i++) {
      let chars = WINDOW - 1;
      for (let k = i; k < i + WINDOW; k++) chars += lines[k]!.text.length;
      if (chars < MIN_CHARS) continue;
      const h = hashes.slice(i, i + WINDOW).join(",");
      const loc = { path: f.path, line: lines[i]!.line, end: lines[i + WINDOW - 1]!.line };
      const list = seen.get(h);
      if (list) list.push(loc);
      else seen.set(h, [loc]);
    }
  }
  // Merge overlapping windows per pair of files into blocks.
  type Loc = { path: string; line: number; end: number };
  const pairs = new Map<string, { a: Loc; b: Loc }[]>();
  for (const locs of seen.values()) {
    const [a, b] = locs;
    if (!a || !b || (a.path === b.path && Math.abs(a.line - b.line) < WINDOW)) continue;
    const key = `${a.path}\0${b.path}`;
    const list = pairs.get(key) ?? [];
    const last = list[list.length - 1];
    if (last && a.line <= last.a.end + 2 && a.line >= last.a.line) {
      last.a.end = Math.max(last.a.end, a.end);
      last.b.end = Math.max(last.b.end, b.end);
    } else list.push({ a: { ...a }, b: { ...b } });
    pairs.set(key, list);
  }
  const blocks = [...pairs.values()].flat();
  return blocks
    .sort((x, y) => y.a.end - y.a.line - (x.a.end - x.a.line))
    .slice(0, 25)
    .map((d) => ({
      kind: "duplicate" as const,
      severity: d.a.end - d.a.line > 30 ? ("medium" as const) : ("low" as const),
      title: `${d.a.end - d.a.line + 1} lines repeated in ${posix.basename(d.a.path)} and ${posix.basename(d.b.path)}`,
      detail: RISK_INFO.duplicate,
      locations: [
        { path: d.a.path, line: d.a.line, endLine: d.a.end },
        { path: d.b.path, line: d.b.line, endLine: d.b.end },
      ],
    }));
}
