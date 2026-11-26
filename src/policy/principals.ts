// Agent identities with scoped capabilities (backend review B5). Every agent that can move money acts as a
// principal: what it may use (tools), on which rails, in which currencies, and to which kind of payee. A principal
// can be revoked (at once: a restriction needs no Face ID, like the emergency stop), can expire, and an outside agent's
// key can be rotated. Every payment path asks `authorize` first (src/policy/holds.ts reserves nothing for a principal
// that may not pay), so revoking one agent stops that agent and nothing else.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { checkpointRefusal } from "../audit/checkpointer.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { AGENT_DISPLAY } from "../config/brand.js";
import { payableCurrency, SWIFT_CURRENCIES } from "../payouts/routes.js";
import { revokeAgentTokens } from "./agentTokenStore.js";

/** An agent as people read it: "the Support agent" (internal id support), or "agent ext:acme" for an outside one. */
const who = (id: string) => (id in AGENT_DISPLAY ? `the ${AGENT_DISPLAY[id as keyof typeof AGENT_DISPLAY].name}` : `agent ${id}`);

export type Rail = "metal" | "card" | "airwallex";
export type Payee = "supplier" | "customer" | "sweep" | "beneficiaries" | "merchants";
export interface Capabilities { tools: string[]; rails: Rail[]; currencies: string[]; payees: Payee[] }
export interface Need { tool?: string; rail?: Rail; currency?: string; payee?: Payee }

const OUTSIDE_TOOLS = ["request_company_card", "company_card", "pay_with_card", "request_limit_raise", "ask_for_task_card"];

/**
 * The currencies the treasury agent may pay in: USDZ on Metal, and every currency Purser pays suppliers in over
 * Airwallex (src/payouts/routes.ts payableCurrency: two-decimal currencies SWIFT carries). Widened deliberately when
 * supplier payments began to check the agent's identity (red team round 3): a supplier payment in GBP or TRY is the same
 * agent doing the same job as a Kit 11 euro payment, and the CFO's Face ID on the terms still decides each one.
 */
export const TREASURY_CURRENCIES = ["USDZ", ...SWIFT_CURRENCIES.filter(payableCurrency)];

/** The treasury agent's defaults as written before supplier payments (USDZ, USD and EUR only). */
const EARLIER_TREASURY = JSON.stringify({ tools: ["sweep", "invoice_payment", "card_purchase"], rails: ["metal", "airwallex", "card"], currencies: ["USDZ", "USD", "EUR"], payees: ["sweep", "beneficiaries", "merchants"] });

/** What each agent may do today, as its code does it: the defaults a principal starts with. */
export const DEFAULT_CAPABILITIES: Record<string, Capabilities> = {
  sourcing: { tools: ["buy_stock_check", "card_purchase"], rails: ["metal", "card"], currencies: ["USDZ", "EUR"], payees: ["supplier", "merchants"] },
  support: { tools: ["refund", "card_purchase"], rails: ["metal", "card"], currencies: ["USDZ", "EUR"], payees: ["customer", "merchants"] },
  treasury: { tools: ["sweep", "invoice_payment", "supplier_payment", "card_purchase"], rails: ["metal", "airwallex", "card"], currencies: TREASURY_CURRENCIES, payees: ["sweep", "beneficiaries", "merchants"] },
  outside: { tools: OUTSIDE_TOOLS, rails: ["card"], currencies: ["EUR"], payees: ["merchants"] },
};

/**
 * Least privilege, visible (25 November): every tool each agent principal may call as a model, by name. Its
 * money actions are its capabilities' `tools` above (stored per principal, revocable). An agent's tool that is on neither
 * list is refused in code before it runs (toolRefusal, from src/agents/loop.ts for every tool call), and the refusal is
 * audited (principal.tool_refused). docs/security/agent-permissions.md says what each one does and its kind, row by
 * row, held to these lists by test/agent-permissions.test.ts.
 */
const COMMON_TOOLS = " read_decline propose_raise no_raise send_message finish";
/** Each agent principal's tools as a model, space-separated (what each does, and its kind: the docs table). */
export const AGENT_TOOLS: Record<"sourcing" | "support" | "treasury", string> = {
  sourcing: "check_offer market supplier_terms try_purchase pay buy_software buy_report set_buy_policy ask_card_raise notify_treasury" + COMMON_TOOLS,
  support: "verify_order check_data refund settle_dispute escalate_to_cfo" + COMMON_TOOLS,
  treasury: "read_position cash_position position read_quote open_invoices invoice_lines chart_of_accounts vat_codes cost_centres coding_history vat_regime submit_advice propose_schedule code_invoice plan_invoice submit_plan design_rebalance sweep_earnings" + COMMON_TOOLS,
};

/** The audit event of a tool call refused because the agent may not call that tool. */
export const TOOL_REFUSED = "principal.tool_refused";

/**
 * Null when the agent may call this tool; otherwise why not, and the refusal is audited. An agent principal with a tool
 * list (AGENT_TOOLS) may call those tools and its capabilities' money actions, nothing else. Other callers (the payables
 * agents, the controller, the books agent, the evals) hold no money and keep the tools their code hands them.
 */
export function toolRefusal(db: DB, id: string, tool: string, context: { via: string; task?: string }, now = new Date()): string | null {
  const grants = AGENT_TOOLS[id as keyof typeof AGENT_TOOLS]?.split(" ");
  if (!grants || grants.includes(tool)) return null;
  const p = principal(db, id, now, false);
  const caps = (p ? (JSON.parse(p.capabilities_json) as Capabilities) : DEFAULT_CAPABILITIES[id])?.tools ?? [];
  if (caps.includes(tool)) return null;
  const why = `tool_denied: ${who(id)} may not call ${tool}`;
  audit(db, "system", TOOL_REFUSED, id, { tool: tool.slice(0, 80), via: context.via, task: (context.task ?? "").slice(0, 120) }, now);
  return why;
}

interface Row { principal_id: string; kind: string; capabilities_json: string; status: string; expires_at: string | null; key_sha256: string | null; key_version: number; reason: string | null }

const hasTable = (db: DB) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'principals'").get();
/** Single-use task cards (Ask Purser) are not agents: their card's limits and single use govern them. */
const governed = (id: string) => id in DEFAULT_CAPABILITIES || id.startsWith("ext:");

/** The principal for an agent, made with its default capabilities the first time it is needed. */
export function principal(db: DB, id: string, now = new Date(), create = true): Row | null {
  if (!governed(id) || !hasTable(db)) return null;
  const row = db.prepare("SELECT * FROM principals WHERE principal_id = ?").get(id) as Row | undefined;
  if (row && create && id === "treasury" && row.capabilities_json === EARLIER_TREASURY) {
    // Written with the defaults from before supplier payments (no capability is ever edited, only revoked or expired):
    // widened to today's defaults once, with a record of it (docs/payables.md).
    db.prepare("UPDATE principals SET capabilities_json = ?, updated_at = ? WHERE principal_id = ?").run(JSON.stringify(DEFAULT_CAPABILITIES.treasury), now.toISOString(), id);
    audit(db, "system", "principal.capabilities_widened", id, { currencies: TREASURY_CURRENCIES.join(", "), why: "supplier payments in every payable currency" }, now);
    return db.prepare("SELECT * FROM principals WHERE principal_id = ?").get(id) as Row;
  }
  if (row || !create) return row ?? null;
  const outside = id.startsWith("ext:");
  const caps = outside ? DEFAULT_CAPABILITIES.outside! : DEFAULT_CAPABILITIES[id]!;
  db.prepare("INSERT OR IGNORE INTO principals (principal_id, kind, capabilities_json, status, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?)")
    .run(id, outside ? "outside" : "internal", JSON.stringify(caps), now.toISOString(), now.toISOString());
  return db.prepare("SELECT * FROM principals WHERE principal_id = ?").get(id) as Row;
}

/** Whether the agent may act at all now (not revoked, not expired). Agents outside this scheme always may. */
export function principalActive(db: DB, id: string, now = new Date()): boolean {
  // Read only (the dashboard reads a ledger it may not write): an agent with no row yet has its defaults, active.
  const p = principal(db, id, now, false);
  return !p || (p.status === "ACTIVE" && !(p.expires_at && Date.parse(p.expires_at) <= now.getTime()));
}

/** Null when the agent may do this; otherwise why not, in words, prefixed with a code. */
export function authorize(db: DB, id: string, need: Need, now = new Date()): string | null {
  const p = principal(db, id, now);
  if (!p) return null;
  if (p.status === "REVOKED") return `principal_revoked: ${who(id)}'s identity was revoked${p.reason ? ` (${p.reason})` : ""}; it can do nothing`;
  if (p.expires_at && Date.parse(p.expires_at) <= now.getTime()) return `principal_expired: ${who(id)}'s identity expired at ${p.expires_at}`;
  const c = JSON.parse(p.capabilities_json) as Capabilities;
  if (need.tool && !c.tools.includes(need.tool)) return `capability_denied: the ${id} agent may not use ${need.tool}`;
  if (need.rail && !c.rails.includes(need.rail)) return `capability_denied: the ${id} agent may not pay on ${need.rail}`;
  if (need.currency && !c.currencies.includes(need.currency)) return `capability_denied: the ${id} agent may not pay in ${need.currency}`;
  if (need.payee && !c.payees.includes(need.payee)) return `capability_denied: the ${id} agent may not pay a ${need.payee === "beneficiaries" ? "bank beneficiary" : need.payee}`;
  return null;
}

/** Revokes an agent at once. Its card is frozen by the next card sync (src/policy/cards.ts); the others carry on. */
export function revokePrincipal(db: DB, id: string, reason: string, by: string, now = new Date()): void {
  if (!principal(db, id, now)) throw new Error(`${id} is not an agent with an identity`);
  db.prepare("UPDATE principals SET status = 'REVOKED', reason = ?, updated_at = ? WHERE principal_id = ?").run(reason.slice(0, 200), now.toISOString(), id);
  audit(db, "human", "principal.revoked", id, { by, reason: reason.slice(0, 200) }, now);
  // Its payment tokens go with it, in the same call (src/policy/agentTokens.ts): a copy an agent leaked pays nothing.
  revokeAgentTokens(db, id, `the agent was revoked: ${reason}`, by, now);
}

/** Sets when an agent's identity ends (only sooner: a later end would be a loosening, which is the CFO's to approve). */
export function expirePrincipal(db: DB, id: string, at: Date, by: string, now = new Date()): void {
  const p = principal(db, id, now);
  if (!p) throw new Error(`${id} is not an agent with an identity`);
  if (p.expires_at && Date.parse(p.expires_at) < at.getTime()) throw new Error(`${id} already ends at ${p.expires_at}; a later end needs the CFO's approval`);
  db.prepare("UPDATE principals SET expires_at = ?, updated_at = ? WHERE principal_id = ?").run(at.toISOString(), now.toISOString(), id);
  audit(db, "human", "principal.expires", id, { by, at: at.toISOString() }, now);
}

const sha = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Gives an agent a new key and makes the old one useless. Returns the key for the caller to write to a key file
 * (the CLI does, mode 0600); only its hash stays in the ledger.
 */
export function rotatePrincipalKey(db: DB, id: string, by: string, now = new Date()): { key: string; version: number } {
  const p = principal(db, id, now);
  if (!p) throw new Error(`${id} is not an agent with an identity`);
  if (p.status !== "ACTIVE") throw new Error(`${id} is revoked; a revoked identity gets no new key`);
  // Outside audit 1.4: no key is issued on a ledger that does not match its latest signed checkpoint.
  const unanchored = checkpointRefusal(db, "key enrolment", now);
  if (unanchored) throw new Error(unanchored);
  const key = `pk_${randomBytes(24).toString("base64url")}`;
  const version = p.key_version + 1;
  db.prepare("UPDATE principals SET key_sha256 = ?, key_version = ?, updated_at = ? WHERE principal_id = ?").run(sha(key), version, now.toISOString(), id);
  audit(db, "human", "principal.key_rotated", id, { by, version }, now);
  return { key, version };
}

/** Whether a presented key is the agent's current one. An agent that never got a key needs none. */
export function keyMatches(db: DB, id: string, presented: string | undefined, now = new Date()): boolean {
  const p = principal(db, id, now);
  if (!p?.key_sha256) return true;
  if (!presented) return false;
  const a = Buffer.from(sha(presented), "hex");
  const b = Buffer.from(p.key_sha256, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function listPrincipals(db: DB, now = new Date()): { id: string; kind: string; status: string; expires_at: string | null; key_version: number; capabilities: Capabilities; active: boolean }[] {
  for (const id of ["sourcing", "support", "treasury"]) principal(db, id, now);
  return (db.prepare("SELECT * FROM principals ORDER BY principal_id").all() as Row[]).map((p) => ({
    id: p.principal_id, kind: p.kind, status: p.status, expires_at: p.expires_at, key_version: p.key_version,
    capabilities: JSON.parse(p.capabilities_json) as Capabilities, active: principalActive(db, p.principal_id, now),
  }));
}
