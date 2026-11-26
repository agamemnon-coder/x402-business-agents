// The authority map (governance, 26 Nov): one read model of who may pay what. Per agent, one row per kind of payment it
// may make on its own: what, on which rail, up to which amount per payment and in all, from which account, to whom,
// when, under which grant (the CFO policy keys, a task mandate) and what goes to the CFO instead. Every value is read
// from the live policy and the ledger as they stand: the rules (src/policy/rules.ts), the limit to pay alone in force
// (src/policy/aloneLimit.ts), the task mandates in force (src/policy/taskMandates.ts), the anomaly hold
// (src/policy/anomaly.ts), the agents' principals (src/policy/principals.ts), their on-chain mandates
// (src/policy/holds.ts) and their cards (src/policy/cards.ts). Nothing here is typed in, and nothing is written: the
// dashboard reads a ledger it may not write. Shown on the Agents page (src/agents/profiles.ts) and printed by
// `npm run authority-map` (with --json, the same object).

import { AGENT_DISPLAY } from "../config/brand.js";
import { AGENTS, MCC_WORDS, type Agent } from "../config/policy.js";
import { platformPlan } from "../airwallex/binding.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { aloneLimitInForce, sourceWords } from "./aloneLimit.js";
import { anomalyThresholds } from "./anomaly.js";
import { cardControls } from "./cards.js";
import { spendLimits } from "./holds.js";
import { DEFAULT_CAPABILITIES, principal, principalActive, type Capabilities } from "./principals.js";
import { frozen, paused, policyValue } from "./rules.js";
import { mandateInForce, listTaskMandates, mandateSummary, underMandates } from "./taskMandates.js";
import { stopped } from "./velocity.js";
import { policySha, policyValues } from "./versions.js";

export interface AuthorityRow {
  /** What it may pay on its own. */
  what: string;
  /** How: the rail. */
  rail: string;
  /** The most one payment may be. */
  per_payment: string;
  /** The most in all: per month, per dispute, a budget or a task mandate's total, with what is left. */
  in_all: string;
  /** From which account (entity). */
  from: string;
  /** To whom. */
  to: string;
  /** When: the window it may act in. */
  when: string;
  /** Under which grant: the CFO policy keys it is read from, or the task mandate. */
  under: string;
  /** What goes to the CFO instead. */
  needs_cfo: string;
}

export interface AgentAuthority {
  agent: string;
  name: string;
  /** working, or why it may pay nothing now. */
  status: "working" | "frozen" | "paused" | "stopped" | "revoked";
  /** Its identity's capabilities (rails, currencies, kinds of payee) and when it ends. */
  identity: { rails: string[]; currencies: string[]; payees: string[]; expires_at: string | null };
  rows: AuthorityRow[];
}

export interface AuthorityMap {
  generated_at: string;
  /** The policy it was read from: the hash of the rule values (src/policy/versions.ts policySha). */
  policy_sha256: string;
  agents: AgentAuthority[];
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)!}`);
const merchants = (mccs: string[]) => (mccs.length ? mccs.map((m) => `${MCC_WORDS[m] ?? "Category"} (MCC ${m})`).join(", ") : "any merchant");

/** The agent's identity as the ledger holds it (its defaults when it has no row yet). Read only. */
function identityOf(db: DB, id: string, now: Date): AgentAuthority["identity"] & { active: boolean; revoked: boolean } {
  const p = principal(db, id, now, false);
  const caps: Capabilities = p ? (JSON.parse(p.capabilities_json) as Capabilities) : (DEFAULT_CAPABILITIES[id] ?? DEFAULT_CAPABILITIES.outside!);
  return { rails: caps.rails, currencies: caps.currencies, payees: caps.payees, expires_at: p?.expires_at ?? null, active: principalActive(db, id, now), revoked: p?.status === "REVOKED" };
}

/** The account supplier payments leave from: the company's connected account under Purser as a platform, else its own. */
function payingAccount(db: DB, now: Date): string {
  const pp = platformPlan(db, now);
  if (!pp.ok) return `none: ${pp.reason}`;
  return pp.paying ? `${pp.paying.name} (Airwallex account ${pp.paying.id}, through Purser)` : "the company's own Airwallex account";
}

function card(db: DB, id: string, now: Date, when: string): AuthorityRow {
  const per = policyValue(db, `card.${id}.per_tx`);
  const month = policyValue(db, `card.${id}.monthly`);
  let to = "its card's merchant categories";
  try { to = merchants(cardControls(id, now, db).mccs); } catch { /* no controls on record: the categories line stays general */ }
  return {
    what: "Purchases on its own company card", rail: "card (Airwallex Issuing, Visa)", per_payment: `EUR ${per}`, in_all: `EUR ${month} a month`,
    from: "its own company card at Airwallex (frozen outside a purchase window Purser opens)", to, when,
    under: `card.${id}.per_tx, card.${id}.monthly`, needs_cfo: `a purchase above EUR ${per} or past EUR ${month} in the month; a higher card limit`,
  };
}

/** What the CFO signs whatever the amount, on a supplier payment: from the policy as it stands. */
function supplierAsks(db: DB): string {
  const out: string[] = [];
  const th = anomalyThresholds(db);
  if (th.multiple !== null) out.push(`more than ${th.multiple}x the payee's median of its last ${th.history} paid invoices`);
  if (th.firstEurCents !== null) out.push(`a first payment to a payee above EUR ${fromCents(th.firstEurCents)}`);
  const four = policyValue(db, "approval.four_eyes_eur");
  if (four) out.push(`above EUR ${four}: two people`);
  const second = policyValue(db, "approval.second_key_eur");
  if (second) out.push(`at or above EUR ${second}: Face ID and a security key`);
  out.push("a new payee or changed bank details");
  return out.join("; ");
}

/** One agent's rows. */
function rowsOf(db: DB, id: string, now: Date, when: string): AuthorityRow[] {
  const { capCents, budgetCents, spentCents } = spendLimits(db, id);
  const chainCap = (key: string) => {
    const policy = policyValue(db, key);
    return policy ? `${policy} test USD (CFO policy, inside the on-chain cap${capCents === null ? "" : ` of ${fromCents(capCents)}`})` : capCents === null ? "no mandate bound on chain" : `${fromCents(capCents)} test USD (the on-chain mandate's cap)`;
  };
  const budget = budgetCents === null ? "no mandate bound on chain" : `${fromCents(budgetCents)} test USD on chain (${fromCents(spentCents)} spent, ${fromCents(Math.max(0, budgetCents - spentCents))} left)`;
  if (id === "sourcing") {
    return [{
      what: "Live stock checks from the warehouse API, per query (x402)", rail: "metal (on chain, test USD)", per_payment: chainCap("cap.sourcing"), in_all: budget,
      from: "its own mandate on Metal (Alta)", to: "the warehouse (its supplier)", when, under: "cap.sourcing; its on-chain mandate", needs_cfo: "a supplier price above its limit (it stops, proposes options and waits)",
    }, card(db, id, now, when)];
  }
  if (id === "support") {
    const each = policyValue(db, "approval.refund_each");
    const dispute = policyValue(db, "approval.refund_per_dispute");
    return [{
      what: "Refunds when a dispute holds", rail: "metal (on chain, test USD)", per_payment: `${each} test USD`, in_all: `${dispute} test USD per dispute; ${budget}`,
      from: "its own mandate on Metal (Alta)", to: "the customer of the disputed sale", when, under: "approval.refund_each, approval.refund_per_dispute; its on-chain mandate",
      needs_cfo: `a refund above ${each} each or ${dispute} per dispute`,
    }, card(db, id, now, when)];
  }
  if (id === "treasury") {
    const limit = aloneLimitInForce(db);
    const from = payingAccount(db, now);
    const scoped = underMandates(db, "treasury");
    const rows: AuthorityRow[] = [{
      what: "Sweeps of final earnings to Airwallex", rail: "metal, then Airwallex", per_payment: chainCap("cap.treasury"), in_all: budget,
      from: "its own mandate on Metal (Alta)", to: "the company's own Airwallex account", when, under: "cap.treasury; its on-chain mandate", needs_cfo: "nothing else: a sweep only ever goes to the company's own account",
    }, {
      what: "Supplier invoices, alone (invoice payment, supplier payment)", rail: "Airwallex payout (LOCAL or SWIFT)",
      per_payment: limit ? `${limit.currency} ${limit.amount} (${sourceWords(limit.source)})` : "none: no limit to pay alone is in force, so the CFO signs every invoice",
      in_all: scoped ? "only inside a task mandate in force (rows below)" : "no total beyond the limit per payment",
      from, to: scoped ? "only a task mandate's payees" : "suppliers on file, verified and approved with Face ID", when, under: scoped ? "ap.alone_eur and a task mandate" : "ap.alone_eur",
      needs_cfo: `anything above the limit; ${supplierAsks(db)}`,
    }];
    for (const m of listTaskMandates(db).filter((x) => x.mandate?.agent === "treasury" || !x.mandate)) {
      const rec = mandateInForce(db, m.id);
      if (!rec || !m.mandate) {
        rows.push({ what: `Task mandate ${m.id}`, rail: "-", per_payment: "nothing", in_all: "nothing", from, to: "nobody", when: "never", under: `task_mandate.${m.id}: not in force (not signed by the CFO with the passkey, or changed since without it)`, needs_cfo: "every payment" });
        continue;
      }
      const s = mandateSummary(db, rec, now);
      rows.push({
        what: `Task: ${rec.mandate.purpose} (${rec.mandate.kinds.join(", ").replace(/_/g, " ")}${rec.mandate.invoice_month ? `; invoices of ${rec.mandate.invoice_month}` : ""})`,
        rail: "Airwallex payout (LOCAL or SWIFT)", per_payment: limit ? `${limit.currency} ${limit.amount}` : "none (no limit to pay alone in force)",
        in_all: `${rec.mandate.currency} ${rec.mandate.total} in all (${rec.mandate.currency} ${s.spent} spent, ${rec.mandate.currency} ${s.left} left)`,
        from, to: list(rec.mandate.payees), when: `${rec.mandate.from} to ${rec.mandate.until} (${s.state})`,
        under: `task_mandate.${m.id}, granted by ${rec.granted_by} (passkey)`, needs_cfo: `anything outside it: another payee, purpose or month, past ${rec.mandate.until}, over its total; ${supplierAsks(db)}`,
      });
    }
    const task = policyValue(db, "approval.task_card_eur");
    rows.push({
      what: "Single-use task cards you ask for at the runner (Ask Purser)", rail: "card (Airwallex Issuing, single use)", per_payment: `EUR ${task}`, in_all: `EUR ${task} per card, 3 a day`,
      from: "a new single-use card at Airwallex", to: "the task's merchant categories", when, under: "approval.task_card_eur", needs_cfo: `a task card above EUR ${task}, or asked from the phone or by an agent`,
    }, card(db, id, now, when));
    return rows;
  }
  return [card(db, id, now, when)];
}

/** The authority map now. Reads only. */
export function authorityMap(db: DB, now = new Date()): AuthorityMap {
  const outside = db.prepare("SELECT agent_id, display_name FROM external_agents WHERE status = 'ACTIVE' ORDER BY agent_id").all() as { agent_id: string; display_name: string }[];
  const agents = [...AGENTS.map((a: Agent) => ({ id: a as string, name: AGENT_DISPLAY[a].name })), ...outside.map((x) => ({ id: x.agent_id, name: `${x.display_name} (outside agent)` }))];
  return {
    generated_at: now.toISOString(),
    policy_sha256: policySha(policyValues(db)),
    agents: agents.map(({ id, name }): AgentAuthority => {
      const ident = identityOf(db, id, now);
      const status: AgentAuthority["status"] = !ident.active ? "revoked" : frozen(db) ? "frozen" : paused(db, id) ? "paused" : stopped(db, id) ? "stopped" : "working";
      const when = status !== "working"
        ? `not now: ${status === "revoked" ? (ident.revoked ? "its identity was revoked" : `its identity expired at ${ident.expires_at}`) : status === "frozen" ? "the emergency stop is on" : status === "paused" ? "paused by the CFO" : "stopped by its velocity limit"}`
        : ident.expires_at ? `any time until ${ident.expires_at}` : "any time while it is working";
      const { active: _a, revoked: _r, ...identity } = ident;
      return { agent: id, name, status, identity, rows: rowsOf(db, id, now, when) };
    }),
  };
}

/** The map as a plain table, for the terminal. */
export function authorityMapText(m: AuthorityMap): string {
  const lines = [`Authority map at ${m.generated_at} (policy ${m.policy_sha256.slice(0, 12)}…): every value read from the live CFO policy`];
  for (const a of m.agents) {
    lines.push("", `${a.name} [${a.agent}] ${a.status}; rails ${a.identity.rails.join(", ")}; ${a.identity.currencies.length} currencies; payees ${a.identity.payees.join(", ")}${a.identity.expires_at ? `; identity ends ${a.identity.expires_at}` : ""}`);
    for (const r of a.rows) {
      lines.push(`  - ${r.what}`);
      for (const [k, v] of [["rail", r.rail], ["per payment", r.per_payment], ["in all", r.in_all], ["from", r.from], ["to", r.to], ["when", r.when], ["under", r.under], ["needs the CFO", r.needs_cfo]] as const) lines.push(`      ${k.padEnd(14)} ${v}`);
    }
  }
  return lines.join("\n");
}
