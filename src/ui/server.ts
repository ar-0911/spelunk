import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { RISK_INFO } from "../analysis/risks.js";
import { ask, ClaudeAsk, type AskResult, type AskStep } from "../explain/ask.js";
import { Claude, ClaudeError, estimateCost, MODEL } from "../explain/claude.js";
import { explain, plan } from "../explain/explain.js";
import { formatOverview } from "../format.js";
import { lookupError } from "../query/errors.js";
import { defaultBase, gitDiff, impact } from "../query/impact.js";
import { resolveTarget, trace } from "../query/trace.js";
import { where } from "../query/where.js";
import { diagramSvg } from "../report/diagram.js";
import { publishToElemnt, renderElemnt } from "../report/elemnt.js";
import { renderHtml } from "../report/html.js";
import { buildReport, type Report } from "../report/model.js";
import { buildTour } from "../report/tour.js";
import { cloneRepo } from "../scan/clone.js";
import { openWorkspace, type Workspace } from "../workspace.js";
import { dashboardHtml } from "./page.js";

/**
 * `spelunk ui`: the same answers as the CLI in a browser, for people who'd
 * rather click than type. It listens on 127.0.0.1 only, and every API call
 * must carry the random token from the URL it prints, so other sites open
 * in the same browser can't read the repository through it.
 */

export interface UiOptions {
  root?: string;
  port?: number;
  open?: boolean;
  log?(message: string): void;
}

interface ExplainJob {
  running: boolean;
  messages: string[];
  error?: string;
  summary?: string;
}

interface AskJob {
  running: boolean;
  question: string;
  steps: AskStep[];
  result?: AskResult;
  error?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_SOURCE = 400_000;

export async function startUi(options: UiOptions = {}): Promise<{ url: string; close(): Promise<void> }> {
  const token = randomBytes(18).toString("base64url");
  let root = options.root ? resolve(options.root) : undefined;
  let ws: Workspace | undefined;
  let report: Report | undefined;
  let scanning: Promise<Workspace> | undefined;
  let job: ExplainJob | undefined;
  let askJob: AskJob | undefined;
  // A key pasted for Ask is kept in memory for this session only, so follow-up questions don't ask again.
  let askKey: string | undefined;

  const load = async (refresh: boolean): Promise<Workspace> => {
    if (!root) throw new HttpError(409, "Pick a folder first.");
    if (ws && !refresh) return ws;
    scanning ??= openWorkspace(root, { refresh: true })
      .then((w) => {
        ws = w;
        report = undefined;
        return w;
      })
      .finally(() => {
        scanning = undefined;
      });
    return scanning;
  };
  const getReport = async (): Promise<Report> => {
    const w = await load(false);
    report ??= buildReport(w.index, w.graph, await w.risks(), await w.explanations());
    return report;
  };

  const routes: Record<string, (q: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>> = {
    "GET /api/state": async () => ({
      root: root ?? null,
      scanned: Boolean(ws),
      scanning: Boolean(scanning),
      hasEnvKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      model: MODEL,
      home: homedir(),
    }),

    "POST /api/open": async (_q, body) => {
      const dir = typeof body.root === "string" ? resolve(body.root.replace(/^~(?=$|\/)/, homedir())) : "";
      const s = await stat(dir).catch(() => undefined);
      if (!s?.isDirectory()) throw new HttpError(400, `"${body.root}" isn't a folder on this computer.`);
      root = dir;
      ws = undefined;
      report = undefined;
      job = undefined;
      askJob = undefined;
      await load(true);
      return { root };
    },

    "POST /api/clone": async (_q, body) => {
      const link = typeof body.url === "string" ? body.url.trim() : "";
      if (!link) throw new HttpError(400, "Paste a repository link.");
      // The token is used for this clone only: never stored, logged or sent back.
      const gitToken = typeof body.token === "string" && body.token.trim() ? body.token.trim() : undefined;
      const dir = await cloneRepo(link, gitToken ? { token: gitToken } : {}).catch((err: unknown) => {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      });
      root = dir;
      ws = undefined;
      report = undefined;
      job = undefined;
      askJob = undefined;
      await load(true);
      return { root };
    },

    "POST /api/rescan": async () => {
      await load(true);
      return { files: ws!.index.files.length };
    },

    "GET /api/browse": async (q) => {
      const dir = resolve((q.get("dir") || root || homedir()).replace(/^~(?=$|\/)/, homedir()));
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
        throw new HttpError(400, `Can't read ${dir}.`);
      });
      const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => e.name).sort((a, b) => a.localeCompare(b));
      const looksLikeRepo = entries.some((e) => [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml"].includes(e.name));
      return { dir, parent: dirname(dir) === dir ? null : dirname(dir), dirs, looksLikeRepo };
    },

    "GET /api/report": async () => {
      const r = await getReport();
      return { ...r, diagram: diagramSvg(r.modules) };
    },

    "GET /api/where": async (q) => {
      const w = await load(false);
      return where(w.index, q.get("q") ?? "", { limit: 30 });
    },

    "GET /api/trace": async (q) => {
      const w = await load(false);
      const wanted = (q.get("target") ?? "").trim();
      const all = resolveTarget(w.index, wanted);
      // "PUT /api/pages/:id" also matches catch-alls like "ALL *"; when the route exists as typed, show just that.
      const exact = all.filter((t) => t.label.toLowerCase() === wanted.toLowerCase());
      const targets = exact.length ? exact : all;
      return {
        traces: targets.slice(0, 3).map((t) => trace(w.index, w.graph, t, { depth: Number(q.get("depth")) || 2 })),
        more: targets.slice(3, 15).map((t) => ({ label: t.label, path: t.path, line: t.line ?? null })),
      };
    },

    "GET /api/file": async (q) => {
      const w = await load(false);
      const path = q.get("path") ?? "";
      // Only files in the index can be read, which keeps requests inside the repository.
      const f = w.index.files.find((x) => x.path === path);
      if (!f) throw new HttpError(404, `No file "${path}" in this repository.`);
      const text = await readFile(join(w.index.root, f.path), "utf8").catch(() => "");
      return {
        facts: f,
        importedBy: [...(w.graph.in.get(f.path) ?? [])].sort(),
        imports: [...(w.graph.out.get(f.path) ?? [])].sort(),
        source: text.length > MAX_SOURCE ? `${text.slice(0, MAX_SOURCE)}\n… (truncated)` : text,
      };
    },

    "GET /api/risk-info": async () => RISK_INFO,

    "GET /api/tour": async () => buildTour(await getReport()),

    "POST /api/error": async (_q, body) => {
      const w = await load(false);
      const input = typeof body.text === "string" ? body.text : "";
      if (!input.trim()) throw new HttpError(400, "Paste an error message or stack trace.");
      return lookupError(w.index, w.graph, input, await w.risks());
    },

    "GET /api/impact": async (q) => {
      const w = await load(false);
      const base = q.get("base")?.trim() || (await defaultBase(w.index.root));
      const working = q.get("working") === "1";
      const diff = await gitDiff(w.index.root, base, working ? { includeWorkingTree: true } : {}).catch((err: unknown) => {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      });
      return impact(w.index, w.graph, diff, await w.risks(), { base, head: working ? "working tree" : "HEAD" });
    },

    "POST /api/ask": async (_q, body) => {
      const w = await load(false);
      if (askJob?.running) throw new HttpError(409, "Claude is still answering the last question.");
      const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
      if (!question) throw new HttpError(400, "Type a question.");
      if (typeof body.apiKey === "string" && body.apiKey.trim()) askKey = body.apiKey.trim();
      if (!askKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new HttpError(400, "Paste an Anthropic API key, or start Spelunk with ANTHROPIC_API_KEY set.");
      const history = Array.isArray(body.history)
        ? (body.history as { question?: unknown; answer?: unknown }[]).slice(-6).flatMap((h) => (typeof h.question === "string" && typeof h.answer === "string" ? [{ question: h.question, answer: h.answer }] : []))
        : [];
      const r = await getReport();
      const current: AskJob = { running: true, question, steps: [] };
      askJob = current;
      void ask(w, new ClaudeAsk(askKey), question, { history, overview: formatOverview(r), onStep: (s) => current.steps.push(s) })
        .then((result) => {
          current.result = result;
        })
        .catch((err: unknown) => {
          current.error = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          current.running = false;
        });
      return { started: true };
    },

    "GET /api/ask/status": async () => askJob ?? { running: false, steps: [] },

    "POST /api/publish": async (_q, body) => {
      const r = await getReport();
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
      const url = str("url") || process.env.ELEMNT_URL || "";
      const elemntToken = str("token") || process.env.ELEMNT_TOKEN || "";
      const space = str("space") || process.env.ELEMNT_SPACE || "";
      if (!url || !elemntToken || !space) throw new HttpError(400, "Fill in the Elemnt address, an API token and the space.");
      const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
      try {
        return await publishToElemnt(renderElemnt(r), { url, token: elemntToken, space, path: str("path") || `codebase/${slug}`, draft: body.draft === true, message: `Spelunk map${r.commit ? ` at ${r.commit.slice(0, 10)}` : ""}` });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
    },

    "GET /api/publish/defaults": async () => ({ url: process.env.ELEMNT_URL ?? "", space: process.env.ELEMNT_SPACE ?? "", hasToken: Boolean(process.env.ELEMNT_TOKEN) }),

    "GET /api/explain/plan": async () => {
      const w = await load(false);
      const p = await plan(w.index, w.graph);
      return { modules: p.modules.map((m) => ({ path: m.module.path, files: m.module.files.length, chars: m.chars })), estimate: p.estimate, model: MODEL };
    },

    "POST /api/explain": async (_q, body) => {
      const w = await load(false);
      if (job?.running) throw new HttpError(409, "Claude is already explaining this repository.");
      const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
      if (!apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new HttpError(400, "Paste an Anthropic API key, or start Spelunk with ANTHROPIC_API_KEY set.");
      // The key lives only in this object for this run; it is never written to disk or sent back.
      const claude = new Claude(join(w.index.root, ".spelunk", "cache"), apiKey);
      const current: ExplainJob = { running: true, messages: ["Starting"] };
      job = current;
      void (async () => {
        try {
          await explain(w.index, w.graph, await w.risks(), claude, { onProgress: (m) => current.messages.push(m) });
          const u = claude.usage;
          current.summary = `${u.calls} calls (${u.cached} cached), ${u.inputTokens.toLocaleString("en")} tokens in, ${u.outputTokens.toLocaleString("en")} out, about $${estimateCost(u.inputTokens, u.outputTokens).toFixed(2)}.`;
          report = undefined;
        } catch (err) {
          current.error = err instanceof ClaudeError ? err.message : err instanceof Error ? err.message : String(err);
        } finally {
          current.running = false;
        }
      })();
      return { started: true };
    },

    "GET /api/explain/status": async () => job ?? { running: false, messages: [] },
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) options.log?.(err instanceof Error ? (err.stack ?? err.message) : String(err));
      send(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  let port = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A page on another site can point a hostname at 127.0.0.1 (DNS rebinding); only our own Host gets answers.
    if (!allowedHosts().has(req.headers.host ?? "")) throw new HttpError(403, "Wrong host.");
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
      res.end(dashboardHtml());
      return;
    }
    const given = req.headers["x-spelunk-token"] ?? url.searchParams.get("t") ?? "";
    if (typeof given !== "string" || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) throw new HttpError(401, "Open Spelunk from the link it printed in the terminal.");

    if (req.method === "GET" && url.pathname === "/guide") {
      const w = await load(false);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end(renderHtml(await getReport(), w.index));
      return;
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new HttpError(404, "Not found.");
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
      body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
    }
    send(res, 200, await route(url.searchParams, body));
  }

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, "127.0.0.1", () => ok());
  });
  port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  if (root) void load(true).catch(() => undefined); // start indexing while the browser opens
  if (options.open !== false) openBrowser(url);
  return { url, close: () => new Promise((ok) => server.close(() => ok())) };
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64_000) throw new HttpError(413, "Request too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // No browser launcher: the URL is printed in the terminal anyway.
  }
}
