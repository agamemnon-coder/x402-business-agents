// Payables: paying several ready invoices with one Face ID (src/policy/batch.ts). Each invoice is planned exactly as on
// its own (payApInvoice: reserve floors, FX for the shortfall, fee reserve, duplicate guards), so each becomes its own
// payment proposal with its own exact terms; then one batch over those proposals goes to the CFO's phone. An invoice
// whose payment cannot be planned stays as it is, with the reason, and is left out of the batch.

import type { AirwallexRail, PayoutRail } from "../airwallex/port.js";
import type { DB } from "../db/open.js";
import { BATCH_MAX_LINES, createBatch } from "../policy/batch.js";
import type { ProposalRow } from "../policy/approvals.js";
import { reserveForBatch, withBatchPlanning } from "../payouts/planContext.js";
import { payApInvoice } from "./pay.js";
import type { Asker } from "./read.js";

export interface BatchPayOutcome {
  batch: ProposalRow | null;
  planned: { id: string; proposal_id: string }[];
  notPlanned: { id: string; reason: string }[];
}

export async function payApInvoices(db: DB, rail: AirwallexRail & PayoutRail, ids: string[], now = new Date(), reader?: Asker): Promise<BatchPayOutcome> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new Error("pick at least one invoice to pay");
  if (unique.length > BATCH_MAX_LINES) throw new Error(`pay at most ${BATCH_MAX_LINES} invoices with one Face ID; ${unique.length} were picked`);
  const planned: BatchPayOutcome["planned"] = [];
  const notPlanned: BatchPayOutcome["notPlanned"] = [];
  // Each invoice is planned against what the earlier ones in this batch will draw, so the batch fits as a whole.
  await withBatchPlanning(async () => {
    for (const id of unique) {
      try {
        const out = await payApInvoice(db, rail, id, now, reader);
        if (out.kind === "proposed") {
          planned.push({ id, proposal_id: out.proposal.proposal_id });
          reserveForBatch(JSON.parse(out.proposal.terms_json) as Parameters<typeof reserveForBatch>[0]);
        } else notPlanned.push({ id, reason: out.reason });
      } catch (e) {
        notPlanned.push({ id, reason: (e as Error).message });
      }
    }
  });
  const batch = planned.length ? createBatch(db, planned.map((p) => p.proposal_id), "treasury", now) : null;
  return { batch, planned, notPlanned };
}
