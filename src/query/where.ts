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

interface Posting {
  doc: number;
  /** Field-weighted count of the term in the document. */
  tf: number;
  /** The heaviest field it appears in, for "why this matched". */
  label: string;
}

interface Corpus {
  docs: Doc[];
  avg: number;
  /** term → the documents containing it. Queries walk only these lists, never the whole corpus. */
  postings: Map<string, Posting[]>;
  vocab: string[];
}

// Built once per loaded index: on a 20k-file repo this is most of a query's cost.
const corpora = new WeakMap<Index, Corpus>();

function corpus(index: Index): Corpus {
  let c = corpora.get(index);
  if (c) return c;
  const docs = index.files.flatMap(docsFor);
  const postings = new Map<string, Posting[]>();
  docs.forEach((d, i) => {
    const tf = new Map<string, Posting>();
    for (const f of d.fields) {
      for (const t of f.terms) {
        const p = tf.get(t);
        if (p) p.tf += f.weight;
        else tf.set(t, { doc: i, tf: f.weight, label: f.label });
      }
    }
    for (const [t, p] of tf) {
      let list = postings.get(t);
      if (!list) postings.set(t, (list = []));
      list.push(p);
    }
  });
  c = { docs, avg: docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1) || 1, postings, vocab: [...postings.keys()] };
  corpora.set(index, c);
  return c;
}

export function where(index: Index, query: string, options: WhereOptions = {}): Hit[] {
  const limit = options.limit ?? 15;
  const { docs, avg, postings, vocab } = corpus(index);
  const q = tokens(query);
  if (!q.length || !docs.length) return [];
  // Each query term expands to its synonyms; a synonym counts a bit less than the word itself.
  const expanded = q.map((t) => ({ term: t, alts: [...new Set([t, ...(SYNONYMS[t] ?? []).map(stem)])] }));

  const N = docs.length;
  const df = (t: string) => postings.get(t)?.length ?? 0;
  const idf = (t: string) => Math.log(1 + (N - df(t) + 0.5) / (df(t) + 0.5));
  const k1 = 1.2;
  const b = 0.75;
  const exact = query.trim().toLowerCase();

  const total = new Map<number, { score: number; matched: number; why: Set<string> }>();
  for (const { term, alts } of expanded) {
    const best = new Map<number, { s: number; why: string }>();
    for (const alt of alts) {
      // Words of four letters or more also match longer words they start: "auth" finds "authenticate".
      const terms = alt.length > 3 ? vocab.filter((v) => v.startsWith(alt)) : postings.has(alt) ? [alt] : [];
      const tfs = new Map<number, { tf: number; label: string }>();
      for (const t of terms) {
        for (const p of postings.get(t)!) {
          const cur = tfs.get(p.doc);
          if (cur) cur.tf += p.tf;
          else tfs.set(p.doc, { tf: p.tf, label: p.label });
        }
      }
      const w = idf(alt) * (alt === term ? 1 : 0.6);
      for (const [doc, { tf, label }] of tfs) {
        const s = (w * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docs[doc]!.length) / avg));
        const cur = best.get(doc);
        if (!cur || s > cur.s) best.set(doc, { s, why: `${label}: ${alt}` });
      }
    }
    for (const [doc, { s, why }] of best) {
      const t = total.get(doc) ?? { score: 0, matched: 0, why: new Set<string>() };
      t.score += s;
      t.matched++;
      t.why.add(why);
      total.set(doc, t);
    }
  }

  const scored: Hit[] = [];
  for (const [doc, t] of total) {
    const d = docs[doc]!;
    if (options.kinds && !options.kinds.includes(d.hit.kind)) continue;
    // Prefer documents that match every part of the question.
    let score = t.score * d.prior * (0.5 + (0.5 * t.matched) / expanded.length);
    if (d.hit.name && d.hit.name.toLowerCase() === exact) score *= 3;
    scored.push({ ...d.hit, score: Math.round(score * 100) / 100, why: [...t.why].slice(0, 3).join(", ") });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
