// The world of the adversarial eval v4 (src/evals/adversarialV4Cases.ts): v2's, with the six suppliers v4 adds on file
// (V4_SUPPLIERS) and an earlier invoice's printed months (period) as the ledger keeps them since the second round of
// fixes. The case the Checker gets is v2's (src/evals/adversarialV2Cases.ts invoiceCaseFor) with these added, so the
// same runner and scorer (src/evals/adversarialV2.ts) run v4.

import type { HistoryInvoice, SupplierOnFile } from "../ap/checkerCore.js";
import type { ApReading } from "../ap/reading.js";
import type { AdvWorldAdapter, AnyAdvCase } from "./adversarialV2.js";
import { ADV_SUPPLIERS, invoiceCaseFor, type AdvCase } from "./adversarialV2Cases.js";
import { ON_FILE } from "./apAgentCases.js";
import { V4_SUPPLIERS, type AdvCaseV4, type PriorV4 } from "./adversarialV4Cases.js";

/** Every supplier on file in v4: v2's five and the six v4 adds. */
export const V4_ON_FILE = [...ADV_SUPPLIERS, ...Object.values(V4_SUPPLIERS)];
const BY_KEY = { ...ON_FILE, ...V4_SUPPLIERS };

/** An earlier invoice of v4's world as the history the checks compare with (as src/evals/adversarialV2Cases.ts historyOf). */
export function historyOfV4(x: PriorV4): HistoryInvoice {
  const s: SupplierOnFile = BY_KEY[x.supplier];
  return {
    id: x.id, vendor: s.name, invoiceNo: x.no, total: x.total, currency: x.currency ?? s.currency, issueDate: x.issued,
    receivedAt: x.received ?? `${x.issued}T09:00:00.000Z`, state: x.state, accountKey: s.bank?.iban ?? null, blockedAsDuplicate: false, rejectedWhy: null,
    ...(x.period ? { period: x.period } : {}),
  };
}

export const V4_WORLD: AdvWorldAdapter = {
  suppliers: V4_ON_FILE,
  invoiceCase: (k: AnyAdvCase, reading: ApReading) => {
    const v4 = k as AdvCaseV4;
    const { history, ...rest } = v4.world ?? {};
    const ic = invoiceCaseFor({ ...v4, world: rest } as AdvCase, reading);
    const blocked = rest.blocked ?? [];
    return {
      ...ic,
      suppliers: V4_ON_FILE,
      policy: { ...ic.policy, payees: { allowed: V4_ON_FILE.map((s) => s.name).filter((n) => !blocked.includes(n)), blocked } },
      history: (history ?? []).map(historyOfV4),
    };
  },
};
