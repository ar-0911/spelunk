import type { Report } from "./model.js";

/**
 * The module dependency diagram as inline SVG. Modules that depend on
 * nothing sit at the bottom; each module sits one row above the highest
 * module it imports, so arrows point down towards foundations.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function moduleLayers(mods: Report["modules"]): string[][] {
  const deps = new Map(mods.map((m) => [m.path, m.dependsOn.map((d) => d.path).filter((p) => p !== m.path)]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (p: string): number => {
    if (depth.has(p)) return depth.get(p)!;
    if (visiting.has(p)) return 0; // cycle: break it here
    visiting.add(p);
    const d = Math.max(-1, ...(deps.get(p) ?? []).filter((x) => deps.has(x)).map(depthOf)) + 1;
    visiting.delete(p);
    depth.set(p, d);
    return d;
  };
  for (const m of mods) depthOf(m.path);
  const rows: string[][] = [];
  for (const [p, d] of depth) (rows[d] ??= []).push(p);
  return rows.map((r) => (r ?? []).sort()).reverse();
}

const short = (p: string) => (p ? (p.length > 30 ? `…${p.slice(-29)}` : p) : "(root)");

export function diagramSvg(mods: Report["modules"]): string {
  if (!mods.length) return "";
  const layers = moduleLayers(mods);
  const W = 1000;
  const boxW = 190;
  const boxH = 46;
  const gapX = 16;
  const rowGap = 64;
  const perRow = Math.floor((W + gapX) / (boxW + gapX));
  const pos = new Map<string, { x: number; y: number }>();
  let y = 10;
  for (const layer of layers) {
    for (let i = 0; i < layer.length; i += perRow) {
      const chunk = layer.slice(i, i + perRow);
      const total = chunk.length * boxW + (chunk.length - 1) * gapX;
      let x = (W - total) / 2;
      for (const p of chunk) {
        pos.set(p, { x, y });
        x += boxW + gapX;
      }
      y += boxH + rowGap;
    }
  }
  const H = y - rowGap + 20;
  const lines = new Map(mods.map((m) => [m.path, m.lines]));
  const maxLines = Math.max(...mods.map((m) => m.lines), 1);
  const edges: string[] = [];
  for (const m of mods) {
    const a = pos.get(m.path)!;
    for (const d of m.dependsOn) {
      const b = pos.get(d.path);
      if (!b) continue;
      const x1 = a.x + boxW / 2;
      const y1 = a.y + boxH;
      const x2 = b.x + boxW / 2;
      const y2 = b.y;
      const up = y2 <= y1;
      const path = up
        ? `M${x1},${a.y} C${x1},${a.y - 40} ${x2},${y2 + boxH + 40} ${x2},${y2 + boxH}`
        : `M${x1},${y1} C${x1},${y1 + rowGap / 2} ${x2},${y2 - rowGap / 2} ${x2},${y2}`;
      const w = Math.min(3, 0.8 + Math.log2(1 + d.weight) * 0.6);
      edges.push(`<path d="${path}" fill="none" stroke="var(--edge)" stroke-width="${w.toFixed(1)}" marker-end="url(#sp-arrow)"${up ? ' stroke-dasharray="4 3"' : ""}><title>${esc(m.path || "(root)")} → ${esc(d.path || "(root)")}: ${d.weight} import${d.weight === 1 ? "" : "s"}</title></path>`);
    }
  }
  const boxes = mods.map((m) => {
    const p = pos.get(m.path)!;
    const fill = Math.round(8 + (lines.get(m.path)! / maxLines) * 30);
    return `<a href="#mod-${encodeURIComponent(m.path || "root")}"><g class="sp-node"><rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="7" fill="color-mix(in srgb, var(--accent) ${fill}%, var(--panel))" stroke="var(--line-strong)"/><text x="${p.x + 10}" y="${p.y + 19}" font-size="12.5" font-weight="600" fill="var(--ink)">${esc(short(m.path))}</text><text x="${p.x + 10}" y="${p.y + 36}" font-size="11" fill="var(--muted)">${m.files.length} files · ${m.lines.toLocaleString("en")} lines</text><title>${esc(m.path || "(root)")}</title></g></a>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Module dependency diagram" style="min-width:720px"><defs><marker id="sp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--edge)"/></marker></defs>${edges.join("")}${boxes.join("")}</svg>`;
}

/** The same graph as Mermaid, for Markdown reports (GitHub renders it). */
export function diagramMermaid(mods: Report["modules"]): string {
  const id = new Map(mods.map((m, i) => [m.path, `m${i}`]));
  const lines = ["graph TD"];
  for (const m of mods) lines.push(`  ${id.get(m.path)}["${(m.path || "(root)").replace(/"/g, "'")}<br/>${m.files.length} files"]`);
  for (const m of mods) for (const d of m.dependsOn) if (id.has(d.path)) lines.push(`  ${id.get(m.path)} --> ${id.get(d.path)}`);
  return lines.join("\n");
}
