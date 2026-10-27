import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { RISK_INFO } from "../analysis/risks.js";
import { ask, ClaudeAsk, type AskResult, type AskStep } from "../explain/ask.js";
import { Claude, ClaudeError, MODEL, costText } from "../explain/claude.js";
import { explain, plan } from "../explain/explain.js";
import { formatOverview } from "../format.js";
import { agentMarks, agentsOnMap, braidHere, braidInstalled, braidState, errorTask, riskTask, startBraid } from "../integrations/braid.js";
import { lookupError } from "../query/errors.js";
import { defaultBase, gitDiff, impact, listBranches, mergeBase, snapshotRef } from "../query/impact.js";
import { resolveTarget, trace } from "../query/trace.js";
import { where, type Hit } from "../query/where.js";
import { diagramSvg } from "../report/diagram.js";
import { publishToElemnt, renderElemnt } from "../report/elemnt.js";
import { renderHtml } from "../report/html.js";
import { buildReport, type Report } from "../report/model.js";
import { buildTour } from "../report/tour.js";
import { cloneRepo, reposDir } from "../scan/clone.js";
import { openWorkspace, type Workspace } from "../workspace.js";
import { dashboardHtml } from "./page.js";

/**
 * `spelunk ui`: the same answers as the CLI in a browser, for people who'd
 * rather click than type. It listens on 127.0.0.1 only, and every API call
 * must carry the random token from the URL it prints, so other sites open
 * in the same browser can't read the repository through it. Folder browsing
 * stays inside the home folder unless --allow-any-path is given, so a leaked
 * link can't list the whole disk.
 */

export interface UiOptions {
  root?: string;
  port?: number;
  open?: boolean;
  /** Let the folder picker browse and open folders outside the home folder. */
  allowAnyPath?: boolean;
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

/** True when `path`, with every symlink followed, is `dir` or inside it. */
export async function within(dir: string, path: string): Promise<boolean> {
  const [d, p] = await Promise.all([realpath(dir).catch(() => resolve(dir)), realpath(path).catch(() => undefined)]);
  return Boolean(p && (p === d || p.startsWith(d.endsWith(sep) ? d : d + sep)));
}

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

  let jobStop: AbortController | undefined;
  /** Opens another folder. A running explain for the old one is stopped, so it can't overwrite the new one's results. */
  const switchTo = (dir: string) => {
    jobStop?.abort();
    jobStop = undefined;
    root = dir;
    ws = undefined;
    report = undefined;
    job = undefined;
    askJob = undefined;
  };

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

  // The folder picker's reach: the home folder, cloned repos, and the folder `spelunk ui` started in.
  // Braid: is it set up in the open folder (agents to show), and can tasks be handed to it?
  let braidCli: Promise<boolean> | undefined;
  const braidInfo = async () => {
    const here = root ? await braidHere(root) : false;
    const installed = await (braidCli ??= braidInstalled());
    // A downloaded copy in ~/.spelunk/repos is reset on the next open, which would throw agents' work away.
    const downloaded = root ? await within(reposDir(), root) : false;
    return { here, canStart: installed && Boolean(root) && !downloaded, downloaded };
  };

  const reachable = async (dir: string) =>
    options.allowAnyPath || (await within(homedir(), dir)) || (await within(reposDir(), dir)) || Boolean(options.root && (await within(options.root, dir)));
  const outside = (dir: string) => new HttpError(403, `${dir} is outside your home folder. Start Spelunk with --allow-any-path to open it.`);

  const routes: Record<string, (q: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>> = {
    "GET /api/state": async () => ({
      root: root ?? null,
      scanned: Boolean(ws),
      scanning: Boolean(scanning),
      hasEnvKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      model: MODEL,
      home: homedir(),
      braid: await braidInfo(),
    }),

    "POST /api/open": async (_q, body) => {
      const dir = typeof body.root === "string" ? resolve(body.root.replace(/^~(?=$|\/)/, homedir())) : "";
      const s = await stat(dir).catch(() => undefined);
      if (!s?.isDirectory()) throw new HttpError(400, `"${body.root}" isn't a folder on this computer.`);
      if (!(await reachable(dir))) throw outside(dir);
      switchTo(dir);
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
      switchTo(dir);
      await load(true);
      return { root };
    },

    "POST /api/rescan": async () => {
      await load(true);
      return { files: ws!.index.files.length };
    },

    "GET /api/browse": async (q) => {
      const dir = resolve((q.get("dir") || root || homedir()).replace(/^~(?=$|\/)/, homedir()));
      if (!(await reachable(dir))) throw outside(dir);
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
        throw new HttpError(400, `Can't read ${dir}.`);
      });
      const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => e.name).sort((a, b) => a.localeCompare(b));
      const looksLikeRepo = entries.some((e) => [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml"].includes(e.name));
      const up = dirname(dir);
      return { dir, parent: up !== dir && (await reachable(up)) ? up : null, dirs, looksLikeRepo };
    },

    "GET /api/report": async () => {
      const r = await getReport();
      const braid = root ? await braidState(root) : undefined;
      return { ...r, diagram: diagramSvg(r.modules, braid && agentMarks(agentsOnMap(braid, r))) };
    },

    "GET /api/agents": async () => {
      const state = root ? await braidState(root) : undefined;
      if (!state) return { here: false };
      return { here: true, ...agentsOnMap(state, await getReport()) };
    },

    "POST /api/braid/start": async (_q, body) => {
      const info = await braidInfo();
      if (info.downloaded) throw new HttpError(400, "This is a downloaded copy that Spelunk refreshes on the next open. Clone it yourself and open that folder to run agents on it.");
      if (!info.canStart) throw new HttpError(400, "The braid command isn't installed. Get it from https://github.com/ar-0911/braid.");
      const w = await load(false);
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
      const tasks: string[] = [];
      if (str("kind")) {
        const picked = (await w.risks()).filter((r) => r.kind === str("kind")).slice(0, 30);
        if (!picked.length) throw new HttpError(400, `No ${str("kind")} risks.`);
        tasks.push(riskTask(picked));
      }
      if (str("error")) tasks.push(errorTask(str("error"), lookupError(w.index, w.graph, str("error"), await w.risks())));
      if (Array.isArray(body.tasks)) tasks.push(...body.tasks.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.slice(0, 4000)));
      const goal = str("goal").slice(0, 4000);
      if (!tasks.length && !goal) throw new HttpError(400, "Say what the agents should do.");
      try {
        return await startBraid(w.index.root, goal && !tasks.length ? { goal, base: str("base") } : { tasks, base: str("base") });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
    },

    "GET /api/where": async (q) => {
      const w = await load(false);
      const kinds = (q.get("kind") ?? "").split(",").filter((k): k is Hit["kind"] => ["file", "symbol", "route", "env"].includes(k));
      return where(w.index, q.get("q") ?? "", { limit: 30, ...(kinds.length ? { kinds } : {}) });
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
      // The index can be older than the disk: a file swapped for a symlink since would otherwise be followed.
      const abs = join(w.index.root, f.path);
      const text = (await within(w.index.root, abs)) ? await readFile(abs, "utf8").catch(() => "") : "";
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
      const agentName = q.get("agent")?.trim();
      if (agentName) {
        // A Braid agent's work so far: its worktree, against where its branch split off, uncommitted edits included.
        const state = root ? await braidState(root) : undefined;
        const a = state?.agents.find((x) => x.name === agentName);
        if (!a) throw new HttpError(404, `No Braid agent "${agentName}".`);
        if (!(await stat(a.worktree).catch(() => undefined))) throw new HttpError(400, `${a.name}'s worktree is gone (${a.status}).`);
        const aw = await openWorkspace(a.worktree, { refresh: true });
        const base = (await mergeBase(a.worktree, a.base)) ?? a.base;
        const diff = await gitDiff(a.worktree, base, { includeWorkingTree: true }).catch((err: unknown) => {
          throw new HttpError(400, err instanceof Error ? err.message : String(err));
        });
        return { ...impact(aw.index, aw.graph, diff, await aw.risks(), { base: a.base, head: `${a.name} (with uncommitted edits)` }), agent: a.name };
      }
      const w = await load(false);
      const base = q.get("base")?.trim() || (await defaultBase(w.index.root));
      const headRef = q.get("head")?.trim() || "";
      const fail = (err: unknown) => {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      };
      // Another branch: diff against it, and read its own code from a snapshot, so line numbers and functions are that branch's.
      const snap = headRef ? await snapshotRef(w.index.root, headRef).catch(fail) : undefined;
      if (snap) {
        const sw = await openWorkspace(snap.dir, { refresh: true });
        const diff = await gitDiff(w.index.root, base, { head: snap.commit }).catch(fail);
        return impact(sw.index, sw.graph, diff, await sw.risks(), { base, head: headRef });
      }
      const working = q.get("working") === "1";
      const diff = await gitDiff(w.index.root, base, working ? { includeWorkingTree: true } : {}).catch(fail);
      const { current } = await listBranches(w.index.root);
      return impact(w.index, w.graph, diff, await w.risks(), { base, head: working ? `${current} with uncommitted edits` : current });
    },

    "GET /api/branches": async () => {
      const w = await load(false);
      return { ...(await listBranches(w.index.root)), base: await defaultBase(w.index.root) };
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
      const stop = new AbortController();
      jobStop = stop;
      const claude = new Claude(join(w.index.root, ".spelunk", "cache"), apiKey, stop.signal);
      const current: ExplainJob = { running: true, messages: ["Starting"] };
      job = current;
      void (async () => {
        try {
          await explain(w.index, w.graph, await w.risks(), claude, { onProgress: (m) => current.messages.push(m) });
          const u = claude.usage;
          current.summary = `${u.calls} calls (${u.cached} cached), ${u.inputTokens.toLocaleString("en")} tokens in, ${u.outputTokens.toLocaleString("en")} out, ${costText(u)}.`;
          if (job === current) report = undefined;
        } catch (err) {
          current.error = err instanceof ClaudeError ? err.message : err instanceof Error ? err.message : String(err);
        } finally {
          current.running = false;
          if (jobStop === stop) jobStop = undefined;
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

    const valid = (given: unknown) => typeof given === "string" && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
    const cookie = `spelunk_${port}`;
    const fromCookie = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${cookie}=`))?.slice(cookie.length + 1);

    if (req.method === "GET" && url.pathname === "/") {
      // The printed link carries the token once: it's swapped for a cookie the browser keeps for this
      // origin only (SameSite=Strict, so other sites can't send it), and the address bar loses it.
      if (url.searchParams.has("t")) {
        if (!valid(url.searchParams.get("t"))) throw new HttpError(401, "This link is out of date. Use the one Spelunk printed when it started.");
        res.writeHead(303, { location: "/", "set-cookie": `${cookie}=${token}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
        res.end();
        return;
      }
      if (!valid(fromCookie)) throw new HttpError(401, "Open Spelunk from the link it printed in the terminal.");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
      res.end(dashboardHtml());
      return;
    }
    // Scripts and tests may send the token as a header instead of the cookie.
    if (!valid(req.headers["x-spelunk-token"]) && !valid(fromCookie)) throw new HttpError(401, "Open Spelunk from the link it printed in the terminal.");

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
