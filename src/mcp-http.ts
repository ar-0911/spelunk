import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRemoteServer, type ToolHost } from "./mcp.js";

/**
 * Remote MCP over Streamable HTTP, for claude.ai custom connectors and
 * `claude mcp add --transport http`. Stateless: every POST gets a fresh
 * server, because the tools keep nothing per client (the repository is an
 * argument of each call, and downloads and scans are shared by the host).
 */
export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse, body: unknown, open: ToolHost["open"]): Promise<void> {
  const server = createRemoteServer(open);
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

/** "owner/name" is short for a GitHub repository; links pass through. */
export function repoLink(input: string): string {
  const s = input.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(s) ? `https://github.com/${s}` : s;
}
