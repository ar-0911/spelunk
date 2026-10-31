import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
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
import { cloneRepo, parseRepoUrl, repoDir, reposDir } from "../scan/clone.js";
import { openWorkspace, type Workspace } from "../workspace.js";
import { dashboardHtml } from "./page.js";

/**
 * `spelunk ui`: the same answers as the CLI in a browser, for people who'd
 * rather click than type. It listens on 127.0.0.1 only, and every API call
 * must carry the random token from the URL it prints, so other sites open
 * in the same browser can't read the repository through it. Folder browsing
 * stays inside the home folder unless --allow-any-path is given, so a leaked
 * link can't list the whole disk.
 *
 * `spelunk serve` runs the same dashboard as a public website (hosted mode).
 * There it has no folder picker, no Braid and no publishing: visitors paste a
 * public repository link, each browser gets its own session, and Claude
 * features use the key each visitor pastes, never one the server holds.
 */

export interface UiOptions {
  root?: string;
  port?: number;
  open?: boolean;
  /** Let the folder picker browse and open folders outside the home folder. */
  allowAnyPath?: boolean;
  log?(message: string): void;
  /** Run as a public website instead of a local tool. */
  hosted?: HostedOptions;
}

export interface HostedOptions {
  /** Address to listen on. Default 0.0.0.0. */
  host?: string;
  /** Code hosts visitors may download from. Default github.com, gitlab.com, bitbucket.org. */
  allowedHosts?: string[];
  /** Downloaded repositories kept on disk; the least recently opened go first. Default 30. */
  maxRepos?: number;
  /** Visitors remembered at once; the least recently seen go first. Default 500. */
  maxSessions?: number;
  /** A visitor's session ends after this long without a request. Default 2 hours. */
  sessionTtlMs?: number;
  /** Downloads one address may start in an hour. Default 20. */
  clonesPerHour?: number;
  /** A repository opened again within this long isn't fetched again. Default 10 minutes. */
  refetchAfterMs?: number;
  /** Downloads and scans running at once; the rest wait their turn. Default 2. */
  concurrentScans?: number;
}

/** One person's dashboard: the open repository and their Claude jobs. Local mode has exactly one. */
interface Session {
  root?: string | undefined;
  ws?: Workspace | undefined;
  report?: Report | undefined;
  scanning?: Promise<Workspace> | undefined;
  job?: ExplainJob | undefined;
  askJob?: AskJob | undefined;
  /** A key pasted for Ask is kept in memory for this session only, so follow-up questions don't ask again. */
  askKey?: string | undefined;
  jobStop?: AbortController | undefined;
  cloning?: boolean | undefined;
  seen: number;
}

/** A repository downloaded in hosted mode, shared by everyone who opens it. */
interface SharedRepo {
  fetchedAt: number;
  openedAt: number;
  ws?: Promise<Workspace> | undefined;
  fetching?: Promise<void> | undefined;
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

const PROJECT_MARKERS = new Set([".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "Gemfile", "composer.json", "requirements.txt", "setup.py", "mix.exs"]);

/** True when `path`, with every symlink followed, is `dir` or inside it. */
export async function within(dir: string, path: string): Promise<boolean> {
  const [d, p] = await Promise.all([realpath(dir).catch(() => resolve(dir)), realpath(path).catch(() => undefined)]);
  return Boolean(p && (p === d || p.startsWith(d.endsWith(sep) ? d : d + sep)));
}

export async function startUi(options: UiOptions = {}): Promise<{ url: string; close(): Promise<void> }> {
  const hosted = options.hosted;
  const token = randomBytes(18).toString("base64url");
  const local: Session = { ...(options.root ? { root: resolve(options.root) } : {}), seen: Date.now() };
  const sessions = new Map<string, Session>();
  const repos = new Map<string, SharedRepo>();
  const allowedCodeHosts = new Set(hosted?.allowedHosts ?? ["github.com", "gitlab.com", "bitbucket.org"]);
  const clonesByAddress = new Map<string, number[]>();
  let scansRunning = 0;
  const scanQueue: (() => void)[] = [];
  /** Hosted mode runs a few downloads and scans at a time, so one busy visitor can't starve the rest. */
  const turn = async <T>(work: () => Promise<T>): Promise<T> => {
    if (!hosted) return work();
    if (scansRunning >= (hosted.concurrentScans ?? 2)) await new Promise<void>((go) => scanQueue.push(go));
    scansRunning++;
    try {
      return await work();
    } finally {
      scansRunning--;
      scanQueue.shift()?.();
    }
  };

  /** Opens another folder. A running explain for the old one is stopped, so it can't overwrite the new one's results. */
  const switchTo = (s: Session, dir: string) => {
    s.jobStop?.abort();
    s.jobStop = undefined;
    s.root = dir;
    s.ws = undefined;
    s.report = undefined;
    s.job = undefined;
    s.askJob = undefined;
  };

  const load = async (s: Session, refresh: boolean): Promise<Workspace> => {
    if (!s.root) throw new HttpError(409, hosted ? "Paste a repository link first." : "Pick a folder first.");
    if (s.ws && !refresh) return s.ws;
    const root = s.root;
    if (hosted) {
      // Everyone who opens the same repository shares one scan of it.
      const shared = repos.get(root);
      if (!shared) throw new HttpError(409, "Paste a repository link first.");
      shared.ws ??= turn(() => openWorkspace(root, { refresh: true }));
      shared.ws.catch(() => {
        shared.ws = undefined;
      });
      const w = await shared.ws;
      if (s.root === root) {
        s.ws = w;
        s.report = undefined;
      }
      return w;
    }
    s.scanning ??= openWorkspace(root, { refresh: true })
      .then((w) => {
        s.ws = w;
        s.report = undefined;
        return w;
      })
      .finally(() => {
        s.scanning = undefined;
      });
    return s.scanning;
  };
  const getReport = async (s: Session): Promise<Report> => {
    const w = await load(s, false);
    s.report ??= buildReport(w.index, w.graph, await w.risks(), await w.explanations());
    return s.report;
  };

  /** Hosted mode: download a public repository (or reuse a recent copy) and free disk from the least recently opened. */
  const hostedClone = async (link: string): Promise<string> => {
    const remote = parseRepoUrl(link);
    if (!remote || remote.ssh) throw new HttpError(400, "Paste an https link to a public repository, like https://github.com/owner/repo.");
    if (!allowedCodeHosts.has(remote.host.toLowerCase())) throw new HttpError(400, `This Spelunk only downloads from ${[...allowedCodeHosts].join(", ")}.`);
    const dir = repoDir(remote);
    const now = Date.now();
    let shared = repos.get(dir);
    if (!shared) repos.set(dir, (shared = { fetchedAt: 0, openedAt: now }));
    shared.openedAt = now;
    if (!shared.fetching && now - shared.fetchedAt > (hosted?.refetchAfterMs ?? 10 * 60_000)) {
      const entry = shared;
      entry.fetching = turn(() => cloneRepo(link, { useEnvToken: false, timeoutMs: 3 * 60_000 }))
        .then(() => {
          entry.fetchedAt = Date.now();
          entry.ws = undefined; // the files changed, so scan again
        })
        .finally(() => {
          entry.fetching = undefined;
        });
    }
    try {
      await shared.fetching;
    } catch (err) {
      if (!shared.fetchedAt) repos.delete(dir);
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    await evictRepos();
    return dir;
  };

  const evictRepos = async () => {
    const max = hosted?.maxRepos ?? 30;
    if (repos.size <= max) return;
    const open = new Set([...sessions.values()].map((x) => x.root));
    const old = [...repos.entries()].filter(([dir, r]) => !open.has(dir) && !r.fetching).sort((a, b) => a[1].openedAt - b[1].openedAt);
    for (const [dir] of old.slice(0, repos.size - max)) {
      repos.delete(dir);
      if (await within(reposDir(), dir)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  /** Forgets sessions nobody has used for a while, and the scans only they were holding. */
  const sweep = () => {
    if (!hosted) return;
    const ttl = hosted.sessionTtlMs ?? 2 * 60 * 60_000;
    const now = Date.now();
    for (const [id, x] of sessions) if (now - x.seen > ttl) sessions.delete(id);
    const max = hosted.maxSessions ?? 500;
    if (sessions.size > max) [...sessions.entries()].sort((a, b) => a[1].seen - b[1].seen).slice(0, sessions.size - max).forEach(([id]) => sessions.delete(id));
    const open = new Set([...sessions.values()].map((x) => x.root));
    for (const [dir, r] of repos) if (!open.has(dir)) r.ws = undefined;
    for (const [addr, times] of clonesByAddress) if (!times.some((t) => now - t < 60 * 60_000)) clonesByAddress.delete(addr);
  };
  const sweeper = hosted ? setInterval(sweep, 5 * 60_000) : undefined;
  sweeper?.unref();

  const noLocal = (what: string) => new HttpError(403, `${what} only works when you run Spelunk on your own computer: npx spelunk-cli ui`);

  // The folder picker's reach: the home folder, cloned repos, and the folder `spelunk ui` started in.
  // Braid: is it set up in the open folder (agents to show), and can tasks be handed to it?
  let braidCli: Promise<boolean> | undefined;
  const braidInfo = async (s: Session) => {
    if (hosted) return { here: false, canStart: false, downloaded: true };
    const root = s.root;
    const here = root ? await braidHere(root) : false;
    const installed = await (braidCli ??= braidInstalled());
    // A downloaded copy in ~/.spelunk/repos is reset on the next open, which would throw agents' work away.
    const downloaded = root ? await within(reposDir(), root) : false;
    return { here, canStart: installed && Boolean(root) && !downloaded, downloaded };
  };

  const reachable = async (dir: string) =>
    options.allowAnyPath || (await within(homedir(), dir)) || (await within(reposDir(), dir)) || Boolean(options.root && (await within(options.root, dir)));
  const outside = (dir: string) => new HttpError(403, `${dir} is outside your home folder. Start Spelunk with --allow-any-path to open it.`);

  const routes: Record<string, (s: Session, q: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>> = {
    "GET /api/state": async (s) => ({
      root: s.root ?? null,
      scanned: Boolean(s.ws),
      scanning: Boolean(s.scanning),
      hasEnvKey: !hosted && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      model: MODEL,
      home: hosted ? "" : homedir(),
      hosted: Boolean(hosted),
      remote: hosted && s.root ? (s.ws?.index.remote ?? null) : null,
      braid: await braidInfo(s),
    }),

    "POST /api/open": async (s, _q, body) => {
      const dir = typeof body.root === "string" ? resolve(body.root.replace(/^~(?=$|\/)/, homedir())) : "";
      const found = await stat(dir).catch(() => undefined);
      if (!found?.isDirectory()) throw new HttpError(400, `"${body.root}" isn't a folder on this computer.`);
      if (!(await reachable(dir))) throw outside(dir);
      switchTo(s, dir);
      await load(s, true);
      return { root: s.root };
    },

    "POST /api/clone": async (s, _q, body) => {
      const link = typeof body.url === "string" ? body.url.trim() : "";
      if (!link) throw new HttpError(400, "Paste a repository link.");
      // The token is used for this clone only: never stored, logged or sent back.
      const gitToken = typeof body.token === "string" && body.token.trim() ? body.token.trim() : undefined;
      const dir = await cloneRepo(link, gitToken ? { token: gitToken } : {}).catch((err: unknown) => {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      });
      switchTo(s, dir);
      await load(s, true);
      return { root: s.root };
    },

    "POST /api/rescan": async (s) => {
      await load(s, true);
      return { files: s.ws!.index.files.length };
    },

    "GET /api/browse": async (s, q) => {
      const dir = resolve((q.get("dir") || s.root || homedir()).replace(/^~(?=$|\/)/, homedir()));
      if (!(await reachable(dir))) throw outside(dir);
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
        throw new HttpError(400, `Can't read ${dir}.`);
      });
      const names = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => e.name).sort((a, b) => a.localeCompare(b));
      // Mark folders that hold a project, so they can be opened straight from the list.
      const dirs = await Promise.all(
        names.slice(0, 500).map(async (name) => ({ name, project: await readdir(join(dir, name)).then((xs) => xs.some((x) => PROJECT_MARKERS.has(x)), () => false) })),
      );
      const looksLikeRepo = entries.some((e) => PROJECT_MARKERS.has(e.name));
      const up = dirname(dir);
      // Every folder from / down to this one, each clickable when the picker may go there.
      const crumbs: { name: string; path: string | null }[] = [];
      for (let p = dir; ; p = dirname(p)) {
        crumbs.unshift({ name: p === dirname(p) ? p : basename(p), path: (await reachable(p)) ? p : null });
        if (p === dirname(p)) break;
      }
      const shortcuts = [{ label: "Home", path: homedir() }];
      if (s.root) shortcuts.push({ label: "Current project", path: s.root }, { label: "Next to it", path: dirname(s.root) });
      if (await stat(reposDir()).then((x) => x.isDirectory(), () => false)) shortcuts.push({ label: "Downloaded repos", path: reposDir() });
      return { dir, parent: up !== dir && (await reachable(up)) ? up : null, dirs, looksLikeRepo, crumbs, shortcuts: (await Promise.all(shortcuts.map(async (x) => ((await reachable(x.path)) ? x : null)))).filter(Boolean) };
    },

    "GET /api/report": async (s) => {
      const r = await getReport(s);
      const braid = s.root ? await braidState(s.root) : undefined;
      return { ...r, diagram: diagramSvg(r.modules, braid && agentMarks(agentsOnMap(braid, r))) };
    },

    "GET /api/agents": async (s) => {
      const state = s.root ? await braidState(s.root) : undefined;
      if (!state) return { here: false };
      return { here: true, ...agentsOnMap(state, await getReport(s)) };
    },

    "POST /api/braid/start": async (s, _q, body) => {
      const info = await braidInfo(s);
      if (info.downloaded) throw new HttpError(400, "This is a downloaded copy that Spelunk refreshes on the next open. Clone it yourself and open that folder to run agents on it.");
      if (!info.canStart) throw new HttpError(400, "The braid command isn't installed. Get it from https://github.com/ar-0911/braid.");
      const w = await load(s, false);
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

    "GET /api/where": async (s, q) => {
      const w = await load(s, false);
      const kinds = (q.get("kind") ?? "").split(",").filter((k): k is Hit["kind"] => ["file", "symbol", "route", "env"].includes(k));
      return where(w.index, q.get("q") ?? "", { limit: 30, ...(kinds.length ? { kinds } : {}) });
    },

    "GET /api/trace": async (s, q) => {
      const w = await load(s, false);
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

    "GET /api/file": async (s, q) => {
      const w = await load(s, false);
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

    "GET /api/risk-info": async (s) => RISK_INFO,

    "GET /api/tour": async (s) => buildTour(await getReport(s)),

    "POST /api/error": async (s, _q, body) => {
      const w = await load(s, false);
      const input = typeof body.text === "string" ? body.text : "";
      if (!input.trim()) throw new HttpError(400, "Paste an error message or stack trace.");
      return lookupError(w.index, w.graph, input, await w.risks());
    },

    "GET /api/impact": async (s, q) => {
      const agentName = q.get("agent")?.trim();
      if (agentName) {
        // A Braid agent's work so far: its worktree, against where its branch split off, uncommitted edits included.
        const state = s.root ? await braidState(s.root) : undefined;
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
      const w = await load(s, false);
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

    "GET /api/branches": async (s) => {
      const w = await load(s, false);
      return { ...(await listBranches(w.index.root)), base: await defaultBase(w.index.root) };
    },

    "POST /api/ask": async (s, _q, body) => {
      const w = await load(s, false);
      if (s.askJob?.running) throw new HttpError(409, "Claude is still answering the last question.");
      const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
      if (!question) throw new HttpError(400, "Type a question.");
      if (typeof body.apiKey === "string" && body.apiKey.trim()) s.askKey = body.apiKey.trim();
      if (!s.askKey && (hosted || (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN))) throw new HttpError(400, hosted ? "Paste your Anthropic API key." : "Paste an Anthropic API key, or start Spelunk with ANTHROPIC_API_KEY set.");
      const history = Array.isArray(body.history)
        ? (body.history as { question?: unknown; answer?: unknown }[]).slice(-6).flatMap((h) => (typeof h.question === "string" && typeof h.answer === "string" ? [{ question: h.question, answer: h.answer }] : []))
        : [];
      const r = await getReport(s);
      const current: AskJob = { running: true, question, steps: [] };
      s.askJob = current;
      void ask(w, new ClaudeAsk(s.askKey), question, { history, overview: formatOverview(r), onStep: (s) => current.steps.push(s) })
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

    "GET /api/ask/status": async (s) => s.askJob ?? { running: false, steps: [] },

    "POST /api/publish": async (s, _q, body) => {
      const r = await getReport(s);
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

    "GET /api/publish/defaults": async (s) => ({ url: process.env.ELEMNT_URL ?? "", space: process.env.ELEMNT_SPACE ?? "", hasToken: Boolean(process.env.ELEMNT_TOKEN) }),

    "GET /api/explain/plan": async (s) => {
      const w = await load(s, false);
      const p = await plan(w.index, w.graph);
      return { modules: p.modules.map((m) => ({ path: m.module.path, files: m.module.files.length, chars: m.chars })), estimate: p.estimate, model: MODEL };
    },

    "POST /api/explain": async (s, _q, body) => {
      const w = await load(s, false);
      if (s.job?.running) throw new HttpError(409, "Claude is already explaining this repository.");
      const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
      if (!apiKey && (hosted || (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN))) throw new HttpError(400, hosted ? "Paste your Anthropic API key." : "Paste an Anthropic API key, or start Spelunk with ANTHROPIC_API_KEY set.");
      // The key lives only in this object for this run; it is never written to disk or sent back.
      const stop = new AbortController();
      s.jobStop = stop;
      const claude = new Claude(join(w.index.root, ".spelunk", "cache"), apiKey, stop.signal);
      const current: ExplainJob = { running: true, messages: ["Starting"] };
      s.job = current;
      void (async () => {
        try {
          await explain(w.index, w.graph, await w.risks(), claude, { onProgress: (m) => current.messages.push(m) });
          const u = claude.usage;
          current.summary = `${u.calls} calls (${u.cached} cached), ${u.inputTokens.toLocaleString("en")} tokens in, ${u.outputTokens.toLocaleString("en")} out, ${costText(u)}.`;
          if (s.job === current) s.report = undefined;
        } catch (err) {
          current.error = err instanceof ClaudeError ? err.message : err instanceof Error ? err.message : String(err);
        } finally {
          current.running = false;
          if (s.jobStop === stop) s.jobStop = undefined;
        }
      })();
      return { started: true };
    },

    "GET /api/explain/status": async (s) => s.job ?? { running: false, messages: [] },
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) options.log?.(err instanceof Error ? (err.stack ?? err.message) : String(err));
      // Never let one bad request take the server down for everyone.
      if (res.headersSent) return void res.destroy();
      send(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  let port = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  /** Hosted mode: what a public site must not do, and downloads limited to public links. */
  if (hosted) {
    for (const key of ["POST /api/open", "GET /api/browse", "POST /api/braid/start", "POST /api/publish"]) {
      const what = key.includes("braid") ? "Running Braid agents" : key.includes("publish") ? "Publishing to Elemnt" : "Opening a folder";
      routes[key] = async () => {
        throw noLocal(what);
      };
    }
    routes["GET /api/publish/defaults"] = async () => ({ url: "", space: "", hasToken: false });
    routes["GET /api/agents"] = async () => ({ here: false });
    routes["POST /api/rescan"] = async (s) => ({ files: (await load(s, false)).index.files.length });
    const impactRoute = routes["GET /api/impact"]!;
    routes["GET /api/impact"] = async (s, q, body) => {
      if (q.get("agent")) throw noLocal("Following Braid agents");
      return impactRoute(s, q, body);
    };
    routes["POST /api/clone"] = async (s, _q, body) => {
      const link = typeof body.url === "string" ? body.url.trim() : "";
      if (!link) throw new HttpError(400, "Paste a repository link.");
      if (typeof body.token === "string" && body.token.trim()) throw new HttpError(400, "This Spelunk only opens public repositories, so it doesn't take access tokens. Run it on your own computer for private ones: npx spelunk-cli ui");
      if (s.cloning) throw new HttpError(409, "Still downloading the last link.");
      const addr = (body.__address as string) ?? "";
      const now = Date.now();
      const recent = (clonesByAddress.get(addr) ?? []).filter((t) => now - t < 60 * 60_000);
      if (recent.length >= (hosted.clonesPerHour ?? 20)) throw new HttpError(429, "That's a lot of repositories in an hour. Try again later, or run Spelunk on your own computer: npx spelunk-cli ui");
      clonesByAddress.set(addr, [...recent, now]);
      s.cloning = true;
      try {
        const dir = await hostedClone(link);
        switchTo(s, dir);
        await load(s, false);
        return { root: s.root };
      } finally {
        s.cloning = false;
      }
    };
  }

  /** Who is asking. Local mode: whoever holds the token. Hosted mode: the browser's session cookie, made on first visit. */
  const sessionFor = (req: IncomingMessage, res: ServerResponse, url: URL): Session | undefined => {
    const cookies = (req.headers.cookie ?? "").split(/;\s*/);
    const read = (name: string) => cookies.find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!hosted) {
      const valid = (given: unknown) => typeof given === "string" && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
      const cookie = `spelunk_${port}`;
      if (req.method === "GET" && url.pathname === "/" && url.searchParams.has("t")) {
        // The printed link carries the token once: it's swapped for a cookie the browser keeps for this
        // origin only (SameSite=Strict, so other sites can't send it), and the address bar loses it.
        if (!valid(url.searchParams.get("t"))) throw new HttpError(401, "This link is out of date. Use the one Spelunk printed when it started.");
        res.writeHead(303, { location: "/", "set-cookie": `${cookie}=${token}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
        res.end();
        return undefined;
      }
      // Scripts and tests may send the token as a header instead of the cookie.
      if (!valid(req.headers["x-spelunk-token"]) && !valid(read(cookie))) throw new HttpError(401, "Open Spelunk from the link it printed in the terminal.");
      return local;
    }
    const id = read("spelunk_sid");
    let s = id ? sessions.get(id) : undefined;
    if (!s) {
      if (!(req.method === "GET" && url.pathname === "/")) throw new HttpError(401, "Your session ended. Reload the page.");
      const fresh = randomBytes(24).toString("base64url");
      s = { seen: Date.now() };
      sessions.set(fresh, s);
      sweep();
      // SameSite=Lax keeps the cookie off other sites' requests; POSTs must be JSON, which needs a CORS preflight we never answer.
      res.setHeader("set-cookie", `spelunk_sid=${fresh}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.round((hosted.sessionTtlMs ?? 2 * 60 * 60_000) / 1000)}`);
    }
    s.seen = Date.now();
    return s;
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A page on another site can point a hostname at 127.0.0.1 (DNS rebinding); only our own Host gets answers.
    if (!hosted && !allowedHosts().has(req.headers.host ?? "")) throw new HttpError(403, "Wrong host.");
    const url = new URL(req.url ?? "/", "http://spelunk.local");
    if (hosted && req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    const s = sessionFor(req, res, url);
    if (!s) return;

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      res.end(dashboardHtml());
      return;
    }
    if (req.method === "GET" && url.pathname === "/guide") {
      const w = await load(s, false);
      const page = renderHtml(await getReport(s), w.index);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      res.end(page);
      return;
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new HttpError(404, "Not found.");
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
      const parsed: unknown = JSON.parse((await readBody(req)) || "{}");
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
      delete body.__address;
      if (hosted) body.__address = clientAddress(req);
    }
    send(res, 200, await route(s, url.searchParams, body));
  }

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, hosted ? (hosted.host ?? "0.0.0.0") : "127.0.0.1", () => ok());
  });
  port = (server.address() as { port: number }).port;
  const url = hosted ? `http://${hosted.host && hosted.host !== "0.0.0.0" ? hosted.host : "localhost"}:${port}/` : `http://127.0.0.1:${port}/?t=${token}`;
  if (local.root && !hosted) void load(local, true).catch(() => undefined); // start indexing while the browser opens
  if (options.open !== false && !hosted) openBrowser(url);
  return {
    url,
    close: () =>
      new Promise((ok) => {
        if (sweeper) clearInterval(sweeper);
        server.close(() => ok());
      }),
  };
}

/** The visitor's address, for rate limits. Behind Cloudflare it's in CF-Connecting-IP. */
function clientAddress(req: IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "";
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
