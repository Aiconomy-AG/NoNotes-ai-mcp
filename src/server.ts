import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotesConfig } from "./config.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerNoteTools } from "./tools.js";

export function createServer(config: NotesConfig): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerNoteTools(server, config);
  return server;
}
