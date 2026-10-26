# Spelunk

Understand any codebase: where code lives, how it's written, and how the pieces connect. Built for the moment you open a large or vibe-coded repo and something is broken.

Spelunk reads the repository with [tree-sitter](https://tree-sitter.github.io/) to build a map of files, symbols, imports, HTTP routes, environment variables and commands. That part is fast, offline and free. On top of it, Claude can write the parts static analysis can't: what each module is for, how the main flows work, and where to look when something fails.

You use it from the terminal, or let Claude Code (or any MCP client) ask it questions while it works.

```
$ spelunk trace "PUT /api/pages/:id"
route PUT /api/pages/:id  apps/server/src/app.ts:672

Called from (client code):
  apps/web/src/PageEditor.tsx:111  PUT /api/pages/${pageId}

Reached from entry points:
  apps/server/src/main.ts → apps/server/src/app.ts

What it calls:
  updatePage  apps/server/src/services/pages.ts:153
    getPage  apps/server/src/services/pages.ts:101
    assertNotLockedByOther  apps/server/src/services/pages.ts:140
    compileAndStore  apps/server/src/services/pages.ts:52
      checkSource  apps/server/src/services/pages.ts:48
      storeWidgets  apps/server/src/services/widgets.ts:59
```

## Install

Needs Node 22 or later.

```sh
git clone https://github.com/ar-0911/spelunk && cd spelunk
pnpm install        # also builds dist/
npm link            # puts `spelunk` on your PATH
```

## The dashboard (no command line needed)

```sh
spelunk ui
```

This opens Spelunk in your browser. Choose a project folder and click around:

- **Overview**: what the project is, where the program starts, which files to read first, how to run it, a diagram of how the parts connect, and every part with its summary.
- **Find**: type plain words ("send email", "payment failed") and jump to the code.
- **Trace**: pick a web address or function and see who calls it and what it calls.
- **Risks**, **Routes**, **Config** and **Debugging**: the same findings as the CLI, as pages.
- **Explain with Claude**: shows the cost, takes an API key for that run only, and adds Claude's explanations to every page.

Click any `path:line` to read the code there, with a "What's in it" tab listing the file's functions, imports, settings and errors.

The dashboard runs on your machine at `127.0.0.1` only. It prints a link with a one-time token, and requests without that token are refused, so other websites open in your browser can't read your code through it.

## Commands

Run these inside the repository you want to understand, or pass `-C <dir>`.

| Command | What you get |
|---|---|
| `spelunk map` | The field guide, `.spelunk/map.html`: start here, how to run it, an architecture diagram, a code map of every module, search, routes, flows, debugging, config, risks and tests. `--format md` writes `SPELUNK.md` instead, with a Mermaid diagram GitHub renders. |
| `spelunk where "<words>"` | Where a feature, error message, route, function or env var lives. Ranked, with `path:line`. "auth" also finds login, session and token code. |
| `spelunk trace <target>` | For a route: the client code that calls it and the handler's call tree. For a function: what it calls and who uses it. For a file: imports, importers, and how entry points reach it. |
| `spelunk file <path>` | Everything known about one file: symbols, routes, imports, importers, env vars, where it throws and logs. |
| `spelunk module <dir>` | One module: files ranked by how much they're imported, dependencies, and Claude's summary. |
| `spelunk routes [filter]` | Every HTTP route and the client calls that hit it. |
| `spelunk risks [--kind k]` | Places bugs hide: swallowed errors, calls to routes that don't exist, import cycles, duplicated code, hotspots, long functions, untested modules, dead files, undocumented env vars, TODOs. |
| `spelunk explain` | Asks Claude for module summaries, main flows, a run-it-locally guide, a debugging guide and a glossary. Prints the estimated cost and does nothing until you add `--yes`. |
| `spelunk ui` | The dashboard, above. `--port` to pick a port, `--no-open` to just print the link. |
| `spelunk scan` | Re-index. Every command already rescans incrementally (only changed files are re-parsed), so you rarely need this. |

`where`, `trace` and `risks` take `--json`.

## With Claude Code (MCP)

```sh
claude mcp add spelunk -- spelunk mcp
```

Claude Code starts the server in your project directory. It gets these tools: `overview`, `where`, `trace`, `file`, `module`, `dependencies`, `dependents`, `symbols`, `routes`, `env_vars`, `risks` and `rescan`. They answer from the index instead of reading whole files, so Claude spends fewer tokens finding its way around. The index rescans itself when it's more than 20 seconds old, so Claude sees its own edits.

For other MCP clients, run `spelunk mcp -C /path/to/repo` as a stdio server.

## Claude explanations

```sh
export ANTHROPIC_API_KEY=sk-ant-...
spelunk explain            # shows modules, tokens and cost; spends nothing
spelunk explain --yes      # runs it
spelunk map                # the guide now includes Claude's sections
```

Each module goes to Claude with its full source, or signatures only once it passes `--max-chars` (default 120,000 characters). Answers are cached in `.spelunk/cache` keyed by the files' content, so a re-run after a small change only pays for the modules that changed. Flow steps Claude names are checked against the index: steps that point at files that don't exist are dropped, and line numbers come from the index rather than from Claude. Elemnt (13,600 lines, 11 modules) estimates at about $1.20.

## Languages

Symbols, imports and calls: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Scala, C#, Ruby, PHP, Swift, C, C++, Lua, Elixir, Dart, Zig and shell.

Imports resolve to files for TypeScript and JavaScript (including tsconfig paths and workspace packages), Python, Go (via go.mod), Rust, the JVM languages, Ruby, C and C++, and PHP (PSR-4).

Routes: Express, Hono, Fastify, Koa and similar, `fetch` and axios clients, Flask, FastAPI (with `APIRouter` prefixes), Django, Go `net/http`, gin and chi, Spring, axum, actix, Rails, Sinatra, Laravel and ASP.NET.

Project files: package.json, pyproject.toml, requirements.txt, setup.py, go.mod, Cargo.toml, pom.xml, Gradle, Gemfile, Dockerfiles, compose files, CI workflows, Makefiles and `.env` examples.

## How it works

```
scan     walk files (git ls-files when it's a repo) → tree-sitter → symbols, imports, calls
         + line patterns → routes, env vars, errors, logs, TODOs, entry points
         + manifests → commands, dependencies, documented env vars
         → resolve imports to files → .spelunk/index.jsonl
analyse  file graph → modules (directories, folded to ≤ 40) → risks, route matching
query    where (BM25 with synonyms) · trace (call trees from call sites + definitions)
explain  per-module prompts → Claude → overview prompt → .spelunk/explain.json
report   HTML / Markdown / MCP / terminal / dashboard, all from the same Report model
```

Everything lives in `.spelunk/` inside the repository, with its own `.gitignore`, so nothing lands in your commits.

## Limits

- Call trees follow calls by name. A call through a variable, a dependency-injected object or a string lookup can't be followed, and two functions with the same name can be confused. Treat traces as a map, not a proof.
- Routes registered across files (for example `app.use("/api", router)` in Express, or gin route groups) keep the path written next to the handler, without the outer prefix. FastAPI and Flask router prefixes in the same file are applied.
- Risk findings are heuristics. "Orphan" means nothing imports the file and it isn't a known entry point; frameworks that load files by convention will show up there.
- Files over 1 MB, binaries and generated code are skipped.

## Development

```sh
pnpm test         # vitest: small TypeScript, Python and Go repos, explain with a fake Claude, MCP in memory, the dashboard's API
pnpm typecheck
pnpm dev where "something" -C ../some-repo
```
