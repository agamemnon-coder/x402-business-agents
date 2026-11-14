// The agents' live sandbox cards in Purser Cloud (14 Nov, Max: "each agent gets its own live Airwallex sandbox card,
// with the CFO policy's limits, and the CFO freezes and unfreezes it with Face ID from the Agents tab").
//
// The Cloud holds no Airwallex key. It asks the kit11 Worker's AwxCards entrypoint (worker/src/awxCards.ts) over a
// service binding; every call there is on the card allow-list (src/airwallex/cardGate.ts) and comes back with the last
// four digits at most. Nothing here ever sees, stores or shows a full card number or a CVV.
//
// Every write is an action the CFO signs with their passkey:
//   1. POST /v1/cards/actions: the Cloud writes down the exact action (company, agent, what, the card, the limits, who,
//      a nonce, when it expires), as canonical JSON, and its SHA-256. The passkey challenge IS that hash (base64url).
//   2. POST /v1/cards/actions/{id}/sign: the signed-in owner's own passkey signed that challenge; the Cloud checks the
//      signature, then runs the action once. The same signed action again answers what it did the first time
//      (idempotency by the signed hash; a new card's request_id at Airwallex is that hash too).
// Locks, all fail-closed: the admin switch awx_cards (off while missing), kit11's AWX_CARDS_WRITE, no /try test
// companies, at most CARDS_PER_COMPANY cards a company and WRITES_PER_DAY writes a company a UTC day (WRITES_PER_DAY_ALL
// across all companies). Sandbox only, test money only.
import { verifyAssertion, type AssertionB64 } from "../../worker/src/webauthn.js";
import { CARD_ACTIVE_DAYS, CARDS as POLICY_CARDS } from "../../src/config/policy.js";
import type { CardsAnswer, CardsPort, SafeCard, SafeTx } from "../../src/airwallex/cardGate.js";
import { AuthError, type Caller } from "./auth.js";
import { agentsOf } from "./consoleData.js";
import { randomToken, sha256Hex, toB64u } from "./crypto.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";
import { on, readSwitches } from "./try/switches.js";

export type { CardsPort } from "../../src/airwallex/cardGate.js";

export const CARDS_PER_COMPANY = 3;
export const WRITES_PER_DAY = 20;
export const WRITES_PER_DAY_ALL = 60;
/** How long an action waits for the passkey. */
export const ACTION_TTL_MS = 5 * 60_000;
/** How long a card's live read serves the Agents tab. */
const READ_TTL_MS = 20_000;
/** How long the Issuing scope check's answer serves everyone. */
const SCOPE_TTL_MS = 60_000;
/** A test purchase is this much over the card's limit per purchase: Airwallex should decline it. */
const TEST_OVER_CENTS = 500;
export const CARDS_LABEL = "Airwallex sandbox · test money";

const TABLES = `
CREATE TABLE IF NOT EXISTS agent_cards (
  tenant_id TEXT NOT NULL, agent TEXT NOT NULL, card_id TEXT NOT NULL, last4 TEXT, status TEXT NOT NULL,
  per_tx_cents INTEGER, monthly_cents INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, action_sha256 TEXT NOT NULL,
  PRIMARY KEY (tenant_id, agent)
);
CREATE TABLE IF NOT EXISTS card_actions (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, agent TEXT NOT NULL,
  action_json TEXT NOT NULL, challenge TEXT NOT NULL, by_user TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  status TEXT NOT NULL, day TEXT, signed_at TEXT, done_at TEXT, result_json TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS card_actions_by_day ON card_actions (day, tenant_id);
CREATE TABLE IF NOT EXISTS card_reads (
  tenant_id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, body_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
)`;
const ready = new WeakSet<Sql>();
async function tables(sql: Sql) {
  if (ready.has(sql)) return;
  await sql.exec(TABLES);
  ready.add(sql);
}

export type CardAgent = keyof typeof POLICY_CARDS;
export const CARD_AGENTS = Object.keys(POLICY_CARDS) as CardAgent[];
const isCardAgent = (a: string): a is CardAgent => (CARD_AGENTS as string[]).includes(a);
/** What each agent's card may pay: software (merchant category 5734); the support agent's helpdesk software (7372) too. */
const MCCS: Record<CardAgent, string[]> = { sourcing: ["5734"], support: ["5734", "7372"], treasury: ["5734"] };
const NAMES: Record<CardAgent, string> = { sourcing: "Sourcing agent", support: "Support agent", treasury: "Treasury agent" };

export type CardActionKind = "issue" | "freeze" | "unfreeze" | "limits" | "test";
export const CARD_ACTION_KINDS: readonly CardActionKind[] = ["issue", "freeze", "unfreeze", "limits", "test"];

export class CardRefused extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "CardRefused"; }
}

interface CardRow { agent: string; card_id: string; last4: string | null; status: string; per_tx_cents: number | null; monthly_cents: number | null; created_at: string; updated_at: string }
interface ActionRow { id: string; sha256: string; kind: CardActionKind; agent: string; action_json: string; challenge: string; by_user: string; created_at: string; expires_at: string; status: "pending" | "running" | "done" | "failed"; result_json: string | null }

const eur = (cents: number) => `EUR ${(cents / 100).toFixed(2)}`;
const day = (now: Date) => now.toISOString().slice(0, 10);
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const centsOfText = (v: unknown): number | null => {
  const m = /(\d{1,6})(?:\.(\d{1,2}))?/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
};

/** Why card actions cannot run for this company now, or null when they can. Fail closed. */
export async function cardsBlocked(sql: Sql, tenantId: string, gateway: CardsPort | undefined): Promise<string | null> {
  if (!gateway) return "this deployment has no card gateway";
  if (tenantId.startsWith("t_try_")) return "live cards are not for /try test companies";
  let s;
  try { s = await readSwitches(sql); } catch { return "the switches could not be read"; }
  if (!on(s, "awx_cards")) return "live card actions are switched off (awx_cards)";
  return null;
}

/** The CFO policy's limits for an agent's card: the company's records (a limit the CFO raised) first, else the policy's start. */
async function policyLimits(sql: Sql, tenantId: string): Promise<Map<CardAgent, { name: string; per_tx_cents: number; monthly_cents: number }>> {
  const out = new Map<CardAgent, { name: string; per_tx_cents: number; monthly_cents: number }>();
  const r = await agentsOf(new TenantDb(sql, tenantId)) as { agents: { id: string; name: string; card: { per_purchase: string | null; per_month: string | null } | null }[] };
  for (const a of r.agents) {
    if (!isCardAgent(a.id)) continue;
    const p = POLICY_CARDS[a.id];
    out.set(a.id, { name: a.name || NAMES[a.id], per_tx_cents: centsOfText(a.card?.per_purchase) ?? p.perTxCents, monthly_cents: centsOfText(a.card?.per_month) ?? p.monthlyCents });
  }
  return out;
}

async function cardRow(sql: Sql, tenantId: string, agent: string): Promise<CardRow | null> {
  return sql.first<CardRow>("SELECT agent, card_id, last4, status, per_tx_cents, monthly_cents, created_at, updated_at FROM agent_cards WHERE tenant_id = ? AND agent = ?", [tenantId, agent]);
}

async function writesToday(sql: Sql, tenantId: string | null, now: Date): Promise<number> {
  const r = await sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM card_actions WHERE day = ?${tenantId ? " AND tenant_id = ?" : ""}`, tenantId ? [day(now), tenantId] : [day(now)]);
  return Number(r?.n ?? 0);
}

/** A card's live state: Airwallex's answer (cached a few seconds), or the stored row with why there is no live answer. */
async function liveCard(sql: Sql, tenantId: string, row: CardRow, gateway: CardsPort | undefined, now: Date, fresh = false): Promise<{ card: SafeCard | null; items: SafeTx[]; read_at: string | null; reason: string | null }> {
  const key = `card:${row.agent}`;
  if (!fresh) {
    const hit = await sql.first<{ at: number; body_json: string }>("SELECT at, body_json FROM card_reads WHERE tenant_id = ? AND key = ?", [tenantId, key]);
    if (hit && now.getTime() - hit.at < READ_TTL_MS) return JSON.parse(hit.body_json);
  }
  if (!gateway) return { card: null, items: [], read_at: null, reason: "this deployment has no card gateway" };
  const [c, t] = await Promise.all([gateway.ask({ op: "card", card_id: row.card_id }), gateway.ask({ op: "transactions", card_id: row.card_id })]);
  const card = c.ok && c.op === "card" ? c.card : null;
  const out = { card, items: t.ok && t.op === "transactions" ? t.items : [], read_at: card ? now.toISOString() : null, reason: c.ok ? null : c.reason };
  if (card) {
    await sql.run("UPDATE agent_cards SET status = ?, last4 = COALESCE(?, last4), per_tx_cents = ?, monthly_cents = ?, updated_at = ? WHERE tenant_id = ? AND agent = ?",
      [card.status, card.last4, card.limits?.per_tx_cents ?? row.per_tx_cents, card.limits?.monthly_cents ?? row.monthly_cents, now.toISOString(), tenantId, row.agent]);
    await sql.run("INSERT INTO card_reads (tenant_id, key, at, body_json) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET at = excluded.at, body_json = excluded.body_json", [tenantId, key, now.getTime(), JSON.stringify(out)]);
  }
  return out;
}

const shown = (c: SafeCard | null, row: CardRow) => ({
  last4: c?.last4 ?? row.last4, card_id_last4: row.card_id.slice(-4), status: c?.status ?? row.status, brand: c?.brand ?? null,
  per_tx_cents: c?.limits?.per_tx_cents ?? row.per_tx_cents, monthly_cents: c?.limits?.monthly_cents ?? row.monthly_cents, issued_at: row.created_at,
});
const shownTx = (x: SafeTx) => ({ id: x.id, at: x.at, amount_cents: x.amount_cents, currency: x.currency, status: x.status, approved: x.approved, failure_reason: x.failure_reason, merchant: x.merchant, type: x.type });

/** GET /v1/cards: each agent's live card (last four only), the policy it follows, its newest authorizations, and the locks. */
export async function cardsView(o: { sql: Sql; caller: Caller; gateway?: CardsPort; now: Date }) {
  await tables(o.sql);
  const tenantId = o.caller.tenantId;
  const why = await cardsBlocked(o.sql, tenantId, o.gateway);
  const policy = await policyLimits(o.sql, tenantId);
  const rows = await o.sql.all<CardRow>("SELECT agent, card_id, last4, status, per_tx_cents, monthly_cents, created_at, updated_at FROM agent_cards WHERE tenant_id = ?", [tenantId]);
  const agents = [];
  for (const [agent, p] of policy) {
    const row = rows.find((r) => r.agent === agent);
    if (!row) { agents.push({ agent, name: p.name, policy: { per_tx_cents: p.per_tx_cents, monthly_cents: p.monthly_cents }, card: null, live: false, read_at: null, reason: null, in_sync: false, transactions: [] }); continue; }
    const live = await liveCard(o.sql, tenantId, row, o.gateway, o.now);
    const card = shown(live.card, row);
    agents.push({
      agent, name: p.name, policy: { per_tx_cents: p.per_tx_cents, monthly_cents: p.monthly_cents }, card, live: !!live.card, read_at: live.read_at, reason: live.reason,
      in_sync: card.per_tx_cents === p.per_tx_cents && card.monthly_cents === p.monthly_cents, transactions: live.items.map(shownTx),
    });
  }
  const owner = o.caller.kind === "session" && o.caller.role === "owner";
  return {
    label: CARDS_LABEL, on: !why, why, can_act: !why && owner,
    caps: { cards: rows.length, cards_max: CARDS_PER_COMPANY, writes_today: await writesToday(o.sql, tenantId, o.now), writes_max: WRITES_PER_DAY },
    agents,
    note: "Live from the Airwallex sandbox (test money). Only the last four digits of a card are ever shown; the full number and the CVV never reach Purser.",
  };
}

/** GET /v1/cards/scope: whether the sandbox key may use Issuing. ok or forbidden (or why it could not tell); no card data. */
export async function cardsScope(sql: Sql, gateway: CardsPort | undefined, now: Date): Promise<{ issuing: "ok" | "forbidden" | "no_key" | "no_gateway" | "unavailable"; checked_at: string; label: string }> {
  await tables(sql);
  const hit = await sql.first<{ at: number; body_json: string }>("SELECT at, body_json FROM card_reads WHERE tenant_id = '' AND key = 'scope'");
  if (hit && now.getTime() - hit.at < SCOPE_TTL_MS) return JSON.parse(hit.body_json);
  let issuing: "ok" | "forbidden" | "no_key" | "no_gateway" | "unavailable";
  if (!gateway) issuing = "no_gateway";
  else {
    let a: CardsAnswer;
    try { a = await gateway.ask({ op: "scope" }); } catch { a = { ok: false, code: "no_answer", reason: "" }; }
    issuing = a.ok ? "ok" : a.code === "forbidden" ? "forbidden" : a.code === "no_key" ? "no_key" : "unavailable";
  }
  const out = { issuing, checked_at: now.toISOString(), label: "Airwallex sandbox" };
  await sql.run("INSERT INTO card_reads (tenant_id, key, at, body_json) VALUES ('', 'scope', ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET at = excluded.at, body_json = excluded.body_json", [now.getTime(), JSON.stringify(out)]);
  return out;
}

/** The exact action, in a fixed key order: what the passkey signs (through its SHA-256). */
export function canonicalAction(a: { company: string; agent: string; kind: CardActionKind; card_id: string | null; limits: { per_tx_cents: number; monthly_cents: number } | null; amount_cents: number | null; by: string; nonce: string; issued_at: string; expires_at: string }): string {
  return JSON.stringify({
    v: 1, what: "purser.agent_card_action", sandbox: true, test_money: true,
    company: a.company, agent: a.agent, kind: a.kind, card_id: a.card_id,
    limits: a.limits ? { currency: "EUR", per_tx_cents: a.limits.per_tx_cents, monthly_cents: a.limits.monthly_cents } : null,
    amount_cents: a.amount_cents, by: a.by, nonce: a.nonce, issued_at: a.issued_at, expires_at: a.expires_at,
  });
}

/** The action in plain words, for the person who signs it. */
function linesOf(kind: CardActionKind, name: string, row: CardRow | null, limits: { per_tx_cents: number; monthly_cents: number } | null, amount: number | null): string[] {
  const card = row?.last4 ? `card •••• ${row.last4}` : "the card";
  switch (kind) {
    case "issue": return [`Issue a virtual Visa card for the ${name}`, `Limits from the CFO policy: ${eur(limits!.per_tx_cents)} a purchase, ${eur(limits!.monthly_cents)} a month`, "Airwallex sandbox, test money"];
    case "freeze": return [`Freeze the ${name}'s ${card}`, "Airwallex declines every purchase until it is unfrozen"];
    case "unfreeze": return [`Unfreeze the ${name}'s ${card}`, "It can buy again within its limits"];
    case "limits": return [`Set the ${name}'s ${card} to the CFO policy`, `${eur(limits!.per_tx_cents)} a purchase, ${eur(limits!.monthly_cents)} a month`];
    case "test": return [`Test: the ${name} tries to buy for ${eur(amount!)} on ${card}`, `That is over its limit of ${eur(row?.per_tx_cents ?? 0)} a purchase: Airwallex should decline it`, "Airwallex sandbox simulation, test money"];
  }
}

const actionOut = (r: ActionRow, lines: string[]) => ({ id: r.id, kind: r.kind, agent: r.agent, sha256: r.sha256, challenge: r.challenge, expires_at: r.expires_at, status: r.status, lines, signed_text: r.action_json, label: CARDS_LABEL });

/** POST /v1/cards/actions: write down the exact action and its hash; nothing is sent before the passkey signs it. */
export async function startCardAction(o: { sql: Sql; caller: Caller; gateway?: CardsPort; kind: CardActionKind; agent: string; now: Date }) {
  await tables(o.sql);
  const c = o.caller;
  if (c.kind !== "session" || c.role !== "owner") throw new CardRefused(403, "only a signed-in owner acts on a card, with their own passkey");
  const why = await cardsBlocked(o.sql, c.tenantId, o.gateway);
  if (why) throw new CardRefused(409, why);
  if (!isCardAgent(o.agent)) throw new CardRefused(404, "no such agent with a card");
  const p = (await policyLimits(o.sql, c.tenantId)).get(o.agent);
  if (!p) throw new CardRefused(404, "this company has no such agent");
  if ((await writesToday(o.sql, c.tenantId, o.now)) >= WRITES_PER_DAY) throw new CardRefused(429, `the daily cap of ${WRITES_PER_DAY} card writes is reached for this company`);
  let row = await cardRow(o.sql, c.tenantId, o.agent);
  let limits: { per_tx_cents: number; monthly_cents: number } | null = null;
  let amount: number | null = null;
  if (o.kind === "issue") {
    if (row) throw new CardRefused(409, "this agent has a live card already");
    const n = await o.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM agent_cards WHERE tenant_id = ?", [c.tenantId]);
    if (Number(n?.n ?? 0) >= CARDS_PER_COMPANY) throw new CardRefused(409, `at most ${CARDS_PER_COMPANY} live cards a company`);
    limits = { per_tx_cents: p.per_tx_cents, monthly_cents: p.monthly_cents };
  } else {
    if (!row) throw new CardRefused(409, "this agent has no live card yet");
    // The card's state as Airwallex has it now, so the action fits the card.
    const live = await liveCard(o.sql, c.tenantId, row, o.gateway, o.now, true);
    row = (await cardRow(o.sql, c.tenantId, o.agent))!;
    const status = live.card?.status ?? row.status;
    if (o.kind === "freeze" && status !== "ACTIVE") throw new CardRefused(409, `the card is ${status.toLowerCase()}, not active`);
    if (o.kind === "unfreeze" && status !== "INACTIVE") throw new CardRefused(409, `the card is ${status.toLowerCase()}, not frozen`);
    if (o.kind === "limits") {
      if (row.per_tx_cents === p.per_tx_cents && row.monthly_cents === p.monthly_cents) throw new CardRefused(409, "the card's limits match the CFO policy already");
      limits = { per_tx_cents: p.per_tx_cents, monthly_cents: p.monthly_cents };
    }
    if (o.kind === "test") amount = (row.per_tx_cents ?? p.per_tx_cents) + TEST_OVER_CENTS;
  }
  const issued = o.now.toISOString(), expires = new Date(o.now.getTime() + ACTION_TTL_MS).toISOString();
  const json = canonicalAction({ company: c.tenantId, agent: o.agent, kind: o.kind, card_id: row?.card_id ?? null, limits, amount_cents: amount, by: c.principal, nonce: randomToken(12).replace(/[^A-Za-z0-9]/g, "x"), issued_at: issued, expires_at: expires });
  const sha = await sha256Hex(json);
  const r: ActionRow = { id: `ca_${sha.slice(0, 16)}`, sha256: sha, kind: o.kind, agent: o.agent, action_json: json, challenge: toB64u(hexBytes(sha)), by_user: c.principal, created_at: issued, expires_at: expires, status: "pending", result_json: null };
  await o.sql.run("INSERT INTO card_actions (tenant_id, id, sha256, kind, agent, action_json, challenge, by_user, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    [c.tenantId, r.id, r.sha256, r.kind, r.agent, r.action_json, r.challenge, r.by_user, r.created_at, r.expires_at]);
  return { action: actionOut(r, linesOf(o.kind, p.name, row, limits, amount)) };
}

/** POST /v1/cards/actions/{id}/sign: the owner's passkey over the action's hash; then the action runs, once. */
export async function signCardAction(o: { sql: Sql; caller: Caller; gateway?: CardsPort; id: string; credentialId: string; assertion: AssertionB64; rpId: string; origin: string; now: Date }) {
  await tables(o.sql);
  const c = o.caller;
  if (c.kind !== "session" || c.role !== "owner") throw new CardRefused(403, "only a signed-in owner acts on a card, with their own passkey");
  const r = await o.sql.first<ActionRow>("SELECT id, sha256, kind, agent, action_json, challenge, by_user, created_at, expires_at, status, result_json FROM card_actions WHERE tenant_id = ? AND id = ?", [c.tenantId, o.id]);
  if (!r) throw new CardRefused(404, "no such card action");
  // Idempotency by the signed hash: an action that ran answers what it did; nothing is sent again.
  if (r.status === "done" || r.status === "failed") return { ...(JSON.parse(r.result_json ?? "{}") as object), repeated: true };
  if (r.status === "running") throw new CardRefused(409, "this action is running");
  if (r.by_user !== c.principal) throw new CardRefused(403, "the person who asked signs the action");
  if (r.expires_at <= o.now.toISOString()) throw new CardRefused(410, "this action expired unsigned; ask again");
  // The record is what was asked: its hash, and the challenge is that hash.
  if ((await sha256Hex(r.action_json)) !== r.sha256 || r.challenge !== toB64u(hexBytes(r.sha256))) throw new CardRefused(409, "the action's record does not match its hash; nothing is sent");
  const db = new TenantDb(o.sql, c.tenantId);
  const cred = await db.one<{ user_id: string; x: string; y: string; counter: number }>("credentials", { credential_id: o.credentialId });
  if (!cred || cred.user_id !== c.principal) throw new AuthError(403, "a card action needs your own passkey");
  const v = await verifyAssertion(o.assertion, { x: cred.x, y: cred.y }, { challenge: r.challenge, origin: o.origin, rpId: o.rpId, lastCounter: cred.counter });
  if (!v.ok) throw new AuthError(401, `the passkey check failed (${v.why})`);
  await db.apply([db.update("credentials", { credential_id: o.credentialId, counter: { op: "<=", v: v.counter } }, { counter: v.counter })]);
  // The kill switch, again, at the moment of sending.
  const why = await cardsBlocked(o.sql, c.tenantId, o.gateway);
  if (why) throw new CardRefused(409, why);
  const a = JSON.parse(r.action_json) as { card_id: string | null; limits: { per_tx_cents: number; monthly_cents: number } | null; amount_cents: number | null };
  const today = day(o.now), iso = o.now.toISOString();
  // One claim: pending to running, only under both daily caps (and, for a new card, under the cards cap with none for
  // this agent). Two signatures at once cannot both pass a cap.
  const claim = await o.sql.run(
    `UPDATE card_actions SET status = 'running', day = ?, signed_at = ? WHERE tenant_id = ? AND id = ? AND status = 'pending'
       AND (SELECT COUNT(*) FROM card_actions WHERE day = ? AND tenant_id = ?) < ?
       AND (SELECT COUNT(*) FROM card_actions WHERE day = ?) < ?
       ${r.kind === "issue" ? "AND (SELECT COUNT(*) FROM agent_cards WHERE tenant_id = ?) < ? AND NOT EXISTS (SELECT 1 FROM agent_cards WHERE tenant_id = ? AND agent = ?)" : ""}`,
    [today, iso, c.tenantId, r.id, today, c.tenantId, WRITES_PER_DAY, today, WRITES_PER_DAY_ALL, ...(r.kind === "issue" ? [c.tenantId, CARDS_PER_COMPANY, c.tenantId, r.agent] : [])],
  );
  if (claim.changes !== 1) {
    const again = await o.sql.first<ActionRow>("SELECT status, result_json FROM card_actions WHERE tenant_id = ? AND id = ?", [c.tenantId, r.id]);
    if (again && (again.status === "done" || again.status === "failed")) return { ...(JSON.parse(again.result_json ?? "{}") as object), repeated: true };
    if (again?.status === "running") throw new CardRefused(409, "this action is running");
    throw new CardRefused(429, r.kind === "issue" ? `a cap is reached: at most ${CARDS_PER_COMPANY} cards a company, one an agent, ${WRITES_PER_DAY} card writes a day` : `the daily cap of card writes is reached (${WRITES_PER_DAY} a company, ${WRITES_PER_DAY_ALL} in all)`);
  }
  const p = POLICY_CARDS[r.agent as CardAgent];
  let ans: CardsAnswer;
  try {
    ans = r.kind === "issue"
      ? await o.gateway!.ask({ op: "create", action_sha256: r.sha256, holder: { email: p.email, first_name: p.firstName, last_name: "Agent" }, nickname: `${p.nickname} (Purser Cloud)`, created_by: "Purser Cloud, CFO policy", limits: a.limits!, mccs: MCCS[r.agent as CardAgent], active_days: CARD_ACTIVE_DAYS })
      : r.kind === "freeze" || r.kind === "unfreeze" ? await o.gateway!.ask({ op: "status", action_sha256: r.sha256, card_id: a.card_id!, status: r.kind === "freeze" ? "INACTIVE" : "ACTIVE" })
        : r.kind === "limits" ? await o.gateway!.ask({ op: "limits", action_sha256: r.sha256, card_id: a.card_id!, limits: a.limits! })
          : await o.gateway!.ask({ op: "simulate", action_sha256: r.sha256, card_id: a.card_id!, amount_cents: a.amount_cents!, merchant: "Purser test merchant", mcc: MCCS[r.agent as CardAgent][0]! });
  } catch {
    ans = { ok: false, code: "no_answer", reason: "the card gateway did not answer" };
  }
  let result: Record<string, unknown>;
  if (ans.ok && "card" in ans) {
    const card = ans.card;
    if (r.kind === "issue") {
      await o.sql.run("INSERT INTO agent_cards (tenant_id, agent, card_id, last4, status, per_tx_cents, monthly_cents, created_at, updated_at, action_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [c.tenantId, r.agent, card.card_id, card.last4, card.status, card.limits?.per_tx_cents ?? a.limits!.per_tx_cents, card.limits?.monthly_cents ?? a.limits!.monthly_cents, iso, iso, r.sha256]);
    } else {
      await o.sql.run("UPDATE agent_cards SET status = ?, last4 = COALESCE(?, last4), per_tx_cents = COALESCE(?, per_tx_cents), monthly_cents = COALESCE(?, monthly_cents), updated_at = ? WHERE tenant_id = ? AND agent = ?",
        [card.status, card.last4, card.limits?.per_tx_cents ?? null, card.limits?.monthly_cents ?? null, iso, c.tenantId, r.agent]);
    }
    result = { status: "done", kind: r.kind, agent: r.agent, sha256: r.sha256, card: { last4: card.last4, card_id_last4: card.card_id.slice(-4), status: card.status, per_tx_cents: card.limits?.per_tx_cents ?? null, monthly_cents: card.limits?.monthly_cents ?? null }, label: CARDS_LABEL };
  } else if (ans.ok && ans.op === "simulate") {
    result = { status: "done", kind: r.kind, agent: r.agent, sha256: r.sha256, tx: shownTx(ans.tx), label: CARDS_LABEL };
  } else if (!ans.ok) {
    result = { status: "failed", kind: r.kind, agent: r.agent, sha256: r.sha256, reason: ans.reason, code: ans.code, awx_code: ans.awx_code ?? null, trace_id: ans.trace_id ?? null, label: CARDS_LABEL };
  } else {
    result = { status: "failed", kind: r.kind, agent: r.agent, sha256: r.sha256, reason: "an unexpected answer", label: CARDS_LABEL };
  }
  await o.sql.run("UPDATE card_actions SET status = ?, done_at = ?, result_json = ? WHERE tenant_id = ? AND id = ?", [String(result.status), iso, JSON.stringify(result), c.tenantId, r.id]);
  await o.sql.run("DELETE FROM card_reads WHERE tenant_id = ? AND key = ?", [c.tenantId, `card:${r.agent}`]);
  await db.apply([db.insert("security_events", { id: `se_${r.id}`, at: iso, kind: `card.${r.kind}.${result.status}`, actor: c.principal, detail_json: JSON.stringify({ agent: r.agent, action_sha256: r.sha256, label: CARDS_LABEL }) })]);
  return result;
}
