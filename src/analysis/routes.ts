import type { FileFacts, Index, Route } from "../types.js";

export interface RouteAt extends Route {
  file: string;
}

export function allRoutes(index: Index, side?: Route["side"]): RouteAt[] {
  return index.files.flatMap((f) => f.routes.filter((r) => !side || r.side === side).map((r) => ({ ...r, file: f.path })));
}

/** Path segments with every parameter (":id", "{id}", "<int:id>", "${id}", "*") as "*". */
export function segments(path: string): string[] {
  return path
    .replace(/[?#].*$/, "")
    .replace(/\$\{[^}]*\}/g, "*")
    .split("/")
    .filter(Boolean)
    .map((s) => (/^:|^\{.*\}$|^<.*>$|^\*$|^\[.*\]$/.test(s) || s.includes("*") ? "*" : s.replace(/\{.*\}$/, "")));
}

/** Does a client call's path hit a server route's pattern? A trailing "*" or "/" on either side matches any rest. */
export function pathMatches(server: string, client: string): boolean {
  if (server === "*" || server === "/*") return true;
  const a = segments(server);
  const b = segments(client);
  const open = client.endsWith("/") && client.length > 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return false;
    if (y === undefined) return open || x === "*";
    if (x !== y && x !== "*" && y !== "*") return false;
  }
  return true;
}

export function methodMatches(server: string, client: string): boolean {
  if (client === "ANY" || ["ALL", "ANY"].includes(server)) return true;
  // "GET,POST" from Flask's methods=[...]; HEAD is answered by GET handlers.
  const methods = server.split(",");
  return methods.includes(client) || (client === "HEAD" && methods.includes("GET")) || client === "OPTIONS";
}

/** Server routes a client call could reach, most specific first. */
export function routesFor(server: RouteAt[], method: string, path: string): RouteAt[] {
  return server
    .filter((r) => methodMatches(r.method, method) && pathMatches(r.path, path))
    .sort((a, b) => segments(b.path).filter((s) => s !== "*").length - segments(a.path).filter((s) => s !== "*").length);
}

/** Finds a route from "POST /api/pages/:id", "/api/pages/x" or "pages". */
export function findRoutes(index: Index, query: string): RouteAt[] {
  const m = query.trim().match(/^([A-Z]+)\s+(\S+)$/);
  const server = allRoutes(index, "server");
  if (m) return routesFor(server, m[1]!, m[2]!);
  if (query.startsWith("/")) {
    const exact = server.filter((r) => pathMatches(r.path, query) && segments(r.path).length === segments(query).length);
    if (exact.length) return exact;
  }
  return server.filter((r) => r.path.includes(query));
}

export function fileHasHandlers(f: FileFacts): boolean {
  return f.routes.some((r) => r.side === "server");
}
