import { posix } from "node:path";
import type { Graph } from "../analysis/graph.js";
import type { Risk } from "../analysis/risks.js";
import type { FileFacts, Index, SymbolInfo } from "../types.js";

/**
 * Error lookup: paste a stack trace or a log line and get back the code that
 * raised it. Stack frames are mapped to files in the index (even when the
 * trace has absolute paths or points at compiled output); the message is
 * matched against every throw and log statement Spelunk recorded.
 */

export interface Frame {
  raw: string;
  path?: string;
  line?: number;
  fn?: string;
  /** The repo file this frame maps to, when it's ours (not node_modules, site-packages, the runtime). */
  file?: string;
  symbol?: SymbolInfo;
}

export interface Origin {
  path: string;
  line: number;
  text: string;
  kind: "throw" | "log";
  /** 0–1: share of the message's distinctive words found in this statement. */
  score: number;
  symbol?: SymbolInfo;
}

export interface ErrorLookup {
  message?: string;
  frames: Frame[];
  /** Where the message is thrown or logged, best first. */
  origins: Origin[];
  /** The repo frame nearest the top of the stack: usually where to start reading. */
  start?: { path: string; line?: number; symbol?: SymbolInfo; why: string };
  /** Files that import the start file, i.e. callers worth checking. */
  callers: string[];
  risks: Risk[];
}

const FRAME_PATTERNS: { re: RegExp; read(m: RegExpMatchArray): Omit<Frame, "raw"> }[] = [
  // JS/TS: "at fn (path:line:col)" or "at path:line:col"
  { re: /^\s*at (?:async )?(?:(.+?) \()?((?:file:\/\/)?[^\s()]+?):(\d+)(?::\d+)?\)?\s*$/, read: (m) => ({ ...(m[1] ? { fn: m[1] } : {}), path: m[2]!.replace(/^file:\/\//, ""), line: Number(m[3]) }) },
  // Python: File "path", line N, in fn
  { re: /^\s*File "([^"]+)", line (\d+)(?:, in (.+))?/, read: (m) => ({ path: m[1]!, line: Number(m[2]), ...(m[3] ? { fn: m[3].trim() } : {}) }) },
  // Java/Kotlin/Scala: at pkg.Class.method(File.java:N)
  { re: /^\s*at ([\w$.<>]+)\.([\w$<>]+)\(([\w$]+\.(?:java|kt|scala|groovy)):(\d+)\)/, read: (m) => ({ fn: `${m[1]!.split(".").pop()}.${m[2]}`, path: `${m[1]!.split(".").slice(0, -1).join("/")}/${m[3]}`, line: Number(m[4]) }) },
  // C#: at Ns.Class.Method() in /path/File.cs:line N
  { re: /^\s*at (.+?)\(.*\) in (.+\.cs):line (\d+)/, read: (m) => ({ fn: m[1]!.split(".").slice(-2).join("."), path: m[2]!, line: Number(m[3]) }) },
  // Go: "\t/path/file.go:42 +0x1d"
  { re: /^\s*((?:\/|[A-Za-z]:\\|\.\/)?[^\s:]+\.go):(\d+)(?: \+0x[0-9a-f]+)?\s*$/, read: (m) => ({ path: m[1]!, line: Number(m[2]) }) },
  // Rust (backtrace "at src/x.rs:12:5"), Ruby ("path:12:in `m'"), generic "path.ext:line"
  { re: /^\s*(?:at )?((?:[\w.\/\\-]+\/)?[\w.-]+\.(?:rs|rb|php|ex|exs|swift|dart|py|[cm]?[jt]sx?|go|java|kt|cs|c|cc|cpp|h|hpp|lua|zig|sh)):(\d+)(?::\d+)?(?::in [`'](.+?)')?/, read: (m) => ({ path: m[1]!, line: Number(m[2]), ...(m[3] ? { fn: m[3] } : {}) }) },
  // PHP: "#0 /path/file.php(12): fn()"
  { re: /^#\d+ (.+\.php)\((\d+)\): (.+)$/, read: (m) => ({ path: m[1]!, line: Number(m[2]), fn: m[3]!.replace(/\(.*$/, "") }) },
];

const THIRD_PARTY = /(^|\/)(node_modules|site-packages|dist-packages|vendor|\.cargo|go\/pkg\/mod|gems|internal\/(process|modules)|node:internal)\/|^node:|<anonymous>|^internal\//;

/** Maps a path from a stack trace (absolute, from a container, compiled) to a file in the index. */
export function mapPath(index: Index, raw: string): FileFacts | undefined {
  if (THIRD_PARTY.test(raw)) return undefined;
  const p = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  const candidates = [p, p.replace(/(^|\/)(dist|build|out|lib)\//, "$1src/").replace(/\.[cm]?js$/, ".ts"), p.replace(/(^|\/)(dist|build|out|lib)\//, "$1src/").replace(/\.[cm]?js$/, ".tsx")];
  for (const c of candidates) {
    const exact = index.files.find((f) => f.path === c);
    if (exact) return exact;
  }
  // Longest suffix match: /app/apps/server/src/x.ts → apps/server/src/x.ts
  let best: FileFacts | undefined;
  let bestLen = 0;
  for (const c of candidates) {
    const segs = c.split("/");
    for (const f of index.files) {
      const fs = f.path.split("/");
      let n = 0;
      while (n < fs.length && n < segs.length && fs[fs.length - 1 - n] === segs[segs.length - 1 - n]) n++;
      if (n > bestLen && n === fs.length) {
        best = f;
        bestLen = n;
      } else if (n > bestLen && n >= 2) {
        best = f;
        bestLen = n;
      }
    }
  }
  return best;
}

const enclosing = (f: FileFacts, line: number) =>
  f.symbols.filter((s) => s.line <= line && s.endLine >= line && (s.kind === "function" || s.kind === "method")).sort((a, b) => b.line - a.line)[0];

/** The error's message: the line naming an error type, or the first non-frame line. */
function messageOf(lines: string[]): string | undefined {
  const typed = lines.find((l) => /\b\w*(Error|Exception|panic|Traceback|FATAL|ERROR)\b/.test(l) && !FRAME_PATTERNS.some((p) => p.re.test(l)) && !/^Traceback/.test(l.trim()));
  const first = lines.find((l) => l.trim() && !FRAME_PATTERNS.some((p) => p.re.test(l)) && !/^Traceback/.test(l.trim()));
  return (typed ?? first)?.trim().replace(/^(Uncaught |Unhandled( promise)? rejection:?\s*)/i, "");
}

/** Distinctive words of a message: the literal text a throw statement would contain. */
function messageWords(message: string): string[] {
  return message
    .replace(/^[\w.$]*(Error|Exception)\b[:\s]*/, "")
    .replace(/^(panic|fatal|error|warn(ing)?)[:\s]+/i, "")
    .replace(/\b[0-9a-f]{8,}\b|\b\d+(\.\d+)*\b|https?:\/\/\S+|'[^']*'|"[^"]*"|`[^`]*`/g, " ") // ids, numbers, urls, quoted values vary per run
    .toLowerCase()
    .split(/[^a-z_]+/)
    .filter((w) => w.length >= 3 && !["the", "and", "for", "not", "with", "this", "that", "was", "has", "are", "you", "from", "error"].includes(w));
}

export function lookupError(index: Index, g: Graph, text: string, risks: Risk[] = []): ErrorLookup {
  const lines = text.split(/\r?\n/).slice(0, 400);
  const frames: Frame[] = [];
  for (const raw of lines) {
    for (const p of FRAME_PATTERNS) {
      const m = raw.match(p.re);
      if (!m) continue;
      const fr: Frame = { raw: raw.trim(), ...p.read(m) };
      const f = fr.path ? mapPath(index, fr.path) : undefined;
      if (f) {
        fr.file = f.path;
        const sym = fr.line ? enclosing(f, fr.line) : undefined;
        if (sym) fr.symbol = sym;
      }
      frames.push(fr);
      break;
    }
  }
  // Python prints the innermost frame last; everything else prints it first.
  const innermostFirst = !/^Traceback/m.test(text);
  const ordered = innermostFirst ? frames : [...frames].reverse();

  const message = messageOf(lines);
  const words = message ? messageWords(message) : [];
  const origins: Origin[] = [];
  if (words.length) {
    for (const f of index.files) {
      for (const [kind, list] of [["throw", f.throws], ["log", f.logs]] as const) {
        for (const s of list) {
          const t = s.text.toLowerCase();
          const hits = words.filter((w) => t.includes(w)).length;
          const score = hits / words.length;
          if (hits >= Math.min(2, words.length) && score >= 0.5) {
            const sym = enclosing(f, s.line);
            origins.push({ path: f.path, line: s.line, text: s.text, kind, score, ...(sym ? { symbol: sym } : {}) });
          }
        }
      }
    }
    origins.sort((a, b) => b.score - a.score || Number(a.kind === "log") - Number(b.kind === "log") || Number(g.files.get(a.path)?.role !== "source") - Number(g.files.get(b.path)?.role !== "source"));
  }

  const ours = ordered.find((f) => f.file);
  const top = origins[0];
  const start = ours?.file
    ? { path: ours.file, ...(ours.line ? { line: ours.line } : {}), ...(ours.symbol ? { symbol: ours.symbol } : {}), why: "The first frame in the stack that is this repository's code." }
    : top
      ? { path: top.path, line: top.line, ...(top.symbol ? { symbol: top.symbol } : {}), why: `The ${top.kind === "throw" ? "statement that raises" : "log line that prints"} this message.` }
      : undefined;

  const files = new Set([...ordered.flatMap((f) => (f.file ? [f.file] : [])), ...origins.slice(0, 3).map((o) => o.path)]);
  return {
    ...(message ? { message } : {}),
    frames: ordered,
    origins: origins.slice(0, 10),
    ...(start ? { start } : {}),
    callers: start ? [...(g.in.get(start.path) ?? [])].sort().slice(0, 20) : [],
    risks: risks.filter((r) => r.locations.some((l) => files.has(l.path))).slice(0, 10),
  };
}

/** Plain text for the CLI and MCP. */
export function formatErrorLookup(e: ErrorLookup): string {
  const loc = (p: string, l?: number) => (l ? `${p}:${l}` : p);
  const out: string[] = [];
  if (e.message) out.push(/^[\w.$]*(Error|Exception)\b/.test(e.message) ? e.message : `Error: ${e.message}`);
  if (e.start) out.push("", `Start here: ${loc(e.start.path, e.start.line)}${e.start.symbol ? ` in ${e.start.symbol.name}()` : ""}`, `  ${e.start.why}`);
  else out.push("", "Couldn't match this to code in the repository. Paste more of the stack trace, or search for words from the message with `spelunk where`.");
  if (e.origins.length) out.push("", "Where this message comes from:", ...e.origins.map((o) => `  ${loc(o.path, o.line).padEnd(46)} ${o.kind}  ${o.text}`));
  const ours = e.frames.filter((f) => f.file);
  if (ours.length) out.push("", "Stack frames in this repository (innermost first):", ...ours.map((f) => `  ${loc(f.file!, f.line).padEnd(46)} ${f.symbol?.name ?? f.fn ?? ""}`));
  const skipped = e.frames.length - ours.length;
  if (skipped) out.push(`  (${skipped} frame${skipped === 1 ? "" : "s"} in libraries or the runtime not shown)`);
  if (e.callers.length) out.push("", `Called from (files importing ${posix.basename(e.start!.path)}):`, ...e.callers.map((c) => `  ${c}`));
  if (e.risks.length) out.push("", "Risks in these files:", ...e.risks.map((r) => `  [${r.severity}] ${r.title}  ${r.locations.map((l) => loc(l.path, l.line)).slice(0, 2).join(", ")}`));
  return out.join("\n").trim();
}
