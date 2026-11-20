// "Your connections" (cloud/src/yourConnections.ts): each way a company is connected, from its own rows, with its status
// for this company (connected, not connected, not available on this cloud) and a count where there is one. A key past its
// expiry, a revoked key and a webhook switched off after failures do not count as connected; a provider the platform has
// not configured is "not available", whatever rows exist; a sign-in provider is "connected" only for the person who
// linked it. Never a secret, a token or a URL in the answer.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { yourConnections } from "../cloud/src/yourConnections.js";
import type { ConnectEnv } from "../cloud/src/connect.js";
import type { OidcEnv } from "../cloud/src/oidc.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud, t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("conn"); });
afterEach(() => { c.close(); });

/** A row with every NOT NULL column without a default filled ("x", or 0 for a number), then the given fields. */
async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  const cols = await c.env.sql.all<{ name: string; type: string; notnull: number; dflt_value: unknown }>(`PRAGMA table_info(${table})`, []);
  const full: Record<string, unknown> = {};
  for (const col of cols) if (col.notnull && col.dflt_value === null) full[col.name] = /INT/i.test(col.type) ? 0 : "x";
  Object.assign(full, row);
  const keys = Object.keys(full);
  await c.env.sql.run(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => full[k]) as never);
}
const NOW = new Date("2026-11-08T12:00:00Z");
const status = (items: { id: string; status: string; detail: string | null }[], id: string) => items.find((x) => x.id === id)!;
const client = { clientId: "id", clientSecret: "secret", redirectUri: "https://cloud.test/cb" };

describe("your connections", () => {
  it("without anything configured: keys from the owner only, the rest not connected or not available", async () => {
    const r = await yourConnections(c.env.sql, { tenantId: t.id, userId: null, now: NOW, connect: undefined, oidc: undefined, mailDomain: undefined });
    expect(r.rule).toMatch(/only the CFO's passkey/);
    expect(status(r.items, "api_keys")).toMatchObject({ status: "connected", detail: "1 live key" });
    for (const id of ["mcp", "webhook", "slack", "teams", "alerts"]) expect(status(r.items, id).status, id).toBe("not_connected");
    for (const id of ["inbox", "airwallex", "moneybird", "xero", "quickbooks", "exact", "sign_in_google", "sign_in_microsoft", "sign_in_apple"]) expect(status(r.items, id).status, id).toBe("not_available");
  });

  it("counts MCP tokens and alert targets, names the inbox, and says when a hook was switched off after failures", async () => {
    await insert("api_keys", { tenant_id: t.id, id: "k_mcp1", purpose: "claude", revoked_at: null, expires_at: "2027-01-01T00:00:00Z" });
    await insert("api_keys", { tenant_id: t.id, id: "k_mcp2", purpose: "claude-propose", revoked_at: null, expires_at: "2027-01-01T00:00:00Z" });
    await insert("api_keys", { tenant_id: t.id, id: "k_old", purpose: null, revoked_at: null, expires_at: "2026-01-01T00:00:00Z" });
    await insert("api_keys", { tenant_id: t.id, id: "k_gone", purpose: null, revoked_at: "2026-11-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" });
    await insert("webhooks", { tenant_id: t.id, id: "main", disabled_at: "2026-11-07T00:00:00Z" });
    await insert("chat_hooks", { tenant_id: t.id, id: "slack", disabled_at: null });
    await insert("chat_hooks", { tenant_id: t.id, id: "teams", disabled_at: "2026-11-07T00:00:00Z" });
    await insert("alert_targets", { tenant_id: t.id, id: "a1", channel: "email" });
    await insert("alert_targets", { tenant_id: t.id, id: "a2", channel: "whatsapp" });
    const r = await yourConnections(c.env.sql, { tenantId: t.id, userId: t.owner, now: NOW, connect: undefined, oidc: undefined, mailDomain: "in.cloud.test" });
    expect(status(r.items, "api_keys")).toMatchObject({ status: "connected", detail: "1 live key" });
    expect(status(r.items, "mcp")).toMatchObject({ status: "connected", detail: "2 connector tokens" });
    expect(status(r.items, "webhook")).toMatchObject({ status: "not_connected", detail: "switched off after failures" });
    expect(status(r.items, "slack")).toMatchObject({ status: "connected", detail: null });
    expect(status(r.items, "teams")).toMatchObject({ status: "not_connected", detail: "switched off after failures" });
    expect(status(r.items, "alerts")).toMatchObject({ status: "connected", detail: "2 targets" });
    expect(status(r.items, "inbox")).toMatchObject({ status: "connected", detail: "conn@in.cloud.test" });
    expect(JSON.stringify(r)).not.toMatch(/secret|https:\/\/[^"]*hooks/);
  });

  it("a provider the platform offers: connected only with this company's connected row; a sign-in only for the person who linked it", async () => {
    const connect = { tokenKey: "k", fetch, clients: { airwallex: client, moneybird: client, xero: client, quickbooks: client } } as unknown as ConnectEnv;
    const oidc = { fetch, clients: { google: { clientId: "g", clientSecret: "gs" }, microsoft: { clientId: "m", clientSecret: "ms", tenant: "common" } } } as unknown as OidcEnv;
    await insert("oauth_connections", { tenant_id: t.id, provider: "airwallex", status: "connected" });
    await insert("oauth_connections", { tenant_id: t.id, provider: "moneybird", status: "disconnected" });
    await insert("books_connections", { tenant_id: t.id, provider: "xero", status: "connected" });
    await insert("books_connections", { tenant_id: t.id, provider: "exact", status: "connected" });
    await insert("identity_links", { tenant_id: t.id, provider: "google", issuer: "https://accounts.google.com", subject: "s1", user_id: t.owner, linked_at: "2026-11-01T00:00:00Z" });
    const mine = await yourConnections(c.env.sql, { tenantId: t.id, userId: t.owner, now: NOW, connect, oidc, mailDomain: undefined });
    expect(["airwallex", "moneybird", "xero", "quickbooks", "exact"].map((p) => status(mine.items, p).status)).toEqual(["connected", "not_connected", "connected", "not_connected", "not_available"]);
    expect(status(mine.items, "sign_in_google")).toMatchObject({ status: "connected", detail: "reads only; the passkey approves" });
    expect(status(mine.items, "sign_in_microsoft").status).toBe("not_connected");
    expect(status(mine.items, "sign_in_apple")).toMatchObject({ status: "not_available", detail: null });
    const someoneElse = await yourConnections(c.env.sql, { tenantId: t.id, userId: "u_other", now: NOW, connect, oidc, mailDomain: undefined });
    expect(status(someoneElse.items, "sign_in_google").status).toBe("not_connected");
  });
});
