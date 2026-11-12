// The stand-in's approved invoice: an in-memory ledger in which a labelled virtual test passkey (not a phone) approved
// the exact terms of an invoice payment, as the CFO's Face ID does in a real run. Same steps as `npm run two-locks`
// (src/cli/twoLocks.ts) up to the approval; nothing is paid, and the Airwallex side is the in-memory fake. 0 network.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, type DB } from "../db/open.js";
import { parseInvoiceFallback } from "../agents/invoice.js";
import { proposeInvoicePayment, seedTreasury } from "../agents/euroBill.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import { LICENCE_COMMAND, withOrigin } from "../provenance/origin.js";

export const STAND_IN_PASSKEY_LABEL = "tokenize virtual test passkey (not a phone)";
export const STAND_IN_FIXTURE = "stockline-licence-SLL-2026-11B.txt";
const RP = "tokenize.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;

export const fixtureText = (name = STAND_IN_FIXTURE) => readFileSync(resolve(import.meta.dirname, "../../fixtures", name), "utf8");

/** A ledger with one invoice payment proposal for `document`, approved (or not) by the virtual test passkey. */
export async function standInLedger(o: { document?: string; approve?: boolean } = {}): Promise<{ db: DB; proposalId: string; document: string }> {
  const document = o.document ?? fixtureText();
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  const now = new Date();
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const reg = await processRegistration(db, { ticket: "tokenize-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() }, { label: STAND_IN_PASSKEY_LABEL }, now);
  if (reg.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(reg)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  const out = await withOrigin(LICENCE_COMMAND, () => proposeInvoicePayment(db, awx, parseInvoiceFallback(document), document));
  if (out.kind !== "proposed") throw new Error(`not proposed: ${out.reason}`);
  const proposalId = out.proposal.proposal_id;
  if (o.approve !== false) {
    const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
    const assertion = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
    const r = await processAssertion(db, { ticket: `tokenize-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential: assertion }), received_at: new Date().toISOString() }, new Date());
    if (r.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(r)}`);
  }
  return { db, proposalId, document };
}
