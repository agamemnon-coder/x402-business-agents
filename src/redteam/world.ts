// The red team's throwaway world (security item 4): a fresh in-memory ledger with the CFO's passkey enrolled, the
// manufacturer on file, the agents' company cards on an in-memory Issuing double and one outside agent with a card.
// Nothing here reaches Metal, Airwallex or a phone: the attacks hit the same code the runner runs, and a success
// would move only make-believe money. The CFO's key lives here so the world can approve what the CFO really would;
// the attacker never gets it, except in the one attack that assumes a hijacked phone page (see attacks.ts).

import { ibanSha } from "../agents/invoice.js";
import { MANUFACTURER } from "../agents/euroBill.js";
import { openDb, type DB } from "../db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { executeAgentOnboard, requestCompanyCard, type ExternalAgentId } from "../platform/externalAgents.js";
import { createProposal } from "../policy/approvals.js";
import { setupCards } from "../policy/cards.js";
import { FakeAuthenticator } from "./authenticator.js";
import { FakeIssuing } from "./issuing.js";

export const RP = "purser.example";
export const ORIGIN = `https://${RP}`;

export interface World {
  db: DB;
  issuing: FakeIssuing;
  /** The CFO's own passkey: the honest phone. */
  cfo: FakeAuthenticator;
  /** The outside agent that holds a card (P1). */
  outside: ExternalAgentId;
  now: () => Date;
  /** Moves the world's clock on. */
  advance: (ms: number) => void;
  item: (kind: InboxItem["kind"], body: unknown, proposalId?: string | null) => InboxItem;
  /** A proposal the CFO has not decided yet; returns its id and hash. */
  propose: (over?: Record<string, unknown>) => { id: string; hash: string };
  /** The CFO's genuine approval of a proposal, as the phone would send it. */
  cfoApproval: (id: string, hash: string) => InboxItem;
}

export async function redTeamWorld(start = new Date("2026-11-03T10:00:00Z")): Promise<World> {
  let t = start.getTime();
  const now = () => new Date(t);
  const db = openDb(":memory:");
  const issuing = new FakeIssuing();
  issuing.clock = () => t;
  let tickets = 0;
  let proposals = 0;
  let counter = 0;
  const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
    ({ ticket: `rt-${++tickets}`, kind, proposal_id: proposalId, body: typeof body === "string" ? body : JSON.stringify(body), received_at: now().toISOString() });

  // The CFO enrols a passkey, and confirms its fingerprint on the runner.
  const cfo = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now());
  const reg = await processRegistration(db, item("registration", { code, credential: cfo.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, now());
  if (reg.status !== "pending") throw new Error(`the red team's world could not enrol the CFO: ${reg.message}`);
  confirmPasskey(db, fingerprintOf(cfo.spkiSha256), now());

  // The manufacturer's bank details on file, as the euro bill flow leaves them.
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben-bergtex', ?, ?, ?, ?, 'EUR', 'SWIFT')")
    .run(MANUFACTURER.name, MANUFACTURER.iban.slice(-4), ibanSha(MANUFACTURER.iban), MANUFACTURER.bic);

  await setupCards(db, issuing, now());

  const propose = (over: Record<string, unknown> = {}) => {
    const id = `P-${String(9000 + ++proposals)}`;
    const terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: new Date(t + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), total: "0.15", ...over } as Terms;
    createProposal(db, { terms, createdBy: "support" }, now());
    return { id, hash: termsHash(terms) };
  };
  const cfoApproval = (id: string, hash: string) =>
    item("assertion", { proposal_id: id, terms_sha256: hash, credential: cfo.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter }) }, id);

  // An outside agent asks for a card; the CFO approves it with Face ID; it is issued.
  const outside = "ext:trail-scout" as ExternalAgentId;
  const ask = requestCompanyCard(db, outside, { displayName: "Trail Scout agent", purpose: "buys outdoor market reports", perTx: "25.00", monthly: "80.00" }, now());
  const ok = await processAssertion(db, cfoApproval(ask.proposal_id, ask.terms_sha256), now());
  if (ok.status !== "approved") throw new Error(`the red team's world could not onboard its outside agent: ${ok.message}`);
  await executeAgentOnboard(db, issuing, ask.proposal_id, now());

  return { db, issuing, cfo, outside, now, advance: (ms) => { t += ms; }, item, propose, cfoApproval };
}
