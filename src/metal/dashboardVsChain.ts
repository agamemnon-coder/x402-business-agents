// Metal QA (1 November): the dashboard's mandate numbers, read against the chain. For each agent the dashboard shows a
// cap, a budget and what was spent; Metal has the bound credential's terms and its running spend. They must agree:
// cap and budget exactly; spend between what the dashboard counts as paid and paid + pending (a pull sent and not yet
// final). After a replacement the dashboard carries spend over credentials while the chain counts per credential, so
// the chain's spend is then only an upper bound.

import { extractTerms, readMandateState } from "@metalntwx/metal-pay/mandates";
import type { DB } from "../db/open.js";
import { buildSnapshot } from "../dashboard/snapshot.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents, toCents } from "../lib/money.js";
import { publicClient } from "./chain.js";
import { activeMandate, type MandateAgent } from "./mandate.js";

const words = (units: bigint) => fromCents(baseUnitsToCents(units));

export interface ShownMandate { agent: string; cap: string; budget: string; spent: string; pending: string; credentials: number }
export interface ChainMandate { perPaymentCap: bigint; budget: bigint; spent: bigint; revoked: boolean; bound: boolean }

/** What differs between the dashboard and the chain for one mandate; empty when they agree. */
export function compareMandate(shown: ShownMandate, chain: ChainMandate): string[] {
  if (!chain.bound) return ["the chain has no bound mandate for this credential"];
  if (chain.revoked) return ["the chain has revoked this credential"];
  const out: string[] = [];
  const units = (s: string) => centsToBaseUnits(toCents(s));
  if (units(shown.cap) !== chain.perPaymentCap) out.push(`cap: the dashboard shows ${shown.cap}, the chain ${words(chain.perPaymentCap)}`);
  if (units(shown.budget) !== chain.budget) out.push(`budget: the dashboard shows ${shown.budget}, the chain ${words(chain.budget)}`);
  const paid = units(shown.spent), pending = units(shown.pending);
  if (shown.credentials <= 1) {
    if (chain.spent < paid || chain.spent > paid + pending) out.push(`spent: the dashboard shows ${shown.spent} (${shown.pending} pending), the chain ${words(chain.spent)}`);
  } else if (chain.spent > paid + pending) {
    out.push(`spent: the dashboard shows ${shown.spent} (${shown.pending} pending), the chain ${words(chain.spent)} under the current credential alone`);
  }
  return out;
}

export interface MandateCheck { agent: string; ok: boolean; differences: string[] }

/** The live check: the snapshot the dashboard serves, against Metal testnet. */
export async function dashboardVsChain(db: DB): Promise<MandateCheck[]> {
  const b = buildSnapshot(db).budgets;
  const shown = [...b.agents, ...(b.counterparty ? [b.counterparty] : [])];
  const out: MandateCheck[] = [];
  for (const s of shown) {
    let differences: string[];
    try {
      const m = await activeMandate(s.agent as MandateAgent);
      const terms = extractTerms(m.credential).constraints;
      const state = await readMandateState(publicClient(), m.principal, m.reference);
      differences = compareMandate(s, { perPaymentCap: terms.perPaymentCap, budget: terms.budget, spent: state.spent, revoked: state.revoked, bound: state.boundBlock > 0n });
    } catch (e) {
      differences = [`could not read it on chain: ${(e as Error).message.slice(0, 160)}`];
    }
    out.push({ agent: s.agent, ok: differences.length === 0, differences });
  }
  return out;
}
