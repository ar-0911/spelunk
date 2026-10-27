/** What Spelunk knows about one repository. Stored as JSON Lines at .spelunk/index.jsonl. */

export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "struct" | "trait" | "module" | "constant";

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  /** 1-based. */
  line: number;
  endLine: number;
  exported: boolean;
  /** Enclosing class, impl or module, for methods. */
  parent?: string;
  /** The comment or docstring attached to the symbol, first paragraph only. */
  doc?: string;
  /** First line of the declaration, trimmed. */
  signature: string;
  /** Calls made inside a function or method body: "save", or "recv.save" when called on a receiver. */
  calls?: string[];
  /** The module's default export (`export default`, `module.exports = x`). */
  default?: boolean;
  /** A Moleculer action or event handler: reached by name through the broker (`ctx.call("users.get")`), with `parent` as the service. */
  broker?: "action" | "event";
}

export interface ImportRef {
  /** As written: "./pages.js", "os.path", "github.com/x/y". */
  spec: string;
  line: number;
  /** Names pulled from the module (`from a import b, c`), when the language says them. */
  names?: string[];
  /** The local names those become (`import { a as b }` binds "b"), in the same order as `names`. */
  bindings?: string[];
  /** Local name for the whole module: `import * as x`, `import a.b as x`, a Go package name, `const x = require()`. "*" re-exports everything. */
  namespace?: string;
  /** Local name of a default import: `import x from "…"`. */
  defaultBinding?: string;
  /** Repo-relative files this import points at. Empty when it's external or unresolved. */
  targets: string[];
  /** Package name when the import leaves the repo (npm, PyPI, Go module, crate). */
  external?: string;
}

export interface Route {
  method: string;
  path: string;
  /** "server" defines the endpoint; "client" calls it (fetch, axios, an API wrapper). */
  side: "server" | "client";
  line: number;
  framework: string;
  /** The handler's name when it is a named reference rather than an inline function. */
  handler?: string;
  /** Moleculer `rest` routes: the path under the service, before the gateway's prefix. */
  servicePath?: string;
}

export interface Located {
  line: number;
  text: string;
}

export type FileRole = "source" | "test" | "config" | "docs" | "build" | "migration" | "generated" | "fixture";

export interface FileFacts {
  path: string;
  language: string;
  role: FileRole;
  /** sha256 of the content; scans skip files whose hash didn't change. */
  hash: string;
  bytes: number;
  lines: number;
  /** Leading comment or module docstring, first paragraph. */
  doc?: string;
  symbols: SymbolInfo[];
  imports: ImportRef[];
  /** Names this file calls, for "who calls X" across files. */
  calls: string[];
  /** Every call as [ref, line] ("save" or "recv.save"), for tracing what a route handler or a block does. */
  callSites: [string, number][];
  /** Line ranges of route registrations (`app.get("/x", …)`), so tracing knows where a handler ends. */
  spans?: [number, number][];
  /** Size and modification time when read: an unchanged file is reused without reading it again. */
  size?: number;
  mtime?: number;
  routes: Route[];
  /** A moleculer-web gateway route with `autoAliases`: the path the services' `rest` actions are served under. */
  restPrefix?: string;
  /** Environment variables read here. */
  env: Located[];
  /** TODO / FIXME / HACK / XXX comments. */
  notes: Located[];
  /** Places that raise or throw. */
  throws: Located[];
  /** Places that log errors or warnings. */
  logs: Located[];
  /** Empty catch / except-pass blocks: errors that vanish. */
  swallowed: Located[];
  /** True when this file is a program entry point (main, server start, CLI bin). */
  entry?: string;
  /** Parse problems, so a reader knows when facts may be incomplete. */
  parseErrors?: number;
}

export interface Manifest {
  /** Repo-relative path of the manifest. */
  path: string;
  kind: "npm" | "python" | "go" | "cargo" | "maven" | "gradle" | "ruby" | "docker" | "compose" | "ci" | "make" | "env";
  name?: string;
  /** Runnable commands: npm scripts, Make targets, CI steps, Docker CMD. */
  commands: { name: string; command: string }[];
  dependencies: string[];
  /** Variables named in .env.example and similar. */
  env?: string[];
}

export interface Index {
  version: number;
  root: string;
  scannedAt: string;
  /** git HEAD when scanned, if the root is a git repo. */
  commit?: string;
  /** Web URL of the origin remote (GitHub, GitLab…), for linking files in reports. */
  remote?: string;
  files: FileFacts[];
  manifests: Manifest[];
  /** Commits touching each file in the last year, from git log. */
  churn: Record<string, number>;
  /** Files Spelunk saw but didn't parse (binary, too large, unknown language). */
  skipped: { path: string; reason: string }[];
  /** Directories the scan was limited to (`--only`); absent means the whole repo. */
  only?: string[];
}

export const INDEX_VERSION = 6;
