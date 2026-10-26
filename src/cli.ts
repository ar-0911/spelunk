#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { RiskKind } from "./analysis/risks.js";
import { Claude, ClaudeError, estimateCost, MODEL } from "./explain/claude.js";
import { explain, explanationsPath, plan } from "./explain/explain.js";
import { formatFile, formatHits, formatModule, formatRisks, formatRoutes, formatTrace } from "./format.js";
import { resolveTarget, trace } from "./query/trace.js";
import { where } from "./query/where.js";
import { renderHtml } from "./report/html.js";
import { renderMarkdown } from "./report/markdown.js";
import { buildReport } from "./report/model.js";
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
  explain              Ask Claude for module summaries, flows and a debugging guide (shows cost first)
  mcp                  Run as an MCP server on stdio, for Claude Code and other agents

Options
  -C, --cwd <dir>      Repository to read (default: current directory)
  -o, --out <file>     map: where to write
  --format html|md     map: output format (default html)
  --kind <kind>        risks: only this kind (e.g. swallowed-error, hotspot, orphan)
  --limit <n>          where/risks: how many results
  --depth <n>          trace: how deep to follow calls (default 2)
  --json               Print JSON instead of text (where, trace, risks)
  --yes                explain: go ahead and spend tokens
  --max-modules <n>    explain: explain at most n modules (default 40)
  --max-chars <n>      explain: source characters sent per module (default 120000)
  --full               scan: reparse every file
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
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.version) return print(VERSION);
  if (values.help || !command) {
    print(HELP);
    return values.help ? 0 : 1;
  }

  const root = resolve(values.cwd ?? ".");
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const progress = process.stderr.isTTY ? (done: number, total: number) => done % 50 === 0 && process.stderr.write(`\rReading files… ${done}/${total}`) : undefined;
  const open = async (refresh = true) => {
    // Every command rescans: unchanged files are reused by hash, so this is cheap and answers never go stale.
    const ws = await openWorkspace(root, { refresh, ...(values.full ? { full: true } : {}), ...(progress ? { onProgress: progress } : {}) });
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
        `Indexed ${ix.files.length} files in ${((Date.now() - started) / 1000).toFixed(1)}s (${ix.skipped.length} skipped).\n` +
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
      await writeFile(out, format === "md" ? renderMarkdown(report) : renderHtml(report, ws.index));
      return print(`Wrote ${relative(process.cwd(), out) || out}${report.overview ? "" : "\nTip: run `spelunk explain` first for module summaries, flows and a debugging guide."}`);
    }
    case "where": {
      if (!text) return fail('Say what to look for: spelunk where "password reset email"');
      const ws = await open();
      const hits = where(ws.index, text, { limit: num(values.limit) ?? 15 });
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
      return print(values.json ? JSON.stringify(opts.kind ? risks.filter((r) => r.kind === opts.kind) : risks, null, 2) : formatRisks(risks, opts));
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
      return print(`Saved ${relative(process.cwd(), explanationsPath(root))}. ${u.calls} calls (${u.cached} cached), ${u.inputTokens.toLocaleString("en")} in / ${u.outputTokens.toLocaleString("en")} out, about $${estimateCost(u.inputTokens, u.outputTokens).toFixed(2)}.\nNow run \`spelunk map\`.`);
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

function print(s: string): number {
  process.stdout.write(`${s}\n`);
  return 0;
}

function fail(s: string): number {
  process.stderr.write(`${s}\n`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  },
);
