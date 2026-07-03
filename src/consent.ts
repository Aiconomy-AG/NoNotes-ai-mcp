import { SERVER_NAME } from "./constants.js";

function esc(s: string): string {
  return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
}

const PAGE_HEAD = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Notes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --color-background:#1B1B1D;
    --color-accent:#D71921;
    --color-surface:#2A2A2D;
    --color-border:#3A3A3D;
    --font-sans:'Inter',system-ui,sans-serif;
    --font-display:'Space Grotesk',var(--font-sans);
    --font-mono:'IBM Plex Mono',ui-monospace,monospace;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:var(--font-sans);
    background:var(--color-background);
    color:#fff;
    display:flex;justify-content:center;align-items:center;
    min-height:100vh;padding:16px;
  }
  .wrap{width:100%;max-width:384px}
  .eyebrow{font-family:var(--font-mono);font-size:12px;letter-spacing:.3em;color:var(--color-accent);text-align:center}
  .logo{font-family:var(--font-display);font-size:34px;font-weight:700;text-align:center;margin-top:8px}
  .rule{width:40px;height:1px;background:var(--color-accent);margin:16px auto}
  .subtitle{font-family:var(--font-mono);font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:rgba(255,255,255,.4);text-align:center;margin-bottom:32px}
  .card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:32px}
  label{display:block;font-family:var(--font-mono);font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:rgba(255,255,255,.5);margin-bottom:8px}
  .field{margin-bottom:20px}
  .field:last-of-type{margin-bottom:24px}
  input{
    width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:6px;
    background:var(--color-background);color:#fff;font-size:15px;font-family:var(--font-sans);
    outline:none;transition:border-color .2s;
  }
  input:focus{border-color:var(--color-accent)}
  button{
    width:100%;padding:10px;background:var(--color-accent);color:#fff;border:none;border-radius:6px;
    font-size:15px;font-weight:600;font-family:var(--font-sans);cursor:pointer;
    display:flex;align-items:center;justify-content:center;gap:8px;
    transition:opacity .2s;
  }
  button:hover{opacity:.9}
  .err{
    border-left:2px solid var(--color-accent);background:rgba(215,25,33,.1);color:rgba(255,255,255,.8);
    padding:10px 12px;font-size:13px;margin-bottom:20px;
  }
  .scopes{font-family:var(--font-mono);font-size:11px;color:rgba(255,255,255,.4);margin-top:20px;text-align:center;text-transform:uppercase;letter-spacing:.1em}
  .check{font-size:40px;text-align:center;margin-bottom:12px;color:var(--color-accent)}
  .title{font-family:var(--font-display);font-size:20px;font-weight:700;text-align:center;margin-bottom:8px}
  .sub{font-family:var(--font-sans);font-size:14px;color:rgba(255,255,255,.5);text-align:center}
</style></head><body><div class="wrap">`;

const PAGE_FOOT = `</div></body></html>`;

export interface ConsentParams {
  clientId: string;
  clientName?: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  error?: string;
}

export function buildConsentPageHtml(p: ConsentParams): string {
  const clientLabel = p.clientName ? esc(p.clientName) : "An application";
  const errBox = p.error ? `<div class="err">${esc(p.error)}</div>` : "";
  const scopeText = p.scopes.length ? p.scopes.join(", ") : "read and write your notes";

  return `${PAGE_HEAD}
  <div class="eyebrow">N&deg; 001</div>
  <div class="logo">Notes</div>
  <div class="rule"></div>
  <div class="subtitle">${clientLabel} wants to connect</div>
  <div class="card">
    ${errBox}
    <form method="POST" action="/oauth/consent">
      <input type="hidden" name="client_id" value="${esc(p.clientId)}">
      <input type="hidden" name="redirect_uri" value="${esc(p.redirectUri)}">
      <input type="hidden" name="state" value="${esc(p.state ?? "")}">
      <input type="hidden" name="code_challenge" value="${esc(p.codeChallenge)}">
      <input type="hidden" name="scopes" value="${esc(p.scopes.join(" "))}">
      <input type="hidden" name="resource" value="${esc(p.resource)}">
      <div class="field">
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required autofocus>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button type="submit">Sign in &amp; connect <span aria-hidden="true">&rarr;</span></button>
    </form>
  </div>
  <div class="scopes">Grants permission to ${esc(scopeText)}</div>
  ${PAGE_FOOT}`;
}

export function buildSuccessPageHtml(redirectUrl: string): string {
  const safe = esc(redirectUrl);
  return `${PAGE_HEAD.replace(
      "<title>Connect to Notes</title>",
      `<title>Connected</title><meta http-equiv="refresh" content="1;url=${safe}">`
  )}
  <div class="card" style="text-align:center">
    <div class="check">&#10003;</div>
    <div class="title">Connected</div>
    <div class="sub">You can close this tab and return to your app.</div>
  </div>
  <script>setTimeout(function(){window.location.href=${JSON.stringify(redirectUrl)}},1000)</script>
  ${PAGE_FOOT}`;
}