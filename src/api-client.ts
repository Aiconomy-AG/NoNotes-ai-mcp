import type { NotesConfig } from "./config.js";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public responseBody: string,
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = "ApiError";
  }
}


export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions,
  config: NotesConfig,
): Promise<T> {
  const { method = "GET", body } = options;
  const url = `${config.baseUrl}/${endpoint.replace(/^\//, "")}`;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new ApiError(response.status, response.statusText, responseBody);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return {} as T;
  }

  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function errorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    let detail = err.responseBody;
    try {
      const parsed = JSON.parse(err.responseBody);
      if (parsed.message) {
        detail = parsed.message;
        if (parsed.errors) detail += ` (${JSON.stringify(parsed.errors)})`;
      }
    } catch {
      /* keep raw body */
    }
    if (err.status === 401) {
      return "Not authenticated. Your connection may have expired, please reconnect the connector.";
    }
    if (err.status === 403) return "You are not allowed to access that note.";
    if (err.status === 404) return "Note not found.";
    return `Backend error (${err.status}): ${detail}`;
  }
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
}
