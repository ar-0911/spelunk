import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Language, Parser, type Tree } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const grammarDir = join(dirname(require.resolve("tree-sitter-wasms/package.json")), "out");

let ready: Promise<void> | undefined;
const languages = new Map<string, Promise<Language | undefined>>();

/** Loads a grammar once. Returns undefined when it can't load, so the file falls back to line-based facts. */
function load(grammar: string): Promise<Language | undefined> {
  let lang = languages.get(grammar);
  if (!lang) {
    lang = (ready ??= Parser.init())
      .then(() => Language.load(join(grammarDir, `tree-sitter-${grammar}.wasm`)))
      .catch(() => undefined);
    languages.set(grammar, lang);
  }
  return lang;
}

const parsers = new Map<string, Parser>();

export async function parse(grammar: string, source: string): Promise<Tree | undefined> {
  const lang = await load(grammar);
  if (!lang) return undefined;
  let parser = parsers.get(grammar);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(lang);
    parsers.set(grammar, parser);
  }
  return parser.parse(source) ?? undefined;
}
