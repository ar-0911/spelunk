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
- **First day**: a guided walk through the project in about ten steps, each naming the files to open in order. Tick steps off; progress is kept in your browser.
- **Find**: type plain words ("send email", "payment failed") and jump to the code.
- **Ask**: ask a question in plain words. Claude searches and reads the code and answers with links to the lines it used.
- **Trace**: pick a web address or function and see who calls it and what it calls.
- **Error lookup**: paste an error or a whole stack trace and get the line that raised it, even from a server or compiled code.
- **Changes**: what your branch touches compared with main: functions edited, what depends on them, routes to re-check, tests to run.
- **Risks**, **Routes**, **Config** and **Debugging**: the same findings as the CLI, as pages.
- **Explain with Claude**: shows the cost, takes an API key for that run only, and adds Claude's explanations to every page.
- **Share**: publish the map as a page in Elemnt.

You can also paste a GitHub, GitLab or Bitbucket link instead of choosing a folder; Spelunk downloads it (with an access token for private repositories, used once and never saved).

Click any `path:line` to read the code there, with a "What's in it" tab listing the file's functions, imports, settings and errors.

The dashboard runs on your machine at `127.0.0.1` only. It prints a link with a one-time token; on first load the token is swapped for an HttpOnly cookie and the link is replaced, so it doesn't sit in your browser history. Requests without the cookie (or the `x-spelunk-token` header, for scripts) are refused, so other websites open in your browser can't read your code through it. The folder picker stays inside your home folder; start it with `--allow-any-path` to open folders elsewhere.

## Commands

Run these inside the repository you want to understand, or pass `-C <dir>`. `-C` also takes a repository link (see below).

| Command | What you get |
|---|---|
| `spelunk map` | The field guide, `.spelunk/map.html`: start here, how to run it, an architecture diagram, a code map of every module, search, routes, flows, debugging, config, risks and tests. `--format md` writes `SPELUNK.md` instead, with a Mermaid diagram GitHub renders. |
| `spelunk where "<words>"` | Where a feature, error message, route, function or env var lives. Ranked, with `path:line`. "auth" also finds login, session and token code. |
| `spelunk trace <target>` | For a route: the client code that calls it and the handler's call tree. For a function: what it calls and who uses it. For a file: imports, importers, and how entry points reach it. |
| `spelunk file <path>` | Everything known about one file: symbols, routes, imports, importers, env vars, where it throws and logs. |
| `spelunk module <dir>` | One module: files ranked by how much they're imported, dependencies, and Claude's summary. |
| `spelunk routes [filter]` | Every HTTP route and the client calls that hit it. |
| `spelunk risks [--kind k]` | Places bugs hide: swallowed errors, calls to routes that don't exist, import cycles, duplicated code, hotspots, long functions, untested modules, dead files, undocumented env vars, TODOs. |
| `spelunk error "<text>"` | Paste an error message or stack trace (or pipe one in: `pbpaste \| spelunk error`). Maps frames to files and functions, even from absolute container paths or compiled `dist/` output, and finds the throw or log statement that produces the message. |
| `spelunk impact [base]` | What the current branch changes compared with `base` (default: the remote's main branch): changed functions, files that depend on them, routes whose handlers reach the change, tests to run, changed files no test reaches, and risks in the changed lines. Markdown, so it fits a PR comment. `--working` includes uncommitted edits. |
| `spelunk tour` | A first-day walkthrough: what it is, how to run it, the settings it needs, the big parts, one request end to end, the core files, where bugs hide, how to debug and test. |
| `spelunk ask "<question>"` | Claude answers from the code: it searches, traces and reads line ranges through Spelunk's index (not the whole repo), and cites `path:line` for each claim. Needs `ANTHROPIC_API_KEY`; a question usually costs a few cents. |
| `spelunk publish` | Publishes the map as one Elemnt page, creating it or updating it in place. See [Share the map in Elemnt](#share-the-map-in-elemnt). |
| `spelunk explain` | Asks Claude for module summaries, main flows, a run-it-locally guide, a debugging guide and a glossary. Prints the estimated cost and does nothing until you add `--yes`. |
| `spelunk ui` | The dashboard, above. `--port` to pick a port, `--no-open` to just print the link. |
| `spelunk scan` | Re-index. Every command already rescans incrementally (only changed files are re-parsed), so you rarely need this. |

`where`, `trace`, `risks`, `error`, `impact`, `tour` and `ask` take `--json`.

## Open a repository by link

```sh
spelunk -C https://github.com/owner/repo map
spelunk -C https://bitbucket.org/team/repo/src/develop/ tour      # a branch in the link is checked out
spelunk -C https://git.acme.com/projects/PAY/repos/ledger/browse ui
```

GitHub, GitLab (including nested groups), Bitbucket Cloud, Bitbucket Data Center and Gitea links work, as do `git@host:owner/repo.git` SSH addresses. The copy lives in `~/.spelunk/repos` and is updated on the next run. For private repositories pass `--git-token`, or set `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN` (an app password as `user:password` also works) or `SPELUNK_GIT_TOKEN`. The token goes to git as a header for that command only; it isn't written into the clone's config.

## Big repositories

Spelunk is built to stay usable on repositories with tens of thousands of files:

- Parsing runs on every core (up to 8 worker threads) once there are more than a few hundred files to read. `--workers <n>` overrides it.
- The index is JSON Lines, streamed to disk, so a large index never has to fit in one string. Later scans only re-parse files whose content changed.
- In a monorepo, `spelunk scan --only services/billing,packages/shared` reads just those folders. The choice is remembered for later commands; `--only .` goes back to the whole repository.

On a 4-core machine, VS Code (18,700 files) indexes in about a minute and Django (3,500 files) in 10 to 15 seconds. After the first query, searches answer in well under a second.

## Share the map in Elemnt

`spelunk publish` turns the map into an [Elemnt](https://github.com/ar-0911/elemnt) page: a hero with the headline numbers, the architecture diagram, cards for the main parts, sortable tables of commands, routes, settings and tests, and collapsible detail for every module and risk. Running it again updates the same page (Elemnt keeps the history), and does nothing when the map hasn't changed.

```sh
export ELEMNT_URL=https://docs.example.com ELEMNT_TOKEN=elm_...
spelunk publish --space eng                    # → /s/eng/codebase/<repo>
spelunk publish --space eng --path maps/api --draft
spelunk publish --dry-run > map.md             # just print the page source
```

To keep it current, run it in CI on every merge to main. [`examples/ci`](examples/ci) has a GitHub Actions workflow and a Bitbucket Pipelines file that publish on merge and add `spelunk impact` to every pull request. The dashboard's Share page does the same with a form.

## With Claude Code (MCP)

```sh
claude mcp add spelunk -- spelunk mcp
```

Claude Code starts the server in your project directory. It gets these tools: `overview`, `where`, `trace`, `file`, `module`, `dependencies`, `dependents`, `symbols`, `routes`, `env_vars`, `risks`, `lookup_error`, `impact`, `onboarding_tour` and `rescan`. They answer from the index instead of reading whole files, so Claude spends fewer tokens finding its way around. Before each answer the server checks `git status` and rescans only when something changed, reparsing just the changed files, so Claude sees its own edits without waiting on a scan every call. Outside git it rescans when the index is more than 20 seconds old.

For other MCP clients, run `spelunk mcp -C /path/to/repo` as a stdio server.

## Claude explanations

```sh
export ANTHROPIC_API_KEY=sk-ant-...
spelunk explain            # shows modules, tokens and cost; spends nothing
spelunk explain --yes      # runs it
spelunk map                # the guide now includes Claude's sections
```

Each module goes to Claude with its full source, or signatures only once it passes `--max-chars` (default 120,000 characters). Answers are cached in `.spelunk/cache` keyed by the files' content, so a re-run after a small change only pays for the modules that changed. Flow steps Claude names are checked against the index: steps that point at files that don't exist are dropped, and line numbers come from the index rather than from Claude. Elemnt (13,600 lines, 11 modules) estimates at about $1.20.

The model is `claude-opus-5-5`; set `SPELUNK_MODEL` to use another. Costs come from a price table per model, with cache reads and writes at their own rates. For a model the table doesn't know, Spelunk refuses to estimate rather than quote the wrong price: pass `--price-in` and `--price-out` (dollars per million tokens) or set `SPELUNK_PRICE_IN` and `SPELUNK_PRICE_OUT`. Every answer is checked against the JSON schema it was asked for; a wrong shape is retried once with the problem pointed out, then reported. Requests use the API's server-side fallback beta when it's available; set `SPELUNK_NO_FALLBACK=1` to leave it off.

## Languages

Symbols, imports and calls: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Scala, C#, Ruby, PHP, Swift, C, C++, Lua, Elixir, Dart, Zig and shell.

Imports resolve to files for TypeScript and JavaScript (including tsconfig paths and workspace packages), Python, Go (via go.mod), Rust, the JVM languages, Ruby, C and C++, and PHP (PSR-4).

Routes: Express, Hono, Fastify, Koa and similar, `fetch` and axios clients, Flask, FastAPI (with `APIRouter` prefixes), Django, Go `net/http`, gin and chi, Spring, axum, actix, Rails, Sinatra, Laravel and ASP.NET.

Project files: package.json, pyproject.toml, requirements.txt, setup.py, go.mod, Cargo.toml, pom.xml, Gradle, Gemfile, Dockerfiles, compose files, CI workflows, Makefiles and `.env` examples.

## How it works

```
scan     walk files (git ls-files when it's a repo) → tree-sitter on a worker pool → symbols, imports, calls
         + line patterns → routes, env vars, errors, logs, TODOs, entry points
         + manifests → commands, dependencies, documented env vars
         → resolve imports to files → .spelunk/index.jsonl
analyse  file graph → modules (directories, folded to ≤ 40) → risks, route matching
query    where (BM25 with synonyms) · trace (call trees from call sites + definitions)
explain  per-module prompts → Claude → overview prompt → .spelunk/explain.json
ask      Claude with search / trace / outline / read tools over the index → answer with path:line
report   HTML / Markdown / Elemnt / MCP / terminal / dashboard, all from the same Report model
```

Everything lives in `.spelunk/` inside the repository, with its own `.gitignore`, so nothing lands in your commits.

## Limits

- Call trees follow what the code says: import bindings (`import { x }`, `import * as m`, `export { }`, barrels, `require`), `this`/`self`, local definitions, `new Foo()` and the variables it's assigned to, JSX components, and handlers passed by name. `res.json()` isn't matched to an unrelated local `json`. A call through a parameter, an injected object or a string lookup can't be followed. Where only the name matched (languages whose imports don't say what they bind, like C or Ruby), the edge is marked "by name only", and each trace ends with how many calls resolved, went into packages, or couldn't be placed. Treat traces as a map, not a proof.
- Routes registered across files (for example `app.use("/api", router)` in Express, or gin route groups) keep the path written next to the handler, without the outer prefix. FastAPI and Flask router prefixes in the same file are applied.
- Risk findings are heuristics. "Orphan" means nothing imports the file and it isn't a known entry point; frameworks that load files by convention will show up there.
- Files over 1 MB, binaries, dependency folders, virtualenvs and build output are skipped. Build output (`dist`, `build`, `out`, `target`, …) is only skipped next to a project manifest, so a `src/build/` folder of real code is kept; in a git repository `.gitignore` decides, and only a committed `dist/` or `coverage/` is skipped. Symbolic links, and folders that are symlinks leading out of the repository, are never followed. `spelunk scan` and `spelunk map` print what was skipped and why.

## Development

```sh
pnpm test         # vitest: small TypeScript, Python and Go repos, explain with a fake Claude, MCP in memory, the dashboard's API
pnpm typecheck
pnpm dev where "something" -C ../some-repo
```
