import crypto from "crypto";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  getOAuthClient,
  insertOAuthClient,
  getOAuthCode,
  deleteOAuthCode,
  getOAuthToken,
  getOAuthTokenByRefresh,
  insertOAuthToken,
  revokeOAuthToken,
} from "./db.js";
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, SCOPES_SUPPORTED } from "./constants.js";
import { buildConsentPageHtml } from "./consent.js";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}


export class NotesClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const row = await getOAuthClient(clientId);
    if (!row) return undefined;
    return {
      client_id: row.client_id,
      client_secret: row.client_secret ?? undefined,
      redirect_uris: JSON.parse(row.redirect_uris),
      client_name: row.client_name ?? undefined,
      grant_types: JSON.parse(row.grant_types),
      response_types: JSON.parse(row.response_types),
      scope: row.scope ?? undefined,
      token_endpoint_auth_method: row.token_endpoint_auth_method ?? undefined,
      client_id_issued_at: row.client_id_issued_at ?? undefined,
    } as OAuthClientInformationFull;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    const clientId = crypto.randomUUID();
    const issuedAt = nowSec();

    const isPublic = client.token_endpoint_auth_method === "none";
    const clientSecret = isPublic ? null : crypto.randomBytes(32).toString("hex");

    const uris = (client.redirect_uris ?? []) as unknown as Array<URL | string>;
    await insertOAuthClient({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: JSON.stringify(uris.map((u) => String(u))),
      client_name: client.client_name ?? null,
      grant_types: JSON.stringify(client.grant_types ?? ["authorization_code", "refresh_token"]),
      response_types: JSON.stringify(client.response_types ?? ["code"]),
      scope: client.scope ?? null,
      token_endpoint_auth_method: client.token_endpoint_auth_method ?? null,
      client_id_issued_at: issuedAt,
    });

    return {
      ...client,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_id_issued_at: issuedAt,
    } as OAuthClientInformationFull;
  }
}

interface CachedExchange {
  challenge: string;
  tokens: OAuthTokens;
  expiresAt: number;
}
const exchangeCache = new Map<string, CachedExchange>();

function pruneExchangeCache(): void {
  const now = Date.now();
  for (const [k, v] of exchangeCache) if (v.expiresAt < now) exchangeCache.delete(k);
}


export class NotesOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new NotesClientsStore();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    res.type("html").send(
      buildConsentPageHtml({
        clientId: client.client_id,
        clientName: client.client_name,
        redirectUri: params.redirectUri,
        state: params.state,
        codeChallenge: params.codeChallenge,
        scopes: params.scopes ?? SCOPES_SUPPORTED,
        resource: params.resource?.toString() ?? "",
      }),
    );
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const row = await getOAuthCode(authorizationCode);
    if (row) return row.code_challenge;

    const cached = exchangeCache.get(authorizationCode);
    if (cached && cached.expiresAt > Date.now()) return cached.challenge;

    throw new Error("Authorization code not found");
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    pruneExchangeCache();

    const cached = exchangeCache.get(authorizationCode);
    if (cached && cached.expiresAt > Date.now()) return cached.tokens;

    const row = await getOAuthCode(authorizationCode);
    if (!row) throw new Error("Authorization code not found");
    if (row.client_id !== client.client_id) throw new Error("Client mismatch");
    if (row.expires_at < nowSec()) {
      await deleteOAuthCode(authorizationCode);
      throw new Error("Authorization code expired");
    }

    const accessToken = crypto.randomBytes(32).toString("hex");
    const refreshToken = crypto.randomBytes(32).toString("hex");
    const now = nowSec();

    await insertOAuthToken({
      token: accessToken,
      token_type: "access",
      client_id: client.client_id,
      scopes: row.scopes,
      resource: row.resource,
      laravel_token: row.laravel_token,
      username: row.username,
      refresh_token: refreshToken,
      expires_at: now + ACCESS_TOKEN_TTL,
      revoked: 0,
    });
    await insertOAuthToken({
      token: refreshToken,
      token_type: "refresh",
      client_id: client.client_id,
      scopes: row.scopes,
      resource: row.resource,
      laravel_token: row.laravel_token,
      username: row.username,
      refresh_token: null,
      expires_at: now + REFRESH_TOKEN_TTL,
      revoked: 0,
    });

    await deleteOAuthCode(authorizationCode);

    const tokens: OAuthTokens = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
      scope: (JSON.parse(row.scopes) as string[]).join(" "),
    };

    exchangeCache.set(authorizationCode, {
      challenge: row.code_challenge,
      tokens,
      expiresAt: Date.now() + 60_000,
    });

    return tokens;
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const row = await getOAuthTokenByRefresh(refreshToken);
    if (!row || row.revoked) throw new Error("Invalid refresh token");
    if (row.client_id !== client.client_id) throw new Error("Client mismatch");
    if (row.expires_at < nowSec()) throw new Error("Refresh token expired");

    const accessToken = crypto.randomBytes(32).toString("hex");
    const now = nowSec();
    const scopeStr = scopes && scopes.length ? JSON.stringify(scopes) : row.scopes;

    await insertOAuthToken({
      token: accessToken,
      token_type: "access",
      client_id: client.client_id,
      scopes: scopeStr,
      resource: row.resource,
      laravel_token: row.laravel_token,
      username: row.username,
      refresh_token: refreshToken,
      expires_at: now + ACCESS_TOKEN_TTL,
      revoked: 0,
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
      scope: (JSON.parse(scopeStr) as string[]).join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await getOAuthToken(token);
    if (!row || row.token_type !== "access" || row.revoked) {
      throw new Error("Invalid access token");
    }
    if (row.expires_at < nowSec()) throw new Error("Access token expired");

    return {
      token,
      clientId: row.client_id,
      scopes: JSON.parse(row.scopes),
      expiresAt: row.expires_at,
      extra: { laravelToken: row.laravel_token, username: row.username },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await revokeOAuthToken(request.token);
  }
}
