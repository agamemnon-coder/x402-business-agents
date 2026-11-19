// Taking one payment out of a batch on the phone (src/passkey/process.ts, a REMOVE_LINE submission): it needs the
// enrolled passkey's signature over that exact removal, and everything else is refused with the batch left waiting,
// untouched. test/payment-batch.test.ts covers the removal that works and its replay; this file is every refusal: the
// wrong kind of proposal, no line named, a batch no longer waiting, a passkey not enrolled or revoked, a line that is
// not a proposal id, and a correctly signed removal of a line the batch does not hold. Test money only; no network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { decide } from "../src/policy/approvals.js";
import { batchLinesOf, batchRemovalSha256 } from "../src/policy/batch.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
let n = 0;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "batch-removal-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bergtex = (no: string, net: string, vat: string, total: string) => EN
  .replace(/BTX-2026-21/g, no)
  .replace("Subtotal EUR 1,554.62", `Subtotal EUR ${net}`)
  .replace("VAT 19% EUR 295.38", `VAT 19% EUR ${vat}`)
  .replace("Total due EUR 1,850.00", `Total due EUR ${total}`);
const row = (id: string) => db.prepare("SELECT proposal_id, status, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { proposal_id: string; status: string; terms_sha256: string };
async function twoInBatch(): Promise<{ batch: { proposal_id: string; terms_sha256: string }; lines: string[] }> {
  const ids: string[] = [];
  for (const t of [bergtex("BTX-2026-41", "1,100.00", "209.00", "1,309.00"), bergtex("BTX-2026-42", "1,480.00", "281.20", "1,761.20")]) {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(t), filename: "invoice.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    ids.push(out.invoice.id);
  }
  const out = await payApInvoices(db, awx, ids, now);
  return { batch: out.batch!, lines: batchLinesOf(db, out.batch!.proposal_id).map((l) => l.proposal_id) };
}
async function enrol(): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  await processRegistration(db, { ticket: `e-${++n}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), received_at: now.toISOString() }, { label: "cfo" }, now);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}
/** A REMOVE_LINE submission for `proposalId`, signed by `auth` over the removal of `signLine` from `signHash`. */
function removal(auth: FakeAuthenticator, proposalId: string, hash: string, line: string | undefined, signed = batchRemovalSha256(hash, line ?? "P-0000")): InboxItem {
  const credential = auth.sign({ challenge: challengeFor(signed), origin: ORIGIN, rpId: RP, counter: ++n });
  return { ticket: `r-${n}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, decision: "REMOVE_LINE", ...(line === undefined ? {} : { line }), credential }), received_at: now.toISOString() };
}

describe("taking a line out of a batch is refused, and the batch stays waiting", () => {
  it("for a proposal that is not a batch", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    const line = row(lines[0]!);
    const out = await processAssertion(db, removal(auth, line.proposal_id, line.terms_sha256, lines[1]!), now);
    expect(out).toMatchObject({ status: "refused", message: `${line.proposal_id} is not a batch; only a line of a batch can be taken out` });
    expect(row(batch.proposal_id).status).toBe("PENDING_APPROVAL");
  });

  it("when no line is named", async () => {
    const { batch } = await twoInBatch();
    const auth = await enrol();
    const out = await processAssertion(db, removal(auth, batch.proposal_id, batch.terms_sha256, undefined), now);
    expect(out).toMatchObject({ status: "refused", message: "say which line to take out" });
    expect(row(batch.proposal_id).status).toBe("PENDING_APPROVAL");
  });

  it("once the batch is no longer waiting for approval", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    decide(db, { proposalId: batch.proposal_id, decision: "REJECTED", typedPrefix: batch.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
    const out = await processAssertion(db, removal(auth, batch.proposal_id, batch.terms_sha256, lines[0]!), now);
    expect(out).toMatchObject({ status: "refused", message: `${batch.proposal_id} is REJECTED, not waiting for approval` });
  });

  it("signed by a passkey that is not enrolled", async () => {
    const { batch, lines } = await twoInBatch();
    await enrol();
    const stranger = new FakeAuthenticator();
    const out = await processAssertion(db, removal(stranger, batch.proposal_id, batch.terms_sha256, lines[0]!), now);
    expect(out).toMatchObject({ status: "refused", message: "this passkey is not enrolled" });
    expect(row(lines[0]!).status).toBe("PENDING_APPROVAL");
  });

  it("signed by a passkey that was revoked", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    db.prepare("UPDATE passkeys SET status = 'REVOKED'").run();
    const out = await processAssertion(db, removal(auth, batch.proposal_id, batch.terms_sha256, lines[0]!), now);
    expect(out).toMatchObject({ status: "refused", message: "this passkey was revoked" });
    expect(row(batch.proposal_id).status).toBe("PENDING_APPROVAL");
  });

  it("when the line is not a proposal id: the submission's schema refuses it first", async () => {
    const { batch } = await twoInBatch();
    const auth = await enrol();
    const out = await processAssertion(db, removal(auth, batch.proposal_id, batch.terms_sha256, "everything", batchRemovalSha256(batch.terms_sha256, "P-0001")), now);
    expect(out).toMatchObject({ status: "refused", message: "malformed submission" });
    expect(row(batch.proposal_id).status).toBe("PENDING_APPROVAL");
  });

  it("when the signature is over another line's removal", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    const out = await processAssertion(db, removal(auth, batch.proposal_id, batch.terms_sha256, lines[0]!, batchRemovalSha256(batch.terms_sha256, lines[1]!)), now);
    expect(out.status).toBe("refused");
    for (const id of [batch.proposal_id, ...lines]) expect(row(id).status).toBe("PENDING_APPROVAL");
  });

  it("when a correctly signed removal names a line the batch does not hold: refused and audited, nothing taken out", async () => {
    const { batch, lines } = await twoInBatch();
    const auth = await enrol();
    const out = await processAssertion(db, removal(auth, batch.proposal_id, batch.terms_sha256, "P-9999"), now);
    expect(out).toMatchObject({ status: "refused", message: `P-9999 is not in batch ${batch.proposal_id}` });
    for (const id of [batch.proposal_id, ...lines]) expect(row(id).status).toBe("PENDING_APPROVAL");
    const audited = db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'passkey.refused'").get() as { subject: string; payload_json: string };
    expect(audited.subject).toBe(batch.proposal_id);
    expect(JSON.parse(audited.payload_json).reason).toBe(`P-9999 is not in batch ${batch.proposal_id}`);
  });
});
