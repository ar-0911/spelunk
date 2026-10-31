import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { FileFacts, Index, SymbolInfo } from "../types.js";

/**
 * Code on request, so an agent reads the 30 lines it needs instead of the
 * 600-line file around them. Only files in the index can be read, and only
 * when their real path is still inside the repository.
 */

/** Longest stretch returned for a symbol or a range. Longer ones are cut with a note saying how to see the rest. */
const MAX_LINES = 250;
/** Files bigger than this aren't searched or shown. */
const MAX_BYTES = 2_000_000;

async function readIndexed(index: Index, f: FileFacts): Promise<string[] | undefined> {
  if (f.bytes > MAX_BYTES) return undefined;
  const root = await realpath(index.root).catch(() => index.root);
  const real = await realpath(join(index.root, f.path)).catch(() => undefined);
  if (!real || !real.startsWith(root.endsWith(sep) ? root : root + sep)) return undefined;
  const lines = (await readFile(real, "utf8")).split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop(); // the file's final newline isn't a line
  return lines;
}

function numbered(lines: string[], from: number, to: number): string {
  const width = String(to).length;
  return lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(width)}  ${l}`)
    .join("\n");
}

function fileByPath(index: Index, path: string): FileFacts | undefined {
  const p = path.replace(/^\.\//, "");
  return index.files.find((f) => f.path === p) ?? index.files.find((f) => f.path.endsWith(`/${p}`));
}

/** `src/a.ts`, `src/a.ts:40`, `src/a.ts:40-80` or `src/a.ts#L40-L80`. */
function parseRange(target: string): { path: string; start?: number; end?: number } {
  const m = target.match(/^(.*?)(?::|#L)(\d+)(?:-L?(\d+))?$/);
  if (!m) return { path: target };
  const start = Number(m[2]);
  return { path: m[1]!, start, end: m[3] ? Number(m[3]) : start + 40 };
}

export async function showSource(index: Index, target: string, options: { path?: string } = {}): Promise<string> {
  const t = target.trim();
  const range = parseRange(t);
  const file = fileByPath(index, range.path);
  if (file) {
    const lines = await readIndexed(index, file);
    if (!lines) return `${file.path} is too big to show (${file.bytes.toLocaleString("en")} bytes). Use file for its symbols, then source with a name.`;
    const start = Math.max(1, range.start ?? 1);
    const askedEnd = Math.min(lines.length, range.end ?? lines.length);
    const end = Math.min(askedEnd, start + MAX_LINES - 1);
    const head = `${file.path}:${start}-${end} of ${lines.length}`;
    const more = end < askedEnd ? `\n… cut at ${MAX_LINES} lines. Ask for ${file.path}:${end + 1}-${askedEnd}, or name a function (file lists them).` : "";
    return `${head}\n${numbered(lines, start, end)}${more}`;
  }

  // "Store.put" → parent Store, name put.
  const dot = t.lastIndexOf(".");
  const [parent, name] = dot > 0 && !t.includes("/") ? [t.slice(0, dot), t.slice(dot + 1)] : [undefined, t];
  const scope = options.path?.replace(/^\.\//, "");
  const matches = (exact: boolean) =>
    index.files
      .filter((f) => !scope || f.path.startsWith(scope))
      .flatMap((f) =>
        f.symbols
          .filter((s) => (exact ? s.name === name : s.name.toLowerCase() === name.toLowerCase()) && (!parent || s.parent?.toLowerCase() === parent.toLowerCase() || (!s.parent && f.path.toLowerCase().includes(parent.toLowerCase()))))
          .map((s) => ({ f, s })),
      );
  let hits = matches(true);
  if (!hits.length) hits = matches(false);
  if (!hits.length) return `No file or symbol "${target}"${scope ? ` under ${scope}` : ""}. Try symbols or where.`;
  // Source before tests and examples; classes before their own methods of the same name.
  hits.sort((a, b) => Number(a.f.role !== "source") - Number(b.f.role !== "source") || a.f.path.localeCompare(b.f.path) || a.s.line - b.s.line);
  const shown = hits.slice(0, 3);
  const parts: string[] = [];
  for (const { f, s } of shown) parts.push(await symbolSource(index, f, s));
  if (hits.length > shown.length) parts.push(`${hits.length - shown.length} more definitions: ${hits.slice(3, 15).map(({ f, s }) => `${f.path}:${s.line}`).join(", ")}. Narrow with path.`);
  return parts.join("\n\n---\n\n");
}

async function symbolSource(index: Index, f: FileFacts, s: SymbolInfo): Promise<string> {
  const lines = await readIndexed(index, f);
  const label = `${f.path}:${s.line}-${s.endLine}  ${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name}`;
  if (!lines) return `${label}\n(file too big to show)`;
  // Doc comments sit just above the declaration; include them when they're short.
  let start = s.line;
  while (start > 1 && s.line - start < 12 && /^\s*(\/\/|\/?\*|#|""")/.test(lines[start - 2] ?? "")) start--;
  const end = Math.min(s.endLine || s.line, start + MAX_LINES - 1, lines.length);
  const cut = (s.endLine || s.line) > end ? `\n… cut at ${MAX_LINES} lines. Ask for ${f.path}:${end + 1}-${s.endLine}.` : "";
  return `${label}\n${numbered(lines, start, end)}${cut}`;
}

/** Case-insensitive literal search over the indexed files, for the remote server where there's no grep. */
export async function searchText(index: Index, needle: string, options: { path?: string; limit?: number } = {}): Promise<string> {
  const q = needle.toLowerCase();
  const limit = options.limit ?? 40;
  const scope = options.path?.replace(/^\.\//, "");
  const files = index.files.filter((f) => !scope || f.path.startsWith(scope)).sort((a, b) => Number(a.role !== "source") - Number(b.role !== "source") || a.path.localeCompare(b.path));
  const out: string[] = [];
  let total = 0;
  for (const f of files) {
    const lines = await readIndexed(index, f);
    if (!lines) continue;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.toLowerCase().includes(q)) continue;
      total++;
      if (out.length < limit) out.push(`${f.path}:${i + 1}  ${lines[i]!.trim().slice(0, 200)}`);
    }
  }
  if (!total) return `"${needle}" isn't in any indexed file${scope ? ` under ${scope}` : ""}.`;
  return `${out.join("\n")}${total > out.length ? `\n… ${total - out.length} more. Narrow with path.` : ""}`;
}
