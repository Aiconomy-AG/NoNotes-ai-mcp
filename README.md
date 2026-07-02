# Notes MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes the Notes app's CRUD
API as tools an LLM connector (ChatGPT, Claude) can call — "check my notes",
"create a note", etc. — after the user authenticates.

## How it works

```
LLM ──OAuth 2.1 (PKCE) -> Notes MCP Server -- Bearer (Sanctum PAT) --> Laravel API
```

1. ChatGPT discovers this server's OAuth metadata and dynamically registers itself.
2. On connect, ChatGPT opens the server's **consent page — a Notes login form**.
3. The user signs in; the server calls the backend `POST /api/mcp/token` to mint a
   Sanctum personal access token and binds it to the issued OAuth token.
4. Every subsequent tool call carries that Sanctum token as `Authorization: Bearer …`
   to the Laravel API, so the connector acts as that user.

The OAuth clients/codes/tokens are stored by the Laravel backend in MySQL through
private MCP storage endpoints guarded by `MCP_STORAGE_SECRET`.

## Tools

| Tool | Description |
|------|-------------|
| `list_notes` | List all notes (summaries: id, title, updated, preview) |
| `get_note` | Full content of one note by id |
| `search_notes` | Search titles + content by text |
| `create_note` | Create a note (`blocks` structured content, or `text` shortcut) |
| `update_note` | Update title and/or blocks (blocks fully replace) |
| `delete_note` | Delete a note by id |

Notes are `{ title, blocks[] }` where each block is either
`{ "type": "paragraph", "text": "…" }` or `{ "type": "list", "items": ["…"] }`.

## Backend requirement

This server relies on the Laravel backend for both user data and connector state:

- `POST /api/mcp/token` returns a Sanctum token for valid credentials.
- `/api/mcp/oauth-storage/*` stores OAuth clients, auth codes, and connector tokens
  in MySQL. These routes require `X-MCP-Storage-Secret`, so set the same
  `MCP_STORAGE_SECRET` value in both `backend/.env` and `mcp/.env`.
- The existing note routes accept Bearer tokens via `auth:sanctum`.

## Setup

```bash
cd mcp
npm install
cp .env.example .env      # edit values
```

`.env` keys: `LARAVEL_API_URL` (backend origin, e.g. `http://localhost`),
`MCP_SERVER_URL` (this server's public URL), `PORT`, `TRANSPORT`,
`MCP_STORAGE_SECRET`.

Run the backend migrations so MySQL has the notes, Sanctum, and MCP OAuth tables:

```bash
cd ../backend
php artisan migrate
```

## Local testing (no OAuth) — stdio + MCP Inspector

Mint a token for your account, then run the Inspector:

```bash
# 1. Mint a Sanctum token
curl -X POST "$LARAVEL_API_URL/api/mcp/token" -H 'Accept: application/json' \
  -d 'username=YOUR_USER' -d 'password=YOUR_PASS'
# → {"token":"1|abc…"}

# 2. Explore the tools in the Inspector UI
TRANSPORT=stdio NOTES_API_TOKEN='1|abc…' npm run inspect
```

Or drive it over HTTP with the Inspector pointed at `http://localhost:PORT/mcp`
(it will walk you through the OAuth login flow).

## Connecting LLM (remote / production)

LLM connectors require a **public HTTPS** URL and OAuth. For local dev, expose
the server through a tunnel:

```bash
# Terminal 1 - the MCP server
npm run build && npm start

# Terminal 2 - a tunnel (either works)
cloudflared tunnel --url http://localhost:3100
#   or
ngrok http 3100
```

Set `MCP_SERVER_URL` in `.env` to the **https** tunnel URL and restart the server
(the OAuth issuer/redirects must match the public URL).

Then in LLM: **Settings → Connectors → Create/Add custom connector**, and enter
`https://YOUR-TUNNEL/mcp` as the MCP server URL. LLM will:
register itself -> send you to the Notes login page -> after login, connect. The
tools then appear in Developer mode / when the connector is enabled in a chat.
