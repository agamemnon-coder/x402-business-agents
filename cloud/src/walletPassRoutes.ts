// The agent card's Apple Wallet pass, served (./walletPass.ts builds it). Three ways in, each only when the owner has
// configured passes (CloudEnv.walletPass):
//   GET  /v1/agents/{id}/wallet-pass        the pass itself, for a signed-in reader of the company (a bearer token);
//   POST /v1/agents/{id}/wallet-pass/link   a link to it that works for 5 minutes without a header, so Safari on an
//                                            iPhone can open it and offer "Add to Apple Wallet";
//   GET  /v1/wallet-pass/{link}             that link: pwp.<company>.<agent>.<expiry>.<MAC>, the MAC an HMAC-SHA-256
//                                            (128 bits) under a key derived from the session secret.
// The pass carries what the agent card shows: name, limits, the card's last four, status; the agent's token id only when
// it is this company's own (never the recorded run's), never the token.

import { agentsOf } from "./consoleData.js";
import { hmacB64u, sameString } from "./crypto.js";
import { partnerFromCompany } from "./partnerRails.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";
import { buildPkpass, PKPASS_TYPE, type AgentPassData, type PassConfig } from "./walletPass.js";

export type { PassConfig } from "./walletPass.js";

export const LINK_TTL_MS = 5 * 60_000;
const TAG = "pwp";
const linkSecret = (sessionSecret: string) => `wallet-pass:${sessionSecret}`;

/** What the pass shows for one of the company's agents, or null when it has no such agent with a card. */
export async function passDataFor(sql: Sql, tenantId: string, agent: string, origin: string): Promise<AgentPassData | null> {
  const db = new TenantDb(sql, tenantId);
  const company = await sql.first<{ name: string }>("SELECT name FROM tenants WHERE id = ?", [tenantId]);
  const a = ((await agentsOf(db)).agents as { id: string; name: string; role: string; status: string; card: { last4: string; currency: string; per_purchase: string | null; per_month: string | null } | null }[]).find((x) => x.id === agent);
  if (!company || !a || !a.card) return null;
  const own = await partnerFromCompany(db);
  const tok = own?.tokens.filter((t) => t.agent === agent).at(-1) ?? null;
  const status = a.status === "revoked" || a.status === "paused" ? a.status : "active";
  return {
    company: company.name, tenant: tenantId, agent, name: a.name, role: a.role, card_last4: a.card.last4 || null, currency: a.card.currency,
    per_purchase: a.card.per_purchase, per_month: a.card.per_month, status,
    token: tok ? { token_id: tok.token_id, status: tok.status, mandate_sha256: tok.mandate_sha256 } : null,
    console_url: `${origin.replace(/\/+$/, "")}/console#/agents`,
  };
}

function pkpassResponse(bytes: Uint8Array, agent: string): Response {
  return new Response(bytes as BodyInit, { status: 200, headers: { "content-type": PKPASS_TYPE, "content-disposition": `attachment; filename="purser-${agent.replace(/[^a-z0-9_-]/gi, "_")}.pkpass"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

/** The pass for a signed-in reader: null when passes are not configured or the agent has no card. */
export async function walletPassFor(cfg: PassConfig | undefined, sql: Sql, tenantId: string, agent: string, origin: string, now: Date): Promise<Response | null> {
  if (!cfg) return null;
  const d = await passDataFor(sql, tenantId, agent, origin);
  return d ? pkpassResponse(await buildPkpass(cfg, d, now), agent) : null;
}

/** A link to the pass that works for LINK_TTL_MS without a header; null when there is no pass to link to. */
export async function walletPassLink(cfg: PassConfig | undefined, sql: Sql, sessionSecret: string, tenantId: string, agent: string, origin: string, now: Date): Promise<{ url: string; expires_at: string } | null> {
  if (!cfg || !(await passDataFor(sql, tenantId, agent, origin))) return null;
  const exp = (now.getTime() + LINK_TTL_MS).toString(36);
  const body = `${TAG}.${tenantId}.${agent}.${exp}`;
  return { url: `${origin.replace(/\/+$/, "")}/v1/wallet-pass/${body}.${await linkMac(sessionSecret, body)}`, expires_at: new Date(parseInt(exp, 36)).toISOString() };
}

/** The link's MAC: HMAC-SHA-256 under its own secret, its first 128 bits (a path segment holds at most 120 characters). */
const linkMac = async (sessionSecret: string, body: string) => (await hmacB64u(linkSecret(sessionSecret), body)).slice(0, 22);

/** The pass a link names, while the link is good; null otherwise (a wrong MAC, a link past its time, no pass). */
export async function walletPassByLink(cfg: PassConfig | undefined, sql: Sql, sessionSecret: string, token: string, origin: string, now: Date): Promise<Response | null> {
  if (!cfg) return null;
  const m = /^pwp\.(t_[A-Za-z0-9_-]{6,64})\.([a-z0-9_:-]{1,40})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m || !sameString(await linkMac(sessionSecret, `${TAG}.${m[1]}.${m[2]}.${m[3]}`), m[4]!)) return null;
  if (parseInt(m[3]!, 36) <= now.getTime()) return null;
  return walletPassFor(cfg, sql, m[1]!, m[2]!, origin, now);
}
