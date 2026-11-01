#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { RiskKind } from "./analysis/risks.js";
import { ask, ClaudeAsk } from "./explain/ask.js";
import { Claude, ClaudeError, MODEL, costText } from "./explain/claude.js";
import { explain, explanationsPath, plan } from "./explain/explain.js";
import { formatFile, formatHits, formatModule, formatOverview, formatRisks, formatRoutes, formatSkipped, formatTrace } from "./format.js";
import { formatErrorLookup, lookupError } from "./query/errors.js";
import { agentsOnMap, braidState, errorTask, formatAgents, riskTask, startBraid } from "./integrations/braid.js";
import { parseFiles } from "./integrations/facts.js";
import { outlineFiles } from "./integrations/outline.js";
import { defaultBase, formatImpact, gitDiff, impact, mergeBase, snapshotRef } from "./query/impact.js";
import { resolveTarget, trace } from "./query/trace.js";
import { where, type Hit } from "./query/where.js";
import { publishToElemnt, renderElemnt } from "./report/elemnt.js";
import { renderHtml } from "./report/html.js";
import { renderMarkdown } from "./report/markdown.js";
import { buildReport } from "./report/model.js";
import { buildTour, formatTour } from "./report/tour.js";
import { cloneRepo, isRepoUrl } from "./scan/clone.js";
import { indexPath } from "./scan/scan.js";
import { openWorkspace } from "./workspace.js";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const HELP = `spelunk ${VERSION}: understand a codebase. Where code lives, how it's written, how it connects.

Usage: spelunk <command> [options]

Commands
  scan                 Index the repository (incremental; --full to start over)
  map                  Write the field guide: .spelunk/map.html, or SPELUNK.md with --format md
  where <words>        Find the code for a feature, error message, route or variable
  trace <target>       Follow a route ("POST /api/pages"), function or file: callers, calls, imports
  file <path>          Everything known about one file
  module <dir>         One module: files, dependencies, and Claude's summary if explained
  routes [filter]      HTTP routes and the client calls that hit them
  risks                Smells and risks: swallowed errors, cycles, hotspots, dead code, …
  error [text]         Paste a stack trace or log line (or pipe it in): find the code that raised it
  impact [base]        What this branch changes: functions, dependents, routes, tests to run (vs. main)
  tour                 A first-day walkthrough: what to run, which files to read, in order
  ask <question>       Claude answers from the code, citing file:line (needs ANTHROPIC_API_KEY)
  overview             The short version: modules, what depends on what, entry points, commands
  agents               With Braid: which parts of the code each agent is changing, and where they'll collide
  explain              Ask Claude for module summaries, flows and a debugging guide (shows cost first)
  publish              Publish the map as a page in Elemnt (create or update; for CI too)
  ui                   Open the dashboard in your browser: everything above, no commands needed
  serve                Run the dashboard as a public website: visitors paste public repo links and bring
                       their own Claude key (see deploy/README.md)
  mcp                  Run as an MCP server on stdio, for Claude Code and other agents
  setup claude         Make Claude Code use Spelunk in every project: registers the MCP server
                       and adds a "use Spelunk before grep" note to ~/.claude/CLAUDE.md (--dry-run)
  facts                For other tools: parse files sent as JSON on stdin, print symbols and calls
  outline              For other tools: split files sent as JSON on stdin into entities and class members

Options
  -C, --cwd <dir|url>  Repository to read: a folder, or a GitHub/GitLab/Bitbucket link to clone
                       (default: current directory)
  --git-token <token>  Token for cloning a private repository (or GITHUB_TOKEN, GITLAB_TOKEN,
                       BITBUCKET_TOKEN, SPELUNK_GIT_TOKEN)
  -o, --out <file>     map: where to write
  --format html|md     map: output format (default html). impact: md for a PR comment
  --kind <kind>        risks: only this kind (e.g. swallowed-error, hotspot, orphan); where: symbol, file, route or env
  --limit <n>          where/risks: how many results
  --depth <n>          trace: how deep to follow calls (default 2)
  --json               Print JSON instead of text (where, trace, risks, error, impact, tour, ask, overview, agents)
  --yes                explain: go ahead and spend tokens
  --max-modules <n>    explain: explain at most n modules (default 40)
  --max-chars <n>      explain: source characters sent per module (default 120000)
  --price-in <$>       explain, ask: input price per million tokens, for a model Spelunk doesn't know
  --price-out <$>      explain, ask: output price per million tokens
  --full               scan: reparse every file
  --only <dirs>        scan: only these folders, comma-separated (remembered; --only . resets)
  --workers <n>        scan: parser threads (default: one per core, up to 8)
  --working            impact: include uncommitted changes
  --head <rev>         impact: compare this commit instead of HEAD (the index must be of that commit)
  --agent <name>       impact: a Braid agent's work so far, uncommitted edits included
  --braid              risks, error: hand the findings to Braid as a task for an agent (braid start)
  --elemnt-url <url>   publish: your Elemnt server (or ELEMNT_URL); token from ELEMNT_TOKEN
  --space <slug>       publish: the space to publish into (or ELEMNT_SPACE)
  --path <path>        publish: page path in the space (default codebase/<repo name>)
  --draft              publish: save as a draft instead of publishing
  --dry-run            publish: print the page source instead of sending it. setup: say, don't do
  --port <n>           ui: port to listen on (default: any free port)
  --no-open            ui: don't open a browser, just print the link
  --allow-any-path     ui: let the folder picker go outside your home folder
  --host <addr>        serve: address to listen on (default 0.0.0.0); port from --port or PORT (default 8080)
  -h, --help, -v, --version
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cwd: { type: "string", short: "C" },
      out: { type: "string", short: "o" },
      format: { type: "string" },
      kind: { type: "string" },
      limit: { type: "string" },
      depth: { type: "string" },
      json: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      "max-modules": { type: "string" },
      "max-chars": { type: "string" },
      full: { type: "boolean" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      "git-token": { type: "string" },
      only: { type: "string", multiple: true },
      workers: { type: "string" },
      working: { type: "boolean" },
      head: { type: "string" },
      agent: { type: "string" },
      braid: { type: "boolean" },
      "elemnt-url": { type: "string" },
      space: { type: "string" },
      path: { type: "string" },
      draft: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "allow-any-path": { type: "boolean" },
      host: { type: "string" },
      "price-in": { type: "string" },
      "price-out": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = positionals;
  // Read when a cost is computed, so the flags work like the env vars.
  if (values["price-in"]) process.env.SPELUNK_PRICE_IN = values["price-in"];
  if (values["price-out"]) process.env.SPELUNK_PRICE_OUT = values["price-out"];
  if (values.version) return print(VERSION);
  if (values.help || !command) {
    print(HELP);
    return values.help ? 0 : 1;
  }

  let root = resolve(values.cwd ?? ".");
  if (values.cwd && isRepoUrl(values.cwd)) {
    root = await cloneRepo(values.cwd, { ...(values["git-token"] ? { token: values["git-token"] } : {}), onProgress: (m) => process.stderr.write(`${m}\n`) });
  }
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const progress = process.stderr.isTTY ? (done: number, total: number) => done % 50 === 0 && process.stderr.write(`\rReading files… ${done}/${total}`) : undefined;
  const open = async (refresh = true) => {
    // Every command rescans: unchanged files are reused by hash, so this is cheap and answers never go stale.
    const only = values.only?.flatMap((o) => o.split(",")).map((o) => o.trim());
    const ws = await openWorkspace(root, { refresh, ...(values.full ? { full: true } : {}), ...(only ? { only } : {}), ...(values.workers ? { workers: Number(values.workers) } : {}), ...(progress ? { onProgress: progress } : {}) });
    if (progress) process.stderr.write("\r\x1b[K");
    return ws;
  };
  const text = rest.join(" ").trim();

  switch (command) {
    case "scan": {
      const started = Date.now();
      const ws = await open();
      const ix = ws.index;
      const imports = ix.files.flatMap((f) => f.imports);
      const resolved = imports.filter((i) => i.targets.length || i.external).length;
      return print(
        `Indexed ${ix.files.length} files in ${((Date.now() - started) / 1000).toFixed(1)}s.\n${formatSkipped(ix.skipped)}\n` +
          `${ix.files.reduce((n, f) => n + f.symbols.length, 0)} symbols, ${imports.length} imports (${imports.length ? Math.round((resolved / imports.length) * 100) : 100}% resolved), ` +
          `${ix.files.reduce((n, f) => n + f.routes.length, 0)} routes.\nSaved ${relative(process.cwd(), indexPath(root))}`,
      );
    }
    case "map": {
      const ws = await open();
      const format = values.format ?? (values.out?.endsWith(".md") ? "md" : "html");
      if (format !== "html" && format !== "md") return fail(`--format must be html or md, not "${format}".`);
      const report = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
      const out = resolve(values.out ?? (format === "md" ? join(root, "SPELUNK.md") : join(root, ".spelunk", "map.html")));
      await mkdir(dirname(out), { recursive: true });
      const braid = format === "html" ? await braidState(root) : undefined;
      await writeFile(out, format === "md" ? renderMarkdown(report) : renderHtml(report, ws.index, braid && agentsOnMap(braid, report)));
      return print(`Wrote ${relative(process.cwd(), out) || out}\n${formatSkipped(ws.index.skipped)}${report.overview ? "" : "\nTip: run `spelunk explain` first for module summaries, flows and a debugging guide."}`);
    }
    case "where": {
      if (!text) return fail('Say what to look for: spelunk where "password reset email"');
      const ws = await open();
      const kinds = values.kind?.split(",").map((k) => k.trim());
      if (kinds?.some((k) => !["file", "symbol", "route", "env"].includes(k))) return fail("--kind for where is file, symbol, route or env (comma-separated).");
      const hits = where(ws.index, text, { limit: num(values.limit) ?? 15, ...(kinds ? { kinds: kinds as Hit["kind"][] } : {}) });
      return print(values.json ? JSON.stringify(hits, null, 2) : formatHits(text, hits));
    }
    case "trace": {
      if (!text) return fail('Say what to trace: a route ("POST /api/login"), a function name, or a file path.');
      const ws = await open();
      const targets = resolveTarget(ws.index, text);
      if (!targets.length) return fail(`Nothing called "${text}". Try \`spelunk where ${text}\`.`);
      const traces = targets.slice(0, 3).map((t) => trace(ws.index, ws.graph, t, { depth: num(values.depth) ?? 2 }));
      if (values.json) return print(JSON.stringify(traces, null, 2));
      const more = targets.length > 3 ? `\n\n${targets.length - 3} more matches: ${targets.slice(3, 10).map((t) => `${t.path}:${t.line ?? ""}`).join(", ")}` : "";
      return print(traces.map(formatTrace).join("\n\n────────\n\n") + more);
    }
    case "file": {
      if (!text) return fail("Which file? spelunk file src/server.ts");
      const ws = await open();
      const f = ws.index.files.find((x) => x.path === text) ?? ws.index.files.find((x) => x.path.endsWith(`/${text}`));
      return f ? print(formatFile(ws, f)) : fail(`No file "${text}" in the index.`);
    }
    case "module": {
      const ws = await open();
      const report = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
      const out = formatModule(report, text);
      return out ? print(out) : fail(`No module "${text}". Modules: ${report.modules.map((m) => m.path || "(root)").join(", ")}`);
    }
    case "routes": {
      const ws = await open();
      return print(formatRoutes(ws.index, text || undefined));
    }
    case "risks": {
      const ws = await open();
      const risks = await ws.risks();
      const opts = { ...(values.kind ? { kind: values.kind as RiskKind } : {}), ...(values.limit ? { limit: Number(values.limit) } : {}) };
      if (values.braid) {
        // One agent per kind of finding, so each task stays focused and small enough to review.
        const picked = (opts.kind ? risks.filter((r) => r.kind === opts.kind) : risks.filter((r) => r.severity === "high")).slice(0, opts.limit ?? 30);
        if (!picked.length) return fail(opts.kind ? `No ${opts.kind} risks.` : "No high-severity risks. Pick a kind with --kind.");
        const kinds = [...new Set(picked.map((r) => r.kind))];
        const started = await startBraid(root, { tasks: kinds.map((k) => riskTask(picked.filter((r) => r.kind === k))) });
        return print(`Started ${kinds.length} Braid agent${kinds.length === 1 ? "" : "s"} (${kinds.join(", ")}): ${started.command}\nWatch them with \`braid status --live\` or \`spelunk agents\`. Output: ${relative(process.cwd(), started.log)}`);
      }
      return print(values.json ? JSON.stringify(opts.kind ? risks.filter((r) => r.kind === opts.kind) : risks, null, 2) : formatRisks(risks, opts));
    }
    case "error": {
      // Piped in (`pbpaste | spelunk error`) or given as arguments.
      const input = text || (process.stdin.isTTY ? "" : await readStdin());
      if (!input.trim()) return fail('Paste the error: spelunk error "TypeError: x is undefined", or pipe a stack trace in.');
      const ws = await open();
      const result = lookupError(ws.index, ws.graph, input, await ws.risks());
      if (values.braid) {
        const started = await startBraid(root, { tasks: [errorTask(input, result)] });
        return print(`${formatErrorLookup(result)}\n\nStarted a Braid agent to fix it: ${started.command}\nWatch it with \`braid status --live\` or \`spelunk agents\`.`);
      }
      return print(values.json ? JSON.stringify(result, null, 2) : formatErrorLookup(result));
    }
    case "impact": {
      if (values.agent) {
        // A Braid agent's worktree, against where its branch split off its base, edits not yet committed included.
        const state = await braidState(root);
        if (!state) return fail("Braid isn't set up in this repository (or the braid command isn't installed).");
        const a = state.agents.find((x) => x.name === values.agent);
        if (!a) return fail(`No Braid agent "${values.agent}". Agents: ${state.agents.map((x) => x.name).join(", ") || "none"}.`);
        if (!existsSync(a.worktree)) return fail(`${a.name}'s worktree is gone (${a.status}).`);
        root = a.worktree;
        const ws = await open();
        const base = (await mergeBase(root, text || a.base)) ?? a.base;
        const diff = await gitDiff(root, base, { includeWorkingTree: true });
        const result = impact(ws.index, ws.graph, diff, await ws.risks(), { base: text || a.base, head: `${a.name} (${a.branch}, with uncommitted edits)` });
        return print(values.json ? JSON.stringify(result, null, 2) : formatImpact(result));
      }
      // Another branch's changes are read from that branch's own code, so functions and line numbers match it.
      const snap = values.head && !values.working ? await snapshotRef(root, values.head) : undefined;
      const ws = snap ? await openWorkspace(snap.dir, { refresh: true }) : await open();
      const base = text || (await defaultBase(root));
      const diff = await gitDiff(root, base, { ...(values.working ? { includeWorkingTree: true } : {}), ...(values.head ? { head: snap?.commit ?? values.head } : {}) });
      const result = impact(ws.index, ws.graph, diff, await ws.risks(), { base, head: values.working ? "working tree" : values.head || "HEAD" });
      return print(values.json ? JSON.stringify(result, null, 2) : formatImpact(result));
    }
    case "overview": {
      const ws = await open();
      const report = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
      if (!values.json) return print(formatOverview(report));
      const { name, commit, stats, languages, entries, commands, overview } = report;
      return print(JSON.stringify({ name, commit, stats, languages, entries, commands, overview, modules: report.modules.map((m) => ({ path: m.path, lines: m.lines, files: m.files.map((f) => f.path), dependsOn: m.dependsOn, summary: m.explanation?.summary ?? m.files.find((f) => f.doc)?.doc })) }, null, 2));
    }
    case "agents": {
      const state = await braidState(root);
      if (!state) return fail("Braid isn't set up in this repository, or the braid command isn't installed (https://github.com/ar-0911/braid).");
      const ws = await open();
      const map = agentsOnMap(state, buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations()));
      return print(values.json ? JSON.stringify(map, null, 2) : formatAgents(map));
    }
    case "facts": {
      // Stateless: no repository, no index. Reads {"files": [{path, text}]} from stdin.
      const input = process.stdin.isTTY ? "" : await readStdin();
      if (!input.trim()) return fail('Pipe JSON in: {"files": [{"path": "a.py", "text": "def f(): ..."}]}');
      return print(JSON.stringify(await parseFiles(JSON.parse(input))));
    }
    case "outline": {
      // Stateless, like facts. Braid's merge driver uses it to merge class by class and method by method.
      const input = process.stdin.isTTY ? "" : await readStdin();
      if (!input.trim()) return fail('Pipe JSON in: {"files": [{"path": "a.ts", "text": "class A {}"}]}');
      return print(JSON.stringify(await outlineFiles(JSON.parse(input))));
    }
    case "tour": {
      const ws = await open();
      const report = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
      const steps = buildTour(report);
      return print(values.json ? JSON.stringify(steps, null, 2) : formatTour(report, steps));
    }
    case "ask": {
      if (!text) return fail('Ask a question: spelunk ask "how does saving a page work?"');
      if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return fail("Set ANTHROPIC_API_KEY to use ask.");
      const ws = await open();
      const report = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
      try {
        const result = await ask(ws, new ClaudeAsk(), text, { overview: formatOverview(report), onStep: (s) => process.stderr.write(`  ${s.label}\n`) });
        if (values.json) return print(JSON.stringify(result, null, 2));
        return print(`\n${result.answer}\n\n(${result.steps.length} lookups, ${result.usage.calls} calls, ${costText(result.usage)})`);
      } catch (err) {
        if (err instanceof ClaudeError) return fail(err.message);
        throw err;
      }
    }
    case "publish": {
      const ws = await open();
      const report = buildReport(ws.index, ws.graph, await ws.risks(), await ws.explanations());
      const source = renderElemnt(report);
      if (values["dry-run"]) return print(source);
      const url = values["elemnt-url"] ?? process.env.ELEMNT_URL;
      const token = process.env.ELEMNT_TOKEN;
      const space = values.space ?? process.env.ELEMNT_SPACE;
      if (!url || !token || !space) return fail("publish needs your Elemnt server (--elemnt-url or ELEMNT_URL), an API token (ELEMNT_TOKEN) and a space (--space or ELEMNT_SPACE).");
      const slug = report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
      const result = await publishToElemnt(source, { url, token, space, path: values.path ?? `codebase/${slug}`, ...(values.draft ? { draft: true } : {}), message: `Spelunk map${report.commit ? ` at ${report.commit.slice(0, 10)}` : ""}` });
      return print(`${result.action === "unchanged" ? "Already up to date" : result.action === "created" ? "Created" : "Updated"}: ${result.url}`);
    }
    case "explain": {
      const ws = await open();
      const options = { ...(values["max-chars"] ? { maxChars: Number(values["max-chars"]) } : {}), ...(values["max-modules"] ? { maxModules: Number(values["max-modules"]) } : {}) };
      const p = await plan(ws.index, ws.graph, options);
      const summary = `${p.modules.length} modules, about ${Math.round(p.estimate.inputTokens / 1000)}k input and ${Math.round(p.estimate.outputTokens / 1000)}k output tokens on ${MODEL}: roughly $${p.estimate.dollars.toFixed(2)} (less if parts are cached from a previous run).`;
      if (!values.yes) return print(`${summary}\nRun \`spelunk explain --yes\` to go ahead. Results are cached, so re-runs only pay for modules that changed.`);
      if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return fail("Set ANTHROPIC_API_KEY to use explain.");
      process.stderr.write(`${summary}\n`);
      const claude = new Claude(join(root, ".spelunk", "cache"));
      try {
        await explain(ws.index, ws.graph, await ws.risks(), claude, { ...options, onProgress: (m) => process.stderr.write(`${m}\n`) });
      } catch (err) {
        if (err instanceof ClaudeError) return fail(err.message);
        throw err;
      }
      const u = claude.usage;
      return print(`Saved ${relative(process.cwd(), explanationsPath(root))}. ${u.calls} calls (${u.cached} cached), ${u.inputTokens.toLocaleString("en")} in / ${u.outputTokens.toLocaleString("en")} out, ${costText(u)}.\nNow run \`spelunk map\`.`);
    }
    case "ui": {
      const { startUi } = await import("./ui/server.js");
      // Started inside a project (or with -C), the dashboard opens it; otherwise it asks for a folder.
      const inProject = values.cwd !== undefined || existsSync(join(root, ".git")) || ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"].some((f) => existsSync(join(root, f)));
      const ui = await startUi({ ...(inProject ? { root } : {}), ...(values.port ? { port: Number(values.port) } : {}), open: !values["no-open"], ...(values["allow-any-path"] ? { allowAnyPath: true } : {}), log: (m) => process.stderr.write(`${m}\n`) });
      process.stdout.write(`Spelunk is running at ${ui.url}\nPress Ctrl+C to stop.\n`);
      return -1;
    }
    case "serve": {
      // A public site must never spend the operator's Claude credit or read private repos with their token.
      for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "GITLAB_TOKEN", "BITBUCKET_TOKEN", "SPELUNK_GIT_TOKEN"]) {
        if (process.env[name]) process.stderr.write(`Ignoring ${name}: visitors bring their own keys, and only public repositories are opened.\n`);
        delete process.env[name];
      }
      const { startUi } = await import("./ui/server.js");
      const list = (name: string) => process.env[name]?.split(",").map((x) => x.trim()).filter(Boolean);
      const int = (name: string) => (process.env[name] ? Number(process.env[name]) : undefined);
      const hosts = list("SPELUNK_ALLOWED_HOSTS");
      const opt = <T>(key: string, v: T | undefined) => (v === undefined ? {} : { [key]: v });
      const ui = await startUi({
        port: Number(values.port ?? process.env.PORT ?? 8080),
        open: false,
        hosted: { ...opt("host", values.host), ...opt("allowedHosts", hosts), ...opt("maxRepos", int("SPELUNK_MAX_REPOS")), ...opt("clonesPerHour", int("SPELUNK_CLONES_PER_HOUR")), ...opt("mcpDownloadsPerHour", int("SPELUNK_MCP_DOWNLOADS_PER_HOUR")) },
        log: (m) => process.stderr.write(`${m}\n`),
      });
      process.stdout.write(`Spelunk is serving on ${ui.url}\n`);
      return -1;
    }
    case "setup": {
      if (rest[0] !== "claude") return fail("Usage: spelunk setup claude [--dry-run]");
      const { setupClaude } = await import("./integrations/claude-setup.js");
      const r = await setupClaude({ ...(values["dry-run"] ? { dryRun: true } : {}) });
      const out = [...r.steps];
      if (r.manual.length) out.unshift("The claude command isn't on your PATH. Install Claude Code, then run:", ...r.manual.map((c) => `  ${c}`), "");
      if (!values["dry-run"]) out.push("", "Restart Claude Code (or run /mcp in it) to pick it up. Check with: claude mcp list");
      return print(out.join("\n"));
    }
    case "mcp": {
      const { serve } = await import("./mcp.js");
      await serve(root);
      return -1; // keep running
    }
    default:
      return fail(`Unknown command "${command}". Run spelunk --help.`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function print(s: string): number {
  process.stdout.write(`${s}\n`);
  return 0;
}

function fail(s: string): number {
  process.stderr.write(`${s}\n`);
  return 1;
}

// `spelunk map | head` closes stdout early; that's not an error.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    // Messages are written for people; the stack only helps when debugging Spelunk itself.
    process.stderr.write(`${err instanceof Error ? (process.env.SPELUNK_DEBUG ? (err.stack ?? err.message) : err.message) : String(err)}\n`);
    process.exitCode = 1;
  },
);
