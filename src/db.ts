import { LARAVEL_API_URL, MCP_STORAGE_SECRET } from "./constants.js";

export interface OAuthClientRow {
  client_id: string;
  client_secret: string | null;
  redirect_uris: string;
  client_name: string | null;
  grant_types: string;
  response_types: string;
  scope: string | null;
  token_endpoint_auth_method: string | null;
  client_id_issued_at: number | null;
}

export interface OAuthCodeRow {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  resource: string | null;
  laravel_token: string;
  username: string;
  expires_at: number;
}

export interface OAuthTokenRow {
  token: string;
  token_type: "access" | "refresh";
  client_id: string;
  scopes: string;
  resource: string | null;
  laravel_token: string;
  username: string;
  refresh_token: string | null;
  expires_at: number;
  revoked: boolean | number;
}

type StorageMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function storageRequest<T>(
  endpoint: string,
  options: { method?: StorageMethod; body?: unknown } = {},
): Promise<T | undefined> {
  const { method = "GET", body } = options;
  const url = `${LARAVEL_API_URL}/api/mcp/oauth-storage/${endpoint.replace(/^\//, "")}`;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-MCP-Storage-Secret": MCP_STORAGE_SECRET,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 404 || response.status === 204) return undefined;
  if (!response.ok) {
    throw new Error(`MCP OAuth storage returned ${response.status}: ${await response.text()}`);
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : undefined;
}

function pathPart(value: string): string {
  return encodeURIComponent(value);
}

export async function getOAuthClient(clientId: string): Promise<OAuthClientRow | undefined> {
  return storageRequest<OAuthClientRow>(`clients/${pathPart(clientId)}`);
}

export async function insertOAuthClient(row: OAuthClientRow): Promise<void> {
  await storageRequest("clients", { method: "POST", body: row });
}

export async function getOAuthCode(code: string): Promise<OAuthCodeRow | undefined> {
  return storageRequest<OAuthCodeRow>(`codes/${pathPart(code)}`);
}

export async function insertOAuthCode(row: OAuthCodeRow): Promise<void> {
  await storageRequest("codes", { method: "POST", body: row });
}

export async function deleteOAuthCode(code: string): Promise<void> {
  await storageRequest(`codes/${pathPart(code)}`, { method: "DELETE" });
}

export async function getOAuthToken(token: string): Promise<OAuthTokenRow | undefined> {
  return storageRequest<OAuthTokenRow>(`tokens/${pathPart(token)}`);
}

export async function getOAuthTokenByRefresh(refreshToken: string): Promise<OAuthTokenRow | undefined> {
  return storageRequest<OAuthTokenRow>(`tokens/refresh/${pathPart(refreshToken)}`);
}

export async function insertOAuthToken(row: OAuthTokenRow): Promise<void> {
  await storageRequest("tokens", { method: "POST", body: row });
}

export async function revokeOAuthToken(token: string): Promise<void> {
  await storageRequest(`tokens/${pathPart(token)}/revoke`, { method: "PATCH" });
}

export async function cleanupExpiredOAuth(nowSeconds: number): Promise<void> {
  await storageRequest("expired", { method: "DELETE", body: { now: nowSeconds } });
}
