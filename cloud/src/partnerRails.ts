// T:0 at every payment and the agents' payment tokens, for the console (21 Nov): the Books screen's "Booked in T:0"
// card with its reconcile check, and each agent card's token and its payments' T:0 references. Read only.
//
// Two sources, never mixed, each labelled:
//   - the company's own records, when it has them: the audit rows its runner pushed (t0.booked, t0.reconciled,
//     agent_token.issued / used / refused / revoked; src/accounting/t0Payments.ts, src/policy/agentTokens.ts);
//   - otherwise the recorded live sandbox run (docs/runs/2026-11-20-partner-rails.json, npm run partner-rails), labelled
//     as Purser's own sandbox run and not this company's figures.
// Nothing here pays, revokes or writes. No token is ever here: its id and last four only; no card number: its last four.

import RUN from "../../docs/runs/2026-11-20-partner-rails.json" with { type: "json" };
import type { PartnerRailsRecord } from "../../src/proof/partnerRailsMd.js";
import type { TenantDb } from "./tenant.js";

type Json = Record<string, unknown>;
interface Audit { seq: number; ts: string; event: string; subject: string | null; payload_json: string }
const payload = (r: Audit): Json => { try { return JSON.parse(r.payload_json) as Json; } catch { return {}; } };
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export const PARTNER_EVENTS = ["t0.booked", "t0.reconciled", "agent_token.issued", "agent_token.used", "agent_token.refused", "agent_token.revoked"] as const;

export interface PartnerBooking {
  payment_id: string; rail: string; rail_ref: string; amount: string; currency: string; agent: string | null; counterparty: string | null; what: string | null;
  gl_account: string; cost_centre: string | null; t0_account: string | null; terms_sha256: string | null;
  t0_id: string; je_number: string; booked_at: string; settled_at: string | null; ms_after_settled: number | null; functional: { currency: string; amount: string } | null; explorer: string | null;
}
export interface PartnerRecon { at: string; ok: boolean; rows: { payment_id: string; rail: string; ok: boolean; t0: string | null; rail_read: string | null; failed: string[] }[] }
export interface PartnerToken {
  agent: string; token_id: string; token_last4: string; card_last4: string; status: string; mandate_sha256: string;
  per_purchase: string | null; per_month: string | null; currency: string; mccs: string[]; expires_at: string | null; revoked_at: string | null;
  events: { at: string | null; kind: "used" | "refused"; amount: string | null; merchant: string | null; outcome: string; t0_id: string | null }[];
}
export interface PartnerRails {
  source: "company" | "recorded";
  label: string;
  t0: { bookings: PartnerBooking[]; reconcile: PartnerRecon | null };
  tokens: PartnerToken[];
  /** Misuse the record holds that no token row carries (a card number charged without the token). */
  refusals: { what: string; by: string; code: string; detail: string }[];
  record: string | null;
  story: string | null;
  wallet_pass: { available: boolean };
}

const money = (c: unknown) => (typeof c === "number" ? `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}` : null);

/** From the company's own audit rows, or null when it has none of these. */
export async function partnerFromCompany(db: TenantDb): Promise<Omit<PartnerRails, "wallet_pass"> | null> {
  const rows = await db.select<Audit>("audit_rows", { event: { in: [...PARTNER_EVENTS] } }, { order: ["seq"] });
  if (!rows.length) return null;
  const bookings: PartnerBooking[] = rows.filter((r) => r.event === "t0.booked").map((r) => {
    const p = payload(r);
    const f = p.functional as { currency?: unknown; amount?: unknown } | undefined;
    return {
      payment_id: String(p.payment_id ?? r.subject ?? ""), rail: String(p.rail ?? ""), rail_ref: String(p.rail_ref ?? ""), amount: String(p.amount ?? ""), currency: String(p.currency ?? ""),
      agent: str(p.agent), counterparty: str(p.counterparty), what: null, gl_account: String(p.gl_account ?? ""), cost_centre: str(p.cost_centre), t0_account: str(p.t0_account), terms_sha256: str(p.terms_sha256),
      t0_id: String(p.t0_id ?? ""), je_number: String(p.je_number ?? ""), booked_at: String(p.booked_at ?? r.ts), settled_at: null, ms_after_settled: null,
      functional: f && typeof f.currency === "string" && typeof f.amount === "string" ? { currency: f.currency, amount: f.amount } : null, explorer: null,
    };
  });
  const lastRecon = [...rows].reverse().find((r) => r.event === "t0.reconciled");
  const rp = lastRecon ? payload(lastRecon) : null;
  const reconcile: PartnerRecon | null = rp ? {
    at: String(rp.at ?? lastRecon!.ts), ok: rp.ok === true,
    rows: (Array.isArray(rp.rows) ? rp.rows as Json[] : []).map((x) => ({ payment_id: String(x.payment_id ?? ""), rail: String(x.rail ?? ""), ok: x.ok === true,
      t0: x.t0_amount ? `${String(x.t0_currency ?? "")} ${String(x.t0_amount)}` : null, rail_read: x.rail_amount ? `${String(x.rail_amount)}, ${String(x.rail_status ?? "")}` : null, failed: Array.isArray(x.failed) ? (x.failed as unknown[]).map(String) : [] })),
  } : null;
  const tokens = new Map<string, PartnerToken>();
  for (const r of rows) {
    const p = payload(r);
    const id = str(p.token_id);
    if (r.event === "agent_token.issued" && id) {
      const m = (p.mandate ?? {}) as Json;
      tokens.set(id, { agent: String(p.agent ?? r.subject ?? ""), token_id: id, token_last4: String(p.token_last4 ?? ""), card_last4: String(p.card_last4 ?? ""), status: "active", mandate_sha256: String(p.mandate_sha256 ?? ""),
        per_purchase: money(m.per_purchase_cents), per_month: money(m.monthly_cents), currency: String(m.currency ?? "EUR"), mccs: Array.isArray(m.mccs) ? (m.mccs as unknown[]).map(String) : [], expires_at: str(m.expires_at), revoked_at: null, events: [] });
    }
    const t = id ? tokens.get(id) : undefined;
    if (!t) continue;
    if (r.event === "agent_token.revoked") { t.status = "revoked"; t.revoked_at = r.ts; }
    const t0Of = (txId: unknown) => bookings.find((b) => typeof txId === "string" && b.rail_ref === txId)?.t0_id ?? null;
    if (r.event === "agent_token.used") t.events.push({ at: r.ts, kind: "used", amount: str(p.amount), merchant: str(p.merchant), outcome: p.approved === true ? "approved" : `declined ${String(p.reason ?? p.status ?? "")}`.trim(), t0_id: t0Of(p.transaction_id) });
    if (r.event === "agent_token.refused") t.events.push({ at: r.ts, kind: "refused", amount: str(p.amount), merchant: str(p.merchant), outcome: String(p.code ?? "refused"), t0_id: null });
  }
  return { source: "company", label: "This company's own records", t0: { bookings, reconcile }, tokens: [...tokens.values()], refusals: [], record: null, story: null };
}

/** The recorded live sandbox run, as its record holds it. */
export function partnerFromRecord(r: PartnerRailsRecord = RUN as unknown as PartnerRailsRecord): Omit<PartnerRails, "wallet_pass"> {
  const bookings: PartnerBooking[] = r.payments.map((p) => ({
    payment_id: p.key, rail: p.rail, rail_ref: p.rail_ref, amount: p.amount, currency: p.currency, agent: p.agent, counterparty: p.counterparty, what: p.what,
    gl_account: p.gl_account, cost_centre: p.cost_centre, t0_account: p.t0.t0_account, terms_sha256: p.terms_sha256, t0_id: p.t0.t0_id, je_number: p.t0.je_number, booked_at: p.t0.booked_at,
    settled_at: p.settled_at, ms_after_settled: p.t0.ms_after_settled, functional: { currency: p.t0.functional.currency, amount: p.t0.functional.amount }, explorer: p.explorer ?? null,
  }));
  const keyOf = new Map(r.payments.map((p) => [`${p.rail_ref}`, p.key]));
  const reconcile: PartnerRecon | null = r.reconcile ? {
    at: r.reconcile.at, ok: r.reconcile.ok,
    rows: r.reconcile.rows.map((x) => ({ payment_id: keyOf.get(x.rail_ref) ?? x.payment_id, rail: x.rail, ok: x.ok, t0: x.t0.amount ? `${x.t0.currency ?? ""} ${x.t0.amount}` : null,
      rail_read: x.rail_read ? `${x.rail_read.currency} ${x.rail_read.amount}, ${x.rail_read.status}` : null, failed: x.checks.filter((c) => !c.ok).map((c) => c.name) })),
  } : null;
  const tokens: PartnerToken[] = r.tokens.map((t) => ({
    agent: t.agent, token_id: t.token_id, token_last4: t.token_last4, card_last4: t.card_last4, status: t.status_at_end, mandate_sha256: t.mandate_sha256,
    per_purchase: money(t.mandate.per_purchase_cents), per_month: money(t.mandate.monthly_cents), currency: t.mandate.currency, mccs: t.mandate.mccs, expires_at: t.mandate.expires_at,
    revoked_at: r.revoke && r.revoke.token_id === t.token_id ? r.revoke.revoked_at : null,
    events: [
      ...r.payments.filter((p) => p.token_id === t.token_id).map((p) => ({ at: p.settled_at, kind: "used" as const, amount: p.amount, merchant: p.counterparty, outcome: "approved", t0_id: p.t0.t0_id })),
      ...r.refusals.filter((x) => x.by === "purser" && x.what.startsWith(`the ${t.agent} agent's token`)).map((x) => ({ at: null, kind: "refused" as const, amount: null, merchant: null, outcome: `${x.code}: ${x.what}`, t0_id: null })),
    ],
  }));
  return {
    source: "recorded",
    label: `Recorded live sandbox run of ${r.started_at.slice(0, 10)} (Purser's own test world, test money): not this company's figures`,
    t0: { bookings, reconcile }, tokens,
    refusals: r.refusals.filter((x) => x.by !== "purser").map((x) => ({ what: x.what, by: x.by, code: x.code, detail: x.detail })),
    record: `${REPO}docs/runs/${r.run}.json`, story: `${REPO}docs/runs/${r.run}.md`,
  };
}

export async function partnerRailsOf(db: TenantDb, o: { walletPass: boolean }): Promise<PartnerRails> {
  const own = await partnerFromCompany(db);
  return { ...(own ?? partnerFromRecord()), wallet_pass: { available: o.walletPass } };
}
