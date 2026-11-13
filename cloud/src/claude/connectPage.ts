// GET /connect-ai: how to connect each AI client to this cloud's /mcp, one tab per client, with an exact config to copy
// and a one-click "Add to …" link where the client has one. No script (the tabs are radio buttons and CSS), its own
// styles (the shared site CSS is not touched), every address built from this cloud's own origin.
//
// What each tab says was read from the client's own documentation on 13 Nov 2026 (docs/connect-claude.md lists the
// pages). The demo token reads the made-up demo company; a company's own connector token is made in Purser Cloud.

import { DEMO_CONNECTOR_TOKEN } from "../auth.js";
import { ICON_LINKS } from "../brand.js";
import { randomToken } from "../crypto.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export interface ClientTab { id: string; name: string; intro: string; steps: string[]; snippets: { label: string; code: string }[]; links: { label: string; href: string }[]; note: string }

/** The tabs, built for one cloud: exact snippets and links with its own /mcp address. */
export function clientTabs(origin: string, token = DEMO_CONNECTOR_TOKEN): ClientTab[] {
  const mcp = `${origin}/mcp`;
  const bearer = `Bearer ${token}`;
  const json = (o: unknown) => JSON.stringify(o, null, 2);
  // Cursor's install link: the server object (no name wrapper), base64 (cursor.com/docs/mcp/install-links).
  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=purser&config=${encodeURIComponent(b64(JSON.stringify({ url: mcp })))}`;
  // VS Code's install link: vscode:mcp/install?<url-encoded JSON with name>, opened from the web through vscode.dev/redirect.
  const vscodeUri = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "purser", type: "http", url: mcp }))}`;
  return [
    { id: "claude", name: "Claude", intro: "claude.ai, the Claude desktop and mobile apps, and Claude Code.",
      steps: ["claude.ai or the Claude app: Customize (or Settings), Connectors, Add custom connector.", `Name it Purser and paste ${mcp}. Leave the sign-in on automatic.`, "Claude opens Purser's sign-in page: paste your connector token, or choose Use the demo company."],
      snippets: [{ label: "Claude Code, with a token", code: `claude mcp add --transport http purser ${mcp} --header "Authorization: ${bearer}"` }, { label: "Claude Code, signing in through Purser's page", code: `claude mcp add --transport http purser ${mcp}` }],
      links: [], note: "On a Team or Enterprise plan an owner adds custom connectors for the organisation." },
    { id: "chatgpt", name: "ChatGPT", intro: "ChatGPT on the web: custom MCP servers as connectors (apps).",
      steps: ["In ChatGPT, open Apps (or Plugins), +, Add custom MCP server.", `Name Purser, connection URL ${mcp}.`, "Authentication: OAuth. ChatGPT finds Purser's sign-in by itself; on Purser's page paste your connector token or choose Use the demo company.", "Accept the warning and create it. Purser's tools are read only."],
      snippets: [], links: [],
      note: "ChatGPT signs in by OAuth only; it cannot send a fixed token, so the demo token does not apply here (choose Use the demo company instead). OpenAI lists custom MCP servers for Business, Enterprise and Edu workspaces, and read/fetch connectors for Pro." },
    { id: "cursor", name: "Cursor", intro: "Cursor's agent, in ~/.cursor/mcp.json (all projects) or .cursor/mcp.json (one project).",
      steps: ["Click Add to Cursor, or paste the config below.", "Without a header, Cursor opens Purser's sign-in page."],
      snippets: [{ label: "~/.cursor/mcp.json", code: json({ mcpServers: { purser: { url: mcp, headers: { Authorization: "Bearer ${env:PURSER_CONNECTOR_TOKEN}" } } } }) }],
      links: [{ label: "Add to Cursor", href: cursorLink }], note: "Set PURSER_CONNECTOR_TOKEN to your connector token (or purser-demo-read-only)." },
    { id: "vscode", name: "VS Code", intro: "GitHub Copilot's agent mode in VS Code.",
      steps: ["Click Add to VS Code, or Command Palette, MCP: Add Server, HTTP, and paste the address.", "VS Code opens Purser's sign-in page, or sends the header from the config below."],
      snippets: [{ label: ".mcp.json at the workspace root (or ~/.copilot/mcp-config.json)", code: json({ mcpServers: { purser: { type: "http", url: mcp, headers: { Authorization: "Bearer ${PURSER_CONNECTOR_TOKEN}" } } } }) },
        { label: ".vscode/mcp.json (the older format, asks for the token once)", code: json({ inputs: [{ type: "promptString", id: "purser-token", description: "Purser connector token", password: true }], servers: { purser: { type: "http", url: mcp, headers: { Authorization: "Bearer ${input:purser-token}" } } } }) }],
      links: [{ label: "Add to VS Code", href: `https://vscode.dev/redirect?url=${encodeURIComponent(vscodeUri)}` }, { label: "Add to VS Code Insiders", href: `https://vscode.dev/redirect?url=${encodeURIComponent(vscodeUri.replace(/^vscode:/, "vscode-insiders:"))}` }], note: "" },
    { id: "gemini", name: "Gemini CLI", intro: "Google's Gemini CLI, in ~/.gemini/settings.json (or .gemini/settings.json in a project).",
      steps: ["Run the command, or add the config. httpUrl (not url) is Streamable HTTP."],
      snippets: [{ label: "Command", code: `gemini mcp add --transport http --scope user --header "Authorization: ${bearer}" purser ${mcp}` }, { label: "~/.gemini/settings.json", code: json({ mcpServers: { purser: { httpUrl: mcp, headers: { Authorization: bearer } } } }) }],
      links: [], note: "Without a header, Gemini CLI finds Purser's sign-in on the first 401." },
    { id: "windsurf", name: "Windsurf", intro: "Windsurf, now Devin Desktop: its MCP config file.",
      steps: ["Open the MCP config (~/.config/devin/mcp_config.json; older Windsurf: ~/.codeium/windsurf/mcp_config.json) and add Purser."],
      snippets: [{ label: "mcp_config.json", code: json({ mcpServers: { purser: { serverUrl: mcp, headers: { Authorization: "Bearer ${env:PURSER_CONNECTOR_TOKEN}" } } } }) }, { label: "Devin CLI", code: `devin mcp add purser ${mcp}` }],
      links: [], note: "Windsurf's MCP documentation now lives in Devin's docs." },
    { id: "other", name: "Other", intro: "Any MCP client that speaks Streamable HTTP, and the MCP Inspector.",
      steps: [`The server: ${mcp} (Streamable HTTP). Sign-in: OAuth 2.1 with PKCE (client metadata documents or dynamic registration), or a bearer header.`],
      snippets: [{ label: "MCP Inspector", code: `npx @modelcontextprotocol/inspector --cli ${mcp} --transport http --method tools/list --header "Authorization: ${bearer}"` }],
      links: [{ label: "OAuth metadata", href: `${origin}/.well-known/oauth-protected-resource` }], note: "" },
  ];
}

export function connectPage(origin: string): Response {
  const nonce = randomToken(12);
  const tabs = clientTabs(origin);
  const radios = tabs.map((t, i) => `<input type="radio" name="tab" id="t-${t.id}"${i === 0 ? " checked" : ""}>`).join("");
  const labels = tabs.map((t) => `<label for="t-${t.id}">${esc(t.name)}</label>`).join("");
  const panels = tabs.map((t) => `<section class="panel" id="p-${t.id}"><h2>${esc(t.name)}</h2><p class="intro">${esc(t.intro)}</p>
${t.links.length ? `<p class="links">${t.links.map((l) => `<a class="btn" href="${esc(l.href)}" rel="noopener">${esc(l.label)}</a>`).join("")}</p>` : ""}
<ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
${t.snippets.map((s) => `<p class="label">${esc(s.label)}</p><pre tabindex="0"><code>${esc(s.code)}</code></pre>`).join("")}
${t.note ? `<p class="note">${esc(t.note)}</p>` : ""}</section>`).join("");
  const show = tabs.map((t) => `#t-${t.id}:checked~.tabs label[for=t-${t.id}]{background:var(--ink);color:#fff;border-color:var(--ink)}#t-${t.id}:checked~.panels #p-${t.id}{display:block}`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Connect your AI to Purser</title><meta name="description" content="Connect Claude, ChatGPT, Cursor, VS Code, Gemini CLI or Windsurf to Purser over MCP. Read only: no AI approves or pays.">${ICON_LINKS}
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#0b1220;--muted:#586174;--line:#e3e6ec;--bg:#f7f8fa;--accent:#4f46e5}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 16px 48px}.brand{display:flex;align-items:center;gap:10px;font-weight:750;font-size:18px;margin:0 0 14px}.brand img{width:32px;height:32px;border-radius:9px}
h1{font-size:26px;line-height:1.2;margin:0 0 8px;letter-spacing:-.01em}.lede{color:var(--muted);margin:0 0 14px}
.facts{display:grid;gap:8px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 18px}.facts div{display:grid;grid-template-columns:120px 1fr;gap:10px}.facts b{font-weight:650}
.facts code,pre{font:13.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.facts code{word-break:break-all}
input[type=radio]{position:absolute;opacity:0;pointer-events:none}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.tabs label{border:1px solid #cbd2dc;background:#fff;border-radius:999px;padding:8px 14px;cursor:pointer;font-weight:600;min-height:40px;display:inline-flex;align-items:center}
input[type=radio]:focus-visible~.tabs label{outline:none}
.panel{display:none;background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 18px 8px}.panel h2{margin:0 0 4px;font-size:20px}.intro{color:var(--muted);margin:0 0 12px}
ol{padding-left:20px;margin:0 0 12px}li{margin:0 0 6px}.label{font-weight:650;margin:12px 0 6px;font-size:14px}
pre{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:12px 14px;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 10px}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:10px 16px;border-radius:12px;background:var(--accent);color:#fff;font-weight:650;text-decoration:none;margin:0 8px 8px 0}
.note{color:var(--muted);font-size:14px;margin:8px 0 12px}.rule{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px 14px;margin:0 0 18px}
footer{color:var(--muted);font-size:13px;margin-top:20px}
${show}
</style></head><body><main><div class="brand"><img src="/favicon.svg" alt="" width="32" height="32">Purser</div>
<h1>Connect your AI to Purser</h1>
<p class="lede">Your AI reads your books in Purser over MCP: invoices, payments, cash, VAT, what waits for approval and the CFO's policy.</p>
<p class="rule"><b>Read only.</b> No AI can approve, pay, change a limit or write to the books. Every payment needs the CFO's Face ID in Purser Cloud.</p>
<div class="facts"><div><b>Server</b><code>${esc(`${origin}/mcp`)}</code></div><div><b>Transport</b><span>Streamable HTTP (MCP 2026-07-28, and 2025-11-25 back to 2024-11-05)</span></div>
<div><b>Sign-in</b><span>OAuth 2.1 with PKCE, or a bearer header with your connector token (Purser Cloud: Settings, Connect your AI).</span></div>
<div><b>Demo token</b><span><code>${esc(DEMO_CONNECTOR_TOKEN)}</code> reads the demo company: made-up data, no real money.</span></div></div>
${radios}<nav class="tabs" aria-label="Clients">${labels}</nav><div class="panels">${panels}</div>
<footer>Each tab follows that client's own documentation as read on 13 Nov 2026. Purser has been tried live in Claude's iOS app and with the MCP Inspector; the other clients are described from their docs.</footer>
</main></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "referrer-policy": "same-origin",
    "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } });
}
