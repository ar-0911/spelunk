import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Directories that never hold the code you want to understand, wherever they are. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "__pycache__", ".venv", ".tox", ".mypy_cache",
  ".pytest_cache", ".ruff_cache", "site-packages", ".gradle", ".idea", ".vscode", "bower_components", ".spelunk", ".terraform",
  "Pods", ".dart_tool",
]);

/**
 * Build and dependency output: skipped only where a project puts it, next to
 * its manifest (`dist/` beside package.json, `target/` beside Cargo.toml,
 * `deps/` beside mix.exs). A `src/build/` or `lib/out/` module is code.
 * In a git repo .gitignore already drops real output, so a committed `build/`
 * (VS Code's build scripts, say) is kept; only `dist` and `coverage`, which
 * are committed bundles or reports when they're committed at all, still go.
 */
const OUTPUT_DIRS = new Set(["dist", "build", "out", "target", "coverage", "_build", "deps"]);
const COMMITTED_OUTPUT_DIRS = new Set(["dist", "coverage"]);
const MANIFEST = /(^|\/)(package\.json|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|mix\.exs|pyproject\.toml|setup\.py|go\.mod|composer\.json|Gemfile|tsconfig\.json|Makefile|CMakeLists\.txt|.+\.csproj|pubspec\.yaml)$/;
/** Python virtualenvs go by any name; `pyvenv.cfg` gives them away. */
const VENV_NAMES = new Set(["venv", "env", ".env", "virtualenv"]);

const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|uv\.lock)$|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|wasm|woff2?|ttf|otf|eot|mp[34]|mov|webm|so|dylib|dll|exe|bin|class|jar|pyc|db|sqlite3?|snap)$/i;

export interface Git {
  isRepo: boolean;
  head?: string;
  remote?: string;
}

/**
 * git@github.com:o/r.git or https://github.com/o/r.git → https://github.com/o/r.
 * Self-hosted Bitbucket (Data Center) clones from /scm/PROJ/repo or ssh port 7999
 * and browses at /projects/PROJ/repos/repo.
 */
export function webUrl(remote: string): string | undefined {
  const server = remote.trim().match(/^(?:ssh:\/\/git@([^/:]+):\d+\/|https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/scm\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (server && /bitbucket/.test(server[1] ?? server[2]!)) return `https://${server[1] ?? server[2]}/projects/${server[3]!.toUpperCase()}/repos/${server[4]}`;
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

/**
 * A cheap fingerprint of the working tree: HEAD, `git status`, and the size and
 * time of each dirty file (a second edit to an already-modified file leaves
 * `git status` unchanged). Same stamp, same files: no rescan needed. Undefined
 * outside git.
 */
export async function changeStamp(root: string): Promise<string | undefined> {
  try {
    const [head, status] = await Promise.all([
      run("git", ["-C", root, "rev-parse", "HEAD"]).then((r) => r.stdout.trim(), () => ""),
      run("git", ["-C", root, "status", "--porcelain", "-z", "--untracked-files=all"], { maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout),
    ]);
    const dirty = status.split("\0").filter((e) => e.length > 3).map((e) => e.slice(3));
    const stats = await Promise.all(dirty.slice(0, 5000).map((p) => stat(join(root, p)).then((s) => `${s.size}:${s.mtimeMs}`, () => "-")));
    return `${head}\n${status}\n${stats.join(",")}`;
  } catch {
    return undefined;
  }
}

/** Repo-relative paths (always "/"-separated) of files worth reading, honouring .gitignore when there is one. */
export async function listFiles(root: string, git: Git): Promise<{ files: string[]; skipped: { path: string; reason: string }[] }> {
  let all: string[];
  if (git.isRepo) {
    const { stdout } = await run("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], { maxBuffer: 256 * 1024 * 1024 });
    all = stdout.split("\0").filter(Boolean);
  } else {
    all = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name));
        } else if (e.isFile()) all.push(relative(root, join(dir, e.name)).split(sep).join("/"));
      }
    };
    await walk(root);
  }

  const manifestDirs = new Set([""]);
  for (const f of all) if (MANIFEST.test(f)) manifestDirs.add(posix.dirname(f) === "." ? "" : posix.dirname(f));
  const venvs = new Set(all.filter((f) => posix.basename(f) === "pyvenv.cfg").map((f) => posix.dirname(f)));
  // Skipped folders are reported once each, with why, so nothing disappears silently.
  const skippedDirs = new Map<string, { reason: string; files: number }>();
  const files: string[] = [];
  for (const f of all) {
    if (SKIP_FILES.test(f)) continue;
    const parts = f.split("/");
    let why: { dir: string; reason: string } | undefined;
    for (let i = 0; i < parts.length - 1 && !why; i++) {
      const dir = parts.slice(0, i + 1).join("/");
      const parent = parts.slice(0, i).join("/");
      if (SKIP_DIRS.has(parts[i]!)) why = { dir, reason: "dependencies, caches or editor settings" };
      else if ((git.isRepo ? COMMITTED_OUTPUT_DIRS : OUTPUT_DIRS).has(parts[i]!) && manifestDirs.has(parent)) why = { dir, reason: "build or dependency output" };
      else if (venvs.has(dir) || (VENV_NAMES.has(parts[i]!) && existsSync(join(root, dir, "pyvenv.cfg")))) why = { dir, reason: "Python virtualenv" };
    }
    if (!why) files.push(f);
    else {
      const s = skippedDirs.get(why.dir) ?? { reason: why.reason, files: 0 };
      s.files++;
      skippedDirs.set(why.dir, s);
    }
  }
  return {
    files: files.sort(),
    skipped: [...skippedDirs].map(([dir, s]) => ({ path: `${dir}/`, reason: `${s.reason} (${s.files} file${s.files === 1 ? "" : "s"})` })),
  };
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
