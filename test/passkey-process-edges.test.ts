// The runner's intake of passkey submissions (src/passkey/process.ts), the paths the other files leave: a rejection,
// a line taken out of a batch and a policy change from the phone each refuse a passkey whose enrolment seal is gone; a
// rejection the ledger cannot store is refused and audited with nothing decided; taking out the last line leaves
// nothing to sign; a batch whose stored hash is not a hash cannot have a line taken out; a policy request whose text is
// not JSON, not canonical, not a policy change, or signed by a passkey that is not enrolled creates nothing; and the
// same signed change sent again is answered as already handled. A virtual test authenticator; test money only; no
// network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { canonicalTerms, rejectionSha256, sha256Hex, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processPolicyRequest, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { UNSEALED } from "../src/passkey/seal.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { batchLinesOf, batchRemovalSha256 } from "../src/policy/batch.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const now = new Date();
let n = 0;
let db: DB;

const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem => ({ ticket: `t-${++n}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: now.toISOString() });
const sign = (auth: FakeAuthenticator, hash: string) => auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++n });
const statusOf = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const refusals = () => db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'passkey.refused' ORDER BY seq").all() as { subject: string; payload_json: string }[];

async function enrol(label = "cfo"): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  await processRegistration(db, item("registration", { code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label }, now);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}
/** Takes the enrolment seal away, as a row written straight into the ledger would have none. */
const unseal = () => db.prepare("DELETE FROM passkey_seals").run();

function propose(id: string): string {
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(), total: "0.60" };
  createProposal(db, { terms, createdBy: "support" }, now);
  return termsHash(terms);
}

beforeEach(() => { db = openDb(":memory:"); });

describe("a rejection", () => {
  it("by a passkey whose enrolment seal is gone is refused; the proposal still waits", async () => {
    const auth = await enrol();
    const hash = propose("P-0001");
    unseal();
    const out = await processAssertion(db, item("assertion", { proposal_id: "P-0001", terms_sha256: hash, decision: "REJECTED", credential: sign(auth, rejectionSha256(hash)) }, "P-0001"), now);
    expect(out).toEqual({ status: "refused", proposalId: "P-0001", message: UNSEALED });
    expect(statusOf("P-0001")).toBe("PENDING_APPROVAL");
  });

  it("the ledger cannot store: refused and audited, nothing decided", async () => {
    const auth = await enrol();
    const hash = propose("P-0001");
    db.exec("CREATE TRIGGER no_store BEFORE INSERT ON passkey_assertions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const out = await processAssertion(db, item("assertion", { proposal_id: "P-0001", terms_sha256: hash, decision: "REJECTED", credential: sign(auth, rejectionSha256(hash)) }, "P-0001"), now);
    expect(out).toEqual({ status: "refused", proposalId: "P-0001", message: "disk full" });
    expect(statusOf("P-0001")).toBe("PENDING_APPROVAL");
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
    expect(JSON.parse(refusals().at(-1)!.payload_json)).toMatchObject({ reason: "disk full", credential: auth.credentialId.slice(0, 8) });
  });
});

describe("taking a line out of a batch", () => {
  let dir: string;
  let deps: InboxDeps;
  beforeEach(async () => {
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "passkey-edges-"));
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    deps = { dir, reader: { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker, now: () => now };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const bergtex = (no: string, net: string, vat: string, total: string) => EN
    .replace(/BTX-2026-21/g, no).replace("Subtotal EUR 1,554.62", `Subtotal EUR ${net}`).replace("VAT 19% EUR 295.38", `VAT 19% EUR ${vat}`).replace("Total due EUR 1,850.00", `Total due EUR ${total}`);
  async function twoInBatch() {
    const ids: string[] = [];
    for (const t of [bergtex("BTX-2026-51", "1,100.00", "209.00", "1,309.00"), bergtex("BTX-2026-52", "1,480.00", "281.20", "1,761.20")]) {
      const out = await ingestDocument(db, deps, { bytes: await pdfOf(t), filename: "invoice.pdf", source: "upload" });
      if (out.kind !== "invoice") throw new Error(out.kind);
      ids.push(out.invoice.id);
    }
    const out = await payApInvoices(db, new FakeAirwallex(), ids, now);
    return { batch: out.batch!, lines: batchLinesOf(db, out.batch!.proposal_id).map((l) => l.proposal_id) };
  }
  const removal = (auth: FakeAuthenticator, batch: { proposal_id: string; terms_sha256: string }, line: string) =>
    item("assertion", { proposal_id: batch.proposal_id, terms_sha256: batch.terms_sha256, decision: "REMOVE_LINE", line, credential: sign(auth, batchRemovalSha256(batch.terms_sha256, line)) }, batch.proposal_id);
  const batchRow = (id: string) => db.prepare("SELECT proposal_id, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { proposal_id: string; terms_sha256: string };

  it("taking out the last line leaves nothing in the batch to sign", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    const last = lines.at(-1)!;
    // Down to its last line first, where the batch holds more than one.
    let current = batchRow(batch.proposal_id);
    for (const line of lines.slice(0, -1)) {
      const out = await processAssertion(db, removal(auth, current, line), now);
      expect(out.status).toBe("removed");
      current = batchRow((JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'batch.line_removed' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string }).payload_json) as { next_batch: string }).next_batch);
    }
    const out = await processAssertion(db, removal(auth, current, last), now);
    expect(out).toEqual({ status: "removed", proposalId: current.proposal_id, message: `${last} taken out; nothing is left in the batch` });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'batch.line_removed' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ line: last, next_batch: null });
    expect(statusOf(current.proposal_id)).toBe("SUPERSEDED");
  });

  it("by a passkey whose enrolment seal is gone is refused; the batch still waits", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    unseal();
    expect(await processAssertion(db, removal(auth, batch, lines[0]!), now)).toEqual({ status: "refused", proposalId: batch.proposal_id, message: UNSEALED });
    expect(statusOf(batch.proposal_id)).toBe("PENDING_APPROVAL");
  });

  it("a batch whose stored hash is not a hash: no removal can be signed for it", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    const signedFor = removal(auth, batch, lines[0]!);
    db.prepare("UPDATE proposals SET terms_sha256 = ? WHERE proposal_id = ?").run(batch.terms_sha256.toUpperCase(), batch.proposal_id);
    expect(await processAssertion(db, signedFor, now)).toEqual({ status: "refused", proposalId: batch.proposal_id, message: "a terms hash is 64 lowercase hex characters" });
  });
});

describe("a policy change made on the phone", () => {
  const change = { key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03" };
  const termsOf = (over: Record<string, unknown> = {}) => ({
    schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: "C-0a1b2c3d", expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(), changes: [change], reason: "prices rising", ...over,
  });
  const request = (auth: FakeAuthenticator, terms: Record<string, unknown>) => {
    const canonical = canonicalTerms(terms as Terms);
    const hash = sha256Hex(canonical);
    return item("policy", { canonical, terms_sha256: hash, credential: sign(auth, hash) });
  };
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n;

  it("text that is not JSON, not in canonical form, or not a policy change creates nothing", async () => {
    const auth = await enrol();
    const raw = (canonical: string) => item("policy", { canonical, terms_sha256: sha256Hex(canonical), credential: sign(auth, sha256Hex(canonical)) });
    expect(await processPolicyRequest(db, raw("{not json"), now)).toMatchObject({ status: "refused", message: "malformed submission" });
    const spaced = JSON.stringify(termsOf(), null, 1);
    expect(await processPolicyRequest(db, raw(spaced), now)).toMatchObject({ status: "refused", message: "the terms do not hash to the signed hash" });
    expect(await processPolicyRequest(db, request(auth, termsOf({ kind: "refund_batch" })), now)).toMatchObject({ status: "refused", message: "malformed submission" });
    expect(await processPolicyRequest(db, request(auth, termsOf({ reason: "x".repeat(501) })), now)).toMatchObject({ status: "refused", message: "malformed submission" });
    expect(count()).toBe(0);
  });

  it("signed by a passkey that is not enrolled, or whose seal is gone: nothing becomes a proposal", async () => {
    const auth = await enrol();
    const stranger = new FakeAuthenticator();
    expect(await processPolicyRequest(db, request(stranger, termsOf()), now)).toMatchObject({ status: "refused", message: "this passkey is not the enrolled one" });
    unseal();
    expect(await processPolicyRequest(db, request(auth, termsOf()), now)).toMatchObject({ status: "refused", message: UNSEALED });
    expect(count()).toBe(0);
  });

  it("the same signed change sent again is answered as already handled", async () => {
    const auth = await enrol();
    const req = request(auth, termsOf());
    expect(await processPolicyRequest(db, req, now)).toMatchObject({ status: "approved", proposalId: "C-0a1b2c3d" });
    expect(await processPolicyRequest(db, { ...req, ticket: "resent" }, now)).toMatchObject({ status: "already", ack: "approved", proposalId: "C-0a1b2c3d" });
    expect(count()).toBe(1);
  });
});
