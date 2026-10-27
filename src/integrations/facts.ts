import { languageFor } from "../lang/languages.js";
import { factsFor } from "../scan/facts.js";

/**
 * `spelunk facts`: parse files handed over on stdin, without a repository or
 * an index. Other tools (Braid's conflict checks) send the before and after
 * versions of changed files and get symbols, signatures and call sites back,
 * in every language Spelunk reads.
 *
 * In:  {"files": [{"path": "src/a.ts", "text": "..."}]}
 * Out: {"files": [{"path", "language", "symbols", "callSites", "imports"}]}, leaving out files in languages Spelunk doesn't parse.
 */
export interface FactsRequest {
  files: { path: string; text: string }[];
}

export async function parseFiles(req: FactsRequest) {
  if (!req || !Array.isArray(req.files)) throw new Error('Send {"files": [{"path": "...", "text": "..."}]} on stdin.');
  const out = [];
  for (const f of req.files) {
    if (typeof f?.path !== "string" || typeof f.text !== "string" || !languageFor(f.path)?.grammar) continue;
    const facts = await factsFor(f.path, f.text, "");
    out.push({ path: f.path, language: facts.language, symbols: facts.symbols, callSites: facts.callSites, imports: facts.imports.map(({ targets: _, ...i }) => i) });
  }
  return { files: out };
}
