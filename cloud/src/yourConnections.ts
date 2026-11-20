// "Your connections" (Settings, 20 Nov): every way this company is connected to other systems, in one list, each with
// its status for THIS company: connected, not connected (the company can switch it on itself, on Connections), or not
// available yet (the platform has not configured it on this cloud). Read from the company's own rows; never a secret,
// a token or a webhook URL.

import type { ConnectEnv } from "./connect.js";
import { CONNECT_PROVIDERS } from "./connect.js";
import type { OidcEnv } from "./oidc.js";
import { IDPS } from "./oidc.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

export type ConnectionStatus = "connected" | "not_connected" | "not_available";
export interface YourConnection { id: string; name: string; status: ConnectionStatus; detail: string | null; where: string }

const NAMES: Record<string, string> = { airwallex: "Airwallex", moneybird: "Moneybird", xero: "Xero", quickbooks: "QuickBooks Online", exact: "Exact Online", google: "Google", microsoft: "Microsoft", apple: "Apple" };

export async function yourConnections(sql: Sql, a: { tenantId: string; userId: string | null; now: Date; connect: ConnectEnv | undefined; oidc: OidcEnv | undefined; mailDomain: string | undefined }): Promise<{ rule: string; items: YourConnection[] }> {
  const db = new TenantDb(sql, a.tenantId);
  const iso = a.now.toISOString();
  const keys = await db.select<{ purpose: string | null; revoked_at: string | null; expires_at: string | null }>("api_keys", { revoked_at: null });
  const live = keys.filter((k) => k.expires_at && k.expires_at > iso);
  const plain = live.filter((k) => !k.purpose).length;
  const mcp = live.filter((k) => k.purpose === "claude" || k.purpose === "claude-propose").length;
  const hook = await db.one<{ disabled_at: string | null }>("webhooks", { id: "main" });
  const chats = await db.select<{ id: string; disabled_at: string | null }>("chat_hooks", {});
  const alerts = await db.count("alert_targets", {});
  const slug = (await sql.first<{ slug: string }>("SELECT slug FROM tenants WHERE id = ?", [a.tenantId]))?.slug ?? "";
  const items: YourConnection[] = [
    { id: "api_keys", name: "API keys (REST, Zapier, Make, n8n)", status: plain ? "connected" : "not_connected", detail: plain ? `${plain} live key${plain === 1 ? "" : "s"}` : null, where: "#/settings" },
    { id: "mcp", name: "Claude and other AI clients (MCP)", status: mcp ? "connected" : "not_connected", detail: mcp ? `${mcp} connector token${mcp === 1 ? "" : "s"}` : null, where: "#/connections" },
    { id: "webhook", name: "Signed webhook", status: hook && !hook.disabled_at ? "connected" : "not_connected", detail: hook?.disabled_at ? "switched off after failures" : null, where: "#/connections" },
    ...(["slack", "teams"] as const).map((p): YourConnection => {
      const h = chats.find((x) => x.id === p);
      return { id: p, name: p === "slack" ? "Slack" : "Microsoft Teams", status: h && !h.disabled_at ? "connected" : "not_connected", detail: h?.disabled_at ? "switched off after failures" : null, where: "#/connections" };
    }),
    { id: "alerts", name: "Approval alerts (e-mail, WhatsApp, Slack, Teams)", status: alerts ? "connected" : "not_connected", detail: alerts ? `${alerts} target${alerts === 1 ? "" : "s"}` : null, where: "#/connections" },
    { id: "inbox", name: "Invoices by e-mail (forward from Gmail or Outlook)", status: a.mailDomain ? "connected" : "not_available", detail: a.mailDomain ? `${slug}@${a.mailDomain}` : null, where: "#/settings" },
  ];
  for (const p of CONNECT_PROVIDERS) {
    const offered = Boolean(a.connect?.clients[p]);
    const table = p === "airwallex" || p === "moneybird" ? "oauth_connections" : "books_connections";
    const row = offered ? await sql.first<{ status: string }>(`SELECT status FROM ${table} WHERE tenant_id = ? AND provider = ?`, [a.tenantId, p]) : null;
    items.push({ id: p, name: NAMES[p]!, status: !offered ? "not_available" : row?.status === "connected" ? "connected" : "not_connected", detail: null, where: "#/connections" });
  }
  const linked = a.userId ? (await db.select<{ provider: string }>("identity_links", { user_id: a.userId })).map((r) => r.provider) : [];
  for (const p of IDPS) {
    const offered = Boolean(a.oidc?.clients[p]);
    items.push({ id: `sign_in_${p}`, name: `Sign in with ${NAMES[p]} (you)`, status: !offered ? "not_available" : linked.includes(p) ? "connected" : "not_connected", detail: offered ? "reads only; the passkey approves" : null, where: "#/settings" });
  }
  return { rule: "Each company connects its own systems here. Nothing connected can approve a payment: only the CFO's passkey (Face ID) in Purser Cloud can.", items };
}
