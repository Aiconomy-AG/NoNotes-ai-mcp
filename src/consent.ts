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
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1b1b1d;display:flex;justify-content:center;align-items:center;min-height:100vh;color:#1d1d1f;padding:16px}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;width:100%;padding:36px 32px}
  .logo{font-size:22px;font-weight:700;color:#d71921;margin-bottom:4px}
  .subtitle{font-size:14px;color:#6e6e73;margin-bottom:24px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  input{width:100%;padding:11px 12px;border:1px solid #d2d2d7;border-radius:9px;font-size:15px}
  input:focus{outline:none;border-color:#d71921;box-shadow:0 0 0 3px rgb(120 17 20)}
  button{width:100%;margin-top:22px;padding:12px;background:#d71921;color:#fff;border:none;border-radius:9px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#d71921}
  .err{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:9px;padding:10px 12px;font-size:13px;margin-bottom:16px}
  .scopes{font-size:12px;color:#6e6e73;margin-top:18px;text-align:center}
  .check{font-size:44px;text-align:center;margin-bottom:12px}
  .title{font-size:19px;font-weight:600;text-align:center;margin-bottom:8px}
</style></head><body><div class="card">`;

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
  <div class="logo">Notes</div>
  <div class="subtitle">${clientLabel} wants to connect to your notes. Sign in to allow it.</div>
  ${errBox}
  <form method="POST" action="/oauth/consent">
    <input type="hidden" name="client_id" value="${esc(p.clientId)}">
    <input type="hidden" name="redirect_uri" value="${esc(p.redirectUri)}">
    <input type="hidden" name="state" value="${esc(p.state ?? "")}">
    <input type="hidden" name="code_challenge" value="${esc(p.codeChallenge)}">
    <input type="hidden" name="scopes" value="${esc(p.scopes.join(" "))}">
    <input type="hidden" name="resource" value="${esc(p.resource)}">
    <label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in &amp; connect</button>
  </form>
  <div class="scopes">Grants permission to ${esc(scopeText)}.</div>
  ${PAGE_FOOT}`;
}

export function buildSuccessPageHtml(redirectUrl: string): string {
  const safe = esc(redirectUrl);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="1;url=${safe}">
<title>Connected</title><style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f7;display:flex;justify-content:center;align-items:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;padding:40px;text-align:center}
  .logo{font-size:22px;font-weight:700;color:#2563eb;margin-bottom:8px}
  .check{font-size:44px;margin-bottom:12px}
  .title{font-size:19px;font-weight:600;margin-bottom:8px}
  .sub{font-size:14px;color:#6e6e73}
</style></head><body><div class="card">
  <div class="logo">${esc(SERVER_NAME)}</div>
  <div class="check">&#10003;</div>
  <div class="title">Connected</div>
  <div class="sub">You can close this tab and return to your app.</div>
  <script>setTimeout(function(){window.location.href=${JSON.stringify(redirectUrl)}},1000)</script>
</div></body></html>`;
}
