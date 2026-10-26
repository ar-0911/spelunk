import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Directories that are never the code you want to understand. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "coverage",
  "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages",
  ".gradle", ".idea", ".vscode", "bower_components", ".spelunk", ".terraform", "Pods", ".dart_tool", "_build", "deps",
]);

const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|uv\.lock)$|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|wasm|woff2?|ttf|otf|eot|mp[34]|mov|webm|so|dylib|dll|exe|bin|class|jar|pyc|db|sqlite3?|snap)$/i;

export interface Git {
  isRepo: boolean;
  head?: string;
  remote?: string;
}

/** git@github.com:o/r.git or https://github.com/o/r.git → https://github.com/o/r */
export function webUrl(remote: string): string | undefined {
  const m = remote.trim().match(/^(?:git@|ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)([^:/]+)[:/](.+?)(?:\.git)?\/?$/);
  if (!m || !/(github|gitlab|bitbucket|codeberg)\./.test(m[1]!)) return undefined;
  return `https://${m[1]}/${m[2]!.replace(/^git\//, "")}`;
}

export async function gitInfo(root: string): Promise<Git> {
  try {
    const { stdout } = await run("git", ["-C", root, "rev-parse", "HEAD"]);
    const remote = await run("git", ["-C", root, "config", "--get", "remote.origin.url"]).then((r) => webUrl(r.stdout), () => undefined);
    return { isRepo: true, head: stdout.trim(), ...(remote ? { remote } : {}) };
  } catch {
    try {
      await run("git", ["-C", root, "rev-parse", "--git-dir"]);
      return { isRepo: true };
    } catch {
      return { isRepo: false };
    }
  }
}

/** Repo-relative paths (always "/"-separated) of files worth reading, honouring .gitignore when there is one. */
export async function listFiles(root: string, git: Git): Promise<string[]> {
  let files: string[];
  if (git.isRepo) {
    const { stdout } = await run("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], { maxBuffer: 256 * 1024 * 1024 });
    files = stdout.split("\0").filter(Boolean);
  } else {
    files = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name));
        } else if (e.isFile()) files.push(relative(root, join(dir, e.name)).split(sep).join("/"));
      }
    };
    await walk(root);
  }
  return files.filter((f) => !SKIP_FILES.test(f) && !f.split("/").slice(0, -1).some((d) => SKIP_DIRS.has(d))).sort();
}

/** Commits per file over the last year: the "churn" half of a hotspot. */
export async function churn(root: string, git: Git): Promise<Record<string, number>> {
  if (!git.head) return {};
  try {
    const { stdout } = await run("git", ["-C", root, "log", "--since=1.year", "--name-only", "--format=", "--no-merges"], { maxBuffer: 256 * 1024 * 1024 });
    const counts: Record<string, number> = {};
    for (const f of stdout.split("\n")) if (f) counts[f] = (counts[f] ?? 0) + 1;
    return counts;
  } catch {
    return {};
  }
}
