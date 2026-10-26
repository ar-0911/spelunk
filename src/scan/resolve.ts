import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { ImportRef, Manifest } from "../types.js";

/**
 * Turns import specifiers into repo files, per language: relative paths,
 * tsconfig aliases and workspace packages for JS/TS; sys.path roots for
 * Python; the go.mod module path for Go; crate paths for Rust; package paths
 * for the JVM languages. What leaves the repo is recorded as `external`.
 */

const JS_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".json"];
const JS_LANGS = new Set(["typescript", "tsx", "javascript", "vue", "svelte"]);
const NODE_BUILTINS = new Set(["assert", "buffer", "child_process", "crypto", "dns", "events", "fs", "http", "https", "net", "os", "path", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "url", "util", "v8", "vm", "worker_threads", "zlib", "module", "perf_hooks", "async_hooks", "cluster", "dgram", "inspector", "test"]);

interface NpmPackage {
  name: string;
  dir: string;
  exports: Record<string, string>;
}

interface Alias {
  /** Directory the tsconfig lives in; only files under it use the alias. */
  scope: string;
  prefix: string;
  wildcard: boolean;
  targets: string[];
}

export interface Resolver {
  resolve(file: string, lang: string, imp: Omit<ImportRef, "targets">): Pick<ImportRef, "targets" | "external">;
}

const norm = (p: string) => posix.normalize(p).replace(/^\.\//, "").replace(/\/$/, "");

function stripJsonComments(text: string): string {
  return text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string | undefined) => str ?? "").replace(/,(\s*[}\]])/g, "$1");
}

/** The first string a package.json `exports` entry points at, preferring source-ish conditions. */
function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["source", "development", "types", "import", "module", "default", "require", "node"]) {
      const t = exportTarget(o[k]);
      if (t) return t;
    }
  }
  return undefined;
}

export async function createResolver(root: string, files: string[], manifests: Manifest[]): Promise<Resolver> {
  const all = new Set(files);
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const d = posix.dirname(f) === "." ? "" : posix.dirname(f);
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }

  // npm workspace packages
  const npm: NpmPackage[] = [];
  for (const m of manifests.filter((m) => m.kind === "npm" && m.name)) {
    try {
      const pkg = JSON.parse(await readFile(join(root, m.path), "utf8")) as Record<string, unknown>;
      const dir = posix.dirname(m.path) === "." ? "" : posix.dirname(m.path);
      const exports: Record<string, string> = {};
      const ex = pkg.exports;
      if (typeof ex === "string" || (ex && typeof ex === "object" && !Object.keys(ex).some((k) => k.startsWith(".")))) {
        const t = exportTarget(ex);
        if (t) exports["."] = t;
      } else if (ex && typeof ex === "object") {
        for (const [k, v] of Object.entries(ex)) {
          const t = exportTarget(v);
          if (t) exports[k] = t;
        }
      }
      for (const k of ["source", "module", "main", "types"]) if (!exports["."] && typeof pkg[k] === "string") exports["."] = pkg[k] as string;
      npm.push({ name: m.name!, dir, exports });
    } catch {
      /* unreadable package.json: imports of it stay unresolved */
    }
  }

  // tsconfig path aliases
  const aliases: Alias[] = [];
  for (const f of files.filter((f) => /(^|\/)[jt]sconfig[\w.-]*\.json$/.test(f))) {
    try {
      const cfg = JSON.parse(stripJsonComments(await readFile(join(root, f), "utf8"))) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const scope = posix.dirname(f) === "." ? "" : posix.dirname(f);
      const base = norm(posix.join(scope, cfg.compilerOptions?.baseUrl ?? "."));
      for (const [pattern, targets] of Object.entries(cfg.compilerOptions?.paths ?? {})) {
        const wildcard = pattern.endsWith("*");
        aliases.push({ scope, prefix: wildcard ? pattern.slice(0, -1) : pattern, wildcard, targets: targets.map((t) => norm(posix.join(base, t))) });
      }
    } catch {
      /* ignore broken tsconfig */
    }
  }

  // Python roots: where top-level packages live, plus each manifest dir and its src/.
  const pyRoots = new Set<string>(["", "src"]);
  for (const f of files) {
    if (!f.endsWith("__init__.py")) continue;
    const pkg = posix.dirname(f);
    const parent = posix.dirname(pkg) === "." ? "" : posix.dirname(pkg);
    if (!all.has(parent ? `${parent}/__init__.py` : "__init__.py")) pyRoots.add(parent);
  }
  for (const m of manifests.filter((m) => m.kind === "python")) {
    const d = posix.dirname(m.path) === "." ? "" : posix.dirname(m.path);
    pyRoots.add(d);
    pyRoots.add(norm(posix.join(d, "src")));
  }

  const goModules = manifests.filter((m) => m.kind === "go" && m.name).map((m) => ({ name: m.name!, dir: posix.dirname(m.path) === "." ? "" : posix.dirname(m.path) }));
  const crates = manifests.filter((m) => m.kind === "cargo").map((m) => norm(posix.join(posix.dirname(m.path), "src")));

  const tryJs = (base: string): string[] => {
    base = norm(base);
    if (all.has(base)) return [base];
    const stem = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    for (const ext of JS_EXT) if (all.has(stem + ext)) return [stem + ext];
    for (const ext of JS_EXT) if (all.has(`${base}/index${ext}`)) return [`${base}/index${ext}`];
    return [];
  };

  /** dist/index.js → src/index.ts when only sources are in the repo. */
  const tryPackageFile = (dir: string, target: string): string[] => {
    const direct = tryJs(posix.join(dir, target));
    if (direct.length) return direct;
    const asSrc = target.replace(/^\.?\/?(dist|build|lib|out|esm|cjs)\//, "src/").replace(/\.d\.ts$/, "");
    const viaSrc = tryJs(posix.join(dir, asSrc));
    if (viaSrc.length) return viaSrc;
    return tryJs(posix.join(dir, "src/index"));
  };

  const pyModule = (base: string, dotted: string): string[] => {
    const p = norm(posix.join(base, dotted.replace(/\./g, "/")));
    if (all.has(`${p}.py`)) return [`${p}.py`];
    if (all.has(`${p}/__init__.py`)) return [`${p}/__init__.py`];
    if (all.has(`${p}.pyi`)) return [`${p}.pyi`];
    return [];
  };

  const rustModule = (base: string, segments: string[]): string[] => {
    for (let n = segments.length; n > 0; n--) {
      const p = norm(posix.join(base, ...segments.slice(0, n)));
      if (all.has(`${p}.rs`)) return [`${p}.rs`];
      if (all.has(`${p}/mod.rs`)) return [`${p}/mod.rs`];
    }
    return [];
  };

  const bySuffix = (suffixes: string[]): string[] => files.filter((f) => suffixes.some((s) => f === s || f.endsWith(`/${s}`)));

  return {
    resolve(file, lang, imp) {
      const spec = imp.spec;
      const here = posix.dirname(file) === "." ? "" : posix.dirname(file);

      if (JS_LANGS.has(lang)) {
        if (spec.startsWith(".") || spec.startsWith("/")) return { targets: tryJs(spec.startsWith("/") ? spec.slice(1) : posix.join(here, spec)) };
        for (const a of aliases) {
          if ((a.scope && !file.startsWith(`${a.scope}/`)) || !(a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix)) continue;
          for (const t of a.targets) {
            const hit = tryJs(a.wildcard ? t.replace("*", spec.slice(a.prefix.length)) : t);
            if (hit.length) return { targets: hit };
          }
        }
        const pkg = npm.find((p) => spec === p.name || spec.startsWith(`${p.name}/`));
        if (pkg) {
          const sub = spec === pkg.name ? "." : `.${spec.slice(pkg.name.length)}`;
          const target = pkg.exports[sub];
          const hit = target ? tryPackageFile(pkg.dir, target) : sub === "." ? tryPackageFile(pkg.dir, "src/index") : tryJs(posix.join(pkg.dir, sub)).concat(tryJs(posix.join(pkg.dir, "src", sub)));
          if (hit.length) return { targets: hit.slice(0, 1) };
        }
        const bare = spec.replace(/^node:/, "");
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
        return { targets: [], external: spec.startsWith("node:") || NODE_BUILTINS.has(bare.split("/")[0]!) ? `node:${bare.split("/")[0]}` : name };
      }

      if (lang === "python") {
        const dots = spec.match(/^\.+/)?.[0].length ?? 0;
        const rest = spec.slice(dots);
        const names = imp.names ?? [];
        const bases = dots ? [norm(posix.join(here, ...Array(dots - 1).fill("..")))] : [...pyRoots, here];
        for (const base of bases) {
          // A module never imports itself: `import logging` inside flask/logging.py is the standard library.
          const mod = rest ? pyModule(base, rest).filter((t) => t !== file) : [];
          const subs = names.flatMap((n) => pyModule(base, rest ? `${rest}.${n}` : n)).filter((t) => t !== file);
          if (subs.length) return { targets: [...new Set(subs)] };
          if (mod.length) return { targets: mod };
          if (!rest && dots) {
            const init = pyModule(base, "");
            if (init.length) return { targets: init };
          }
        }
        return dots ? { targets: [] } : { targets: [], external: rest.split(".")[0]! };
      }

      if (lang === "go") {
        const mod = goModules.filter((m) => spec === m.name || spec.startsWith(`${m.name}/`)).sort((a, b) => b.name.length - a.name.length)[0];
        if (mod) {
          const dir = norm(posix.join(mod.dir, spec.slice(mod.name.length).replace(/^\//, "")));
          return { targets: (byDir.get(dir) ?? []).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go")) };
        }
        return { targets: [], external: spec.includes(".") ? spec.split("/").slice(0, 3).join("/") : spec.split("/")[0]! };
      }

      if (lang === "rust") {
        if (spec.startsWith("mod:")) {
          const name = spec.slice(4);
          const stem = posix.basename(file, ".rs");
          const base = ["main", "lib", "mod"].includes(stem) ? here : norm(posix.join(here, stem));
          return { targets: rustModule(base, [name]) };
        }
        const segs = spec.replace(/::\{.*$/, "").split("::").filter((s) => s && s !== "*");
        const crate = crates.filter((c) => file.startsWith(`${c}/`) || c === here).sort((a, b) => b.length - a.length)[0] ?? "src";
        if (segs[0] === "crate") return { targets: rustModule(crate, segs.slice(1)) };
        if (segs[0] === "super" || segs[0] === "self") {
          const base = segs[0] === "super" ? norm(posix.join(here, "..")) : here;
          return { targets: rustModule(base, segs.slice(1)) };
        }
        return { targets: [], external: segs[0] ?? spec };
      }

      if (lang === "java" || lang === "kotlin" || lang === "scala") {
        const clean = spec.replace(/^static\s+/, "").replace(/\s+as\s+\w+$/, "");
        const parts = clean.split(".");
        if (parts[parts.length - 1] === "*") {
          const dirSuffix = parts.slice(0, -1).join("/");
          const hits = files.filter((f) => /\.(java|kt|scala)$/.test(f) && posix.dirname(f).endsWith(dirSuffix));
          return hits.length ? { targets: hits } : { targets: [], external: parts.slice(0, 2).join(".") };
        }
        for (let n = parts.length; n > 1; n--) {
          const path = parts.slice(0, n).join("/");
          const hits = bySuffix([`${path}.java`, `${path}.kt`, `${path}.scala`]);
          if (hits.length) return { targets: hits };
        }
        return { targets: [], external: parts.slice(0, 2).join(".") };
      }

      if (lang === "ruby") {
        const rel = spec.startsWith(".") ? norm(posix.join(here, spec)) : undefined;
        const cands = rel ? [`${rel}.rb`, rel] : [`lib/${spec}.rb`, `${spec}.rb`, `app/${spec}.rb`];
        const hit = cands.filter((c) => all.has(c));
        return hit.length ? { targets: hit.slice(0, 1) } : rel ? { targets: [] } : { targets: [], external: spec.split("/")[0]! };
      }

      if (lang === "c" || lang === "cpp") {
        if (spec.startsWith("<")) return { targets: [], external: spec.slice(1, -1) };
        const local = norm(posix.join(here, spec));
        if (all.has(local)) return { targets: [local] };
        const hits = bySuffix([spec]);
        return { targets: hits.slice(0, 1) };
      }

      if (lang === "php") {
        const path = spec.replace(/^\\/, "").replace(/\\/g, "/").replace(/\s+as\s+\w+$/, "");
        const tail = path.split("/").slice(1).join("/");
        const hits = bySuffix([`${path}.php`, ...(tail ? [`${tail}.php`] : [])]);
        return hits.length ? { targets: hits.slice(0, 1) } : { targets: [] };
      }

      return { targets: [] };
    },
  };
}

