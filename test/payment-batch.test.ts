// One Face ID for many invoices (Max, 9 November): the CFO signs one hash over the canonical list of each payment's own
// exact terms. Every line stays its own proposal with its own hash, checks and idempotent payout; the batch only
// approves them together. Tampering with any line, adding or removing one, or reusing an invoice in a second batch is
// refused; one line failing never pays another twice.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executePaymentBatch } from "../src/executors/paymentBatch.js";
import { canonicalTerms, termsHash, type Terms } from "../src/lib/terms.js";
import { decide } from "../src/policy/approvals.js";
import { BATCH_KIND, BATCH_MAX_LINES, batchInclusion, batchLinesOf, batchRemovalSha256, createBatch, openBatchOf, removeBatchLine, verifyBatchInclusion } from "../src/policy/batch.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { buildRelayState } from "../src/relay/state.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "batch-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The Bergtex invoice with its own number and amounts (net + 19% VAT = total). */
const bergtex = (no: string, net: string, vat: string, total: string) => EN
  .replace(/BTX-2026-21/g, no)
  .replace("Subtotal EUR 1,554.62", `Subtotal EUR ${net}`)
  .replace("VAT 19% EUR 295.38", `VAT 19% EUR ${vat}`)
  .replace("Total due EUR 1,850.00", `Total due EUR ${total}`);
const INVOICES = [
  bergtex("BTX-2026-31", "1,100.00", "209.00", "1,309.00"),
  bergtex("BTX-2026-32", "1,480.00", "281.20", "1,761.20"),
  bergtex("BTX-2026-33", "1,300.00", "247.00", "1,547.00"),
];
const add = async (text: string) => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: "invoice.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  expect(apInvoice(db, out.invoice.id)!.status).toBe("ready");
  return out.invoice.id;
};
const row = (id: string) => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as { proposal_id: string; status: string; terms_json: string; terms_sha256: string; kind: string; expires_at: string };
const approve = (id: string, at = now) => decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: row(id).terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, at);
const runLine = (id: string) => executeInvoicePayment(db, awx, awx, id).then(() => undefined);
const threeInBatch = async () => {
  const ids = [];
  for (const t of INVOICES) ids.push(await add(t));
  const out = await payApInvoices(db, awx, ids, now);
  expect(out.notPlanned).toEqual([]);
  return { ids, batch: out.batch! };
};

describe("one Face ID for a batch of invoices", () => {
  it("files one batch over each payment's own exact terms: sorted lines with their hashes, count and totals", async () => {
    const { ids, batch } = await threeInBatch();
    expect(batch.kind).toBe(BATCH_KIND);
    const t = JSON.parse(batch.terms_json) as { count: string; totals: Record<string, string>; lines: { proposal_id: string; terms_sha256: string; terms: Terms }[] };
    expect(t.count).toBe("3");
    expect(t.totals).toEqual({ EUR: "4617.20" });
    expect(t.lines.map((l) => l.proposal_id)).toEqual([...t.lines.map((l) => l.proposal_id)].sort());
    for (const l of t.lines) {
      expect(termsHash(l.terms)).toBe(l.terms_sha256);
      expect(row(l.proposal_id)).toMatchObject({ status: "PENDING_APPROVAL", terms_sha256: l.terms_sha256 });
    }
    expect(batch.terms_sha256).toBe(termsHash(t as unknown as Terms));
    for (const id of ids) expect(apInvoice(db, id)!.status).toBe("waiting_cfo");
    expect(batchLinesOf(db, batch.proposal_id)).toHaveLength(3);
  });

  it("the CFO's one approval approves every line; each line is paid once, and the invoices are marked paid", async () => {
    const { ids, batch } = await threeInBatch();
    expect(approve(batch.proposal_id)).toBe("APPROVED");
    for (const l of batchLinesOf(db, batch.proposal_id)) {
      expect(row(l.proposal_id).status).toBe("APPROVED");
      const a = db.prepare("SELECT approved_sha256, note FROM approvals WHERE proposal_id = ?").get(l.proposal_id) as { approved_sha256: string; note: string };
      expect(a.approved_sha256).toBe(l.terms_sha256);
      expect(a.note).toContain(batch.proposal_id);
      expect(a.note).toContain(batch.terms_sha256);
    }
    const result = await executePaymentBatch(db, batch.proposal_id, runLine, now);
    expect(result.lines.map((l) => [l.outcome, l.detail])).toEqual([["paid", null], ["paid", null], ["paid", null]]);
    expect(row(batch.proposal_id).status).toBe("EXECUTED");
    expect(awx.transfers).toHaveLength(3);
    await syncPayments(db, { now: () => now });
    for (const id of ids) expect(apInvoice(db, id)!.status).toBe("paid");
  });

  it("refuses the whole batch when one line's stored terms changed after the list was signed (amount or IBAN)", async () => {
    const { batch } = await threeInBatch();
    const victim = batchLinesOf(db, batch.proposal_id)[1]!.proposal_id;
    const t = JSON.parse(row(victim).terms_json) as Record<string, unknown>;
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, amount: "9999.00" }), victim);
    expect(() => approve(batch.proposal_id)).toThrow(/no longer match/);
    for (const l of batchLinesOf(db, batch.proposal_id)) expect(row(l.proposal_id).status).toBe("PENDING_APPROVAL");
    expect(row(batch.proposal_id).status).toBe("PENDING_APPROVAL");
  });

  it("refuses the batch when its own list was changed (a line removed or added) after it was filed", async () => {
    const { batch } = await threeInBatch();
    const t = JSON.parse(batch.terms_json) as { lines: unknown[]; count: string };
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, lines: t.lines.slice(1), count: "2" }), batch.proposal_id);
    expect(() => approve(batch.proposal_id)).toThrow(/no longer match/);
    for (const l of batchLinesOf(db, batch.proposal_id)) expect(row(l.proposal_id).status).toBe("PENDING_APPROVAL");
  });

  it("a line in a waiting batch is approved or rejected only with its batch, and never filed in a second batch", async () => {
    const { batch } = await threeInBatch();
    const line = batchLinesOf(db, batch.proposal_id)[0]!.proposal_id;
    expect(openBatchOf(db, line)).toBe(batch.proposal_id);
    expect(() => approve(line)).toThrow(/batch/);
    expect(() => createBatch(db, [line], "treasury", now)).toThrow(/already in .*batch/);
  });

  it("removing a line before signing supersedes the batch, frees that invoice and files a new batch of the rest", async () => {
    const { ids, batch } = await threeInBatch();
    const lines = batchLinesOf(db, batch.proposal_id);
    const next = removeBatchLine(db, batch.proposal_id, lines[0]!.proposal_id, "cfo", now);
    expect(row(batch.proposal_id).status).toBe("SUPERSEDED");
    expect(row(lines[0]!.proposal_id).status).toBe("SUPERSEDED");
    expect(next!.terms_sha256).not.toBe(batch.terms_sha256);
    expect(batchLinesOf(db, next!.proposal_id).map((l) => l.proposal_id)).toEqual(lines.slice(1).map((l) => l.proposal_id));
    await syncPayments(db, { now: () => now });
    const freed = ids.find((id) => apInvoice(db, id)!.proposal_id === null)!;
    expect(apInvoice(db, freed)!.status).toBe("ready");
    // The old batch can no longer be approved.
    expect(() => approve(batch.proposal_id)).toThrow(/SUPERSEDED/);
    expect(approve(next!.proposal_id)).toBe("APPROVED");
  });

  it("one line failing pays no line twice; a retry pays only the line that is missing", async () => {
    const { batch } = await threeInBatch();
    approve(batch.proposal_id);
    const flaky = batchLinesOf(db, batch.proposal_id)[1]!.proposal_id;
    let failOnce = true;
    const run = async (id: string) => {
      if (id === flaky && failOnce) { failOnce = false; throw new Error("the connection to Airwallex dropped"); }
      await runLine(id);
    };
    const first = await executePaymentBatch(db, batch.proposal_id, run, now);
    expect(first.lines.map((l) => l.outcome)).toEqual(["paid", "failed", "paid"]);
    expect(row(batch.proposal_id).status).toBe("FAILED");
    expect(awx.transfers).toHaveLength(2);
    const again = await executePaymentBatch(db, batch.proposal_id, run, now);
    expect(again.lines.map((l) => l.outcome)).toEqual(["paid", "paid", "paid"]);
    expect(row(batch.proposal_id).status).toBe("EXECUTED");
    expect(awx.transfers).toHaveLength(3);
    expect(new Set(awx.transfers.map((t) => t.requestId)).size).toBe(3);
  });

  it("a batch with any line over the four-eyes threshold needs two people", async () => {
    setSetting(db, "human", "approval.four_eyes_eur", "1500.00");
    const { batch } = await threeInBatch();
    expect(fourEyes(db, row(batch.proposal_id))).toBe(true);
    expect(() => approve(batch.proposal_id)).toThrow(/two different people/);
  });

  it("a batch past its time approves nothing", async () => {
    const { batch } = await threeInBatch();
    const late = new Date(Date.parse(row(batch.proposal_id).expires_at) + 1000);
    expect(approve(batch.proposal_id, late)).toBe("EXPIRED");
    for (const l of batchLinesOf(db, batch.proposal_id)) expect(["PENDING_APPROVAL", "EXPIRED"]).toContain(row(l.proposal_id).status);
    for (const l of batchLinesOf(db, batch.proposal_id)) expect(row(l.proposal_id).status).not.toBe("APPROVED");
  });

  it("a batch of one carries the same payment terms as paying that invoice alone", async () => {
    const id = await add(INVOICES[0]!);
    const out = await payApInvoices(db, awx, [id], now);
    const line = batchLinesOf(db, out.batch!.proposal_id)[0]!;
    expect((JSON.parse(row(line.proposal_id).terms_json) as { kind: string }).kind).toBe("invoice_payment");
    approve(out.batch!.proposal_id);
    await executePaymentBatch(db, out.batch!.proposal_id, runLine, now);
    expect(awx.transfers).toHaveLength(1);
  });

  it(`refuses more than ${BATCH_MAX_LINES} lines, and an empty batch`, () => {
    expect(() => createBatch(db, [], "treasury", now)).toThrow(/at least one/);
    expect(() => createBatch(db, Array.from({ length: BATCH_MAX_LINES + 1 }, (_, i) => `P-${String(9000 + i)}`), "treasury", now)).toThrow(new RegExp(`at most ${BATCH_MAX_LINES}`));
  });

  it("proves one line was in the signed batch, offline, from the two canonical texts", async () => {
    const { batch } = await threeInBatch();
    const line = batchLinesOf(db, batch.proposal_id)[2]!.proposal_id;
    const proof = batchInclusion(db, line)!;
    expect(proof.batch_sha256).toBe(batch.terms_sha256);
    expect(verifyBatchInclusion(proof)).toEqual({ ok: true });
    const forged = { ...proof, line_canonical: proof.line_canonical.replace(/"amount":"[^"]+"/, '"amount":"1.00"') };
    expect(verifyBatchInclusion(forged).ok).toBe(false);
    expect(canonicalTerms(JSON.parse(proof.line_canonical) as Terms)).toBe(proof.line_canonical);
  });

  it("the phone gets the batch to sign, not its lines one by one", async () => {
    const { batch } = await threeInBatch();
    const s = buildRelayState(db, { rpId: "kit11.example.workers.dev", relayToken: "t".repeat(64) }, now);
    const ids = s.approvals.proposals.map((p) => p.proposal_id);
    expect(ids).toContain(batch.proposal_id);
    for (const l of batchLinesOf(db, batch.proposal_id)) expect(ids).not.toContain(l.proposal_id);
  });
});

describe("the batch on the phone, with a passkey", () => {
  const RP = "kit11.example.workers.dev";
  const ORIGIN = `https://${RP}`;
  let n = 0;
  const item = (body: unknown, proposalId: string): InboxItem => ({ ticket: `b-${++n}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify(body), received_at: now.toISOString() });
  const enrol = async () => {
    const auth = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
    await processRegistration(db, { ticket: `e-${++n}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), received_at: now.toISOString() }, { label: "cfo" }, now);
    confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
    return auth;
  };

  it("one Face ID over the batch hash approves the batch and every line", async () => {
    const { batch } = await threeInBatch();
    const auth = await enrol();
    const sig = auth.sign({ challenge: challengeFor(batch.terms_sha256), origin: ORIGIN, rpId: RP, counter: 1 });
    const out = await processAssertion(db, item({ proposal_id: batch.proposal_id, terms_sha256: batch.terms_sha256, credential: sig }, batch.proposal_id), now);
    expect(out.status).toBe("approved");
    for (const l of batchLinesOf(db, batch.proposal_id)) expect(row(l.proposal_id).status).toBe("APPROVED");
  });

  it("a line's own signature is refused while it waits in a batch", async () => {
    const { batch } = await threeInBatch();
    const auth = await enrol();
    const line = batchLinesOf(db, batch.proposal_id)[0]!;
    const sig = auth.sign({ challenge: challengeFor(line.terms_sha256), origin: ORIGIN, rpId: RP, counter: 1 });
    const out = await processAssertion(db, item({ proposal_id: line.proposal_id, terms_sha256: line.terms_sha256, credential: sig }, line.proposal_id), now);
    expect(out.status).toBe("refused");
    expect(row(line.proposal_id).status).toBe("PENDING_APPROVAL");
  });

  it("taking a line out needs the passkey's signature over that removal; a replay changes nothing", async () => {
    const { batch } = await threeInBatch();
    const auth = await enrol();
    const line = batchLinesOf(db, batch.proposal_id)[1]!.proposal_id;
    // An approval signature sent as a removal is refused.
    const wrong = auth.sign({ challenge: challengeFor(batch.terms_sha256), origin: ORIGIN, rpId: RP, counter: 1 });
    expect((await processAssertion(db, item({ proposal_id: batch.proposal_id, terms_sha256: batch.terms_sha256, decision: "REMOVE_LINE", line, credential: wrong }, batch.proposal_id), now)).status).toBe("refused");
    expect(row(batch.proposal_id).status).toBe("PENDING_APPROVAL");
    const sig = auth.sign({ challenge: challengeFor(batchRemovalSha256(batch.terms_sha256, line)), origin: ORIGIN, rpId: RP, counter: 2 });
    const body = { proposal_id: batch.proposal_id, terms_sha256: batch.terms_sha256, decision: "REMOVE_LINE", line, credential: sig };
    const out = await processAssertion(db, item(body, batch.proposal_id), now);
    expect(out).toMatchObject({ status: "removed", message: expect.stringMatching(/other 2 payments/) });
    expect(row(batch.proposal_id).status).toBe("SUPERSEDED");
    expect(row(line).status).toBe("SUPERSEDED");
    expect((await processAssertion(db, item(body, batch.proposal_id), now)).status).not.toBe("removed");
  });
});
