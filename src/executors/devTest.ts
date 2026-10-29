// A dev test proposal: lets a person try the approval flow (the phone, Face ID, the runner's checks) on a real
// relay without moving anything. Its terms say so, the phone shows it, and "executing" it only records that
// nothing moved. Never part of the demo story.

import type { DB } from "../db/open.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";

export const DEV_TEST_LABEL = "DEV TEST: moves no money";
const TTL_MS = 30 * 60 * 1000;

export function proposeDevTest(db: DB, now = new Date()): ProposalRow {
  const terms: Terms = {
    schema: TERMS_SCHEMA, kind: "dev_test", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    label: DEV_TEST_LABEL, purpose: "Max checks Face ID approval on his iPhone", amount: "0.00",
  };
  return createProposal(db, { terms, createdBy: "system" }, now);
}

export function executeDevTest(db: DB, proposalId: string, now = new Date()): void {
  beginExecution(db, proposalId, (t) => {
    if (t.kind !== "dev_test" || t.label !== DEV_TEST_LABEL) throw new Error(`${proposalId} is not a dev test`);
  }, now);
  finishExecution(db, proposalId, "EXECUTED", { dev_test: true, moved: "nothing" }, now);
}
