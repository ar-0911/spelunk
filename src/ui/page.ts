import { THEME_CSS } from "../report/html.js";

/**
 * The dashboard page: one HTML document with inline CSS and JS that talks to
 * the local server's /api routes. No framework, no build step, no network.
 */

const CSS = `
.hosted .localonly{display:none!important}
body:not(.hosted) .hostedonly{display:none!important}
${THEME_CSS}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14.5px/1.55 var(--body); }
button, input, textarea { font: inherit; color: inherit; }
a { color: var(--accent-ink); }
code, .mono { font-family: var(--mono); font-size: .86em; }
code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
h1, h2, h3 { font-family: var(--display); font-weight: 600; line-height: 1.15; margin: 0; text-wrap: balance; }
h1 { font-size: clamp(26px, 4vw, 38px); }
h2 { font-size: 22px; margin: 28px 0 10px; }
h3 { font-size: 16px; margin: 18px 0 6px; font-family: var(--body); }
p { margin: 0 0 10px; max-width: 75ch; }
.muted { color: var(--muted); }
.app { display: grid; grid-template-rows: auto 1fr; height: 100%; }
header.top { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.brand { font: 600 19px/1 var(--display); display: flex; align-items: center; gap: 8px; margin-right: 6px; }
.brand svg { color: var(--accent); }
.repo { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 260px; }
.repo .path { font: 12.5px var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.btn { border: 1px solid var(--line-strong); background: var(--panel); border-radius: 7px; padding: 6px 12px; cursor: pointer; white-space: nowrap; text-decoration: none; color: var(--ink); font-size: 13.5px; }
.btn:hover { border-color: var(--accent); }
.btn:focus-visible, .navb:focus-visible, .chip:focus-visible, .lnk:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.body { display: grid; grid-template-columns: 196px minmax(0, 1fr); min-height: 0; }
nav.side { border-right: 1px solid var(--line); padding: 14px 10px; overflow-y: auto; }
.navb { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; background: none; border: 0; border-radius: 7px; padding: 8px 10px; cursor: pointer; color: var(--muted); font-size: 14px; }
.navb:hover { background: var(--accent-soft); color: var(--ink); }
.navb[aria-current="page"] { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.navb .n { margin-left: auto; font: 11px var(--mono); }
.navhint { font-size: 12px; color: var(--muted); padding: 14px 10px 0; line-height: 1.45; }
main { overflow-y: auto; padding: 24px clamp(16px, 3vw, 36px) 80px; min-width: 0; }
.view { max-width: 1100px; }
.lede { font-size: 16px; color: var(--muted); margin-top: 8px; }
.stats { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 14px 0 6px; color: var(--muted); font-size: 13.5px; }
.stats b { color: var(--ink); font-variant-numeric: tabular-nums; }
.langbar { display: flex; height: 7px; border-radius: 4px; overflow: hidden; max-width: 560px; background: var(--line); margin-top: 8px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.card h4 { margin: 0 0 6px; font-size: 14px; }
.card .lnk { font-size: 12.5px; }
.card.click { cursor: pointer; text-align: left; width: 100%; font: inherit; color: inherit; }
.card.click:hover { border-color: var(--accent); }
.lnk { font: 12.5px var(--mono); color: var(--accent-ink); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); text-underline-offset: 2px; text-align: left; overflow-wrap: anywhere; }
.lnk:hover { text-decoration-color: currentColor; }
.figure { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow-x: auto; }
.figure svg { display: block; width: 100%; height: auto; }
.figure svg text { font-family: var(--body); }
.sp-node:hover rect { stroke: var(--accent); }
.tw { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; vertical-align: top; padding: 7px 12px; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: 0; }
th { font: 500 11px/1.2 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: var(--code-bg); }
.tag { display: inline-block; font: 500 11px/1 var(--mono); padding: 3px 6px; border-radius: 4px; background: var(--code-bg); color: var(--muted); white-space: nowrap; }
.pill { display: inline-block; font: 600 11px/1 var(--mono); padding: 4px 7px; border-radius: 999px; white-space: nowrap; }
.high { background: var(--high-soft); color: var(--high); }
.medium { background: var(--medium-soft); color: var(--medium); }
.low { background: var(--low-soft); color: var(--low); }
.searchrow { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.field { flex: 1 1 320px; max-width: 640px; padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--panel); font-size: 15px; }
.field:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 14px; }
.chip { border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 4px 11px; font-size: 13px; cursor: pointer; color: var(--muted); }
.chip:hover, .chip[aria-pressed="true"] { border-color: var(--accent); color: var(--accent-ink); background: var(--accent-soft); }
.hit { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 4px 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.hit .why { color: var(--muted); font-size: 13px; }
.tree { list-style: none; margin: 0; padding-left: 18px; border-left: 1px dashed var(--line-strong); }
.tree.top { border: 0; padding-left: 0; }
.tree li { padding: 3px 0; }
.chain { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 4px 0; }
.chain .arrow { color: var(--muted); }
.risk { border-left: 3px solid var(--line-strong); padding: 6px 0 6px 12px; margin: 0 0 10px; }
.risk.sev-high { border-color: var(--high); }
.risk.sev-medium { border-color: var(--medium); }
.note { border: 1px solid var(--line); border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 8px 8px 0; padding: 10px 14px; margin: 0 0 14px; max-width: 80ch; }
.err { border-left-color: var(--high); }
.empty { padding: 40px 0; color: var(--muted); }
ol.steps { padding-left: 20px; } ol.steps li { margin-bottom: 6px; }
.log { font: 12.5px/1.6 var(--mono); background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; max-height: 240px; overflow-y: auto; white-space: pre-wrap; }
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
/* File drawer */
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 100%); background: var(--panel); border-left: 1px solid var(--line-strong); box-shadow: -12px 0 32px rgba(0,0,0,.18); display: grid; grid-template-rows: auto auto auto 1fr; z-index: 20; transform: translateX(102%); visibility: hidden; transition: transform .18s ease, visibility 0s linear .18s; }
.drawer.open { transform: none; visibility: visible; transition: transform .18s ease; }
.drawer .dh { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.drawer .dh .t { flex: 1; min-width: 0; }
.drawer .dh .t b { font: 600 13.5px var(--mono); overflow-wrap: anywhere; }
.drawer .tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--line); }
.drawer .tabs button { border: 0; background: none; padding: 6px 10px; border-bottom: 2px solid transparent; cursor: pointer; color: var(--muted); }
.drawer .tabs button[aria-selected="true"] { color: var(--ink); border-color: var(--accent); }
.drawer .pane { overflow: auto; min-height: 0; }
.code { font: 12.5px/1.6 var(--mono); margin: 0; padding: 8px 0; counter-reset: ln; }
.code .l { display: grid; grid-template-columns: 52px 1fr; white-space: pre; min-height: 1.6em; }
.code .l > i { font-style: normal; color: var(--muted); text-align: right; padding-right: 14px; user-select: none; opacity: .7; }
.code .l.hl { background: var(--accent-soft); }
.code .l.hl > i { color: var(--accent-ink); opacity: 1; }
.outline { padding: 6px 16px 30px; }
.outline .sym { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 3px 0; }
.outline .sym > div { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; min-width: 0; overflow-wrap: anywhere; }
.outline .sym .lnk { text-align: right; }
.scrim { position: fixed; inset: 0; background: rgba(0,0,0,.25); z-index: 15; display: none; }
.scrim.open { display: block; }
/* Folder picker */
dialog { border: 1px solid var(--line-strong); border-radius: 12px; background: var(--panel); color: var(--ink); width: min(640px, calc(100% - 32px)); padding: 0; }
dialog::backdrop { background: rgba(0,0,0,.35); }
.dlg { padding: 18px 20px; display: grid; gap: 10px; }
.dirs { max-height: 320px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; }
.dirs button { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: none; padding: 7px 12px; cursor: pointer; font: 13px var(--mono); }
.dirs button:hover { background: var(--accent-soft); }
.dirrow { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
.dirrow > button:first-child { border-bottom: 0; flex: 1; }
.dirrow .btn { margin: 3px 8px; padding: 2px 10px; font-size: 12.5px; width: auto; }
.crumbs { font: 12.5px var(--mono); overflow-wrap: anywhere; }
.welcome { max-width: 640px; margin: 8vh auto 0; text-align: left; }
.welcome ol { padding-left: 20px; color: var(--muted); }
.progress { height: 8px; border-radius: 4px; background: var(--line); max-width: 560px; overflow: hidden; margin-top: 14px; }
.progress span { display: block; height: 100%; background: var(--accent); transition: width .2s; }
.tstep { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.tstep .tnum { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font: 600 13px var(--mono); border: 1.5px solid var(--line-strong); color: var(--muted); }
.tstep.done .tnum { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.tstep.done h3 { color: var(--muted); }
.topen { display: grid; gap: 4px; }
details.sec { border-top: 1px solid var(--line); padding: 10px 0; }
details.sec > summary { cursor: pointer; font-weight: 600; font-size: 15px; list-style-position: outside; }
details.sec > summary .muted { font-weight: 400; font-size: 13px; }
details.sec[open] > summary { margin-bottom: 8px; }
.cmp { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: end; }
.cmp label { display: grid; gap: 3px; font-size: 12.5px; color: var(--muted); }
.cmp .field { min-width: 200px; }
.summary { font-size: 15px; margin: 16px 0 8px; }
.tick { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); margin-top: 10px; cursor: pointer; }
.askbox { display: grid; gap: 8px; max-width: 760px; margin-top: 14px; }
.askbox .field { max-width: none; resize: vertical; }
.q { margin: 18px 0 6px; font-weight: 600; max-width: 80ch; }
.q::before { content: "You asked"; display: block; font: 500 11px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
.a { border-left: 3px solid var(--accent); padding: 2px 0 2px 14px; max-width: 80ch; }
.a ul, .a ol { padding-left: 20px; margin: 0 0 10px; } .a li { margin-bottom: 4px; }
.a .lnk { font-size: 12px; }
.card.start { border-color: var(--accent); margin-top: 12px; max-width: 760px; }
.orline { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12.5px; margin-top: 6px; }
.orline::before, .orline::after { content: ""; flex: 1; border-top: 1px solid var(--line); }
label { font-size: 13px; color: var(--muted); }
/* Trace reader */
.view.wide { max-width: 1320px; }
.trail { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 13px; margin: 6px 0 4px; }
.trail .lnk { font-size: 12.5px; }
.trail .btn { margin-left: 8px; padding: 3px 10px; font-size: 12.5px; }
.fhead { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.fsum { margin: 8px 0 0; font-size: 15px; max-width: 80ch; }
.lane { font: 500 11px/1.2 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.gethere { margin: 14px 0; }
.flowrow { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.flowrow .arrow, .entry .arrow { color: var(--muted); }
.flowrow details.more { flex-basis: 100%; font-size: 13px; } .flowrow details.more .pill2 { margin: 4px 4px 0 0; }
.pill2 { border: 1px solid var(--line-strong); background: var(--code-bg); border-radius: 999px; padding: 3px 11px; font: 12.5px var(--mono); cursor: pointer; color: var(--ink); }
.pill2:hover { border-color: var(--accent); }
.pill2.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); cursor: default; font-weight: 600; }
.pill2 .tag { padding: 2px 5px; font-size: 10px; }
.entry { font-size: 12.5px; margin-top: 8px; }
.reader { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 14px; align-items: start; }
.steps2 { padding: 12px 10px; position: sticky; top: 0; max-height: calc(100vh - 120px); overflow-y: auto; }
.tstep2 { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: 8px; padding: 7px 8px; cursor: pointer; color: inherit; font: inherit; }
.tstep2:hover { background: var(--code-bg); }
.tstep2.sel { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.tstep2:not([data-into]) { cursor: default; }
.tstep2 .tn { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--bg); font: 600 11px/22px var(--mono); text-align: center; margin-top: 1px; }
.tstep2 .tn.o { background: none; border: 1px solid var(--line-strong); color: var(--muted); line-height: 20px; }
.tstep2.small { padding: 4px 8px; } .tstep2.small .nm { font-weight: 500; }
.tstep2 .tb { display: flex; flex-direction: column; min-width: 0; }
.tstep2 .hd { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: baseline; }
.tstep2 .nm { font: 600 13px var(--mono); overflow-wrap: anywhere; }
.tstep2 .what { font-size: 13px; color: var(--ink); margin-top: 1px; }
.tstep2 .where { font: 11.5px var(--mono); color: var(--muted); margin-top: 2px; }
.badge { font: 500 10.5px var(--mono); padding: 1px 6px; border-radius: 9px; background: var(--medium-soft); color: var(--medium); white-space: nowrap; }
.tog { display: block; margin: 10px 8px 4px; font-family: var(--body); font-size: 12.5px; }
.keys { font-size: 11.5px; margin: 12px 8px 0; } kbd { font: 11px var(--mono); border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 4px; background: var(--code-bg); }
.codecard { padding: 0; overflow: hidden; }
.codehead { display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 12px; }
.codecard .code { overflow-x: auto; max-height: calc(100vh - 140px); }
.code .call { background: color-mix(in srgb, var(--accent) 14%, transparent); border-bottom: 2px solid var(--accent); border-radius: 3px; cursor: pointer; }
.code .call.dim { background: none; border-bottom: 1px dotted var(--line-strong); cursor: default; }
.code .call.sel { background: color-mix(in srgb, var(--accent) 35%, transparent); }
.code .mk { color: var(--accent-ink); margin: 0 2px 0 1px; cursor: pointer; font-weight: 600; font-size: 11px; vertical-align: super; }
.code .mk.sel { background: var(--accent); color: var(--bg); border-radius: 50%; padding: 0 2px; }
.code .l.cur { background: var(--accent-soft); }
.code .l.thr > i { color: var(--high); opacity: 1; font-weight: 600; }
.code .l.thr > i::before { content: "!"; margin-right: 4px; }
.code .cref { border-bottom: 1px dotted var(--accent); cursor: pointer; }
.code .cref:hover { background: var(--accent-soft); }
.drawer .dnav { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 16px; border-bottom: 1px solid var(--line); }
.drawer .dnav:empty { display: none; }
.drawer .dnav .btn { padding: 3px 10px; font-size: 12.5px; }
.choices { display: grid; gap: 8px; max-width: 760px; }
/* Map */
.maptools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 10px; }
#mapfig svg .sp-edge, #mapfig svg .sp-node { transition: opacity .12s; }
#mapfig svg.hov .sp-edge:not(.on) { opacity: .12; }
#mapfig svg.hov .sp-node:not(.on) { opacity: .3; }
#mapfig svg.hov .sp-edge.on { stroke: var(--accent); }
.focusgrid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; align-items: start; margin-top: 12px; }
.fx svg { min-width: 640px; }
.fx svg text { fill: var(--ink); } .fx svg text.sub, .fx svg .sub { fill: var(--muted); }
.fx svg .lane2 { font: 500 11px var(--mono); letter-spacing: .06em; fill: var(--muted); }
.fx-node { cursor: pointer; } .fx-node rect { fill: var(--panel); stroke: var(--line-strong); } .fx-node:hover rect, .fx-node:focus rect { stroke: var(--accent); stroke-width: 2; outline: none; }
.fx-node rect.cyc { stroke: var(--medium); stroke-dasharray: 5 3; }
.fx-me rect { fill: var(--accent); } .fx-me text { fill: var(--bg) !important; }
.fx-edge { cursor: pointer; } .fx-edge path { fill: none; stroke: color-mix(in srgb, var(--accent) 55%, var(--line-strong)); } .fx-edge path.hit { stroke: transparent; stroke-width: 14; }
.fx-edge text { fill: var(--accent-ink) !important; font-family: var(--mono); }
.fx-edge:hover path:not(.hit), .fx-edge.on path:not(.hit) { stroke: var(--accent); }
.fside { font-size: 13.5px; position: sticky; top: 0; }
.fside .pair { font-size: 12.5px; margin: 0 0 10px; line-height: 1.7; } .fside .pair .arrow { color: var(--muted); }
@media (max-width: 1000px) { .reader, .focusgrid { grid-template-columns: minmax(0, 1fr); } .steps2 { position: static; max-height: none; } }
@media (max-width: 820px) {
  .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
  nav.side { border-right: 0; border-bottom: 1px solid var(--line); display: flex; overflow-x: auto; padding: 6px 10px; gap: 2px; }
  .navb { width: auto; white-space: nowrap; }
  .navb .n, .navhint { display: none; }
  .hit { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .drawer { transition: none; } .spinner { animation: none; } }
`;

const JS = String.raw`
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n).toLocaleString("en");
const prose = (s) => esc(s).replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
const LANG_COLORS = ["#2f7d5b", "#3b6fb6", "#b5672a", "#8a4fb0", "#c0414f", "#4c9a9a", "#9a8a2e", "#6b7280"];

async function api(path, body) {
  const res = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ error: "The Spelunk server stopped. Start it again with spelunk ui." }));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// A clickable path:line that opens the file drawer.
const loc = (path, line, label) => '<button class="lnk" data-open="' + esc(path) + '" data-line="' + (line || "") + '">' + esc(label || (path + (line ? ":" + line : ""))) + "</button>";
const traceBtn = (target, label) => '<button class="lnk" data-trace="' + esc(target) + '">' + esc(label || target) + "</button>";

let state = {}, report = null, view = "overview", riskKind = "";

const VIEWS = [
  ["overview", "Overview", "M3 12h18M3 6h18M3 18h12"],
  ["tour", "First day", "M5 21V4m0 0h11l-2 4 2 4H5"],
  ["find", "Find", "M11 19a8 8 0 1 1 5.3-14 8 8 0 0 1-5.3 14Zm10 2-4.3-4.3"],
  ["ask", "Ask", "M4 5h16v11H9l-5 4V5Zm5 5h.01M12 10h.01M15 10h.01"],
  ["trace", "Trace", "M4 6h6v4H4zM14 14h6v4h-6zM7 10v4a2 2 0 0 0 2 2h5"],
  ["error", "Error lookup", "M12 8v5m0 3v.5M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"],
  ["changes", "Changes", "M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0c0 5-6 4-12 9"],
  ["agents", "Agents", "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 3-5 6-5s6 2 6 5m0-5c1-.6 2-1 3-1 3 0 5 2 5 5"],
  ["risks", "Risks", "M12 3 2 21h20L12 3Zm0 7v5m0 3v.5"],
  ["routes", "Routes", "M4 7h10M4 12h16M4 17h7"],
  ["debug", "Debugging", "M9 9h6v8a3 3 0 0 1-6 0V9Zm-4 3h4m6 0h4M6 7l3 2m9-2-3 2M6 19l3-2m9 2-3-2"],
  ["config", "Config", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  ["explain", "Explain with Claude", "M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"],
  ["share", "Share", "M4 12v7h16v-7M12 3v12m0-12-4 4m4-4 4 4"],
];
const icon = (d) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';

function renderNav() {
  const counts = { risks: report ? report.risks.reduce((n, g) => n + g.items.length, 0) : "", routes: report ? report.routes.length : "", config: report ? report.env.length : "" };
  $("#nav").innerHTML = VIEWS.filter(([id]) => (id !== "agents" || (state.braid && state.braid.here)) && !(state.hosted && id === "share")).map(([id, label, d]) => '<button class="navb" data-view="' + id + '"' + (view === id ? ' aria-current="page"' : "") + ">" + icon(d) + esc(label) + (counts[id] !== undefined && counts[id] !== "" ? '<span class="n">' + counts[id] + "</span>" : "") + "</button>").join("") +
    '<p class="navhint">Click any <span class="mono" style="color:var(--accent-ink)">path:line</span> to read the code there.</p>';
}

function go(v, arg) {
  view = v;
  renderNav();
  const main = $("#main");
  main.scrollTop = 0;
  if (!state.root) return renderWelcome();
  if (!report) { main.innerHTML = '<div class="view empty"><span class="spinner"></span> Reading the repository…</div>'; return; }
  pathSet = null;
  clearTimeout(agentsTimer);
  Promise.resolve(({ agents: vAgents, overview: vOverview, tour: vTour, find: vFind, ask: vAsk, trace: vTrace, error: vError, changes: vChanges, risks: vRisks, routes: vRoutes, debug: vDebug, config: vConfig, explain: vExplain, share: vShare })[v](arg)).catch((e) => { $("#main").innerHTML = '<div class="view"><div class="note err">' + esc(e.message) + "</div></div>"; });
}

// ---------- Welcome & folder picker
function renderWelcome() {
  if (state.hosted) {
    $("#main").innerHTML = '<div class="welcome"><h1>Find your way around a codebase</h1><p class="lede">Paste a link to a public repository and Spelunk shows you how it fits together: what each part does, where things live, how a request flows through the code, and where bugs are likely to hide.</p>' +
      '<form id="hostform" style="display:flex;gap:8px;margin-top:20px;max-width:640px"><input class="field" id="hosturl" placeholder="https://github.com/owner/repo" aria-label="Repository link" autocomplete="off" style="flex:1;max-width:none"><button class="btn primary">Open</button></form>' +
      '<ol><li>Works with public repositories on GitHub, GitLab and Bitbucket.</li><li>Reading the code and drawing the map is free. Ask and Explain use Claude with your own Anthropic API key, which this server keeps in memory for your visit only and never stores.</li><li>For private code, run Spelunk on your own computer: <code>npx spelunk-cli ui</code>.</li><li>New here? Start with First day. Looking for something? Use Find or Ask.</li></ol></div>';
    $("#hostform").addEventListener("submit", (e) => { e.preventDefault(); $("#cloneurl").value = $("#hosturl").value; useLink(); });
    return;
  }
  $("#main").innerHTML = '<div class="welcome"><h1>Find your way around a codebase</h1><p class="lede">Spelunk reads a project folder and shows you how it fits together: what each part does, where things live, how a request flows through the code, and where bugs are likely to hide.</p>' +
    '<p style="margin-top:20px"><button class="btn primary" data-pick>Choose a project folder</button></p><ol><li>Pick the folder that holds the code (the one with package.json, pyproject.toml, go.mod or .git).</li><li>Spelunk reads it locally. Nothing leaves your computer unless you ask Claude to explain it.</li><li>Or paste a GitHub, GitLab or Bitbucket link and Spelunk downloads it for you.</li><li>New here? Start with First day. Looking for something? Use Find or Ask.</li></ol></div>';
}

let pickerDir = "", pickerDirs = [], pickerParent = null;
const recentFolders = () => { try { return JSON.parse(localStorage.getItem("spelunk.recent") || "[]"); } catch { return []; } };
function rememberFolder(path) {
  try { localStorage.setItem("spelunk.recent", JSON.stringify([path, ...recentFolders().filter((p) => p !== path)].slice(0, 6))); } catch {}
}
async function openPicker(dir) {
  const d = $("#picker");
  if (!d.open) d.showModal();
  if (state.hosted) { $("#cloneurl").focus(); return; }
  try {
    const r = await api("/api/browse?dir=" + encodeURIComponent(dir || state.root || state.home));
    pickerDir = r.dir;
    pickerDirs = r.dirs;
    pickerParent = r.parent;
    $("#pickpath").value = r.dir;
    $("#pickfilter").value = "";
    $("#pickhint").textContent = r.looksLikeRepo ? "This looks like a project folder. Use it, or open one below." : "Open a folder below, type or paste a path, or jump with the shortcuts.";
    const recent = recentFolders().filter((p) => p !== r.dir).slice(0, 4);
    $("#pickshort").innerHTML = r.shortcuts.map((x) => '<button type="button" class="chip" data-dir="' + esc(x.path) + '">' + esc(x.label) + "</button>").join("") +
      recent.map((p) => '<button type="button" class="chip" data-dir="' + esc(p) + '" title="' + esc(p) + '">' + esc(p.split("/").filter(Boolean).pop() || p) + "</button>").join("");
    // "/ › home › adi › code": each part clickable, except the folder you're in.
    $("#crumbs").innerHTML = r.crumbs.map((c, i) => (c.path && i < r.crumbs.length - 1 ? '<button type="button" class="lnk" data-dir="' + esc(c.path) + '">' + esc(c.name) + "</button>" : "<b>" + esc(c.name) + "</b>")).join('<span class="muted"> › </span>');
    renderDirs();
  } catch (e) { $("#pickhint").textContent = e.message; }
}
function renderDirs() {
  const f = $("#pickfilter").value.trim().toLowerCase();
  const list = pickerDirs.filter((x) => !f || x.name.toLowerCase().includes(f));
  const base = pickerDir.replace(/\/$/, "") + "/";
  $("#dirs").innerHTML = (pickerParent && !f ? '<div class="dirrow"><button type="button" data-dir="' + esc(pickerParent) + '">↑ Up to ' + esc(pickerParent) + "</button></div>" : "") + list.map((x) => '<div class="dirrow"><button type="button" data-dir="' + esc(base + x.name) + '">' + esc(x.name) + "/" + (x.project ? ' <span class="tag">project</span>' : "") + "</button>" +
    (x.project ? '<button type="button" class="btn" data-usedir="' + esc(base + x.name) + '">Open</button>' : "") + "</div>").join("") ||
    '<p class="muted" style="padding:8px 12px">' + (f ? "No folder here matches." : "No folders here.") + "</p>";
}

async function useFolder(path) {
  $("#picker").close();
  state.root = path;
  report = null;
  renderTop();
  go("overview");
  try {
    await api("/api/open", { root: path });
    rememberFolder(path);
    await refresh();
  } catch (e) { $("#main").innerHTML = '<div class="view"><div class="note err">' + esc(e.message) + '</div><button class="btn" data-pick>Choose another folder</button></div>'; }
}

async function refresh() {
  report = await api("/api/report");
  renderTop();
  go(view);
}

function renderTop() {
  const shown = state.hosted ? (report && report.remote ? report.remote.replace(/^https:\/\//, "") : state.pending || "") : state.root;
  $("#repo").innerHTML = state.root ? '<span class="path" title="' + esc(shown) + '">' + esc(shown) + '</span><button class="btn" data-pick>Change</button>' : '<button class="btn" data-pick>' + (state.hosted ? "Open a repository" : "Choose a folder") + "</button>";
  $("#actions").innerHTML = state.root ? (state.hosted ? "" : '<button class="btn" id="rescan" title="Read the folder again after changes">Rescan</button>') + '<a class="btn" target="_blank" rel="noopener" href="/guide">Field guide ↗</a>' : "";
}

// ---------- The map: filters, hover to light up links, click to focus one part
let mapAreas = [], mapSmall = null;
function mapToolbar() {
  const areas = report.areas || [];
  if (mapSmall === null) mapSmall = report.modules.length > 14;
  return '<div class="maptools">' + (areas.length > 1 ? '<button class="chip" data-area="" aria-pressed="' + !mapAreas.length + '">Everything</button>' + areas.map((a) => '<button class="chip" data-area="' + esc(a.name) + '" aria-pressed="' + mapAreas.includes(a.name) + '">' + esc(a.name) + ' <span class="muted">' + a.count + "</span></button>").join("") : "") +
    '<label class="tick" style="margin:0 0 0 auto"><input type="checkbox" id="mapsmall"' + (mapSmall ? " checked" : "") + "> Hide parts with fewer than 3 files</label></div>";
}
async function redrawMap() {
  const fig = $("#mapfig"); if (!fig) return;
  const r = await api("/api/diagram?areas=" + encodeURIComponent(mapAreas.join(",")) + "&small=" + (mapSmall ? 3 : 0));
  fig.innerHTML = r.svg || '<p class="muted">No parts match.</p>';
  $("#mapcount").textContent = r.shown < r.total ? "Showing " + r.shown + " of " + r.total + " parts." : "";
}
function wireMap() {
  const fig = $("#mapfig"); if (!fig) return;
  if (mapAreas.length || mapSmall) redrawMap();
  fig.addEventListener("mouseover", (e) => {
    const n = e.target.closest(".sp-node"); const svg = fig.querySelector("svg"); if (!svg) return;
    if (!n) { svg.classList.remove("hov"); return; }
    const p = n.dataset.mod, near = new Set([p]);
    svg.querySelectorAll(".sp-edge").forEach((x) => { const on = x.dataset.from === p || x.dataset.to === p; x.classList.toggle("on", on); if (on) { near.add(x.dataset.from); near.add(x.dataset.to); } });
    svg.querySelectorAll(".sp-node").forEach((x) => x.classList.toggle("on", near.has(x.dataset.mod)));
    svg.classList.add("hov");
  });
  fig.addEventListener("mouseleave", () => { const svg = fig.querySelector("svg"); if (svg) svg.classList.remove("hov"); });
  $("#mapsmall").addEventListener("change", (e) => { mapSmall = e.target.checked; redrawMap(); });
}
let focusLink = null;
async function vFocus(path) {
  view = "overview"; renderNav();
  $("#main").innerHTML = '<div class="view wide empty"><span class="spinner"></span></div>';
  const f = await api("/api/focus?module=" + encodeURIComponent(path));
  focusLink = null;
  const name = (p) => p || "(root)";
  const W = 960, bw = 240, bh = 58, gap = 14, colX = [10, (W - bw) / 2, W - bw - 10];
  const MAXN = 8;
  const left = f.usedBy.slice(0, MAXN), right = f.uses.slice(0, MAXN);
  const rows = Math.max(left.length, right.length, 1);
  const H = Math.max(rows * (bh + gap) + 40, 180);
  const cy = H / 2 + 12;
  const maxW = Math.max(1, ...f.usedBy.concat(f.uses).map((x) => x.weight));
  const thick = (w) => (1.2 + 5 * Math.sqrt(w / maxW)).toFixed(1);
  const colY = (n, i) => 30 + (H - 30 - n * (bh + gap)) / 2 + i * (bh + gap);
  const box = (x, y, l, dir) => { const cyc = f.cycles.includes(l.path); return '<g class="fx-node" data-focus="' + esc(l.path) + '" tabindex="0"><rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="8"' + (cyc ? ' class="cyc"' : "") + '/><text x="' + (x + 12) + '" y="' + (y + 22) + '" font-size="13" font-weight="600">' + esc(trunc(name(l.path), 30)) + '</text><text x="' + (x + 12) + '" y="' + (y + 41) + '" font-size="11.5" class="sub">' + esc(trunc(l.about || l.fileCount + " files", 36)) + "</text><title>" + esc(name(l.path)) + (cyc ? " (they import each other: a cycle)" : "") + "</title></g>"; };
  const edge = (x1, y1, x2, y2, l, dir) => { const mx = (x1 + x2) / 2; return '<g class="fx-edge" data-link="' + dir + ":" + esc(l.path) + '"><path d="M' + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + (x2 - 6) + "," + y2 + '" stroke-width="' + thick(l.weight) + '" marker-end="url(#fx-arrow)"/><path class="hit" d="M' + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + (x2 - 6) + "," + y2 + '"/><text x="' + mx + '" y="' + ((y1 + y2) / 2 - 6) + '" font-size="11" text-anchor="middle">' + l.weight + "</text><title>" + l.weight + " import" + (l.weight === 1 ? "" : "s") + ". Click to see which files.</title></g>"; };
  let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="What uses ' + esc(name(f.path)) + ' and what it uses"><defs><marker id="fx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker></defs>' +
    '<text x="' + (colX[0] + 4) + '" y="16" class="lane2">USES ' + esc(trunc(name(f.path).split("/").pop(), 20).toUpperCase()) + " (" + f.usedBy.length + ')</text><text x="' + (colX[2] + 4) + '" y="16" class="lane2">' + esc(trunc(name(f.path).split("/").pop(), 20).toUpperCase()) + " USES (" + f.uses.length + ")</text>";
  left.forEach((l, i) => { const y = colY(left.length, i); svg += edge(colX[0] + bw, y + bh / 2, colX[1], cy, l, "in"); });
  right.forEach((l, i) => { const y = colY(right.length, i); svg += edge(colX[1] + bw, cy, colX[2], y + bh / 2, l, "out"); });
  left.forEach((l, i) => { svg += box(colX[0], colY(left.length, i), l, "in"); });
  right.forEach((l, i) => { svg += box(colX[2], colY(right.length, i), l, "out"); });
  svg += '<g class="fx-me"><rect x="' + colX[1] + '" y="' + (cy - 40) + '" width="' + bw + '" height="80" rx="10"/><text x="' + (colX[1] + 14) + '" y="' + (cy - 12) + '" font-size="14" font-weight="600">' + esc(trunc(name(f.path), 28)) + '</text><text x="' + (colX[1] + 14) + '" y="' + (cy + 8) + '" font-size="11.5">' + f.fileCount + " files · " + fmt(f.lines) + ' lines</text><text x="' + (colX[1] + 14) + '" y="' + (cy + 26) + '" font-size="11.5">' + esc(trunc(f.about || "", 34)) + "</text></g>";
  if (!left.length) svg += '<text x="' + (colX[0] + bw / 2) + '" y="' + cy + '" text-anchor="middle" font-size="12" class="sub">Nothing else imports it</text>';
  if (!right.length) svg += '<text x="' + (colX[2] + bw / 2) + '" y="' + cy + '" text-anchor="middle" font-size="12" class="sub">It imports nothing else here</text>';
  svg += "</svg>";
  const extra = (list, n) => (list.length > n ? '<p class="muted" style="font-size:12.5px">+ ' + (list.length - n) + " more: " + list.slice(n).map((l) => '<button class="lnk" data-focus="' + esc(l.path) + '">' + esc(name(l.path)) + "</button>").join(", ") + "</p>" : "");
  $("#main").innerHTML = '<div class="view wide"><button class="lnk" data-view="overview">← All parts</button><h1 class="mono" style="font-size:24px;margin-top:10px">' + esc(name(f.path)) + "</h1>" + (f.about ? '<p class="lede">' + prose(f.about) + "</p>" : "") +
    '<p class="muted" style="font-size:13px">Only this part and its neighbours. Thicker arrows mean more files import across that link. Click a box to move the focus there, or an arrow to see the files behind it.</p>' +
    '<div class="focusgrid"><div class="figure fx">' + svg + extra(f.usedBy, MAXN) + extra(f.uses, MAXN) + '</div><div class="card fside" id="fside"></div></div></div>';
  const side = () => {
    let h = "";
    if (focusLink) {
      const [dir, p] = [focusLink.slice(0, focusLink.indexOf(":")), focusLink.slice(focusLink.indexOf(":") + 1)];
      const l = (dir === "in" ? f.usedBy : f.uses).find((x) => x.path === p);
      if (l) h += '<button class="lnk" id="fsideback">← About this part</button><h3 style="margin-top:8px">' + esc(dir === "in" ? name(p) + " → " + name(f.path) : name(f.path) + " → " + name(p)) + '</h3><p class="muted" style="font-size:12.5px">' + l.weight + " import" + (l.weight === 1 ? "" : "s") + ":</p>" + groupPairs(l.files) + (l.weight > l.files.length ? '<p class="muted">…and ' + (l.weight - l.files.length) + " more</p>" : "") + '<p style="margin-top:10px"><button class="btn" data-focus="' + esc(p) + '">Focus on ' + esc(trunc(name(p), 24)) + "</button></p>";
    }
    if (!h) {
      h = "<h3 style=\"margin-top:0\">Read first</h3>" + f.readFirst.map((x) => '<div style="margin-bottom:6px">' + loc(x.path, 0, x.path.split("/").pop()) + ' <span class="muted" style="font-size:12px">imported by ' + x.usedBy + "</span>" + (x.doc ? '<div class="muted" style="font-size:12.5px">' + esc(firstSentence(x.doc)) + "</div>" : "") + "</div>").join("") +
        (f.cycles.length ? '<h3>Cycles</h3><p style="font-size:13px">It and ' + f.cycles.map((c) => "<b>" + esc(name(c)) + "</b>").join(", ") + " import each other, so a change on either side can ripple back.</p>" : "") +
        '<p style="margin-top:12px"><button class="btn" data-module="' + esc(f.path) + '">See all its files</button></p>';
    }
    $("#fside").innerHTML = h;
    const b = $("#fsideback"); if (b) b.addEventListener("click", () => { focusLink = null; side(); });
    document.querySelectorAll(".fx-edge").forEach((e) => e.classList.toggle("on", e.dataset.link === focusLink));
  };
  side();
  $(".fx svg").addEventListener("click", (e) => {
    const n = e.target.closest(".fx-node"); if (n) return vFocus(n.dataset.focus);
    const ed = e.target.closest(".fx-edge"); if (ed) { focusLink = ed.dataset.link; side(); }
  });
  $(".fx svg").addEventListener("keydown", (e) => { const n = e.target.closest(".fx-node"); if (n && e.key === "Enter") vFocus(n.dataset.focus); });
}
// "schema.ts, imported by accounts.ts, ask.ts, …": one line per imported file reads faster than one per pair.
function groupPairs(files) {
  const by = new Map();
  for (const [a, b] of files) (by.get(b) || by.set(b, []).get(b)).push(a);
  return [...by].map(([b, as]) => '<div class="pair">' + loc(b, 0, b.split("/").slice(-2).join("/")) + ' <span class="muted">used by ' + as.length + ":</span> " + as.slice(0, 12).map((a) => loc(a, 0, a.split("/").pop())).join(", ") + (as.length > 12 ? " …" : "") + "</div>").join("");
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- Overview
function vOverview() {
  const r = report, o = r.overview;
  const total = r.languages.reduce((n, l) => n + l.lines, 0) || 1;
  const hot = (r.risks.find((g) => g.kind === "hotspot") || { items: [] }).items.slice(0, 6);
  const rank = (c) => (/^(npm run|make|bin|poetry|uv|cargo|go) /.test(c.name + " ") ? 0 : c.kind === "ci" || /^(EXPOSE|CMD|ENTRYPOINT)$/.test(c.name) ? 2 : 1);
  const cmds = r.commands.filter((c) => rank(c) < 2).sort((a, b) => rank(a) - rank(b)).slice(0, 7);
  let h = '<div class="view"><div class="mono muted" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase">' + esc(r.remote ? r.remote.replace(/^https:\/\//, "") : "local project") + (r.commit ? " · " + esc(r.commit.slice(0, 7)) : "") + "</div>" +
    "<h1>" + esc(r.name) + "</h1>" + (o ? '<p class="lede">' + prose(o.oneLiner) + "</p>" : '<p class="lede">How this project is laid out. <button class="lnk" data-view="explain">Ask Claude</button> to add plain-English explanations of each part.</p>') +
    '<div class="stats"><span><b>' + fmt(r.stats.codeFiles) + "</b> code files</span><span><b>" + fmt(r.stats.codeLines) + "</b> lines</span><span><b>" + fmt(r.stats.routes) + "</b> routes</span><span><b>" + fmt(r.stats.tests) + "</b> test files</span><span><b>" + fmt(r.stats.env) + "</b> settings</span></div>" +
    '<div class="langbar">' + r.languages.map((l, i) => '<span style="width:' + (l.lines / total) * 100 + "%;background:" + LANG_COLORS[i % 8] + '" title="' + esc(l.language) + '"></span>').join("") + "</div>" +
    '<div class="stats" style="font-size:12.5px">' + r.languages.slice(0, 6).map((l, i) => '<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:' + LANG_COLORS[i % 8] + '"></i>' + esc(l.language) + " " + Math.round((l.lines / total) * 100) + "%</span>").join("") + "</div>";
  if (o) h += "<h2>What it does</h2><p>" + prose(o.whatItDoes) + "</p><p>" + prose(o.architecture) + "</p>";
  h += '<h2>Where to start</h2><div class="cards">' +
    '<div class="card"><h4>Where the program starts</h4>' + (r.entries.length ? r.entries.map((e) => "<div>" + loc(e.path) + ' <span class="tag">' + esc(e.label) + "</span></div>").join("") : '<p class="muted">No entry point found.</p>') + "</div>" +
    '<div class="card"><h4>Read these first</h4><p class="muted" style="font-size:12.5px">Big files that change often. Most bugs live here.</p>' + (hot.length ? hot.map((x) => "<div>" + loc(x.locations[0].path) + "</div>").join("") : '<p class="muted">No git history to rank by.</p>') + "</div>" +
    '<div class="card"><h4>How to run it</h4>' + (o && o.runLocally.length ? '<ol class="steps" style="margin:0;font-size:13px">' + o.runLocally.map((s) => "<li>" + prose(s) + "</li>").join("") + "</ol>" : cmds.length ? cmds.map((c) => '<div style="margin-bottom:6px"><code>' + esc(c.name) + '</code><div class="muted mono" style="font-size:11.5px;overflow-wrap:anywhere">' + esc(c.command.slice(0, 70)) + "</div></div>").join("") : '<p class="muted">No commands found.</p>') + "</div></div>";
  h += '<h2>How the parts connect</h2><p class="muted">Each box is a folder of code; arrows point to the folders it uses, thicker when more files do. Point at a box to light up its links, click it to see just that part and its neighbours.</p>' + mapToolbar() + '<div class="figure" id="mapfig">' + r.diagram + '</div><p class="muted" id="mapcount" style="font-size:12.5px;margin-top:6px"></p>';
  h += '<h2>The parts</h2><div class="cards">' + r.modules.map((m) => {
    const e = m.explanation, doc = e ? e.summary : (m.files.find((f) => f.doc) || {}).doc;
    return '<button class="card click" data-module="' + esc(m.path) + '"><h4 class="mono" style="font-size:13px">' + esc(m.path || "(root)") + '</h4><p class="muted" style="font-size:12.5px;margin-bottom:6px">' + m.files.length + " files · " + fmt(m.lines) + " lines</p>" + (doc ? '<p style="font-size:13px;margin:0">' + prose(doc.length > 220 ? doc.slice(0, 220) + "…" : doc) + "</p>" : "") + "</button>";
  }).join("") + "</div>";
  if (o && o.glossary.length) h += '<h2>Words this project uses</h2><div class="tw"><table>' + o.glossary.map((g) => "<tr><td><b>" + esc(g.term) + "</b></td><td>" + prose(g.meaning) + "</td></tr>").join("") + "</table></div>";
  $("#main").innerHTML = h + "</div>";
  wireMap();
}

function vModule(path) {
  const m = report.modules.find((x) => x.path === path);
  if (!m) return go("overview");
  const e = m.explanation;
  const usedBy = report.modules.filter((x) => x.dependsOn.some((d) => d.path === m.path));
  let h = '<div class="view"><button class="lnk" data-view="overview">← Overview</button><h1 class="mono" style="font-size:24px;margin-top:10px">' + esc(m.path || "(root)") + '</h1><p class="lede">' + m.files.length + " files · " + fmt(m.lines) + " lines" + (m.owner ? " · package " + esc(m.owner) : "") + "</p>";
  if (e) h += "<p>" + prose(e.summary) + '</p><h3>What it does</h3><ul>' + e.responsibilities.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul>" + (e.gotchas.length ? '<h3>Watch out for</h3><ul>' + e.gotchas.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul>" : "");
  const roles = new Map((e ? e.keyFiles : []).map((k) => [k.path, k.role]));
  h += '<h3>Files</h3><div class="tw"><table><tr><th>File</th><th>What it is</th><th>Lines</th><th>Used by</th></tr>' + [...m.files].sort((a, b) => b.usedBy - a.usedBy).map((f) => "<tr><td>" + loc(f.path, 0, f.path.slice(m.path ? m.path.length + 1 : 0)) + "</td><td>" + prose(roles.get(f.path) || f.doc || "") + '</td><td class="muted">' + fmt(f.lines) + '</td><td class="muted">' + (f.usedBy || "") + "</td></tr>").join("") + "</table></div>";
  h += '<h3>Uses</h3><div class="chips">' + (m.dependsOn.map((d) => '<button class="chip" data-module="' + esc(d.path) + '">' + esc(d.path || "(root)") + "</button>").join("") || '<span class="muted">Nothing else in the project.</span>') + "</div>";
  h += '<h3>Used by</h3><div class="chips">' + (usedBy.map((d) => '<button class="chip" data-module="' + esc(d.path) + '">' + esc(d.path || "(root)") + "</button>").join("") || '<span class="muted">Nothing else in the project.</span>') + "</div>";
  $("#main").innerHTML = h + "</div>";
}

// ---------- Find
let findTimer, findKind = "";
const FIND_KINDS = [["", "Everything"], ["symbol", "Functions & classes"], ["file", "Files"], ["route", "Routes"], ["env", "Settings"]];
function vFind(q) {
  $("#main").innerHTML = '<div class="view"><h1>Find</h1><p class="lede">Type what you are looking for in plain words: a feature, an error message, a page, a setting.</p>' +
    '<div class="searchrow"><input class="field" id="q" type="search" placeholder="e.g. login, send email, payment failed, DATABASE_URL" autocomplete="off" aria-label="What are you looking for?"></div>' +
    '<div class="chips" role="group" aria-label="Show">' + FIND_KINDS.map(([k, label]) => '<button class="chip" data-findkind="' + k + '" aria-pressed="' + (k === findKind) + '">' + label + "</button>").join("") + "</div>" +
    '<div class="chips"><span class="muted" style="font-size:12.5px;align-self:center">Try:</span>' + ["login", "database", "send email", "error handling", "config", "upload"].map((x) => '<button class="chip" data-q="' + x + '">' + x + "</button>").join("") + '</div><div id="hits"></div></div>';
  const input = $("#q");
  input.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(() => search(input.value), 200); });
  document.querySelectorAll("[data-findkind]").forEach((b) => b.addEventListener("click", () => {
    findKind = b.dataset.findkind;
    document.querySelectorAll("[data-findkind]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    search(input.value);
  }));
  if (q) { input.value = q; search(q); }
  input.focus();
}
async function search(q) {
  if (!q.trim()) { $("#hits").innerHTML = ""; return; }
  const hits = await api("/api/where?q=" + encodeURIComponent(q) + (findKind ? "&kind=" + findKind : ""));
  if (q !== $("#q").value) return;
  $("#hits").innerHTML = hits.length ? hits.map((h) => '<div class="hit"><span class="tag">' + esc(h.kind) + "</span><div><div>" + (h.name ? "<b>" + esc(h.name) + "</b> " : "") + loc(h.path, h.line) +
    (h.kind === "symbol" || h.kind === "route" ? ' · ' + traceBtn(h.kind === "route" ? h.name : h.name, "trace") : "") + '</div><div class="why">' + esc(h.why) + "</div></div></div>").join("") : '<p class="empty">Nothing matches' + (findKind ? " in " + FIND_KINDS.find(([k]) => k === findKind)[1].toLowerCase() + '. <button class="lnk" data-findkind-all>Search everything</button>' : ". Try other words, or a name you saw on screen or in an error.") + "</p>";
}

// ---------- Trace: a reader you step through, one function at a time
let tstack = [], captions = {}, autoCaption = false, tsel = 0, tframe = null, showHelpers = false, showOther = false;
function vTrace(target) {
  const ex = report.routes.slice(0, 4).map((r) => r.method + " " + r.path).concat(report.entries.slice(0, 2).map((e) => e.path));
  $("#main").innerHTML = '<div class="view wide"><h1>Trace</h1><p class="lede">Read how the code runs, one function at a time. Start from a web address the app serves or a function name; click a numbered call to step into it, and use the trail at the top to step back.</p>' +
    '<form class="searchrow" id="tf"><input class="field" id="tq" placeholder="e.g. POST /api/login, saveUser, src/server.ts" autocomplete="off" aria-label="What to trace"><button class="btn primary">Trace</button></form>' +
    '<div class="chips">' + ex.map((x) => '<button class="chip" data-trace="' + esc(x) + '">' + esc(x) + "</button>").join("") + '</div><div id="tr"></div></div>';
  $("#tf").addEventListener("submit", (e) => { e.preventDefault(); startTrace($("#tq").value); });
  if (target) { $("#tq").value = target; startTrace(target); }
  else if (tstack.length) loadFrame(tstack[tstack.length - 1]);
}
async function startTrace(target) {
  if (!target.trim()) return;
  $("#tr").innerHTML = '<p class="muted"><span class="spinner"></span> Tracing…</p>';
  const r = await api("/api/frame?target=" + encodeURIComponent(target));
  if (r.frame) { tstack = [{ path: r.frame.path, line: r.frame.line, label: r.frame.label }]; return showFrame(r.frame, r.choices); }
  if (r.choices.length) {
    $("#tr").innerHTML = '<p class="summary">"' + esc(target) + '" matches ' + r.choices.length + ' things. Which one?</p><div class="choices">' + r.choices.map((c) => '<button class="card click" data-frame="' + esc(c.path) + '" data-fline="' + (c.line || "") + '" data-flabel="' + esc(c.label) + '"><b class="mono" style="font-size:13px">' + esc(c.label) + '</b> <span class="tag">' + esc(c.kind === "route" ? "route" : "function") + '</span><div class="muted mono" style="font-size:12px">' + esc(c.path) + ":" + (c.line || "") + "</div>" + (c.doc ? '<div style="font-size:13px;margin-top:4px">' + esc(c.doc.slice(0, 160)) + "</div>" : "") + "</button>").join("") + "</div>";
    return;
  }
  return runTrace(target); // files, and the "nothing found" message
}
async function loadFrame(at) {
  $("#tr").innerHTML = '<p class="muted"><span class="spinner"></span> Opening ' + esc(at.label || at.path) + "…</p>";
  const r = await api("/api/frame?path=" + encodeURIComponent(at.path) + "&line=" + at.line);
  if (!r.frame) { $("#tr").innerHTML = '<p class="empty">Spelunk couldn’t open that code. ' + loc(at.path, at.line) + "</p>"; return; }
  showFrame(r.frame, []);
}
function stepInto(path, line, label) {
  tstack.push({ path, line, label });
  showHelpers = false; showOther = false;
  if (view !== "trace") { view = "trace"; renderNav(); closeFile(); vTrace(); return; }
  loadFrame(tstack[tstack.length - 1]);
}
function stepBack(i) {
  if (tstack.length < 2 && i === undefined) return;
  tstack = tstack.slice(0, i === undefined ? tstack.length - 1 : i + 1);
  loadFrame(tstack[tstack.length - 1]);
}
const firstSentence = (s) => { const m = /^(.{0,140}?[.!?])(\s|$)/.exec(s || ""); return m ? m[1] : (s || "").slice(0, 140); };
const NUMS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const num = (n) => (n <= 20 ? NUMS[n - 1] : "(" + n + ")");
function markLine(text, marks, numbered) {
  // marks: [{name, n, step}]. Wraps the first occurrence of each call on the line; numbered calls get their number right after.
  const spans = [], missing = [];
  for (const m of marks) {
    const re = new RegExp("\\b" + m.name.replace(/[$]/g, "\\$") + "\\b", "g");
    let x, hit = -1;
    while ((x = re.exec(text))) if (!spans.some((sp) => x.index < sp.b && x.index + m.name.length > sp.a)) { hit = x.index; break; }
    if (hit >= 0) spans.push({ a: hit, b: hit + m.name.length, m }); else missing.push(m);
  }
  spans.sort((p, q) => p.a - q.a);
  const mk = (m) => (numbered(m) ? '<b class="mk" data-step="' + m.n + '">' + num(m.n) + "</b>" : "");
  let out = "", at = 0;
  for (const sp of spans) { out += esc(text.slice(at, sp.a)) + '<span class="call' + (sp.m.step.kind === "code" ? "" : " dim") + '" data-step="' + sp.m.n + '">' + esc(text.slice(sp.a, sp.b)) + "</span>" + mk(sp.m); at = sp.b; }
  return out + esc(text.slice(at)) + missing.map(mk).join("");
}
function showFrame(f, choices) {
  tframe = f; tsel = 0;
  const key = f.path + ":" + f.line, cap = captions[key];
  const main = f.steps.filter((s) => s.kind === "code" && !s.helper), helpers = f.steps.filter((s) => s.kind === "code" && s.helper), other = f.steps.filter((s) => s.kind !== "code");
  const what = (s) => (cap && (cap.steps.find((c) => c.n === s.n) || {}).what) || (s.def && s.def.doc ? firstSentence(s.def.doc) : "");
  const stepRow = (s, small) => '<button class="tstep2' + (small ? " small" : "") + '" data-step="' + s.n + '"' + (s.def ? ' data-into="' + esc(s.def.path) + '" data-iline="' + s.def.line + '" data-ilabel="' + esc(s.def.name) + '"' : "") + '><span class="tn' + (s.kind === "code" ? "" : " o") + '">' + s.n + '</span><span class="tb"><span class="hd"><span class="nm">' + esc(s.def ? s.def.name : s.ref) + "</span>" +
    (s.inside ? ' <span class="badge" title="Calls this many functions in the project">' + s.inside + (s.inside === 1 ? " call" : " calls") + " inside</span>" : "") + (s.def && s.def.byName ? ' <span class="tag" title="No import says which function this is; matched on the name alone">by name</span>' : "") + "</span>" +
    (what(s) ? '<span class="what">' + esc(what(s)) + "</span>" : "") +
    '<span class="where">' + (s.def ? esc(s.def.path === f.path ? "line " + s.def.line : s.def.path.split("/").slice(-2).join("/") + ":" + s.def.line) : s.kind === "library" ? "package or built-in" : "Spelunk can’t tell where this goes") + " · called on line " + s.lines[0] + "</span></span></button>";
  const crumbs = tstack.length > 1 ? '<nav class="trail" aria-label="Where you came from">' + tstack.map((c, i) => (i < tstack.length - 1 ? '<button class="lnk" data-crumb="' + i + '">' + esc(c.label || c.path) + "</button>" : "<b>" + esc(c.label || c.path) + "</b>")).join('<span class="muted"> › </span>') + ' <button class="btn" data-crumb="back" title="Back (Backspace)">← Back</button></nav>' : "";
  let h = crumbs + '<div class="fhead"><div><h2 style="margin:6px 0 2px"><span class="tag">' + (f.kind === "route" ? "route" : "function") + "</span> " + esc(f.label) + "</h2>" +
    '<div class="muted" style="font-size:13px">' + loc(f.path, f.line) + " · " + main.length + " step" + (main.length === 1 ? "" : "s") + (helpers.length ? ", " + helpers.length + " helper" + (helpers.length === 1 ? "" : "s") : "") + "</div>" +
    (cap ? '<p class="fsum">' + esc(cap.summary) + ' <span class="tag">Claude</span></p>' : f.doc ? '<p class="fsum">' + esc(f.doc) + "</p>" : "") + "</div>" +
    '<div class="fact">' + (cap ? "" : '<button class="btn" id="capgo">Explain the steps with Claude</button>') + "</div></div>" +
    '<div id="capkey"></div>';
  // How you get here
  const up = f.callers;
  if (f.note) h += '<div class="note">' + esc(f.note) + "</div>";
  h += '<div class="card gethere"><div class="lane">How you get here</div>';
  if (f.kind === "route") {
    h += '<div class="flowrow">' + (up.length ? up.slice(0, 4).map((c) => callerChip(c)).join("") + (up.length > 4 ? '<span class="muted">+' + (up.length - 4) + " more</span>" : "") + '<span class="arrow">→ HTTP →</span>' : '<span class="muted">No front-end code in this project calls it.</span><span class="arrow">→</span>') + '<span class="pill2 on">' + esc(f.label) + "</span></div>";
  } else if (up.length) {
    h += '<div class="flowrow">' + up.slice(0, 8).map((c) => callerChip(c)).join("") + (up.length > 8 ? '<details class="more"><summary>' + (up.length - 8) + " more callers</summary>" + up.slice(8).map((c) => callerChip(c)).join("") + "</details>" : "") + '<span class="arrow">→</span><span class="pill2 on">' + esc(f.label) + "</span></div>";
  } else h += '<p class="muted" style="margin:0">Nothing in the project calls it directly. It may be called by a framework, through an object, or by name at runtime.</p>';
  if (f.fromEntry.length > 1) h += '<div class="muted entry">The program reaches this file through ' + f.fromEntry.map((p) => loc(p, 0, p.split("/").pop())).join(' <span class="arrow">→</span> ') + "</div>";
  h += "</div>";
  // Steps and code side by side
  const lines = {};
  for (const s of f.steps) for (const l of s.lines) (lines[l] = lines[l] || []).push({ name: (s.ref.split(".").pop() || s.ref).replace(/^(svc|evt):/, ""), n: s.n, step: s });
  const throwsAt = new Set(f.throws);
  const numbered = (m) => m.step.kind === "code" && (!m.step.helper || showHelpers);
  const code = f.code.map((t, i) => { const l = f.line + i; return '<span class="l' + (throwsAt.has(l) ? " thr" : "") + '" id="F' + l + '"><i' + (throwsAt.has(l) ? ' title="Throws or raises here"' : "") + ">" + l + "</i><span>" + markLine(t, lines[l] || [], numbered) + "</span></span>"; }).join("");
  h += '<div class="reader"><div class="card steps2"><div class="lane">What happens, in order</div>' +
    (main.length ? main.map((s) => stepRow(s)).join("") : '<p class="muted" style="font-size:13px">It calls nothing else in this project' + (helpers.length ? " except small helpers" : "") + ".</p>") +
    (helpers.length ? '<button class="lnk tog" id="toghelp">' + (showHelpers ? "Hide" : "Show") + " " + helpers.length + " helper" + (helpers.length === 1 ? "" : "s") + " (" + esc(helpers.slice(0, 3).map((s) => s.def.name).join(", ")) + (helpers.length > 3 ? ", …" : "") + ")</button>" + (showHelpers ? helpers.map((s) => stepRow(s, true)).join("") : "") : "") +
    (other.length ? '<button class="lnk tog" id="togother">' + (showOther ? "Hide" : "Show") + " " + other.length + " call" + (other.length === 1 ? "" : "s") + " into packages or code Spelunk can’t follow</button>" + (showOther ? other.map((s) => stepRow(s, true)).join("") : "") : "") +
    '<p class="muted keys">Keys: <kbd>↑</kbd> <kbd>↓</kbd> pick a step, <kbd>Enter</kbd> step in, <kbd>Backspace</kbd> back.</p></div>' +
    '<div class="card codecard"><div class="codehead"><span class="mono muted">' + esc(f.path) + ":" + f.line + "–" + f.endLine + "</span>" + loc(f.path, f.line, "Open the whole file") + '</div><pre class="code">' + code + "</pre>" + (f.truncated ? '<p class="muted" style="padding:0 12px">Long function: the rest is in the file.</p>' : "") + "</div></div>";
  if (choices && choices.length > 1) h += '<p class="muted" style="margin-top:12px">Also matches: ' + choices.filter((c) => !(c.path === f.path && c.line === f.line)).slice(0, 8).map((c) => '<button class="lnk" data-frame="' + esc(c.path) + '" data-fline="' + (c.line || "") + '" data-flabel="' + esc(c.label) + '">' + esc(c.label + " (" + c.path + ")") + "</button>").join(", ") + "</p>";
  $("#tr").innerHTML = h;
  if (main.length) selectStep(main[0].n, false);
  const cg = $("#capgo"); if (cg) cg.addEventListener("click", () => captionNow());
  const th = $("#toghelp"); if (th) th.addEventListener("click", () => { showHelpers = !showHelpers; showFrame(f, choices); });
  const to = $("#togother"); if (to) to.addEventListener("click", () => { showOther = !showOther; showFrame(f, choices); });
  if (autoCaption && !cap) captionNow();
}
const callerChip = (c) => (c.frameLine ? '<button class="pill2" data-frame="' + esc(c.path) + '" data-fline="' + c.frameLine + '" data-flabel="' + esc(c.label) + '" title="Step up into ' + esc(c.label) + " (" + esc(c.path) + ":" + c.line + ')">' + (c.kind === "route" ? '<span class="tag">route</span> ' : c.kind === "client" ? '<span class="tag">front end</span> ' : "↑ ") + esc(c.label) + ' <span class="muted">' + esc(c.path.split("/").pop()) + ":" + c.line + "</span></button>" : '<button class="pill2" data-open="' + esc(c.path) + '" data-line="' + c.line + '">' + esc(c.label) + ' <span class="muted">:' + c.line + "</span></button>");
function selectStep(n, scroll = true) {
  tsel = n;
  document.querySelectorAll(".tstep2").forEach((b) => b.classList.toggle("sel", Number(b.dataset.step) === n));
  document.querySelectorAll(".code .call, .code .mk").forEach((b) => b.classList.toggle("sel", Number(b.dataset.step) === n));
  const s = tframe && tframe.steps.find((x) => x.n === n);
  document.querySelectorAll(".code .l.cur").forEach((l) => l.classList.remove("cur"));
  if (s) { const el = document.getElementById("F" + s.lines[0]); if (el) { el.classList.add("cur"); if (scroll) el.scrollIntoView({ block: "nearest" }); } }
}
async function captionNow(apiKey) {
  const f = tframe; if (!f) return;
  const box = $("#capkey"), btn = $("#capgo");
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Asking Claude…'; }
  try {
    captions[f.path + ":" + f.line] = await api("/api/frame/explain", { path: f.path, line: f.line, apiKey });
    autoCaption = true;
    if (tframe === f) showFrame(f, []);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Explain the steps with Claude"; }
    if (/API key/.test(e.message) && box) {
      box.innerHTML = '<form class="searchrow" id="capform"><input class="field" id="capk" type="password" placeholder="Anthropic API key (sk-ant-…)" autocomplete="off" aria-label="Anthropic API key"><button class="btn primary">Explain</button></form><p class="muted" style="font-size:12.5px">Kept in memory for this visit only, never saved. Each function costs about a cent; answers are cached.</p>';
      $("#capform").addEventListener("submit", (ev) => { ev.preventDefault(); captionNow($("#capk").value); });
    } else if (box) box.innerHTML = '<div class="note err">' + esc(e.message) + "</div>";
  }
}

// The older trace, still used for files: imports, importers, and how entry points reach them.
const tree = (nodes, top) => '<ul class="tree' + (top ? " top" : "") + '">' + nodes.map((n) => "<li>" + traceBtn(n.name) + " " + loc(n.path, n.line) + (n.byName ? ' <span class="tag" title="No import says which function this is; matched on the name alone">by name</span>' : "") + (n.children.length ? tree(n.children) : "") + "</li>").join("") + "</ul>";
const callStats = (c) => {
  const parts = [c.resolved + " call" + (c.resolved === 1 ? "" : "s") + " resolved"];
  if (c.byName) parts.push(c.byName + " matched by name only");
  if (c.library) parts.push(c.library + " into packages or built-ins");
  if (c.unresolved.length) parts.push(c.unresolved.length + " unresolved (" + c.unresolved.slice(0, 5).map(esc).join(", ") + (c.unresolved.length > 5 ? ", …" : "") + ")");
  return '<p class="muted" style="font-size:12.5px">' + parts.join(", ") + ".</p>";
};
const steps = (nodes, top) => '<ul class="tree' + (top ? " top" : "") + '">' + nodes.map((s) => "<li>" + loc(s.path, s.line) + (s.via.length ? ' <span class="muted" style="font-size:12.5px">' + esc(s.via.slice(0, 6).join(", ")) + "</span>" : "") + (s.children.length ? steps(s.children) : "") + "</li>").join("") + "</ul>";
async function runTrace(target) {
  if (!target.trim()) return;
  $("#tr").innerHTML = '<p class="muted"><span class="spinner"></span> Tracing…</p>';
  const { traces, more } = await api("/api/trace?target=" + encodeURIComponent(target));
  if (!traces.length) { $("#tr").innerHTML = '<p class="empty">Nothing called "' + esc(target) + '". <button class="lnk" data-find="' + esc(target) + '">Search for it instead</button>.</p>'; return; }
  $("#tr").innerHTML = traces.map((t) => {
    let h = '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0"><span class="tag">' + esc(t.target.kind) + "</span> " + esc(t.target.label) + "</h3><div>" + loc(t.target.path, t.target.line) + "</div>";
    if (t.callers.length) h += "<h3>Called from the front end</h3>" + t.callers.map((c) => "<div>" + loc(c.path, c.line) + ' <span class="muted mono" style="font-size:12px">' + esc(c.label) + "</span></div>").join("");
    if (t.fromEntries.length) h += "<h3>How the program gets here</h3>" + t.fromEntries.map((p) => '<div class="chain">' + p.map((x) => loc(x)).join('<span class="arrow">→</span>') + "</div>").join("");
    if (t.note) h += '<div class="note" style="margin-top:10px">' + esc(t.note) + "</div>";
    if (t.flow.length) h += "<h3>What it calls</h3>" + tree(t.flow, true);
    if (t.calls && t.target.kind !== "file" && t.calls.resolved + t.calls.byName + t.calls.library + t.calls.unresolved.length) h += callStats(t.calls);
    if (t.downstream.length) h += "<h3>What it uses</h3>" + steps(t.downstream, true);
    if (t.usedBy.length) h += "<h3>Used by (" + t.usedBy.length + ")</h3>" + t.usedBy.slice(0, 40).map((u) => "<div>" + loc(u.path, u.line) + "</div>").join("");
    if (!t.note && !t.callers.length && !t.flow.length && !t.downstream.length && !t.usedBy.length && !t.fromEntries.length) h += '<p class="muted" style="margin-top:10px">No connections found. It may be reached by name at runtime, or by a framework convention.</p>';
    return h + "</div>";
  }).join("") + (more.length ? '<p class="muted">Also matches: ' + more.map((m) => loc(m.path, m.line, m.label + " (" + m.path + ")")).join(", ") + "</p>" : "");
}

// ---------- Risks
function vRisks() {
  const groups = report.risks;
  const list = riskKind ? groups.filter((g) => g.kind === riskKind) : groups;
  let h = '<div class="view"><h1>Risks</h1><p class="lede">Places where bugs tend to hide. These are hints from reading the code, not proof that something is broken.</p><div class="chips"><button class="chip" data-kind="" aria-pressed="' + !riskKind + '">All</button>' +
    groups.map((g) => '<button class="chip" data-kind="' + g.kind + '" aria-pressed="' + (riskKind === g.kind) + '">' + esc(g.kind.replace(/-/g, " ")) + " " + g.items.length + "</button>").join("") + "</div>";
  if (!groups.length) h += '<p class="empty">Nothing flagged.</p>';
  for (const g of list) {
    h += "<h2>" + esc(g.kind.replace(/-/g, " ")) + ' <span class="muted" style="font-size:15px">' + g.items.length + "</span>" + (canBraid() ? ' <button class="btn" style="font-size:12.5px;vertical-align:3px" data-braidkind="' + g.kind + '" title="Start a Braid agent that fixes these">Fix with Braid</button>' : "") + '</h2><p class="muted">' + prose(g.info) + "</p>";
    h += g.items.slice(0, riskKind ? 300 : 12).map((x) => '<div class="risk sev-' + x.severity + '"><span class="pill ' + x.severity + '">' + x.severity + "</span> " + esc(x.title) + (x.detail !== g.info ? '<div class="muted" style="font-size:13px">' + prose(x.detail) + "</div>" : "") + "<div>" + x.locations.slice(0, 6).map((l) => loc(l.path, l.line)).join(" · ") + "</div></div>").join("");
    if (!riskKind && g.items.length > 12) h += '<button class="lnk" data-kind="' + g.kind + '">Show all ' + g.items.length + "</button>";
  }
  $("#main").innerHTML = h + "</div>";
}

// ---------- Routes
function vRoutes() {
  $("#main").innerHTML = '<div class="view"><h1>Routes</h1><p class="lede">Every web address the server answers, where its code is, and which front-end code calls it.</p><div class="searchrow"><input class="field" id="rf" type="search" placeholder="Filter, e.g. /api/users or POST" aria-label="Filter routes"></div><div id="rt"></div></div>';
  const draw = (f) => {
    const rows = report.routes.filter((r) => !f || (r.method + " " + r.path + " " + r.file).toLowerCase().includes(f.toLowerCase()));
    $("#rt").innerHTML = rows.length ? '<div class="tw"><table><tr><th>Method</th><th>Path</th><th>Code</th><th>Called from</th><th></th></tr>' + rows.map((r) => '<tr><td><span class="tag">' + esc(r.method) + '</span></td><td class="mono" style="font-size:12.5px">' + esc(r.path) + "</td><td>" + loc(r.file, r.line) + "</td><td>" + r.callers.slice(0, 3).map((c) => loc(c.path, c.line)).join("<br>") + "</td><td>" + traceBtn(r.method + " " + r.path, "trace") + "</td></tr>").join("") + "</table></div>" : '<p class="empty">No routes found.</p>';
  };
  $("#rf").addEventListener("input", (e) => draw(e.target.value));
  draw("");
}

// ---------- Debugging
function vDebug() {
  const d = report.overview && report.overview.debugging;
  let h = '<div class="view"><h1>Debugging</h1><p class="lede">Something broke? Work through it in this order.</p><ol class="steps"><li>Reproduce it and copy the exact error text.</li><li>Paste words from the error into <button class="lnk" data-view="find">Find</button> to see the code that raises or logs it.</li><li>Open that code, then <button class="lnk" data-view="trace">Trace</button> it to see who calls it and what it calls.</li><li>Check <button class="lnk" data-view="risks">Risks</button> for that file. Swallowed errors and hotspots are the usual suspects.</li></ol>';
  if (d) {
    h += "<h2>First checks</h2><ul>" + d.firstChecks.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul><h2>Where the logs are</h2><ul>" + d.logs.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul>";
    if (d.failurePoints.length) h += '<h2>Common failures</h2><div class="tw"><table><tr><th>Symptom</th><th>Likely cause</th><th>Where to look</th></tr>' + d.failurePoints.map((p) => "<tr><td>" + prose(p.symptom) + "</td><td>" + prose(p.likelyCause) + "</td><td>" + prose(p.whereToLook) + "</td></tr>").join("") + "</table></div>";
  } else h += '<div class="note">Claude can write a debugging guide for this project: first checks, where the logs are, and common failures with their likely causes. <button class="lnk" data-view="explain">Explain with Claude</button>.</div>';
  const flows = (report.overview ? report.overview.flows : []);
  if (flows.length) h += "<h2>Main flows</h2>" + flows.map((f) => '<div class="card" style="margin-bottom:12px"><h4>' + esc(f.name) + '</h4><p class="muted" style="font-size:13px">' + prose(f.summary) + '</p><ol class="steps">' + f.steps.map((s) => "<li>" + prose(s.what) + " " + loc(s.path, s.line) + "</li>").join("") + "</ol></div>").join("");
  if (report.errorLogs.length) h += '<h2>Where errors are logged</h2><div class="tw"><table>' + report.errorLogs.slice(0, 80).map((l) => "<tr><td>" + loc(l.path, l.line) + '</td><td class="mono" style="font-size:12px">' + esc(l.text.slice(0, 120)) + "</td></tr>").join("") + "</table></div>";
  $("#main").innerHTML = h + "</div>";
}

// ---------- Config
function vConfig() {
  const env = report.env;
  $("#main").innerHTML = '<div class="view"><h1>Config</h1><p class="lede">Settings the code reads from environment variables. A missing one is a common reason an app will not start.</p>' +
    (env.length ? '<div class="tw"><table><tr><th>Variable</th><th>Read at</th><th>In the example .env</th></tr>' + env.map((e) => '<tr><td class="mono" style="font-size:12.5px">' + esc(e.name) + "</td><td>" + (e.readAt.slice(0, 3).map((l) => loc(l.path, l.line)).join("<br>") || '<span class="muted">never read</span>') + "</td><td>" + (e.documented ? "yes" : '<span class="pill medium">missing</span>') + "</td></tr>").join("") + "</table></div>" : '<p class="empty">No environment variables found.</p>') + "</div>";
}

// ---------- Explain
let pollTimer;
async function vExplain() {
  const done = report.overview ? '<div class="note">Claude explained this project on ' + esc((report.explainedAt || "").slice(0, 10)) + '. Run it again after big changes; unchanged parts are reused for free.</div>' : "";
  $("#main").innerHTML = '<div class="view"><h1>Explain with Claude</h1><p class="lede">Claude reads the code and writes a plain-English summary of every part, the main flows, how to run it, a debugging guide and a glossary. They show up across this dashboard and in the field guide.</p>' + done + '<div id="plan"><p class="muted"><span class="spinner"></span> Working out the cost…</p></div><div id="job"></div></div>';
  try {
    const p = await api("/api/explain/plan");
    $("#plan").innerHTML = '<div class="card" style="max-width:640px"><h4>What it will cost</h4><p>' + p.modules.length + " parts, about " + fmt(Math.round(p.estimate.inputTokens / 1000)) + "k tokens in and " + fmt(Math.round(p.estimate.outputTokens / 1000)) + "k out with " + esc(p.model) + ": roughly <b>$" + p.estimate.dollars.toFixed(2) + "</b>, charged to your Anthropic account.</p>" +
      (state.hasEnvKey ? '<p class="muted" style="font-size:13px">Using the ANTHROPIC_API_KEY Spelunk was started with.</p>' : '<label for="key" style="font-size:13px">Anthropic API key</label><input class="field" id="key" type="password" autocomplete="off" placeholder="sk-ant-…" style="display:block;width:100%;margin:4px 0 6px"><p class="muted" style="font-size:12.5px">' + (state.hosted ? "Sent to this server for this run only, and never stored or logged." : "Used for this run only. It is not saved anywhere.") + ' Get one at console.anthropic.com.</p>') +
      '<button class="btn primary" id="go">Explain this project</button></div>';
    $("#go").addEventListener("click", startExplain);
  } catch (e) { $("#plan").innerHTML = '<div class="note err">' + esc(e.message) + "</div>"; }
  pollJob();
}
async function startExplain() {
  const key = $("#key") ? $("#key").value : "";
  try {
    $("#go").disabled = true;
    await api("/api/explain", { apiKey: key });
    if ($("#key")) $("#key").value = "";
    pollJob();
  } catch (e) { $("#go").disabled = false; $("#job").innerHTML = '<div class="note err">' + esc(e.message) + "</div>"; }
}
async function pollJob() {
  clearTimeout(pollTimer);
  if (view !== "explain") return;
  const j = await api("/api/explain/status");
  if (!j.messages.length && !j.running) return;
  $("#job").innerHTML = "<h3>" + (j.running ? '<span class="spinner"></span> Claude is reading the code' : j.error ? "Stopped" : "Done") + '</h3><div class="log">' + esc(j.messages.join("\n")) + "</div>" + (j.error ? '<div class="note err" style="margin-top:10px">' + esc(j.error) + "</div>" : "") + (j.summary ? '<p style="margin-top:10px">' + esc(j.summary) + ' <button class="lnk" data-view="overview">See the overview</button></p>' : "");
  if ($("#go")) $("#go").disabled = j.running;
  if (j.running) pollTimer = setTimeout(pollJob, 1500);
  else if (j.summary && !report.overview) report = await api("/api/report");
}

// ---------- Markdown answers, with path:line citations as links
let pathSet = null;
const knownPath = (p) => { if (!pathSet) pathSet = new Set(report.modules.flatMap((m) => m.files.map((f) => f.path))); return pathSet.has(p); };
function citeOrCode(c) {
  const m = c.match(/^([\w@./-]+\.[A-Za-z0-9]+)(?::(\d+)(?:-\d+)?)?$/);
  return m && knownPath(m[1]) ? loc(m[1], Number(m[2]) || 0) : "<code>" + esc(c) + "</code>";
}
function mdInline(s) {
  return s.split(/\x60([^\x60]+)\x60/).map((part, i) => i % 2 ? citeOrCode(part) :
    esc(part).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/([\w@./-]+\.[A-Za-z0-9]+)(?::(\d+))?/g, (all, p, l) => knownPath(p) ? loc(p, Number(l) || 0) : all)).join("");
}
function md(text) {
  const out = [], lines = String(text || "").split("\n");
  let list = null, para = [], fence = null;
  const flush = () => { if (para.length) out.push("<p>" + mdInline(para.join(" ")) + "</p>"); para = []; if (list) { out.push("</" + list + ">"); list = null; } };
  for (const line of lines) {
    if (fence !== null) { if (/^\x60\x60\x60/.test(line)) { out.push('<pre class="log">' + esc(fence.join("\n")) + "</pre>"); fence = null; } else fence.push(line); continue; }
    if (/^\x60\x60\x60/.test(line)) { flush(); fence = []; continue; }
    const h = line.match(/^#{1,4}\s+(.*)/), li = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.*)/);
    if (h) { flush(); out.push("<h3>" + mdInline(h[1]) + "</h3>"); }
    else if (li) { if (para.length) { out.push("<p>" + mdInline(para.join(" ")) + "</p>"); para = []; } const kind = li[1] ? "ol" : "ul"; if (list !== kind) { if (list) out.push("</" + list + ">"); out.push("<" + kind + ">"); list = kind; } out.push("<li>" + mdInline(li[2]) + "</li>"); }
    else if (!line.trim()) flush();
    else { if (list) { out.push("</" + list + ">"); list = null; } para.push(line.trim()); }
  }
  if (fence !== null) out.push('<pre class="log">' + esc(fence.join("\n")) + "</pre>");
  flush();
  return out.join("");
}

// ---------- First day (tour)
const tourKey = () => "spelunk-tour:" + state.root;
function tourDone() { try { return new Set(JSON.parse(localStorage.getItem(tourKey()) || "[]")); } catch { return new Set(); } }
async function vTour() {
  $("#main").innerHTML = '<div class="view empty"><span class="spinner"></span></div>';
  const steps = await api("/api/tour");
  if (view !== "tour") return;
  const done = tourDone();
  const n = steps.filter((s) => done.has(s.id)).length;
  let h = '<div class="view"><h1>Your first day</h1><p class="lede">A walk through ' + esc(report.name) + ' in ' + steps.length + ' steps. Open each file in order; you do not need to read every line. Tick a step when you are done; your progress is kept in this browser.</p>' +
    '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + steps.length + '" aria-valuenow="' + n + '"><span style="width:' + (n / steps.length) * 100 + '%"></span></div><p class="muted" style="font-size:13px">' + n + " of " + steps.length + " done</p>";
  h += steps.map((s, i) => '<section class="tstep' + (done.has(s.id) ? " done" : "") + '"><div class="tnum">' + (done.has(s.id) ? "✓" : i + 1) + '</div><div class="tbody"><h3 style="margin-top:2px">' + esc(s.title) + "</h3><p>" + prose(s.body) + "</p>" +
    (s.commands && s.commands.length ? '<div class="log" style="margin-bottom:10px">' + s.commands.map((c) => esc(c.command) + '  <span class="muted"># ' + esc(c.why) + "</span>").join("\n") + "</div>" : "") +
    (s.open.length ? '<div class="topen">' + s.open.map((f) => "<div>" + loc(f.path, f.line || 0) + ' <span class="muted" style="font-size:13px">' + esc(f.why) + "</span></div>").join("") + "</div>" : "") +
    (s.tryIt ? '<p style="margin-top:8px;font-size:13.5px">Try it: ' + (s.tryIt.kind === "trace" ? traceBtn(s.tryIt.query, s.tryIt.prompt) : '<button class="lnk" data-find="' + esc(s.tryIt.query) + '">' + esc(s.tryIt.prompt) + "</button>") + "</p>" : "") +
    '<label class="tick"><input type="checkbox" data-tour="' + esc(s.id) + '"' + (done.has(s.id) ? " checked" : "") + "> Done</label></div></section>").join("");
  $("#main").innerHTML = h + "</div>";
}
document.addEventListener("change", (e) => {
  const id = e.target.dataset && e.target.dataset.tour;
  if (!id) return;
  const done = tourDone();
  if (e.target.checked) done.add(id); else done.delete(id);
  try { localStorage.setItem(tourKey(), JSON.stringify([...done])); } catch {}
  vTour();
});

// ---------- Ask
let askHistory = [], askPoll, askKeyGiven = false;
function vAsk() {
  const needKey = !state.hasEnvKey && !askKeyGiven;
  let h = '<div class="view"><h1>Ask</h1><p class="lede">Ask anything about this code in plain words. Claude searches and reads the project the way an engineer would, and every answer links to the lines it is based on.</p>' +
    '<div id="convo">' + askHistory.map((x) => '<div class="q">' + esc(x.question) + '</div><div class="a">' + md(x.answer) + (x.steps ? '<details class="muted" style="font-size:12.5px"><summary>Looked at ' + x.steps.length + " places</summary>" + x.steps.map((s) => "<div>" + esc(s.label) + "</div>").join("") + "</details>" : "") + "</div>").join("") + '</div><div id="askrun"></div>' +
    '<form id="askf" class="askbox"><textarea class="field" id="askq" rows="3" placeholder="e.g. How does saving a page work? Where are permissions checked? Why would login fail with a 401?" aria-label="Your question"></textarea>' +
    (needKey ? '<input class="field" id="askkey" type="password" autocomplete="off" placeholder="Anthropic API key (sk-ant-…), ' + (state.hosted ? "kept in memory on this server for your visit only" : "kept in memory until you close Spelunk") + '" aria-label="Anthropic API key">' : "") +
    '<div style="display:flex;gap:8px;align-items:center"><button class="btn primary" id="askgo">Ask</button>' + (askHistory.length ? '<button type="button" class="btn" id="asknew">New conversation</button>' : "") + '<span class="muted" style="font-size:12.5px">Uses ' + esc(state.model) + " on your Anthropic account; a question usually costs a few cents.</span></div></form>";
  if (!askHistory.length) h += '<div class="chips" style="margin-top:12px">' + ["What does this project do, in two sentences?", "How does a request reach the database?", "Where is authentication handled?", "What should I read first to fix bugs here?"].map((x) => '<button class="chip" data-ask="' + esc(x) + '">' + esc(x) + "</button>").join("") + "</div>";
  $("#main").innerHTML = h + "</div>";
  $("#askf").addEventListener("submit", (e) => { e.preventDefault(); startAsk($("#askq").value); });
  $("#askq").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) startAsk($("#askq").value); });
  if ($("#asknew")) $("#asknew").addEventListener("click", () => { askHistory = []; vAsk(); });
  pollAsk();
}
async function startAsk(q) {
  if (!q.trim()) return;
  const key = $("#askkey") ? $("#askkey").value.trim() : "";
  try {
    $("#askgo").disabled = true;
    await api("/api/ask", { question: q, history: askHistory.map((x) => ({ question: x.question, answer: x.answer })), apiKey: key });
    if (key) askKeyGiven = true;
    $("#askq").value = "";
    if ($("#askkey")) $("#askkey").remove();
    pollAsk();
  } catch (e) { $("#askgo").disabled = false; $("#askrun").innerHTML = '<div class="note err">' + esc(e.message) + "</div>"; }
}
async function pollAsk() {
  clearTimeout(askPoll);
  if (view !== "ask") return;
  const j = await api("/api/ask/status");
  if (!j.question) return;
  if (j.running) {
    $("#askrun").innerHTML = '<div class="q">' + esc(j.question) + '</div><div class="a"><p class="muted"><span class="spinner"></span> Claude is looking…</p><div class="log">' + esc(j.steps.map((s) => s.label).join("\n") || "Starting") + "</div></div>";
    if ($("#askgo")) $("#askgo").disabled = true;
    askPoll = setTimeout(pollAsk, 1000);
    return;
  }
  const last = askHistory[askHistory.length - 1];
  if (j.result && !(last && last.question === j.question && last.answer === j.result.answer)) { askHistory.push({ question: j.question, answer: j.result.answer, steps: j.steps }); return vAsk(); }
  if (j.error && !(last && last.question === j.question)) $("#askrun").innerHTML = '<div class="q">' + esc(j.question) + '</div><div class="note err">' + esc(j.error) + "</div>";
  if ($("#askgo")) $("#askgo").disabled = false;
}

// ---------- Error lookup
function vError(text) {
  $("#main").innerHTML = '<div class="view"><h1>Error lookup</h1><p class="lede">Paste an error message, a log line or a whole stack trace. Spelunk finds the code that raised it and where to start reading, even when the trace comes from a server or compiled code.</p>' +
    '<form id="ef" class="askbox"><textarea class="field mono" id="et" rows="8" placeholder="TypeError: Cannot read properties of undefined (reading \'id\')&#10;    at updatePage (/app/dist/services/pages.js:158:3)" aria-label="Error or stack trace" style="font-size:12.5px"></textarea><div><button class="btn primary">Find the code</button></div></form><div id="er"></div></div>';
  $("#ef").addEventListener("submit", (e) => { e.preventDefault(); runError($("#et").value); });
  if (text) { $("#et").value = text; runError(text); }
}
async function runError(text) {
  if (!text.trim()) return;
  $("#er").innerHTML = '<p class="muted"><span class="spinner"></span></p>';
  try {
    const r = await api("/api/error", { text });
    let h = r.message ? '<p class="mono" style="font-size:13px;margin-top:14px">' + esc(r.message) + "</p>" : "";
    h += r.start ? '<div class="card start"><h4>Start here</h4><div>' + loc(r.start.path, r.start.line || 0) + (r.start.symbol ? " in <b>" + esc(r.start.symbol.name) + "()</b> " + traceBtn(r.start.symbol.name, "trace") : "") + '</div><p class="muted" style="font-size:13px;margin:6px 0 0">' + esc(r.start.why) + "</p></div>"
      : '<div class="note">This did not match code in the project. Paste more of the stack trace, or search for words from the message in <button class="lnk" data-find="' + esc((r.message || text).slice(0, 80)) + '">Find</button>.</div>';
    if (r.origins.length) h += "<h3>Where this message comes from</h3>" + r.origins.map((o) => '<div class="hit"><span class="tag">' + o.kind + "</span><div>" + loc(o.path, o.line) + (o.symbol ? ' <span class="muted">in ' + esc(o.symbol.name) + "()</span>" : "") + '<div class="why mono" style="font-size:12px">' + esc(o.text.slice(0, 200)) + "</div></div></div>").join("");
    const ours = r.frames.filter((f) => f.file);
    if (ours.length) h += "<h3>Stack frames in this project</h3><p class=\"muted\" style=\"font-size:13px\">Innermost first. " + (r.frames.length - ours.length) + " frames in libraries or the runtime are hidden.</p>" + ours.map((f) => "<div>" + loc(f.file, f.line || 0) + " " + (f.symbol ? "<b>" + esc(f.symbol.name) + "</b>" : f.fn ? '<span class="muted">' + esc(f.fn) + "</span>" : "") + "</div>").join("");
    if (r.callers.length) h += "<h3>Files that call into it</h3>" + r.callers.map((c) => "<div>" + loc(c) + "</div>").join("");
    if (canBraid() && (r.start || r.origins.length)) h += '<p style="margin-top:14px"><button class="btn" id="braiderr">Fix with Braid</button> <span class="muted" style="font-size:13px">Starts an agent with this error and where Spelunk traced it.</span></p>';
    if (r.risks.length) h += "<h3>Risks in these files</h3>" + r.risks.map((x) => '<div class="risk sev-' + x.severity + '"><span class="pill ' + x.severity + '">' + x.severity + "</span> " + esc(x.title) + "<div>" + x.locations.slice(0, 3).map((l) => loc(l.path, l.line)).join(" · ") + "</div></div>").join("");
    $("#er").innerHTML = h;
  } catch (e) { $("#er").innerHTML = '<div class="note err">' + esc(e.message) + "</div>"; }
}

// ---------- Agents (Braid)
let agentsTimer = 0, agentPick = "", agentShown = "";
const canBraid = () => Boolean(state.braid && state.braid.canStart);
const SEV_PILL = { conflict: "high", semantic: "medium", overlap: "low" };
async function vAgents() {
  const m = await api("/api/agents");
  if (view !== "agents") return;
  let h = '<div class="view"><h1>Agents</h1>';
  if (!m.here) { $("#main").innerHTML = h + '<p class="empty">Braid isn\'t running agents here.</p></div>'; return; }
  const live = m.agents.filter((a) => a.live);
  h += '<p class="lede">What each <a href="https://github.com/ar-0911/braid" target="_blank" rel="noopener">Braid</a> agent is changing, on the map of the code, and where they are about to collide. Updates every few seconds.</p>';
  h += '<div class="stats"><span><b>' + live.length + "</b> working</span><span>landing on <b>" + esc(m.base) + "</b></span>" + (m.waiting ? "<span><b>" + m.waiting + "</b> waiting for your OK (braid approvals)</span>" : "") + "<span>watcher <b>" + (m.watcher ? "running" : "stopped") + "</b></span></div>";
  if (m.risks.length) h += "<h2>Predicted collisions</h2>" + m.risks.map((r) => '<div class="risk sev-' + SEV_PILL[r.severity] + '"><span class="pill ' + SEV_PILL[r.severity] + '">' + esc(r.severity) + "</span> <b>" + esc(r.a) + "</b> and <b>" + esc(r.b) + "</b>" + (r.modules.length ? ' <span class="muted">in ' + r.modules.map((p) => '<button class="lnk" data-module="' + esc(p) + '">' + esc(p || "(root)") + "</button>").join(", ") + "</span>" : "") + '<div class="muted mono" style="font-size:12px">' + r.files.slice(0, 8).map(esc).join(" · ") + "</div></div>").join("");
  const shared = m.modules.filter((x) => x.agents.length > 1);
  if (shared.length) h += '<div class="note">More than one agent is changing ' + shared.map((x) => '<button class="lnk" data-module="' + esc(x.path) + '">' + esc(x.path || "(root)") + "</button> (" + x.agents.map((a) => esc(a.name)).join(", ") + ")").join(", ") + ".</div>";
  h += '<div class="figure">' + report.diagram + "</div>";
  h += '<h2>Agents</h2><div class="cards">' + (m.agents.length ? m.agents.map((a) => '<div class="card"' + (a.live ? "" : ' style="opacity:.6"') + '><h4>' + esc(a.name) + ' <span class="tag">' + esc(a.status) + "</span></h4><p style=\"font-size:13px;margin:0 0 8px\">" + esc(a.task.slice(0, 220)) + "</p>" +
    (a.modules.length ? '<div class="muted" style="font-size:12.5px">Parts: ' + a.modules.map((p) => '<button class="lnk" data-module="' + esc(p) + '">' + esc(p || "(root)") + "</button>").join(", ") + "</div>" : "") +
    (a.files.length ? '<div style="font-size:12.5px;margin-top:4px">' + a.files.slice(0, 8).map((f) => loc(f)).join(" · ") + (a.files.length > 8 ? " +" + (a.files.length - 8) : "") + "</div>" : '<div class="muted" style="font-size:12.5px">No changes yet.</div>') +
    (a.needs ? '<div class="note err" style="margin:8px 0 0;font-size:12.5px">Needs you: ' + esc(a.needs.slice(0, 200)) + "</div>" : "") +
    (a.live && a.files.length ? '<p style="margin:8px 0 0"><button class="btn" data-agentimpact="' + esc(a.name) + '">What it touches</button></p>' : "") + "</div>").join("") : '<p class="empty">No agents yet.</p>') + "</div>";
  if (canBraid()) h += '<h2>Start more</h2><form id="bf" class="askbox"><textarea class="field" id="bg" rows="3" placeholder="Describe the work. Braid plans it into parallel tasks and starts an agent for each." aria-label="Goal for Braid"></textarea><div><button class="btn primary">Plan and start</button></div></form>';
  $("#main").innerHTML = h + "</div>";
  if ($("#bf")) $("#bf").addEventListener("submit", (e) => { e.preventDefault(); startBraid({ goal: $("#bg").value }); });
  clearTimeout(agentsTimer);
  const tick = () => {
    if (view !== "agents") return;
    // Don't redraw under someone typing a goal.
    if ($("#bg") && (document.activeElement === $("#bg") || $("#bg").value)) { agentsTimer = setTimeout(tick, 5000); return; }
    vAgents().catch(() => {});
  };
  agentsTimer = setTimeout(tick, 5000);
}
async function startBraid(body) {
  const what = body.goal ? "plan this and start agents for it" : "start a Braid agent for this";
  if (!confirm("Braid will " + what + ". The agents edit code on their own branches and use your Claude account. Go ahead?")) return;
  try {
    const r = await api("/api/braid/start", body);
    state = await api("/api/state");
    alert("Started: " + r.command + "\n\nWatch them on the Agents page, or with braid status --live.");
    report = await api("/api/report");
    go("agents");
  } catch (e) { alert(e.message); }
}

// ---------- Changes (impact)
function vChanges() {
  $("#main").innerHTML = '<div class="view"><h1>Changes</h1><p class="lede">Pick a branch and what to compare it with. Spelunk shows the functions it changes, the routes and tests to re-check, and what else depends on it.</p>' +
    '<form id="cf" class="cmp"><label>Changes in<input class="field" id="ch" list="brs" autocomplete="off" placeholder="this branch" aria-label="Branch with the changes"></label>' +
    '<label>compared with<input class="field" id="cb" list="brs" autocomplete="off" placeholder="the main branch" aria-label="Branch or commit to compare with"></label>' +
    '<select class="field" id="ca" aria-label="Whose changes" style="max-width:220px;display:none"><option value="">This branch</option></select>' +
    '<button class="btn primary">Compare</button></form><datalist id="brs"></datalist>' +
    '<label class="tick" id="cwl"><input type="checkbox" id="cw"> Include edits I haven\'t committed yet</label><div id="cr"></div></div>';
  $("#cf").addEventListener("submit", (e) => { e.preventDefault(); runChanges(); });
  // Uncommitted edits only exist on the branch that's checked out.
  const syncTick = () => { $("#cwl").style.display = !$("#ch").value || $("#ch").value === branchInfo.current ? "" : "none"; };
  $("#ch").addEventListener("input", syncTick);
  api("/api/branches").then((b) => {
    branchInfo = b;
    $("#brs").innerHTML = b.branches.map((x) => '<option value="' + esc(x) + '">').join("");
    $("#ch").placeholder = b.current + " (checked out)";
    $("#cb").placeholder = b.base;
  }).catch(() => {});
  if (state.braid && state.braid.here) api("/api/agents").then((m) => {
    if (!m.here || !m.agents.some((a) => a.live)) return;
    $("#ca").innerHTML = '<option value="">This branch</option>' + m.agents.filter((a) => a.live).map((a) => '<option value="' + esc(a.name) + '"' + (a.name === (agentPick || agentShown) ? " selected" : "") + ">Agent " + esc(a.name) + "</option>").join("");
    $("#ca").style.display = "";
  }).catch(() => {});
  runChanges();
}
let branchInfo = { current: "", branches: [], base: "" };
const plural = (n, one, many) => fmt(n) + " " + (n === 1 ? one : many || one + "s");
const section = (title, count, body, open) => '<details class="sec"' + (open ? " open" : "") + "><summary>" + title + (count !== undefined ? ' <span class="muted">' + fmt(count) + "</span>" : "") + "</summary>" + body + "</details>";
async function runChanges() {
  $("#cr").innerHTML = '<p class="muted"><span class="spinner"></span> Comparing… Another branch takes a little longer the first time, while Spelunk reads its code.</p>';
  try {
    const who = agentPick || ($("#ca") && $("#ca").value) || "";
    agentPick = "";
    agentShown = who;
    const head = $("#ch").value.trim();
    const working = $("#cw").checked && (!head || head === branchInfo.current);
    const i = await api(who ? "/api/impact?agent=" + encodeURIComponent(who) : "/api/impact?base=" + encodeURIComponent($("#cb").value) + (head ? "&head=" + encodeURIComponent(head) : "") + (working ? "&working=1" : ""));
    if (!i.files.length) { $("#cr").innerHTML = '<p class="empty">No changes between ' + esc(i.head) + " and " + esc(i.base) + ".</p>"; return; }
    const code = i.files.filter((f) => f.symbols.length);
    const fns = code.reduce((n, f) => n + f.symbols.length, 0);
    // One sentence first: the size of the change and what to re-check. The detail sits in sections below.
    let h = '<p class="summary">' + (i.agent ? "Agent <b>" + esc(i.agent) + "</b>" : "<b>" + esc(i.head) + "</b>") + " changes " + plural(i.files.length, "file") + " compared with <b>" + esc(i.base) + "</b>" +
      (fns ? ", touching " + plural(fns, "function") + " in " + plural(code.length, "file") : "") + ". " +
      (i.routes.length || i.tests.length ? "Re-check " + [i.routes.length ? plural(i.routes.length, "route") : "", i.tests.length ? "run " + plural(i.tests.length, "test file") : ""].filter(Boolean).join(" and ") + "." : "No routes or tests reach it.") + "</p>";
    if (i.untested.length) h += '<div class="note err">No test reaches ' + i.untested.slice(0, 6).map((p) => loc(p)).join(", ") + (i.untested.length > 6 ? " and " + (i.untested.length - 6) + " more" : "") + ". Check these by hand.</div>";
    const other = i.files.length - code.length;
    h += section("Functions changed", fns, code.length ? code.slice(0, 100).map((f) => '<div style="margin-bottom:6px">' + loc(f.path) + ' <span class="tag">' + f.status + '</span><div style="font-size:13px;padding-left:12px">' + f.symbols.slice(0, 12).map((s) => loc(f.path, s.line, (s.parent ? s.parent + "." : "") + s.name)).join(", ") + (f.symbols.length > 12 ? " …" : "") + "</div></div>").join("") + (code.length > 100 ? '<p class="muted">And ' + (code.length - 100) + " more files.</p>" : "") : '<p class="muted">None: the changes are outside functions.</p>', code.length <= 15);
    if (i.routes.length) h += section("Routes to re-check", i.routes.length, '<div class="tw"><table>' + i.routes.map((r) => '<tr><td><span class="tag">' + esc(r.method) + '</span></td><td class="mono" style="font-size:12.5px">' + traceBtn(r.method + " " + r.path, r.path) + "</td><td>" + loc(r.file, r.line) + '</td><td class="muted">' + esc(r.reason) + "</td></tr>").join("") + "</table></div>", i.routes.length <= 20);
    if (i.tests.length) h += section("Tests to run", i.tests.length, i.tests.slice(0, 60).map((t) => "<div>" + loc(t.path) + ' <span class="muted" style="font-size:13px">' + esc(t.reason) + "</span></div>").join(""));
    if (other) h += section("Other files changed", other, i.files.filter((f) => !f.symbols.length).slice(0, 200).map((f) => "<div>" + (f.inIndex ? loc(f.path) : '<span class="mono" style="font-size:12.5px">' + esc(f.path) + "</span>") + ' <span class="tag">' + f.status + "</span></div>").join(""));
    if (i.dependents.length) h += section("Code that depends on the change", i.dependents.length, i.dependents.filter((d) => d.depth === 1).slice(0, 40).map((d) => "<div>" + loc(d.path) + ' <span class="muted" style="font-size:13px">imports ' + esc(d.via) + "</span></div>").join("") + (i.dependents.some((d) => d.depth > 1) ? '<p class="muted" style="font-size:13px">And ' + i.dependents.filter((d) => d.depth > 1).length + " more through those.</p>" : ""));
    if (i.modules.length) h += section("Parts of the project affected", i.modules.length, '<div class="tw"><table><tr><th>Part</th><th>Files changed</th><th>Files depending</th></tr>' + i.modules.map((m) => '<tr><td><button class="lnk" data-module="' + esc(m.path) + '">' + esc(m.path || "(root)") + "</button></td><td>" + m.changed + "</td><td>" + m.affected + "</td></tr>").join("") + "</table></div>");
    if (i.env.length) h += section("Settings read in the changed lines", i.env.length, i.env.map((e) => "<div><code>" + esc(e.name) + "</code> " + loc(e.path, e.line) + "</div>").join(""));
    if (i.risks.length) h += section("Risks in the changed lines", i.risks.length, i.risks.slice(0, 30).map((x) => '<div class="risk sev-' + x.severity + '"><span class="pill ' + x.severity + '">' + x.severity + "</span> " + esc(x.title) + "<div>" + x.locations.slice(0, 3).map((l) => loc(l.path, l.line)).join(" · ") + "</div></div>").join(""));
    $("#cr").innerHTML = h;
  } catch (e) { $("#cr").innerHTML = '<div class="note err">' + esc(e.message) + "</div>"; }
}

// ---------- Share (Elemnt)
async function vShare() {
  const d = await api("/api/publish/defaults").catch(() => ({ url: "", space: "", hasToken: false }));
  const slug = report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
  $("#main").innerHTML = '<div class="view"><h1>Share the map</h1><p class="lede">Publish this map as a page in Elemnt so your team can read it without installing anything. Publishing again updates the same page, and Elemnt keeps every version.</p>' +
    '<form id="sf" class="card" style="max-width:640px;display:grid;gap:8px">' +
    '<label>Elemnt address<input class="field" id="su" value="' + esc(d.url) + '" placeholder="https://docs.yourcompany.com" style="display:block;width:100%;max-width:none"></label>' +
    '<label>Space<input class="field" id="ss" value="' + esc(d.space) + '" placeholder="e.g. eng" style="display:block;width:100%;max-width:none"></label>' +
    '<label>Page path<input class="field" id="sp" value="codebase/' + esc(slug) + '" style="display:block;width:100%;max-width:none"></label>' +
    '<label>API token' + (d.hasToken ? ' <span class="muted">(using ELEMNT_TOKEN)</span>' : "") + '<input class="field" id="st" type="password" autocomplete="off" placeholder="' + (d.hasToken ? "Leave empty to use ELEMNT_TOKEN" : "elm_…, from Elemnt settings") + '" style="display:block;width:100%;max-width:none"></label>' +
    '<label class="tick"><input type="checkbox" id="sd"> Save as a draft to review first</label>' +
    '<div><button class="btn primary" id="sgo">Publish to Elemnt</button></div><p class="muted" style="font-size:12.5px;margin:0">The token is used for this request only and is not saved.</p></form><div id="sr" style="margin-top:12px"></div>' +
    '<h2>Keep it up to date</h2><p>Run the same thing in CI on every merge to main. Templates for GitHub Actions and Bitbucket Pipelines are in the Spelunk repository under <code>examples/ci</code>; the job runs:</p><div class="log">npx spelunk-cli publish --space ' + esc(d.space || "eng") + " --path codebase/" + esc(slug) + "\n# with ELEMNT_URL and ELEMNT_TOKEN set as CI secrets</div></div>";
  $("#sf").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#sgo").disabled = true;
    $("#sr").innerHTML = '<p class="muted"><span class="spinner"></span> Publishing…</p>';
    try {
      const r = await api("/api/publish", { url: $("#su").value, space: $("#ss").value, path: $("#sp").value, token: $("#st").value, draft: $("#sd").checked });
      $("#st").value = "";
      $("#sr").innerHTML = '<div class="note">' + (r.action === "unchanged" ? "Already up to date." : r.action === "created" ? "Published." : "Updated.") + ' <a target="_blank" rel="noopener noreferrer" href="' + esc(r.url) + '">' + esc(r.url) + " ↗</a></div>";
    } catch (err) { $("#sr").innerHTML = '<div class="note err">' + esc(err.message) + "</div>"; }
    $("#sgo").disabled = false;
  });
}

// ---------- Clone from a link
async function useLink() {
  const url = $("#cloneurl").value.trim();
  if (!url) return;
  const tok = $("#clonetok").value;
  $("#picker").close();
  state.root = url;
  state.pending = url;
  report = null;
  renderTop();
  view = "overview";
  renderNav();
  $("#main").innerHTML = '<div class="view empty"><span class="spinner"></span> Downloading ' + esc(url) + ' and reading it… Large repositories take a minute.</div>';
  try {
    const r = await api("/api/clone", { url, token: tok });
    $("#clonetok").value = "";
    state.root = r.root;
    renderTop();
    await refresh();
  } catch (e) { state.root = null; renderTop(); $("#main").innerHTML = '<div class="view"><div class="note err">' + esc(e.message) + '</div><button class="btn" data-pick>Try again</button></div>'; }
}

// ---------- File drawer
let drawerHist = [];
async function openFile(path, line, fromDef) {
  // Following a call from inside the drawer keeps a trail, so Back returns to where you were reading.
  if (fromDef === true && drawerData && $("#drawer").classList.contains("open")) drawerHist.push({ path: drawerData.f.facts.path, line: drawerData.line });
  else if (!fromDef) drawerHist = [];
  $("#drawer").classList.add("open");
  $("#scrim").classList.add("open");
  $("#dtitle").innerHTML = "<b>" + esc(path) + "</b>";
  $("#dpane").innerHTML = '<p class="muted" style="padding:16px"><span class="spinner"></span></p>';
  try {
    const f = await api("/api/file?path=" + encodeURIComponent(path));
    const x = f.facts;
    $("#dtitle").innerHTML = "<b>" + esc(x.path) + '</b><div class="muted" style="font-size:12.5px">' + esc(x.language) + " · " + esc(x.role) + " · " + fmt(x.lines) + " lines" + (x.entry ? " · starts the program (" + esc(x.entry) + ")" : "") + "</div>" + (x.doc ? '<div style="font-size:13px;margin-top:4px">' + prose(x.doc) + "</div>" : "") +
      (report && report.links ? '<a style="font-size:12.5px" target="_blank" rel="noopener noreferrer" href="' + esc(report.links.template.replace("{path}", x.path).replace("{line}", line ? report.links.anchor + line : "")) + '">Open on the code host ↗</a>' : "");
    drawerData = { f, line };
    const fn = line ? x.symbols.filter((sy) => (sy.kind === "function" || sy.kind === "method") && sy.line <= line && sy.endLine >= line).sort((a, b) => a.endLine - a.line - (b.endLine - b.line))[0] : null;
    $("#dnav").innerHTML = (drawerHist.length ? '<button class="btn" id="dback">← Back to ' + esc(drawerHist[drawerHist.length - 1].path.split("/").pop()) + "</button>" : "") +
      (fn ? '<button class="btn" data-readas="' + esc(x.path) + '" data-line="' + fn.line + '">Read ' + esc(fn.name) + " as a trace</button>" : "") +
      '<span class="muted" style="font-size:12px">Click an underlined call to jump to its code.</span>';
    showTab(drawerTab);
  } catch (e) { $("#dpane").innerHTML = '<div class="note err" style="margin:16px">' + esc(e.message) + "</div>"; }
}
let drawerData = null, drawerTab = "code";
function showTab(tab) {
  drawerTab = tab;
  document.querySelectorAll("#dtabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  if (!drawerData) return;
  const { f, line } = drawerData, x = f.facts;
  if (tab === "code") {
    const refs = {};
    for (const [ref, l] of x.callSites) if (f.defs && f.defs[ref] && !/^(svc|evt):/.test(ref)) (refs[l] = refs[l] || []).push(ref);
    $("#dpane").innerHTML = '<pre class="code">' + f.source.split("\n").map((t, i) => '<span class="l' + (i + 1 === line ? " hl" : "") + '" id="L' + (i + 1) + '"><i>' + (i + 1) + "</i>" + "<span>" + crefLine(t, refs[i + 1] || [], x.path) + "</span></span>").join("") + "</pre>";
    if (line) { const el = document.getElementById("L" + line); if (el) el.scrollIntoView({ block: "center" }); }
  } else {
    let h = '<div class="outline">';
    if (x.symbols.length) h += "<h3>Defined here</h3>" + x.symbols.map((s) => '<div class="sym"><button class="lnk" data-jump="' + s.line + '">' + s.line + '</button><div><span class="tag">' + esc(s.kind) + "</span><b>" + esc((s.parent ? s.parent + "." : "") + s.name) + "</b>" + (s.kind === "function" || s.kind === "method" ? traceBtn(s.name, "trace") : "") + (s.doc ? '<span class="muted" style="font-size:12.5px;flex-basis:100%">' + esc(s.doc.slice(0, 160)) + "</span>" : "") + "</div></div>").join("");
    if (x.routes.length) h += "<h3>Routes</h3>" + x.routes.map((r) => '<div class="sym"><button class="lnk" data-jump="' + r.line + '">' + r.line + '</button><div><span class="tag">' + esc(r.method) + "</span>" + esc(r.path) + " " + (r.side === "server" ? traceBtn(r.method + " " + r.path, "trace") : '<span class="muted">calls the server</span>') + "</div></div>").join("");
    if (f.imports.length) h += "<h3>Uses</h3>" + f.imports.map((p) => "<div>" + loc(p) + "</div>").join("");
    if (f.importedBy.length) h += "<h3>Used by</h3>" + f.importedBy.map((p) => "<div>" + loc(p) + "</div>").join("");
    if (x.env.length) h += "<h3>Settings it reads</h3>" + x.env.map((e) => '<div class="sym"><button class="lnk" data-jump="' + e.line + '">' + e.line + "</button><div><code>" + esc(e.text) + "</code></div></div>").join("");
    const errs = x.throws.concat(x.logs).sort((a, b) => a.line - b.line);
    if (errs.length) h += "<h3>Errors raised or logged</h3>" + errs.slice(0, 40).map((e) => '<div class="sym"><button class="lnk" data-jump="' + e.line + '">' + e.line + '</button><div><span class="mono" style="font-size:12px">' + esc(e.text) + "</span></div></div>").join("");
    if (x.notes.length) h += "<h3>Notes in the code</h3>" + x.notes.map((e) => '<div class="sym"><button class="lnk" data-jump="' + e.line + '">' + e.line + "</button><div>" + esc(e.text) + "</div></div>").join("");
    $("#dpane").innerHTML = h + "</div>";
  }
}
function closeFile() { $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); drawerHist = []; }
function crefLine(text, refs, path) {
  const spans = [];
  for (const ref of refs) {
    const name = ref.split(".").pop();
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const re = new RegExp("\\b" + name.replace(/[$]/g, "\\$") + "\\s*\\(", "g");
    let x;
    while ((x = re.exec(text))) if (!spans.some((sp) => x.index < sp.b && x.index + name.length > sp.a)) spans.push({ a: x.index, b: x.index + name.length, ref });
  }
  spans.sort((p, q) => p.a - q.a);
  let out = "", at = 0;
  for (const sp of spans) { out += esc(text.slice(at, sp.a)) + '<span class="cref" data-ref="' + esc(sp.ref) + '" data-from="' + esc(path) + '">' + esc(text.slice(sp.a, sp.b)) + "</span>"; at = sp.b; }
  return out + esc(text.slice(at));
}
function goToDef(ref) {
  const d = drawerData && drawerData.f.defs && drawerData.f.defs[ref];
  if (d) return openFile(d[0], d[1], true);
}
function drawerBack() { const prev = drawerHist.pop(); if (prev) openFile(prev.path, prev.line, "back"); }

// ---------- Wiring
document.addEventListener("click", async (e) => {
  const mark = e.target.closest(".code .call, .code .mk");
  if (mark && tframe && mark.closest("#tr")) {
    const s = tframe.steps.find((x) => x.n === Number(mark.dataset.step));
    if (s && s.def) return stepInto(s.def.path, s.def.line, s.def.name);
    return selectStep(Number(mark.dataset.step));
  }
  const cref = e.target.closest(".cref");
  if (cref) return goToDef(cref.dataset.ref);
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  try {
    if (t.matches("a[href^='#mod-']")) { e.preventDefault(); vFocus(decodeURIComponent(t.getAttribute("href").slice(5)).replace(/^root$/, "")); return; }
    if (d.frame !== undefined) { tstack.push({ path: d.frame, line: Number(d.fline) || 1, label: d.flabel }); showHelpers = false; showOther = false; return loadFrame(tstack[tstack.length - 1]); }
    if (d.into !== undefined) return stepInto(d.into, Number(d.iline), d.ilabel);
    if (d.crumb !== undefined) return d.crumb === "back" ? stepBack() : stepBack(Number(d.crumb));
    if (d.area !== undefined) { mapAreas = d.area ? (mapAreas.includes(d.area) ? mapAreas.filter((x) => x !== d.area) : mapAreas.concat(d.area)) : []; document.querySelectorAll("[data-area]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.area ? mapAreas.includes(b.dataset.area) : !mapAreas.length))); return redrawMap(); }
    if (d.focus !== undefined) return vFocus(d.focus);
    if (t.id === "dback") return drawerBack();
    if (d.readas !== undefined) { closeFile(); tstack = []; return stepInto(d.readas, Number(d.line), ""); }
    if (d.open !== undefined) return openFile(d.open, Number(d.line) || 0);
    if (d.jump) { drawerData.line = Number(d.jump); return showTab("code"); }
    if (d.trace !== undefined) { closeFile(); view = "trace"; renderNav(); return vTrace(d.trace); }
    if (d.find !== undefined) { view = "find"; renderNav(); return vFind(d.find); }
    if (d.q !== undefined) { $("#q").value = d.q; return search(d.q); }
    if (d.findkindAll !== undefined) return document.querySelector('[data-findkind=""]').click();
    if (d.ask !== undefined) { $("#askq").value = d.ask; return startAsk(d.ask); }
    if (t.id === "clonego") return useLink();
    if (d.view) return go(d.view);
    if (d.module !== undefined) return vModule(d.module);
    if (d.kind !== undefined) { riskKind = d.kind; return vRisks(); }
    if (d.braidkind) return startBraid({ kind: d.braidkind });
    if (t.id === "braiderr") return startBraid({ error: $("#et").value });
    if (d.agentimpact) { agentPick = d.agentimpact; return go("changes"); }
    if (d.pick !== undefined) return openPicker();
    if (d.dir) return openPicker(d.dir);
    if (d.usedir) return useFolder(d.usedir);
    if (d.tab) return showTab(d.tab);
    if (t.id === "rescan") { t.disabled = true; t.textContent = "Reading…"; await api("/api/rescan", {}); await refresh(); return; }
    if (t.id === "dclose") return closeFile();
    if (t.id === "theme") { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); const next = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("spelunk-theme", next); } catch {} }
  } catch (err) { alert(err.message); }
});
$("#scrim").addEventListener("click", closeFile);
document.addEventListener("mouseover", (e) => { const b = e.target.closest(".tstep2"); if (b && tframe) selectStep(Number(b.dataset.step), false); });
document.addEventListener("keydown", (e) => {
  if (view !== "trace" || !tframe || $("#drawer").classList.contains("open") || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const shown = [...document.querySelectorAll(".tstep2")].map((b) => Number(b.dataset.step));
  const i = shown.indexOf(tsel);
  if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); selectStep(shown[Math.min(shown.length - 1, i + 1)] ?? shown[0]); }
  else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); selectStep(shown[Math.max(0, i - 1)] ?? shown[0]); }
  else if (e.key === "Enter") { const s = tframe.steps.find((x) => x.n === tsel); if (s && s.def) { e.preventDefault(); stepInto(s.def.path, s.def.line, s.def.name); } }
  else if (e.key === "Backspace" && tstack.length > 1) { e.preventDefault(); stepBack(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFile(); if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); go("find"); } });
$("#pickform").addEventListener("submit", (e) => { e.preventDefault(); if (state.hosted) return useLink(); useFolder($("#pickpath").value || pickerDir); });
$("#browse").addEventListener("click", () => openPicker($("#pickpath").value));
// Enter in the path box goes to that folder; "Use this folder" opens it.
$("#pickpath").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); openPicker($("#pickpath").value); } });
$("#pickfilter").addEventListener("input", renderDirs);
$("#pickfilter").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const first = $("#dirs [data-dir]"); if (first) openPicker(first.dataset.dir); } });
$("#cloneurl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useLink(); } });
try { const th = localStorage.getItem("spelunk-theme"); if (th) document.documentElement.dataset.theme = th; } catch {}

(async () => {
  try {
    state = await api("/api/state");
    if (state.hosted) document.body.classList.add("hosted");
    renderTop();
    go("overview");
    if (state.root) await refresh();
  } catch (e) { $("#main").innerHTML = '<div class="view note err">' + esc(e.message) + "</div>"; }
})();
`;

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spelunk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <header class="top">
    <div class="brand"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 20h18M6 20l4-9 3 5 2-3 3 7"/><circle cx="16" cy="6" r="2"/></svg>Spelunk</div>
    <div class="repo" id="repo"></div>
    <div id="actions" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    <button class="btn" id="theme" aria-label="Switch light or dark" title="Light or dark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:-3px"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/></svg></button>
  </header>
  <div class="body">
    <nav class="side" id="nav" aria-label="Sections"></nav>
    <main id="main"></main>
  </div>
</div>
<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-label="File">
  <div class="dh"><div class="t" id="dtitle"></div><button class="btn" id="dclose" aria-label="Close file">✕</button></div>
  <div class="dnav" id="dnav"></div>
  <div class="tabs" id="dtabs" role="tablist"><button role="tab" data-tab="code" aria-selected="true">Code</button><button role="tab" data-tab="outline" aria-selected="false">What's in it</button></div>
  <div class="pane" id="dpane"></div>
</aside>
<dialog id="picker" aria-label="Choose a project">
  <form class="dlg" id="pickform">
    <div class="localonly" style="display:grid;gap:inherit">
    <h2 style="margin:0">Choose a project folder</h2>
    <div class="chips" id="pickshort" style="margin:0"></div>
    <div style="display:flex;gap:8px"><input class="field" id="pickpath" aria-label="Folder path" placeholder="Type or paste a path, e.g. ~/code/my-app" style="flex:1;max-width:none"><button type="button" class="btn" id="browse">Go</button></div>
    <div class="crumbs" id="crumbs"></div>
    <p class="muted" id="pickhint" style="margin:0;font-size:13px"></p>
    <input class="field" id="pickfilter" type="search" placeholder="Filter these folders" aria-label="Filter folders" autocomplete="off" style="max-width:none">
    <div class="dirs" id="dirs"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" onclick="this.closest('dialog').close()">Cancel</button><button class="btn primary">Use this folder</button></div>
    <div class="orline">or paste a repository link</div>
    </div>
    <h2 class="hostedonly" style="margin:0">Open a public repository</h2>
    <input class="field" id="cloneurl" placeholder="https://github.com/owner/repo, https://bitbucket.org/team/repo, …" aria-label="Repository link" autocomplete="off" style="max-width:none">
    <input class="field localonly" id="clonetok" type="password" placeholder="Access token, only for private repositories" aria-label="Access token" autocomplete="off" style="max-width:none">
    <p class="muted localonly" style="margin:0;font-size:12.5px">The token is used for this download only and is never saved. Spelunk keeps the copy in ~/.spelunk/repos.</p>
    <p class="muted hostedonly" style="margin:0;font-size:12.5px">GitHub, GitLab or Bitbucket. For private code, run <code>npx spelunk-cli ui</code> on your own computer.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn hostedonly" onclick="this.closest('dialog').close()">Cancel</button><button type="button" class="btn" id="clonego">Download and open</button></div>
  </form>
</dialog>
<script>${JS}</script>
</body>
</html>`;
}
