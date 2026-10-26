import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Manifest } from "../types.js";

/**
 * How the project is built, run and tested, from the files that say so:
 * package.json, pyproject.toml, go.mod, Cargo.toml, Dockerfiles, CI
 * workflows, Makefiles and .env examples.
 */

/** Just enough TOML for manifests: [tables], key = "str", key = [arrays] (multi-line too), key = { inline }. */
export function parseToml(text: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = { "": {} };
  let table = "";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const t = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (t) {
      table = t[1]!;
      if (line.startsWith("[[")) {
        const list = ((out[table] as unknown as { _items?: Record<string, unknown>[] })?._items ?? []) as Record<string, unknown>[];
        list.push({});
        out[table] = { _items: list };
      } else out[table] ??= {};
      continue;
    }
    const kv = line.match(/^("[^"]+"|[\w.-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2]!;
    if (value.startsWith("[") && !balanced(value)) {
      while (i + 1 < lines.length && !balanced(value)) value += ` ${lines[++i]!.replace(/\s+#.*$/, "").trim()}`;
    }
    const key = kv[1]!.replace(/"/g, "");
    const target = out[table]!;
    const items = (target as { _items?: Record<string, unknown>[] })._items;
    (items ? items[items.length - 1]! : target)[key] = tomlValue(value);
  }
  return out;
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s.replace(/"[^"]*"|'[^']*'/g, "")) depth += ch === "[" ? 1 : ch === "]" ? -1 : 0;
  return depth <= 0;
}

function tomlValue(v: string): unknown {
  v = v.trim();
  if (/^["']/.test(v)) return v.slice(1, v.lastIndexOf(v[0]!));
  if (v.startsWith("[")) return [...v.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
  if (v.startsWith("{")) return Object.fromEntries([...v.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
  return v;
}

const depName = (spec: string) => spec.trim().split(/[\s<>=!~;[(@]/)[0]!;

async function read(root: string, path: string): Promise<string | undefined> {
  return readFile(join(root, path), "utf8").catch(() => undefined);
}

export async function readManifests(root: string, files: string[]): Promise<Manifest[]> {
  const out: Manifest[] = [];
  for (const path of files) {
    const name = basename(path);
    let m: Manifest | undefined;
    if (name === "package.json" && !path.includes("node_modules/")) m = await npm(root, path);
    else if (name === "pyproject.toml") m = await pyproject(root, path);
    else if (/^requirements[\w.-]*\.txt$/.test(name)) m = await requirements(root, path);
    else if (name === "setup.py") m = await setupPy(root, path);
    else if (name === "go.mod") m = await goMod(root, path);
    else if (name === "Cargo.toml") m = await cargo(root, path);
    else if (name === "pom.xml") m = await pom(root, path);
    else if (/^build\.gradle(\.kts)?$/.test(name)) m = { path, kind: "gradle", commands: [], dependencies: [] };
    else if (name === "Gemfile") m = await gemfile(root, path);
    else if (/^Dockerfile/.test(name)) m = await dockerfile(root, path);
    else if (/^(docker-)?compose[\w.-]*\.ya?ml$/.test(name)) m = await compose(root, path);
    else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) || /\.gitlab-ci\.yml$/.test(path)) m = await ci(root, path);
    else if (name === "Makefile") m = await makefile(root, path);
    else if (/^\.env\.(example|sample|template|dist)$|^example\.env$/.test(name)) m = await envExample(root, path);
    if (m) out.push(m);
  }
  return out;
}

async function npm(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  let pkg: { name?: string; scripts?: Record<string, string>; bin?: string | Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(text);
  } catch {
    return undefined;
  }
  const commands = Object.entries(pkg.scripts ?? {}).map(([name, command]) => ({ name: `npm run ${name}`, command }));
  const bin = typeof pkg.bin === "string" ? { [pkg.name ?? "bin"]: pkg.bin } : (pkg.bin ?? {});
  for (const [name, file] of Object.entries(bin)) commands.push({ name: `bin ${name}`, command: file });
  return { path, kind: "npm", ...(pkg.name ? { name: pkg.name } : {}), commands, dependencies: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) };
}

async function pyproject(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const t = parseToml(text);
  const project = t.project ?? {};
  const poetry = t["tool.poetry"] ?? {};
  const scripts = { ...(t["project.scripts"] ?? {}), ...(t["tool.poetry.scripts"] ?? {}) } as Record<string, string>;
  const deps = [
    ...((project.dependencies as string[] | undefined) ?? []).map(depName),
    ...Object.keys(t["tool.poetry.dependencies"] ?? {}).filter((d) => d !== "python"),
  ];
  const name = (project.name ?? poetry.name) as string | undefined;
  return { path, kind: "python", ...(name ? { name } : {}), commands: Object.entries(scripts).map(([n, c]) => ({ name: `script ${n}`, command: String(c) })), dependencies: deps };
}

async function requirements(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const deps = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("-")).map(depName);
  return { path, kind: "python", commands: [], dependencies: deps };
}

async function setupPy(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const name = text.match(/\bname\s*=\s*["']([^"']+)/)?.[1];
  const scripts = [...text.matchAll(/["']([\w-]+)\s*=\s*([\w.:]+)["']/g)].map((m) => ({ name: `script ${m[1]}`, command: m[2]! }));
  return { path, kind: "python", ...(name ? { name } : {}), commands: scripts, dependencies: [] };
}

async function goMod(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const name = text.match(/^module\s+(\S+)/m)?.[1];
  const deps = [...text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+v[\d.]+/gm)].map((m) => m[1]!);
  return { path, kind: "go", ...(name ? { name } : {}), commands: [], dependencies: deps };
}

async function cargo(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const t = parseToml(text);
  const name = t.package?.name as string | undefined;
  const bins = ((t.bin as { _items?: Record<string, string>[] } | undefined)?._items ?? []).map((b) => ({ name: `bin ${b.name}`, command: b.path ?? `src/bin/${b.name}.rs` }));
  return { path, kind: "cargo", ...(name ? { name } : {}), commands: bins, dependencies: Object.keys({ ...t.dependencies, ...t["dev-dependencies"] }) };
}

async function pom(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const name = text.replace(/<parent>[\s\S]*?<\/parent>/, "").match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
  const deps = [...text.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]!);
  return { path, kind: "maven", ...(name ? { name } : {}), commands: [], dependencies: deps };
}

async function gemfile(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  return { path, kind: "ruby", commands: [], dependencies: [...text.matchAll(/^\s*gem\s+["']([^"']+)/gm)].map((m) => m[1]!) };
}

async function dockerfile(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const commands = [...text.matchAll(/^(CMD|ENTRYPOINT|EXPOSE)\s+(.+)$/gm)].map((m) => ({ name: m[1]!, command: m[2]!.trim() }));
  return { path, kind: "docker", commands, dependencies: [...text.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]!) };
}

async function compose(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const services = text.split(/^services:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  const names = [...services.matchAll(/^ {2}([\w.-]+):\s*$/gm)].map((m) => m[1]!);
  const images = [...text.matchAll(/^\s+image:\s*(\S+)/gm)].map((m) => m[1]!);
  return { path, kind: "compose", commands: names.map((n) => ({ name: `service ${n}`, command: `docker compose up ${n}` })), dependencies: images };
}

async function ci(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const commands: { name: string; command: string }[] = [];
  let lastName = "step";
  for (const line of text.split("\n")) {
    const named = line.match(/^\s*-?\s*name:\s*(.+)$/);
    if (named) lastName = named[1]!.trim().replace(/^["']|["']$/g, "");
    const run = line.match(/^\s*-?\s*run:\s*(.+)$/);
    if (run && run[1]!.trim() !== "|") commands.push({ name: lastName, command: run[1]!.trim() });
  }
  return { path, kind: "ci", commands, dependencies: [] };
}

async function makefile(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const commands: { name: string; command: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^([A-Za-z0-9_.-]+):(?!=)/);
    if (m && !m[1]!.startsWith(".")) commands.push({ name: `make ${m[1]}`, command: lines[i + 1]?.startsWith("\t") ? lines[i + 1]!.trim() : "" });
  }
  return { path, kind: "make", commands, dependencies: [] };
}

async function envExample(root: string, path: string): Promise<Manifest | undefined> {
  const text = await read(root, path);
  if (!text) return undefined;
  const env = [...text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1]!);
  return { path, kind: "env", commands: [], dependencies: [], env: [...new Set(env)] };
}
