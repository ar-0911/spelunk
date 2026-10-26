import type { FileRole, Located, Route } from "../types.js";

/**
 * Line-based detectors that work across languages: routes, environment
 * variables, TODOs, error sites and entry points. Regexes, not parsers, so
 * they also work on files tree-sitter can't parse; each one is tuned to the
 * idioms of the common frameworks rather than trying to be complete.
 */

const HTTP = "get|post|put|patch|delete|options|head|all";

interface RoutePattern {
  framework: string;
  re: RegExp;
  /** Pull method, path and handler from a match. */
  read(m: RegExpMatchArray, line: string): { method: string; path: string; handler?: string; side?: "client" } | undefined;
}

const ROUTES: RoutePattern[] = [
  {
    // Express, Hono, Fastify, Koa-router, Elysia: app.get("/x", handler). The same shape from an
    // HTTP client (api.post("/x", body), axios.get(`/x/${id}`)) is a call to a route, not a route.
    framework: "js",
    re: new RegExp(`\\b(app|router|server|api|routes?|r|fastify|web|axios|http|client|ky|got|request|fetcher|\\$http|this\\.http|[a-z]\\w*(?:Router|App|Api|Routes|Client))\\.(${HTTP})(?:<[^>]*>)?\\(\\s*(["'\`])((?:/|\\*)[^"'\`]*)\\3\\s*(?:,\\s*([^,)]*))?`),
    read: (m) => {
      const receiver = m[1]!;
      const next = (m[5] ?? "").trim();
      const handlerArg = /^(async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(next);
      const clientish = /^(axios|http|client|ky|got|request|fetcher|\$http|this\.http|api)$|Client$/.test(receiver);
      const side = m[4]!.includes("${") || (clientish && !handlerArg) ? "client" : undefined;
      const handler = !side && /^[A-Za-z_$][\w$.]*$/.test(next) ? next : undefined;
      return { method: m[2]!.toUpperCase(), path: m[4]!, ...(handler ? { handler } : {}), ...(side ? { side } : {}) };
    },
  },
  {
    // fetch("/api/x", { method: "POST" })
    framework: "fetch",
    re: /\bfetch\(\s*(["'`])(\/[^"'`]*)\1(.*)$/,
    read: (m) => ({ method: m[3]!.match(/method:\s*["'](\w+)/)?.[1]?.toUpperCase() ?? "GET", path: m[2]!, side: "client" }),
  },
  {
    // requests / httpx in Python: requests.post(f"{BASE}/x")
    framework: "python-client",
    re: /\b(?:requests|httpx|session|client)\.(get|post|put|patch|delete)\(\s*f?(["'])(?:\{[^}]*\})?(\/[^"']*)\2/,
    read: (m) => ({ method: m[1]!.toUpperCase(), path: m[3]!, side: "client" }),
  },
  {
    // Flask, FastAPI, Starlette, Sanic, aiohttp: @app.get("/x") / @bp.route("/x", methods=["POST"])
    framework: "python",
    re: /@\s*\w+\.(get|post|put|patch|delete|route|api_route|websocket)\(\s*[rf]?(["'])([^"']*)\2(.*)$/,
    read: (m) => {
      let method = m[1]!.toUpperCase();
      if (method === "ROUTE" || method === "API_ROUTE") method = flaskMethods(m[4]);
      return { method, path: m[3]! };
    },
  },
  {
    // Flask: app.add_url_rule("/x", "name", view, methods=["POST"])
    framework: "python",
    re: /\b\w+\.add_url_rule\(\s*[rf]?(["'])([^"']*)\1(.*)$/,
    read: (m) => ({ method: flaskMethods(m[3]), path: m[2]! }),
  },
  {
    // Django: path("users/<int:id>/", views.user)
    framework: "django",
    re: /\b(?:re_)?path\(\s*r?(["'])([^"']*)\1\s*,\s*([\w.]+)/,
    read: (m) => ({ method: "ANY", path: `/${m[2]!.replace(/^\^|\$$/g, "")}`, handler: m[3]! }),
  },
  {
    // Go net/http (incl. 1.22 "GET /x" patterns), gorilla/mux
    framework: "go",
    re: /\.(?:HandleFunc|Handle)\(\s*"([^"]+)"\s*,\s*([\w.]+)?/,
    read: (m) => {
      const [a, b] = m[1]!.split(/\s+/);
      return b ? { method: a!, path: b, ...(m[2] ? { handler: m[2] } : {}) } : { method: "ANY", path: a!, ...(m[2] ? { handler: m[2] } : {}) };
    },
  },
  {
    // gin, echo, chi, fiber: r.GET("/x", h) / r.Get("/x", h)
    framework: "go",
    re: /\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"\s*(?:,\s*([\w.]+))?/,
    read: (m) => ({ method: m[1]!.toUpperCase(), path: m[2]!, ...(m[3] ? { handler: m[3] } : {}) }),
  },
  {
    // Spring
    framework: "spring",
    re: /@(Get|Post|Put|Delete|Patch|Request)Mapping\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)"/,
    read: (m) => ({ method: m[1] === "Request" ? "ANY" : m[1]!.toUpperCase(), path: m[2]! }),
  },
  {
    // axum: .route("/x", get(handler).post(other))
    framework: "rust",
    re: /\.route\(\s*"(\/[^"]*)"\s*,\s*(get|post|put|patch|delete|any)\(\s*([\w:]+)?/,
    read: (m) => ({ method: m[2]!.toUpperCase(), path: m[1]!, ...(m[3] ? { handler: m[3] } : {}) }),
  },
  {
    // actix-web, rocket: #[get("/x")]
    framework: "rust",
    re: /#\[(get|post|put|patch|delete)\(\s*"([^"]*)"/,
    read: (m) => ({ method: m[1]!.toUpperCase(), path: m[2]! }),
  },
  {
    // Rails routes.rb, Sinatra
    framework: "ruby",
    re: /^\s*(get|post|put|patch|delete)\s+["']([^"']+)["'](?:.*to:\s*["']([^"']+))?/,
    read: (m) => ({ method: m[1]!.toUpperCase(), path: m[2]!, ...(m[3] ? { handler: m[3] } : {}) }),
  },
  {
    // Laravel
    framework: "laravel",
    re: /Route::(get|post|put|patch|delete|any)\(\s*['"]([^'"]+)/,
    read: (m) => ({ method: m[1]!.toUpperCase(), path: m[2]!.startsWith("/") ? m[2]! : `/${m[2]}` }),
  },
  {
    // ASP.NET attributes and minimal APIs
    framework: "aspnet",
    re: /(?:\[Http(Get|Post|Put|Delete|Patch)\(\s*"([^"]*)"|\.Map(Get|Post|Put|Delete|Patch)\(\s*"([^"]*)")/,
    read: (m) => ({ method: (m[1] ?? m[3])!.toUpperCase(), path: (m[2] ?? m[4])! }),
  },
];

const ENV: RegExp[] = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["'`]([^"'`]+)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /Deno\.env\.get\(\s*["']([^"']+)["']/g,
  /os\.environ(?:\.get)?[([]\s*f?["']([^"']+)["']/g,
  /os\.getenv\(\s*["']([^"']+)["']/g,
  /os\.(?:Getenv|LookupEnv)\(\s*"([^"]+)"/g,
  /env::var(?:_os)?\(\s*"([^"]+)"/g,
  /env!\(\s*"([^"]+)"/g,
  /System\.getenv\(\s*"([^"]+)"/g,
  /\bENV(?:\.fetch\(|\[)\s*["']([^"']+)["']/g,
  /getenv\(\s*['"]([^'"]+)['"]/g,
  /\$_ENV\[\s*['"]([^'"]+)['"]/g,
  /Environment\.GetEnvironmentVariable\(\s*"([^"]+)"/g,
];

/** In config/env/settings modules, `NAME: schema` and `NAME = Field(...)` declare variables (zod, pydantic, envalid). */
const ENV_SCHEMA_FILE = /(^|\/)(config|env|settings|environment)[^/]*\.[a-z]+$/i;
const ENV_SCHEMA_LINE = /^\s*([A-Z][A-Z0-9_]{2,})\s*[:=]\s*(?:z\.|str|int|bool|Field|env\.|t\.|Joi\.|string|number|os\.)/;

const NOTE = /\b(TODO|FIXME|HACK|XXX)\b[:\s(]*(.*)$/;

const THROWS: Record<string, RegExp> = {
  default: /\bthrow\s+(?:new\s+)?([\w.]+)?|\bthrow\b/,
  python: /^\s*raise\b/,
  ruby: /\braise\b|\bfail\s+["A-Z]/,
  go: /\bpanic\(|errors\.New\(|fmt\.Errorf\(/,
  rust: /\bpanic!\(|\.unwrap\(\)|\.expect\(|\bbail!\(|\bErr\(/,
  shell: /\bexit\s+[1-9]/,
};

const LOGS = /\bconsole\.(error|warn)\(|\blog(?:ger)?\.(error|warn|warning|exception|critical|fatal|Error|Warn|Fatal|Errorf|Warnf)\(|\blogging\.(error|warning|exception|critical)\(|\beprintln!\(|\b(?:log|tracing)::(error|warn)!|\bSystem\.err\.|\bprint\(.*file\s*=\s*sys\.stderr|\bslog\.(Error|Warn)\(|\bLogger\.(error|warn)\(/;

const ENTRY: { re: RegExp; label: string; lang?: string[] }[] = [
  { re: /^if\s+__name__\s*==\s*["']__main__["']/, label: "python __main__", lang: ["python"] },
  { re: /^\s*\w+\s*=\s*(FastAPI|Flask|Starlette|Sanic|Quart)\(/, label: "web app", lang: ["python"] },
  { re: /^func\s+main\(\)/, label: "go main", lang: ["go"] },
  { re: /^\s*(pub\s+)?(async\s+)?fn\s+main\(/, label: "rust main", lang: ["rust"] },
  { re: /public\s+static\s+(async\s+)?\w+\s+[Mm]ain\(/, label: "main method", lang: ["java", "csharp"] },
  { re: /^fun\s+main\(/, label: "kotlin main", lang: ["kotlin"] },
  { re: /^\s*int\s+main\s*\(/, label: "c main", lang: ["c", "cpp"] },
  { re: /\.listen\(\s*[\w.]*[pP]ort|\bserve\(\s*\{\s*fetch|\bBun\.serve\(|\bDeno\.serve\(|\.listen\(\s*\d{2,5}/, label: "server start", lang: ["javascript", "typescript", "tsx"] },
  { re: /\b(createRoot|hydrateRoot)\(|ReactDOM\.render\(|\bcreateApp\([^)]*\)\.mount\(|\bnew Vue\(|\bbootstrapApplication\(/, label: "browser app", lang: ["javascript", "typescript", "tsx"] },
  { re: /^#!.*\b(node|python3?|bash|sh|deno|bun|ruby)\b/, label: "script" },
];

export interface LineFacts {
  routes: Route[];
  env: Located[];
  notes: Located[];
  throws: Located[];
  logs: Located[];
  entry?: string;
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function detectLines(path: string, lang: string, source: string, lineComment: string[]): LineFacts {
  const routes: Route[] = [];
  const env: Located[] = [];
  const notes: Located[] = [];
  const throws: Located[] = [];
  const logs: Located[] = [];
  let entry: string | undefined;
  const lines = source.split("\n");
  const throwRe = THROWS[lang] ?? THROWS.default!;
  const isCode = !/^(markdown|json|yaml|toml|css|html|env|sql)$/.test(lang);
  const schemaFile = ENV_SCHEMA_FILE.test(path);
  const seenEnv = new Set<string>();
  let inBlockComment = false;
  let inDocstring = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    const n = i + 1;
    if (!line) continue;

    // Python docstrings hold example code (`@app.route("/")`) that isn't the app's.
    const quotes = lang === "python" ? (raw.match(/"""|'''/g) ?? []).length : 0;
    const wasDocstring = inDocstring;
    if (quotes % 2 === 1) inDocstring = !inDocstring;
    const commentStart = wasDocstring || quotes > 0 && /^[rbuf]*("""|''')/i.test(line) || line.startsWith("/*") || line.startsWith("*") || lineComment.some((p) => line.startsWith(p));
    if (line.includes("/*")) inBlockComment = !line.includes("*/");
    const isComment = commentStart || inBlockComment;
    if (inBlockComment && line.includes("*/")) inBlockComment = false;

    if (isCode || lang === "yaml" || lang === "docker" || lang === "make") {
      const note = line.match(NOTE);
      const commentAt = Math.min(...[raw.indexOf("//"), raw.indexOf("#"), raw.indexOf("/*"), raw.indexOf("--")].filter((x) => x >= 0).concat(Infinity));
      if (note && (isComment || raw.indexOf(note[1]!) > commentAt)) notes.push({ line: n, text: clip(`${note[1]}: ${note[2]!.replace(/\*\/\s*$/, "").trim()}`) });
    }
    if (!isCode || isComment) continue;

    for (const p of ROUTES) {
      const m = raw.match(p.re);
      const r = m && p.read(m, raw);
      if (r) {
        routes.push({ side: "server", ...r, line: n, framework: p.framework });
        break;
      }
    }
    for (const re of ENV) {
      re.lastIndex = 0;
      for (const m of raw.matchAll(re)) {
        const name = m[1]!;
        if (!seenEnv.has(`${name}:${n}`)) {
          seenEnv.add(`${name}:${n}`);
          env.push({ line: n, text: name });
        }
      }
    }
    if (schemaFile) {
      const m = raw.match(ENV_SCHEMA_LINE);
      if (m && !seenEnv.has(`${m[1]}:${n}`)) {
        seenEnv.add(`${m[1]}:${n}`);
        env.push({ line: n, text: m[1]! });
      }
    }
    if (throwRe.test(raw)) throws.push({ line: n, text: clip(line) });
    if (LOGS.test(raw)) logs.push({ line: n, text: clip(line) });
    if (!entry) {
      for (const e of ENTRY) {
        if ((!e.lang || e.lang.includes(lang)) && e.re.test(e.label === "script" ? raw : line)) {
          if (e.label === "script" && i > 0) continue;
          entry = e.label;
          break;
        }
      }
    }
  }
  if (lang === "python") applyRouterPrefixes(source, lines, routes);
  return { routes, env, notes, throws, logs, ...(entry ? { entry } : {}) };
}

/** `methods=["GET", "POST"]` or `methods=("POST",)` → "GET,POST"; Flask's default is GET. */
function flaskMethods(rest: string | undefined): string {
  const list = rest?.match(/methods\s*=\s*[[(]([^\])]*)[\])]/)?.[1];
  return list?.replace(/["'\s]/g, "").replace(/,$/, "").toUpperCase() || "GET";
}

const ROUTER_DECL = /^(\w+)\s*=\s*(?:APIRouter|Blueprint)\((.*)\)/gm;
const PREFIX_ARG = /\b(?:url_)?prefix\s*=\s*["']([^"']+)["']/;

/** FastAPI `APIRouter(prefix="/users")` and Flask `Blueprint(url_prefix=...)`: routes on that router live under the prefix. */
function applyRouterPrefixes(source: string, lines: string[], routes: Route[]): void {
  const prefixes = new Map<string, string>();
  for (const m of source.matchAll(ROUTER_DECL)) {
    const prefix = m[2]!.match(PREFIX_ARG)?.[1];
    if (prefix) prefixes.set(m[1]!, prefix.replace(/\/$/, ""));
  }
  if (!prefixes.size) return;
  for (const r of routes) {
    const receiver = lines[r.line - 1]!.trim().match(/^@(\w+)\./)?.[1];
    const prefix = receiver && prefixes.get(receiver);
    if (prefix) r.path = r.path === "/" ? prefix : `${prefix}${r.path.startsWith("/") ? "" : "/"}${r.path}`;
  }
}

const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|e2e|integration_tests)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$|_test\.(go|py|rb|exs)$|(^|\/)test_[^/]+\.py$|(^|\/)conftest\.py$|_spec\.rb$|(^|\/)src\/test\/|Tests?\.(cs|java|kt|swift)$/;
const MIGRATION_PATH = /(^|\/)(migrations?|alembic\/versions|db\/migrate|drizzle|prisma\/migrations)\//;
const FIXTURE_PATH = /(^|\/)(fixtures?|testdata|__snapshots__|__mocks__|mocks?|stubs?|samples?|examples?|demo)\//;
const GENERATED_PATH = /\.min\.(js|css)$|\.pb\.go$|_pb2(_grpc)?\.py$|\.d\.ts$|\.g\.dart$|\.generated\.\w+$|(^|\/)(vendor|third_party|gen|generated)\//;
const CONFIG_NAME = /(^|\/)(\.[\w.-]+rc(\.\w+)?|[\w.-]*config\.[cm]?[jt]s|[\w.-]*\.config\.\w+|tsconfig[\w.-]*\.json|package\.json|pyproject\.toml|setup\.cfg|Cargo\.toml|go\.mod|\.env[\w.-]*|Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Makefile|wrangler\.\w+)$/;

export function roleFor(path: string, lang: string, head: string): FileRole {
  if (/@generated|DO NOT EDIT|auto-?generated|Code generated by/i.test(head)) return "generated";
  if (GENERATED_PATH.test(path)) return "generated";
  if (TEST_PATH.test(path)) return "test";
  if (MIGRATION_PATH.test(path)) return "migration";
  if (FIXTURE_PATH.test(path)) return "fixture";
  if (/(^|\/)\.github\/|(^|\/)(Dockerfile|Makefile|Jenkinsfile)|\.gitlab-ci\.yml$/.test(path)) return "build";
  if (CONFIG_NAME.test(path)) return "config";
  if (lang === "markdown" || /(^|\/)docs?\//.test(path)) return "docs";
  if (/^(json|yaml|toml|env)$/.test(lang)) return "config";
  return "source";
}
