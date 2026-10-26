import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Scan by URL: clone a repository from a link into ~/.spelunk/repos and keep
 * it updated. Accepts the web links people paste (…/tree/main, …/src/master)
 * as well as clone URLs. Private repos use a token sent as an HTTP header for
 * that one git call, so it is never written into .git/config or the URL.
 */

export interface RemoteRepo {
  host: string;
  /** "owner/repo", or "PROJECT/repo" for Bitbucket Data Center. */
  path: string;
  cloneUrl: string;
  /** A branch named in the pasted link, e.g. …/tree/dev. */
  branch?: string;
  ssh: boolean;
}

export function isRepoUrl(s: string): boolean {
  return /^(https?:\/\/|git@[\w.-]+:|ssh:\/\/)/.test(s.trim());
}

export function parseRepoUrl(input: string): RemoteRepo | undefined {
  const s = input.trim();
  const ssh = s.match(/^(?:ssh:\/\/)?git@([\w.-]+)(?::\d+)?[:/]([\w.\/-]+?)(?:\.git)?\/?$/);
  if (ssh) return { host: ssh[1]!, path: ssh[2]!, cloneUrl: s, ssh: true };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  // Bitbucket Data Center: /projects/P/repos/r/browse or /scm/p/r.git
  const dc = url.pathname.match(/^\/(?:projects\/([^/]+)\/repos\/([^/]+)|scm\/([^/]+)\/([^/]+?)(?:\.git)?)(?:\/|$)/);
  if (dc) {
    const project = (dc[1] ?? dc[3])!;
    const repo = (dc[2] ?? dc[4])!;
    const branch = url.searchParams.get("at")?.replace(/^refs\/heads\//, "");
    return { host: url.host, path: `${project}/${repo}`, cloneUrl: `${url.origin}/scm/${project.toLowerCase()}/${repo}.git`, ...(branch ? { branch } : {}), ssh: false };
  }
  // GitLab groups can nest; everything before "/-/" is the project.
  const dash = parts.indexOf("-");
  const repoParts = dash > 0 ? parts.slice(0, dash) : parts.slice(0, 2);
  if (repoParts.length < 2) return undefined;
  const rest = dash > 0 ? parts.slice(dash + 1) : parts.slice(2);
  // …/tree/<branch>, …/-/tree/<branch>, …/src/<branch> (Bitbucket), …/src/branch/<branch> (Gitea)
  let branch: string | undefined;
  if (rest[0] === "tree" || (rest[0] === "src" && rest[1] && rest[1] !== "branch")) branch = rest[1];
  if (rest[0] === "src" && rest[1] === "branch") branch = rest[2];
  if (branch && /^[0-9a-f]{40}$/.test(branch)) branch = undefined; // a commit, not a branch
  const path = repoParts.join("/");
  return { host: url.host, path, cloneUrl: `${url.origin}/${path}.git`, ...(branch ? { branch } : {}), ssh: false };
}

/** Token for a host from the environment, so CI and repeat runs don't need it typed. */
export function tokenFromEnv(host: string): string | undefined {
  const env = process.env;
  if (host.includes("github")) return env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (host.includes("gitlab")) return env.GITLAB_TOKEN;
  if (host.includes("bitbucket")) return env.BITBUCKET_TOKEN;
  return env.SPELUNK_GIT_TOKEN;
}

/** The Basic-auth user each host expects alongside an access token over HTTPS. */
function authHeader(host: string, token: string): string {
  if (token.includes(":")) return `Authorization: Basic ${Buffer.from(token).toString("base64")}`; // "user:app-password"
  const user = host.includes("github") ? "x-access-token" : host.includes("gitlab") ? "oauth2" : "x-token-auth";
  return `Authorization: Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
}

export const reposDir = () => process.env.SPELUNK_HOME ? join(process.env.SPELUNK_HOME, "repos") : join(homedir(), ".spelunk", "repos");

export interface CloneOptions {
  token?: string;
  onProgress?(message: string): void;
}

/** Clones (or updates) the repository and returns the local folder. */
export async function cloneRepo(input: string, options: CloneOptions = {}): Promise<string> {
  const repo = parseRepoUrl(input);
  if (!repo) throw new Error(`"${input}" doesn't look like a repository link. Paste a link like https://github.com/owner/repo or git@bitbucket.org:team/repo.git.`);
  const dir = join(reposDir(), repo.host.replace(/[^\w.-]/g, "_"), ...repo.path.split("/").map((p) => p.replace(/[^\w.-]/g, "_")));
  const token = options.token ?? (repo.ssh ? undefined : tokenFromEnv(repo.host));
  const config = [
    // Only real network transports; no ext::, file:// or other local protocols from a pasted link.
    "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.http.allow=always", "-c", "protocol.ssh.allow=always",
    ...(token ? ["-c", `http.extraHeader=${authHeader(repo.host, token)}`] : []),
  ];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const git = (args: string[], cwd?: string) =>
    run("git", [...config, ...args], { env, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000, ...(cwd ? { cwd } : {}) }).catch((err: { stderr?: string; message: string }) => {
      const msg = (err.stderr || err.message).replace(/Authorization: Basic \S+/g, "Authorization: ***");
      if (/Authentication failed|could not read Username|403|401|Repository not found|access denied|Permission denied/i.test(msg))
        throw new Error(`Couldn't access ${repo.host}/${repo.path}. If it's private, add an access token${repo.ssh ? " or check your SSH key" : ""}.`);
      throw new Error(`git failed: ${msg.trim().split("\n").slice(-3).join(" ")}`);
    });

  if (existsSync(join(dir, ".git"))) {
    options.onProgress?.(`Updating ${repo.host}/${repo.path}`);
    await git(["fetch", "--prune", "origin"], dir);
    const ref = repo.branch ? `origin/${repo.branch}` : "origin/HEAD";
    await git(["reset", "--hard", ref], dir).catch(async () => git(["reset", "--hard", "FETCH_HEAD"], dir));
  } else {
    options.onProgress?.(`Cloning ${repo.host}/${repo.path}`);
    await mkdir(join(dir, ".."), { recursive: true });
    // Blobless keeps history (for hotspots) without downloading every old file version.
    await git(["clone", "--filter=blob:none", "--no-tags", ...(repo.branch ? ["--branch", repo.branch] : []), "--", repo.cloneUrl, dir]);
  }
  return dir;
}
