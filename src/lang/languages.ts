import { basename, extname } from "node:path";

export interface LanguageDef {
  id: string;
  /** Grammar file name in tree-sitter-wasms, without "tree-sitter-" and ".wasm". Missing means line-based facts only. */
  grammar?: string;
  /** Prefixes that start a line comment, for TODO and header-comment detection without a parser. */
  lineComment: string[];
}

const L = (id: string, grammar: string | undefined, lineComment: string[]): LanguageDef => ({ id, ...(grammar ? { grammar } : {}), lineComment });

const BY_EXT: Record<string, LanguageDef> = {
  ".ts": L("typescript", "typescript", ["//"]),
  ".mts": L("typescript", "typescript", ["//"]),
  ".cts": L("typescript", "typescript", ["//"]),
  ".tsx": L("tsx", "tsx", ["//"]),
  ".js": L("javascript", "javascript", ["//"]),
  ".mjs": L("javascript", "javascript", ["//"]),
  ".cjs": L("javascript", "javascript", ["//"]),
  ".jsx": L("javascript", "javascript", ["//"]),
  ".py": L("python", "python", ["#"]),
  ".pyi": L("python", "python", ["#"]),
  ".go": L("go", "go", ["//"]),
  ".rs": L("rust", "rust", ["//"]),
  ".java": L("java", "java", ["//"]),
  ".kt": L("kotlin", "kotlin", ["//"]),
  ".kts": L("kotlin", "kotlin", ["//"]),
  ".scala": L("scala", "scala", ["//"]),
  ".cs": L("csharp", "c_sharp", ["//"]),
  ".rb": L("ruby", "ruby", ["#"]),
  ".php": L("php", "php", ["//", "#"]),
  ".swift": L("swift", "swift", ["//"]),
  ".c": L("c", "c", ["//"]),
  ".h": L("c", "c", ["//"]),
  ".cc": L("cpp", "cpp", ["//"]),
  ".cpp": L("cpp", "cpp", ["//"]),
  ".cxx": L("cpp", "cpp", ["//"]),
  ".hpp": L("cpp", "cpp", ["//"]),
  ".lua": L("lua", "lua", ["--"]),
  ".ex": L("elixir", "elixir", ["#"]),
  ".exs": L("elixir", "elixir", ["#"]),
  ".dart": L("dart", "dart", ["//"]),
  ".zig": L("zig", "zig", ["//"]),
  ".vue": L("vue", undefined, ["//"]),
  ".svelte": L("svelte", undefined, ["//"]),
  ".sh": L("shell", "bash", ["#"]),
  ".bash": L("shell", "bash", ["#"]),
  ".sql": L("sql", undefined, ["--"]),
  ".md": L("markdown", undefined, []),
  ".mdx": L("markdown", undefined, []),
  ".json": L("json", undefined, []),
  ".yaml": L("yaml", undefined, ["#"]),
  ".yml": L("yaml", undefined, ["#"]),
  ".toml": L("toml", undefined, ["#"]),
  ".css": L("css", undefined, []),
  ".scss": L("css", undefined, ["//"]),
  ".html": L("html", undefined, []),
};

const BY_NAME: Record<string, LanguageDef> = {
  Dockerfile: L("docker", undefined, ["#"]),
  Makefile: L("make", undefined, ["#"]),
  Gemfile: L("ruby", "ruby", ["#"]),
  Rakefile: L("ruby", "ruby", ["#"]),
};

export function languageFor(path: string): LanguageDef | undefined {
  const name = basename(path);
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("Dockerfile")) return BY_NAME.Dockerfile;
  if (name.startsWith(".env")) return L("env", undefined, ["#"]);
  return BY_EXT[extname(name).toLowerCase()];
}

/** Languages whose files hold program logic, as opposed to config, docs and styles. */
export const CODE_LANGUAGES = new Set([
  "typescript", "tsx", "javascript", "python", "go", "rust", "java", "kotlin", "scala", "csharp", "ruby", "php",
  "swift", "c", "cpp", "lua", "elixir", "dart", "zig", "vue", "svelte", "shell",
]);
