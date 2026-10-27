import { extract } from "../lang/extract.js";
import { languageFor } from "../lang/languages.js";
import { parse } from "../lang/parser.js";
import type { FileFacts } from "../types.js";
import { detectLines, roleFor } from "./detect.js";

/** Everything Spelunk learns from one file on its own. Runs on the main thread or in a worker. */
export async function factsFor(path: string, source: string, hash: string): Promise<FileFacts> {
  const def = languageFor(path)!;
  const head = source.slice(0, 2000);
  const role = roleFor(path, def.id, head);
  const lineFacts = detectLines(path, def.id, source, def.lineComment);
  // A test that builds a server or broker isn't where the program starts.
  if (role === "test") delete lineFacts.entry;
  const base: FileFacts = {
    path,
    language: def.id,
    role,
    hash,
    bytes: Buffer.byteLength(source),
    lines: source.split("\n").length,
    symbols: [],
    imports: [],
    calls: [],
    callSites: [],
    swallowed: [],
    ...lineFacts,
  };
  if (!def.grammar || role === "generated") return base;
  const tree = await parse(def.grammar, source);
  if (!tree) return base;
  try {
    const t = extract(tree, def.id);
    return {
      ...base,
      symbols: t.symbols,
      imports: t.imports.map((i) => ({ ...i, targets: [] })),
      calls: t.calls,
      callSites: t.callSites,
      ...(t.spans.length ? { spans: t.spans } : {}),
      swallowed: t.swallowed,
      ...(t.doc ? { doc: t.doc } : {}),
      ...(t.parseErrors ? { parseErrors: t.parseErrors } : {}),
    };
  } finally {
    tree.delete();
  }
}
