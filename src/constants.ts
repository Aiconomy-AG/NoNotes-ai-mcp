import "./env.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}. Set it in mcp/.env (see .env.example).`);
  }
  return value;
}

export const SERVER_NAME = "notes-mcp-server";
export const SERVER_VERSION = "1.0.0";


export const SERVER_PORT = parseInt(requireEnv("PORT"), 10);
export const MCP_SERVER_URL = requireEnv("MCP_SERVER_URL").replace(/\/$/, "");
export const LARAVEL_API_URL = requireEnv("LARAVEL_API_URL").replace(/\/$/, "");
export const MCP_STORAGE_SECRET = requireEnv("MCP_STORAGE_SECRET");

export const SCOPES_SUPPORTED = ["notes:read", "notes:write"];


export const ACCESS_TOKEN_TTL = 60 * 60;
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;
export const AUTH_CODE_TTL = 10 * 60;

export const CHARACTER_LIMIT = 20000;
