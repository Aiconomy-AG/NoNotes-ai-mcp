import { LARAVEL_API_URL } from "./constants.js";

export interface MintedToken {
  token: string;
  username: string;
}


export async function mintNotesToken(username: string, password: string): Promise<MintedToken | null> {
  const res = await fetch(`${LARAVEL_API_URL}/api/mcp/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, device_name: "chatgpt-mcp" }),
  });

  if (res.status === 422 || res.status === 401) return null; // bad credentials
  if (!res.ok) {
    throw new Error(`Token endpoint returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { token: string; user?: { username?: string } };
  return { token: data.token, username: data.user?.username ?? username };
}
