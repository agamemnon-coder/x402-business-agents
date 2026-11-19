// The world of the adversarial eval v5 (src/evals/adversarialV5Cases.ts): v4's (src/evals/adversarialV4.ts), with the
// two suppliers v5 adds on file (V5_SUPPLIERS: a Greek and a Bulgarian one, their names in Greek and Cyrillic letters).
// The case the Checker gets is v2's (src/evals/adversarialV2Cases.ts invoiceCaseFor) with these added, so the same
// runner and scorer (src/evals/adversarialV2.ts) run v5.

import type { HistoryInvoice, SupplierOnFile } from "../ap/checkerCore.js";
import type { ApReading } from "../ap/reading.js";
import type { AdvWorldAdapter, AnyAdvCase } from "./adversarialV2.js";
import { invoiceCaseFor, type AdvCase } from "./adversarialV2Cases.js";
import { ON_FILE } from "./apAgentCases.js";
import { V4_ON_FILE } from "./adversarialV4.js";
import { V4_SUPPLIERS } from "./adversarialV4Cases.js";
import { V5_SUPPLIERS, type AdvCaseV5, type PriorV5 } from "./adversarialV5Cases.js";

/** Every supplier on file in v5: v4's eleven and the two v5 adds. */
export const V5_ON_FILE: SupplierOnFile[] = [...V4_ON_FILE, ...Object.values(V5_SUPPLIERS)];
const BY_KEY: Record<PriorV5["supplier"], SupplierOnFile> = { ...ON_FILE, ...V4_SUPPLIERS, ...V5_SUPPLIERS };

/** An earlier invoice of v5's world as the history the checks compare with (as src/evals/adversarialV4.ts historyOfV4). */
export function historyOfV5(x: PriorV5): HistoryInvoice {
  const s = BY_KEY[x.supplier];
  return {
    id: x.id, vendor: s.name, invoiceNo: x.no, total: x.total, currency: x.currency ?? s.currency, issueDate: x.issued,
    receivedAt: x.received ?? `${x.issued}T09:00:00.000Z`, state: x.state, accountKey: s.bank?.iban ?? null, blockedAsDuplicate: false, rejectedWhy: null,
    ...(x.period ? { period: x.period } : {}),
  };
}

export const V5_WORLD: AdvWorldAdapter = {
  suppliers: V5_ON_FILE,
  invoiceCase: (k: AnyAdvCase, reading: ApReading) => {
    const v5 = k as AdvCaseV5;
    const { history, ...rest } = v5.world ?? {};
    const ic = invoiceCaseFor({ ...v5, world: rest } as AdvCase, reading);
    const blocked = rest.blocked ?? [];
    return {
      ...ic,
      suppliers: V5_ON_FILE,
      policy: { ...ic.policy, payees: { allowed: V5_ON_FILE.map((s) => s.name).filter((n) => !blocked.includes(n)), blocked } },
      history: (history ?? []).map(historyOfV5),
    };
  },
};
