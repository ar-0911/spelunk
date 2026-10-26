import type { FileFacts, Index } from "../types.js";

/**
 * "Where is X?" over the index: BM25 across files, symbols, routes and
 * environment variables, with names weighted above comments and a small
 * synonym table so "auth" also finds login, session and token code.
 */

export interface Hit {
  kind: "file" | "symbol" | "route" | "env";
  path: string;
  line?: number;
  /** Symbol name, route ("POST /x") or variable. */
  name?: string;
  /** One line on what matched. */
  why: string;
  score: number;
}

const STOP = new Set("a an and are as at be by do does for from how i in is it of on or the this to what when where which who why with handled handle handles code logic file files live lives done happen happens defined define implemented".split(" "));

const SYNONYMS: Record<string, string[]> = {
  auth: ["auth", "login", "logout", "signin", "session", "token", "jwt", "oauth", "password", "credential", "bearer", "cookie", "permission", "role"],
  login: ["login", "signin", "auth", "session", "password"],
  db: ["db", "database", "sql", "query", "schema", "migration", "orm", "model", "table", "postgres", "sqlite", "mongo", "prisma", "drizzle", "repository"],
  database: ["database", "db", "sql", "schema", "migration", "orm", "model", "table"],
  config: ["config", "configuration", "env", "setting", "option"],
  error: ["error", "exception", "throw", "raise", "fail", "catch", "panic"],
  log: ["log", "logger", "logging", "console", "trace"],
  test: ["test", "spec", "fixture", "mock"],
  route: ["route", "router", "endpoint", "handler", "api", "controller", "view"],
  api: ["api", "route", "endpoint", "handler", "controller"],
  payment: ["payment", "billing", "stripe", "invoice", "checkout", "charge", "subscription"],
  email: ["email", "mail", "smtp", "sendgrid", "notification"],
  upload: ["upload", "file", "blob", "storage", "s3", "bucket"],
  cache: ["cache", "redis", "memo", "ttl"],
  queue: ["queue", "job", "worker", "task", "background", "cron", "schedule"],
  ui: ["ui", "component", "view", "page", "render", "template"],
  save: ["save", "store", "persist", "write", "update", "create"],
  delete: ["delete", "remove", "destroy", "drop"],
  user: ["user", "account", "member", "profile"],
  search: ["search", "query", "index", "find"],
  start: ["start", "main", "entry", "bootstrap", "init", "listen", "serve"],
};

export function tokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith("es") && /(ss|x|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  if (t.length > 5 && t.endsWith("ed")) return t.slice(0, -2);
  return t;
}

interface Doc {
  hit: Omit<Hit, "score" | "why">;
  /** Weighted fields: name matters more than prose. */
  fields: { weight: number; terms: string[]; label: string }[];
  length: number;
  /** Boost for source over tests and docs. */
  prior: number;
}

const ROLE_PRIOR: Record<string, number> = { source: 1, config: 0.7, migration: 0.6, build: 0.6, test: 0.5, docs: 0.5, fixture: 0.3, generated: 0.2 };

function docsFor(f: FileFacts): Doc[] {
  const prior = ROLE_PRIOR[f.role] ?? 0.5;
  const pathTerms = tokens(f.path.replace(/\.[^.]+$/, ""));
  const docs: Doc[] = [];
  const fileFields = [
    { weight: 3, terms: pathTerms, label: "path" },
    { weight: 2, terms: tokens(f.doc ?? ""), label: "file comment" },
    { weight: 1, terms: f.symbols.flatMap((s) => tokens(s.name)), label: "symbols" },
    { weight: 1.5, terms: f.routes.filter((r) => r.side === "server").flatMap((r) => tokens(r.path)), label: "routes" },
  ];
  docs.push({ hit: { kind: "file", path: f.path }, fields: fileFields, length: fileFields.reduce((n, x) => n + x.terms.length, 0), prior });
  for (const s of f.symbols) {
    const fields = [
      { weight: 3, terms: tokens(s.name), label: "name" },
      { weight: 1.5, terms: tokens(s.doc ?? ""), label: "doc comment" },
      { weight: 1, terms: tokens(s.parent ?? ""), label: "class" },
      { weight: 0.75, terms: pathTerms, label: "path" },
    ];
    docs.push({ hit: { kind: "symbol", path: f.path, line: s.line, name: s.parent ? `${s.parent}.${s.name}` : s.name }, fields, length: fields.reduce((n, x) => n + x.terms.length, 0), prior: prior * (s.exported ? 1 : 0.85) });
  }
  for (const r of f.routes.filter((r) => r.side === "server")) {
    const fields = [
      { weight: 3, terms: tokens(r.path), label: "route" },
      { weight: 1, terms: [r.method.toLowerCase(), ...(r.handler ? tokens(r.handler) : [])], label: "method" },
      { weight: 0.75, terms: pathTerms, label: "path" },
    ];
    docs.push({ hit: { kind: "route", path: f.path, line: r.line, name: `${r.method} ${r.path}` }, fields, length: fields.reduce((n, x) => n + x.terms.length, 0), prior });
  }
  for (const e of f.env) {
    const fields = [{ weight: 3, terms: tokens(e.text), label: "variable" }];
    docs.push({ hit: { kind: "env", path: f.path, line: e.line, name: e.text }, fields, length: fields[0]!.terms.length, prior: prior * 0.9 });
  }
  return docs;
}

export interface WhereOptions {
  limit?: number;
  kinds?: Hit["kind"][];
}

export function where(index: Index, query: string, options: WhereOptions = {}): Hit[] {
  const limit = options.limit ?? 15;
  const docs = index.files.flatMap(docsFor).filter((d) => !options.kinds || options.kinds.includes(d.hit.kind));
  const q = tokens(query);
  if (!q.length || !docs.length) return [];
  // Each query term expands to its synonyms; a synonym counts a bit less than the word itself.
  const expanded = q.map((t) => ({ term: t, alts: [...new Set([t, ...(SYNONYMS[t] ?? []).map(stem)])] }));

  const N = docs.length;
  const avg = docs.reduce((n, d) => n + d.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set(d.fields.flatMap((f) => f.terms));
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  const k1 = 1.2;
  const b = 0.75;
  const exact = query.trim();

  const scored: Hit[] = [];
  for (const d of docs) {
    let score = 0;
    let matchedTerms = 0;
    const why = new Set<string>();
    for (const { term, alts } of expanded) {
      let best = 0;
      for (const alt of alts) {
        let tf = 0;
        let label = "";
        for (const f of d.fields) {
          const c = f.terms.filter((x) => x === alt || (alt.length > 3 && x.startsWith(alt))).length;
          if (c) {
            tf += c * f.weight;
            label ||= f.label;
          }
        }
        if (!tf) continue;
        const s = (idf(alt) * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avg)) * (alt === term ? 1 : 0.6);
        if (s > best) {
          best = s;
          why.add(`${label}: ${alt}`);
        }
      }
      if (best) matchedTerms++;
      score += best;
    }
    if (!score) continue;
    // Prefer documents that match every part of the question.
    score *= d.prior * (0.5 + (0.5 * matchedTerms) / expanded.length);
    if (d.hit.name && d.hit.name.toLowerCase() === exact.toLowerCase()) score *= 3;
    scored.push({ ...d.hit, score: Math.round(score * 100) / 100, why: [...why].slice(0, 3).join(", ") });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
