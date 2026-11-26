// Multi-entity governance (Dan Kim, Airwallex, "Agentic banking starts with governance": an agent must know which
// entity owns the money and which account should fund a payment, and that authority is enforced in code, not in a
// prompt). A company may hold several legal entities, e.g. Northwind Outdoor BV (NL, EUR) and Northwind Outdoor Ltd
// (UK, GBP), each with its own Airwallex account and so its own balances. Then:
//   - every payment's terms name the paying entity and its funding account (paying_entity, funding_account), so the
//     CFO's passkey signature covers both: one changed entity or account is a hash mismatch, like one changed cent;
//   - an agent pays from an entity only where the CFO policy lets it (pay_from.<entity>.<agent>, allowed or blocked),
//     and only a value the CFO signed counts (a policy_change approved with the passkey, as for ap.alone_eur): a new
//     entity is closed to every agent until then;
//   - an entity is funded from its own account only: terms naming another entity's account, or a rail acting for
//     another account (x-on-behalf-of), are refused before anything is planned or paid.
// A company with no entities registered (every company until now) is one entity: its terms carry neither field and hash
// exactly as before, and nothing here applies to them.

import type { DB } from "../db/open.js";
import { agentName } from "../config/brand.js";
import { AGENTS } from "../config/policy.js";
import { ACCOUNT_ID, platformOn } from "../airwallex/platform.js";
import { setSetting } from "../world/settings.js";
import { signedPolicyChange } from "./aloneLimit.js";
import type { Rule } from "./rules.js";

type Env = Record<string, string | undefined>;

/** A legal entity of the company, and the Airwallex account (acct_…) that funds its payments. */
export interface LegalEntity {
  id: string;
  name: string;
  /** ISO 3166 alpha-2, e.g. NL. */
  country: string;
  /** Its home currency, e.g. EUR. */
  currency: string;
  /** Its own Airwallex account: its payments are made from here (x-on-behalf-of) and nowhere else. */
  funding_account: string;
}

/** What a payment's terms carry when the company has entities (absent otherwise, so those terms hash as before). */
export interface EntityFields {
  paying_entity: { id: string; name: string; country: string };
  funding_account: { id: string; currency: string };
}

export const ENTITY_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const ENTITY_KEY = "entity.";
const PAY_FROM = /^pay_from\.([a-z0-9][a-z0-9-]{1,39})\.([a-z][a-z0-9_-]{0,39})$/;

/** The CFO policy key that says whether an agent may pay from an entity: "allowed" or "blocked" (the default). */
export const payFromKey = (entity: string, agent: string) => `pay_from.${entity}.${agent}`;

const read = (v: string): LegalEntity | null => {
  try {
    const e = JSON.parse(v) as Partial<LegalEntity>;
    return entityProblem(e) ? null : (e as LegalEntity);
  } catch {
    return null;
  }
};

/** Why this is not a legal entity Purser can hold, or null. */
function entityProblem(e: Partial<LegalEntity>): string | null {
  if (typeof e.id !== "string" || !ENTITY_ID.test(e.id)) return `an entity id is 2 to 40 lowercase letters, digits or dashes, not ${JSON.stringify(e.id)}`;
  if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 100 || [...e.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return "an entity needs a name of at most 100 characters, on one line";
  if (typeof e.country !== "string" || !/^[A-Z]{2}$/.test(e.country)) return `an entity's country is a two-letter code, not ${JSON.stringify(e.country)}`;
  if (typeof e.currency !== "string" || !/^[A-Z]{3}$/.test(e.currency)) return `an entity's currency is a three-letter code, not ${JSON.stringify(e.currency)}`;
  if (typeof e.funding_account !== "string" || !ACCOUNT_ID.test(e.funding_account)) return `an entity's funding account is an Airwallex account id (acct_…), not ${JSON.stringify(e.funding_account)}`;
  return null;
}

/** The company's legal entities, by id. None: a single-entity company, as every company was before. */
export function listEntities(db: DB): LegalEntity[] {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'entity.%' ORDER BY key").all() as { key: string; value: string }[];
  // A row that does not read as an entity still counts as one held (by its key), so a payment naming it is refused.
  return rows.map((r) => read(r.value) ?? { id: r.key.slice(ENTITY_KEY.length), name: "", country: "", currency: "", funding_account: "" });
}

export function entityOf(db: DB, id: string): LegalEntity | null {
  const e = listEntities(db).find((x) => x.id === id);
  return e && e.funding_account ? e : null;
}

/**
 * Adds a legal entity (setup, like a world's options; audited as setting.changed). Adding one gives no agent anything:
 * every agent is blocked from paying from it until the CFO signs pay_from.<entity>.<agent> allowed. An entity's funding
 * account is never changed in place, and no two entities share one.
 */
export function registerEntity(db: DB, actor: "system" | "human", e: LegalEntity, now = new Date()): void {
  const problem = entityProblem(e);
  if (problem) throw new Error(problem);
  const clean: LegalEntity = { id: e.id, name: e.name.trim(), country: e.country, currency: e.currency, funding_account: e.funding_account };
  const held = listEntities(db);
  const same = held.find((x) => x.id === clean.id);
  if (same) {
    if (JSON.stringify(same) === JSON.stringify(clean)) return;
    throw new Error(`entity ${clean.id} is already held with other details; an entity is never changed in place`);
  }
  const owner = held.find((x) => x.funding_account === clean.funding_account);
  if (owner) throw new Error(`the account ${clean.funding_account} already funds ${owner.name} (${owner.id}); each entity is funded from its own account`);
  setSetting(db, actor, `entity.${clean.id}`, JSON.stringify(clean), now);
}

/** The CFO policy rule for pay_from.<entity>.<agent>, for an entity the company holds; null for any other key. */
export function payFromRule(db: DB, key: string): Rule | null {
  const m = PAY_FROM.exec(key);
  if (!m) return null;
  const e = entityOf(db, m[1]!);
  if (!e) return null;
  return {
    key: key as Rule["key"], label: `${agentName(m[2]!)} may pay from ${e.name} (${e.country}, account ${e.funding_account})`,
    unit: "", kind: "choice", choices: ["blocked", "allowed"], fallback: "blocked", agent: m[2]!,
  };
}

/** One rule per entity and agent, shown with the policy once the company holds entities. */
export function payFromRules(db: DB): Rule[] {
  return listEntities(db).flatMap((e) => AGENTS.map((a) => payFromRule(db, payFromKey(e.id, a)))).filter((r): r is Rule => r !== null);
}

/**
 * Whether the agent may pay from the entity now: the setting reads allowed, and its last record is a policy change the
 * CFO signed with the passkey to exactly that (as the limit to pay alone, src/policy/aloneLimit.ts). A value written any
 * other way counts for nothing, and the agent may not.
 */
export function mayPayFrom(db: DB, agent: string, entity: string): boolean {
  const key = payFromKey(entity, agent);
  const v = (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  if (v !== "allowed") return false;
  const last = db.prepare("SELECT event, payload_json FROM audit_log WHERE event IN ('policy.changed', 'setting.changed') AND subject = ? ORDER BY seq DESC LIMIT 1").get(key) as
    { event: string; payload_json: string } | undefined;
  if (last?.event !== "policy.changed") return false;
  let p: { proposal_id?: unknown; to?: unknown };
  try { p = JSON.parse(last.payload_json) as typeof p; } catch { return false; }
  return p.to === "allowed" && typeof p.proposal_id === "string" && signedPolicyChange(db, p.proposal_id, key, "allowed");
}

const named = (e: LegalEntity) => `${e.name} (${e.id})`;
const accountOwner = (db: DB, account: string) => {
  const o = listEntities(db).find((x) => x.funding_account === account);
  return o ? ` (${o.name}'s)` : "";
};

/**
 * Why these terms may not be paid by this agent, or null: the entity check run when a payment is planned and again when
 * it is executed (before the execution begins and before every create at Airwallex). `acting`: the account the rail
 * acts for (x-on-behalf-of), when the caller has the rail; the executors check it in checkPayingAccount
 * (src/airwallex/binding.ts). Each reason starts with its code.
 */
export function entityRefusal(db: DB, terms: object, agent: string, acting?: string | null): string | null {
  const held = listEntities(db);
  const t = terms as { paying_entity?: { id?: unknown } | null; funding_account?: { id?: unknown } | null };
  const pe = t.paying_entity;
  const fa = t.funding_account;
  if (pe == null && fa == null) {
    return held.length ? `entity_missing: the company holds ${held.length} legal entities (${held.map((e) => e.id).join(", ")}), and these terms name none to pay from` : null;
  }
  const id = typeof pe?.id === "string" ? pe.id : "";
  const e = id ? entityOf(db, id) : null;
  if (!e) return `entity_unknown: the terms name ${JSON.stringify(id || null)} as the paying entity, which the company does not hold`;
  if (!mayPayFrom(db, agent, e.id)) return `entity_not_permitted: the CFO policy does not let the ${agentName(agent)} pay from ${named(e)}; the CFO allows it with Face ID (policy ${payFromKey(e.id, agent)})`;
  const account = typeof fa?.id === "string" ? fa.id : "";
  if (account !== e.funding_account) return `funding_account_mismatch: ${named(e)} pays only from its own account ${e.funding_account}, but the terms fund it from ${account || "no account"}${accountOwner(db, account)}`;
  if (acting !== undefined && acting !== e.funding_account) return `funding_account_mismatch: ${named(e)} pays only from its own account ${e.funding_account}, but the rail acts for ${acting ?? "the company's own account"}${acting ? accountOwner(db, acting) : ""}`;
  return null;
}

/** The code a refusal starts with ("entity_not_permitted"), for the audit row. */
export const refusalCode = (reason: string) => /^[a-z_]+(?=:)/.exec(reason)?.[0] ?? "entity_refused";

/** What a payment planned now carries for its paying entity, or why it may not be planned. */
export type EntityPlan = { ok: true; fields: EntityFields | null } | { ok: false; reason: string };

/**
 * The paying entity and funding account of a payment an agent plans now, on a rail acting for `acting`. A company
 * without entities: nothing is added (and naming one is refused). With entities: the entity must be named, held,
 * open to this agent by the CFO's signed policy, and the rail must act for its own account.
 */
export function planEntity(db: DB, agent: string, entity: string | undefined, acting: string | null | undefined, env: Env = process.env): EntityPlan {
  const held = listEntities(db);
  if (!held.length) return entity ? { ok: false, reason: `entity_unknown: the company holds no legal entities, so a payment cannot be made from ${JSON.stringify(entity)}` } : { ok: true, fields: null };
  // Purser as a platform binds a company to one connected account (src/airwallex/binding.ts); an entity's own account
  // is not that binding, so the two are not combined.
  if (platformOn(env)) return { ok: false, reason: "entity_with_platform: payments from several legal entities run on the company's own Airwallex accounts, not through Purser as a platform; nothing is planned" };
  const e = entity ? entityOf(db, entity) : null;
  const fields: EntityFields | null = e && { paying_entity: { id: e.id, name: e.name, country: e.country }, funding_account: { id: e.funding_account, currency: e.currency } };
  const why = entityRefusal(db, fields ?? (entity ? { paying_entity: { id: entity } } : {}), agent, acting ?? null);
  return why ? { ok: false, reason: why } : { ok: true, fields };
}
