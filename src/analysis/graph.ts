import type { FileFacts, Index } from "../types.js";

/** File-level dependency graph built from resolved imports. */
export interface Graph {
  files: Map<string, FileFacts>;
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
}

export function buildGraph(index: Index): Graph {
  const files = new Map(index.files.map((f) => [f.path, f]));
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  for (const f of index.files) {
    out.set(f.path, out.get(f.path) ?? new Set());
    inn.set(f.path, inn.get(f.path) ?? new Set());
  }
  for (const f of index.files) {
    for (const imp of f.imports) {
      for (const t of imp.targets) {
        if (!files.has(t) || t === f.path) continue;
        out.get(f.path)!.add(t);
        inn.get(t)!.add(f.path);
      }
    }
  }
  return { files, out, in: inn };
}

/** Strongly connected components with more than one file: import cycles. Tarjan's algorithm, iterative. */
export function cycles(g: Graph, filter: (path: string) => boolean = () => true): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  for (const start of g.out.keys()) {
    if (idx.has(start) || !filter(start)) continue;
    const work: { node: string; it: Iterator<string> }[] = [];
    const visit = (n: string) => {
      idx.set(n, index);
      low.set(n, index);
      index++;
      stack.push(n);
      onStack.add(n);
      work.push({ node: n, it: [...(g.out.get(n) ?? [])].filter(filter)[Symbol.iterator]() });
    };
    visit(start);
    while (work.length) {
      const top = work[work.length - 1]!;
      const next = top.it.next();
      if (!next.done) {
        const w = next.value;
        if (!idx.has(w)) visit(w);
        else if (onStack.has(w)) low.set(top.node, Math.min(low.get(top.node)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]!.node;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.node)!));
      }
      if (low.get(top.node) === idx.get(top.node)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== top.node);
        if (comp.length > 1) result.push(comp.sort());
      }
    }
  }
  return result.sort((a, b) => b.length - a.length);
}

/** Shortest import path from any of `from` to `to`, following imports forward. */
export function shortestPath(g: Graph, from: Iterable<string>, to: string): string[] | undefined {
  const prev = new Map<string, string | null>();
  const queue: string[] = [];
  for (const s of from) {
    prev.set(s, null);
    queue.push(s);
  }
  while (queue.length) {
    const n = queue.shift()!;
    if (n === to) {
      const path = [n];
      for (let p = prev.get(n); p; p = prev.get(p)) path.unshift(p);
      return path;
    }
    for (const m of g.out.get(n) ?? []) {
      if (!prev.has(m)) {
        prev.set(m, n);
        queue.push(m);
      }
    }
  }
  return undefined;
}

/** Names `from` imports out of `to` and actually calls: the edge's "why". */
export function usedNames(g: Graph, from: string, to: string): string[] {
  const a = g.files.get(from);
  const b = g.files.get(to);
  if (!a || !b) return [];
  const calls = new Set(a.calls);
  const named = new Set(a.imports.filter((i) => i.targets.includes(to)).flatMap((i) => i.names ?? []));
  const out = b.symbols.filter((s) => (s.exported || s.kind === "class") && !s.parent && (calls.has(s.name) || named.has(s.name))).map((s) => s.name);
  return [...new Set(out)];
}
