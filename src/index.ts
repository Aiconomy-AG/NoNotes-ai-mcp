import "./env.js";
import crypto from "crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  SERVER_NAME,
  SERVER_VERSION,
  SERVER_PORT,
  MCP_SERVER_URL,
  LARAVEL_API_URL,
  SCOPES_SUPPORTED,
  AUTH_CODE_TTL,
} from "./constants.js";
import type { NotesConfig } from "./config.js";
import { createServer } from "./server.js";
import { NotesOAuthProvider } from "./oauth-provider.js";
import { getOAuthClient, insertOAuthCode, cleanupExpiredOAuth } from "./db.js";
import { mintNotesToken } from "./notes-auth.js";
import { buildConsentPageHtml, buildSuccessPageHtml, type ConsentParams } from "./consent.js";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function handleMcpRequest(req: express.Request, res: express.Response, config: NotesConfig) {
  const server = createServer(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}


async function runHTTP(): Promise<void> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const provider = new NotesOAuthProvider();

  const protectedResourceMeta = (resource: string) => ({
    resource,
    authorization_servers: [MCP_SERVER_URL],
    scopes_supported: SCOPES_SUPPORTED,
  });
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(protectedResourceMeta(`${MCP_SERVER_URL}/mcp`));
  });
  app.get("/.well-known/oauth-protected-resource/*", (_req, res) => {
    res.json(protectedResourceMeta(`${MCP_SERVER_URL}/mcp`));
  });
  app.get("/.well-known/oauth-authorization-server/*", (_req, res) => {
    res.json({
      issuer: MCP_SERVER_URL,
      authorization_endpoint: `${MCP_SERVER_URL}/authorize`,
      token_endpoint: `${MCP_SERVER_URL}/token`,
      registration_endpoint: `${MCP_SERVER_URL}/register`,
      scopes_supported: SCOPES_SUPPORTED,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  app.post("/token", (req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
      const i = decoded.indexOf(":");
      if (i > 0) {
        req.body ??= {};
        req.body.client_id ??= decodeURIComponent(decoded.slice(0, i));
        req.body.client_secret ??= decodeURIComponent(decoded.slice(i + 1));
        delete req.headers.authorization;
      }
    }
    next();
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(MCP_SERVER_URL),
      scopesSupported: SCOPES_SUPPORTED,
    }),
  );

  app.post("/oauth/consent", async (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, scopes, resource, username, password } =
      req.body as Record<string, string>;

    const reRender = (error: string) => {
      const params: ConsentParams = {
        clientId: client_id,
        redirectUri: redirect_uri,
        state,
        codeChallenge: code_challenge,
        scopes: scopes ? scopes.split(" ").filter(Boolean) : SCOPES_SUPPORTED,
        resource: resource ?? "",
        error,
      };
      res.status(401).type("html").send(buildConsentPageHtml(params));
    };

    if (!client_id || !redirect_uri || !code_challenge || !username || !password) {
      reRender("Missing required fields.");
      return;
    }

    const client = await getOAuthClient(client_id);
    if (!client) {
      res.status(400).send("Unknown client.");
      return;
    }
    const allowedUris: string[] = JSON.parse(client.redirect_uris);
    if (!allowedUris.includes(redirect_uri)) {
      res.status(400).send("redirect_uri not registered for this client.");
      return;
    }

    let minted;
    try {
      minted = await mintNotesToken(username, password);
    } catch (err) {
      console.error("[consent] token mint failed:", err);
      reRender("Could not reach the notes backend. Try again.");
      return;
    }
    if (!minted) {
      reRender("Incorrect username or password.");
      return;
    }

    const code = crypto.randomBytes(32).toString("hex");
    await insertOAuthCode({
      code,
      client_id,
      redirect_uri,
      code_challenge,
      scopes: JSON.stringify(scopes ? scopes.split(" ").filter(Boolean) : SCOPES_SUPPORTED),
      resource: resource || null,
      laravel_token: minted.token,
      username: minted.username,
      expires_at: nowSec() + AUTH_CODE_TTL,
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);
    res.type("html").send(buildSuccessPageHtml(redirectUrl.toString()));
  });

  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: `${MCP_SERVER_URL}/.well-known/oauth-protected-resource`,
  });

  app.post("/mcp", bearerAuth, async (req, res) => {
    const extra = (req.auth?.extra ?? {}) as { laravelToken?: string; username?: string };
    if (!extra.laravelToken) {
      res.status(401).json({ error: "Token is not bound to a notes user." });
      return;
    }
    await handleMcpRequest(req, res, {
      baseUrl: LARAVEL_API_URL,
      apiToken: extra.laravelToken,
      username: extra.username,
    });
  });
  app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed. Use POST." }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed. Use POST." }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  setInterval(() => {
    cleanupExpiredOAuth(nowSec()).catch((err) => {
      console.error("[oauth-storage] cleanup failed:", err);
    });
  }, 60 * 60 * 1000);

  app.listen(SERVER_PORT, "0.0.0.0", () => {
    console.error(`${SERVER_NAME} v${SERVER_VERSION} (HTTP) on ${MCP_SERVER_URL}`);
    console.error(`  MCP endpoint : ${MCP_SERVER_URL}/mcp`);
    console.error(`  OAuth issuer : ${MCP_SERVER_URL}`);
    console.error(`  Backend API  : ${LARAVEL_API_URL}`);
    console.error(`  Health       : ${MCP_SERVER_URL}/health`);
  });
}


async function runStdio(): Promise<void> {
  const apiToken = process.env.NOTES_API_TOKEN;
  if (!apiToken) {
    console.error("NOTES_API_TOKEN is required for stdio mode. Mint one via POST /api/mcp/token.");
    process.exit(1);
  }
  const config: NotesConfig = { baseUrl: LARAVEL_API_URL, apiToken };
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

const transport = process.env.TRANSPORT || "http";
(transport === "stdio" ? runStdio() : runHTTP()).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
