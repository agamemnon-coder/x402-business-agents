// The finance agent's planning for a supplier price rise (scenario S1). Everything here is code:
// it reads the chain, prices the options and writes proposals. It moves nothing.

import { readFileSync } from "node:fs";
import { extractTerms, hashCredential, parseCredential } from "@metalntwx/metal-pay/mandates";
import type { Address } from "viem";
import { audit } from "../audit/log.js";
import {
  ALT_SELL_PRICE_CENTS, INITIAL_MANDATES, MANDATE_PROPOSAL_TTL_MS, TOTAL_BUDGET_CENTS, type Agent,
} from "../config/policy.js";
import type { DB } from "../db/open.js";
import { issueReplacementCredential } from "../executors/ownerSigner.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { activeMandate, mandateSpent, type LoadedMandate } from "../metal/mandate.js";
import { createProposal, nextProposalId } from "../policy/approvals.js";
import { planReplaceSteps, priceRiseOptions, type MandateNow, type MandateTarget } from "../policy/mandates.js";
import type { Addresses } from "../world/runtime.js";

export interface ReplaceStepTerms {
  [k: string]: string | string[];
  order: string;
  agent: string;
  principal: string;
  cap: string;
  budget: string;
  payees: string[];
  expires_at: string;
  credential_hash: string;
  replaces_credential_hash: string;
  spent_at_proposal: string;
}

export interface MandateReplaceTerms extends Terms {
  kind: "mandate_replace";
  option: string;
  query_price: string;
  upstream_price: string;
  margin: string;
  total_budget: string;
  steps: ReplaceStepTerms[];
  evidence: { type: string; ref: string; sha256: string }[];
}

const PAYEE: Record<Agent, (a: Addresses) => { address: Address; name: string }> = {
  sourcing: (a) => ({ address: a.supplier, name: "Stockline" }),
  support: (a) => ({ address: a.customer, name: "Summit Outfitters" }),
  treasury: (a) => ({ address: a.sweep, name: "Northwind sweep" }),
};

/** The limits after a price rise: sourcing's cap is exactly the new price, with no headroom. */
export function priceRiseTargets(newUpstreamCents: number): MandateTarget[] {
  return [
    { agent: "sourcing", capCents: newUpstreamCents, budgetCents: 1200 },
    { agent: "treasury", capCents: 400, budgetCents: 400 },
    { agent: "support", capCents: INITIAL_MANDATES.support.capCents, budgetCents: INITIAL_MANDATES.support.budgetCents },
  ];
}

export interface PriceRiseEvidence {
  noticePath: string;
  liveOfferCents: number;
  refusal: { purchaseId: number; reason: string };
}

export async function proposePriceRise(db: DB, addr: Addresses, sellCents: number, ev: PriceRiseEvidence, now = new Date()) {
  const current = new Map<Agent, { m: LoadedMandate; now: MandateNow }>();
  for (const agent of ["sourcing", "support", "treasury"] as const) {
    const m = await activeMandate(agent);
    const t = extractTerms(m.credential);
    current.set(agent, {
      m,
      now: {
        agent,
        capCents: baseUnitsToCents(t.constraints.perPaymentCap),
        budgetCents: baseUnitsToCents(t.constraints.budget),
        spentCents: baseUnitsToCents(await mandateSpent(m)),
      },
    });
  }
  const steps = planReplaceSteps([...current.values()].map((c) => c.now), priceRiseTargets(ev.liveOfferCents));
  const firstId = nextProposalId(db);

  // Credentials are issued before approval (off-chain, no gas), so their hash goes into the terms.
  const stepTerms: ReplaceStepTerms[] = steps.map((s) => {
    const { m, now: n } = current.get(s.agent)!;
    const path = issueReplacementCredential(
      { agent: s.agent, principal: addr.business, capCents: s.capCents, budgetCents: s.budgetCents, payees: [PAYEE[s.agent](addr)], description: `kit11 ${firstId} ${s.agent}` },
      firstId, m.keyFile,
    );
    const next = extractTermsFrom(path);
    return {
      order: String(s.order), agent: s.agent, principal: addr.business.toLowerCase(),
      cap: fromCents(s.capCents), budget: fromCents(s.budgetCents),
      payees: [PAYEE[s.agent](addr).address.toLowerCase()].sort(),
      expires_at: new Date(Number(next.constraints.expiry) * 1000).toISOString().replace(".000Z", "Z"),
      credential_hash: next.hash, replaces_credential_hash: m.credentialHash,
      spent_at_proposal: fromCents(n.spentCents),
    };
  });

  const notice = readFileSync(ev.noticePath, "utf8");
  const evidence = [
    { type: "supplier_notice", ref: ev.noticePath.split("/").slice(-2).join("/"), sha256: sha256Hex(notice) },
    { type: "live_offer", ref: `upstream price ${fromCents(ev.liveOfferCents)}`, sha256: sha256Hex(fromCents(ev.liveOfferCents)) },
    { type: "refusal", ref: `upstream_purchase:${ev.refusal.purchaseId}:${ev.refusal.reason}`, sha256: sha256Hex(ev.refusal.reason) },
  ];
  const expires = new Date(now.getTime() + MANDATE_PROPOSAL_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const options = priceRiseOptions(sellCents, ALT_SELL_PRICE_CENTS, ev.liveOfferCents).filter((o) => o.sellCents !== null);
  const totalAfter = steps.at(-1)?.totalAfterCents ?? TOTAL_BUDGET_CENTS;

  const proposals = options.map((o, i) => {
    const id = i === 0 ? firstId : nextProposalId(db);
    const terms: MandateReplaceTerms = {
      schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: expires,
      option: o.id, query_price: fromCents(o.sellCents!), upstream_price: fromCents(ev.liveOfferCents), margin: fromCents(o.marginCents!),
      total_budget: fromCents(totalAfter), steps: stepTerms, evidence,
    };
    return createProposal(db, { terms, createdBy: "treasury", evidence }, now);
  });
  audit(db, "treasury", "price_rise.options", firstId, {
    options: priceRiseOptions(sellCents, ALT_SELL_PRICE_CENTS, ev.liveOfferCents).map((o) => ({
      id: o.id, label: o.label, sell: o.sellCents === null ? null : fromCents(o.sellCents), margin: o.marginCents === null ? null : fromCents(o.marginCents),
      margin_percent: o.marginPercent === null ? null : String(o.marginPercent),
    })),
  }, now);
  return proposals;
}

function extractTermsFrom(path: string) {
  const credential = parseCredential(JSON.parse(readFileSync(path, "utf8")));
  return { ...extractTerms(credential), hash: hashCredential(credential) };
}

/**
 * The facts code has already checked, for the advisory Opus review of a price-rise proposal. Without them
 * the reviewer sees only the terms and asks about things that are settled (the third mandate, spend carry-over).
 */
export async function priceRiseContext(addr: Addresses, sellCents: number, oldUpstream: string, liveOfferCents: number, refusalReason: string): Promise<string> {
  const lines: string[] = [];
  let total = 0;
  for (const agent of ["sourcing", "support", "treasury"] as const) {
    const m = await activeMandate(agent);
    const t = extractTerms(m.credential);
    const budget = baseUnitsToCents(t.constraints.budget);
    total += budget;
    lines.push(`- ${agent}: cap ${fromCents(baseUnitsToCents(t.constraints.perPaymentCap))} per payment, budget ${fromCents(budget)}, spent ${fromCents(baseUnitsToCents(await mandateSpent(m)))}, payee ${PAYEE[agent](addr).name} (${PAYEE[agent](addr).address.toLowerCase()})`);
  }
  return [
    `Supplier Stockline raised its price from ${oldUpstream} to ${fromCents(liveOfferCents)} per stock check (its notice and the live 402 offer agree). The next purchase was refused on chain: ${refusalReason}; the customer was not charged.`,
    `Current sell price: ${fromCents(sellCents)}. In the terms, query_price is the sell price this option would set, and margin = query_price - upstream_price. The approver chooses between options (another option keeps the current price; pausing sales means approving nothing).`,
    `Mandates bound now (read from the chain), ${fromCents(total)} of the ${fromCents(TOTAL_BUDGET_CENTS)} total:`,
    ...lines,
    `The proposal replaces sourcing and treasury only; support stays as it is, so total_budget counts all three mandates and never exceeds ${fromCents(TOTAL_BUDGET_CENTS)}.`,
    "Checked by code: each replaces_credential_hash is the credential bound now; each new credential was issued by the business owner key with exactly these caps, budgets, payees and expiry; the payees are the known supplier and our own sweep wallet.",
    "Metal semantics: a replacement mandate carries what the agent has already spent, so spent_at_proposal counts against the new budget. Steps run in order, shrinking first, so the total never exceeds the limit at any moment.",
    "By design: sourcing's cap equals the supplier price with no headroom, so any further rise is refused on chain and comes back to a person; treasury's cap equals its budget because it makes one sweep at a time to our own wallet.",
  ].join("\n");
}

