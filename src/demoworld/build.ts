// One test company of the demo world, built by the real engine, offline: its invoices go through the real inbox (PDF,
// text, the parser, the checks), new suppliers are verified and approved, payments are approved with the company's
// test passkey over the exact terms and paid on the in-memory stand-in for Airwallex (no rail is called, no money
// moves), the ledger is fed, October is closed and the vault is filed with its PDFs. Nothing is written by hand: every
// row, hash chain and report comes from the same code a real company's runner runs.
//
// The clock and all randomness are fixed (src/demoworld/fixed.ts), so two builds give the same bytes.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { acceptCreditNote } from "../ap/credits.js";
import { ingestDocument, type InboxDeps } from "../ap/inbox.js";
import { payApInvoice, syncPayments } from "../ap/pay.js";
import type { Asker } from "../ap/read.js";
import { apInvoice, apInvoices, type ApInvoiceRow } from "../ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../ap/vendors.js";
import { verifyAuditChain } from "../audit/log.js";
import { openDb, type DB } from "../db/open.js";
import { pdfOf } from "../e2e/documents.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { executePolicyChange, proposePolicyChange } from "../executors/policyChange.js";
import { executeSupplierPayment } from "../executors/supplierPayment.js";
import { closeMonth } from "../ledger/close.js";
import { verifyLedger } from "../ledger/core.js";
import { syncLedger } from "../ledger/feed.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import { syncVault, verifyVault, type YearIndex } from "../vault/build.js";
import { yearIndexPath } from "../vault/layout.js";
import { LocalSink } from "../vault/sink.js";
import { setSetting } from "../world/settings.js";
import { creditText, invoiceText, type CompanySpec, type Supplier } from "./companies.js";
import { fixed } from "./fixed.js";
import { testPasskey, TEST_PASSKEY_LABEL } from "./passkey.js";

/** The world's own version: part of every seed, so a changed world is a new world, never a silent edit. */
export const WORLD_VERSION = "2";
/** When the world starts and when it stops: the last thing recorded in it. */
export const WORLD_START = "2026-10-01T08:00:00Z";
export const WORLD_AS_OF = "2026-11-10T09:30:00Z";
/** The month that is closed in every company's books. */
export const CLOSED_MONTH = "2026-10";
/** The relying party the test passkeys are bound to: a test name that resolves nowhere. */
export const DEMO_RP_ID = "demo-world.purser.test";
export const DEMO_ORIGIN = `https://${DEMO_RP_ID}`;

/** The parser only: no model is called while the world is built (no network, no key, no cost). */
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "demo world: the parser read it (no model call)" }) } as Asker;

/** The states a visitor should see, and the invoice that shows each one. */
export type DemoState = "paid" | "paid_closed_month" | "paid_foreign_currency" | "waiting_for_cfo" | "held_possible_fraud" | "duplicate_refused" | "new_supplier" | "credit_note";

export interface BuiltCompany {
  spec: CompanySpec;
  /** The company's own runner ledger, as the engine left it. */
  db: DB;
  /** Where its documents are (dir/ap) and its vault (dir/vault). */
  dir: string;
  vaultDir: string;
  /** The inbox id of the invoice that shows each state. */
  states: Record<DemoState, string>;
  passkey: { credential_id: string; label: string };
  as_of: string;
}

const HOW = "test world: the invented supplier's bank details as printed on its own invoice; there is no real supplier to call";
const ADDRESS = { street: "Teststraat 2", city: "Amsterdam", postcode: "1011 AB" };

/** Builds one company in `dir` (its documents and vault are written there; the ledger stays in memory). */
export async function buildCompany(spec: CompanySpec, dir: string): Promise<BuiltCompany> {
  return fixed(`purser demo world v${WORLD_VERSION}: ${spec.slug}`, WORLD_START, async (clock) => {
    const now = () => clock.now();
    mkdirSync(dir, { recursive: true });
    const db = openDb(":memory:");
    // The stand-in for the company's Airwallex account, holding test money in EUR only.
    const awx = new FakeAirwallex();
    awx.bal.EUR.availableCents = spec.openingEurCents;
    setSetting(db, "human", "eur_obligations", "0.00");
    // The world says in its own books that its rails are stand-ins (src/accounting/books.ts openingLines).
    setSetting(db, "human", "world.stand_in_rails", "on");

    // The CFO's test passkey, enrolled the way a phone enrols: registration, then the fingerprint confirmed.
    const cfo = testPasskey(spec.slug);
    const { window, code } = openEnrolment(db, { rpId: DEMO_RP_ID, origin: DEMO_ORIGIN }, now());
    await processRegistration(db, { ticket: `${spec.slug}-enrol`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: cfo.register({ challenge: window.challenge, origin: DEMO_ORIGIN, rpId: DEMO_RP_ID }) }), received_at: now().toISOString() }, { label: "cfo (test passkey)" }, now());
    confirmPasskey(db, fingerprintOf(cfo.spkiSha256), now());
    let counter = 0;
    let ticket = 0;
    /** The CFO signs the proposal's exact terms with the test passkey; the engine verifies the signature. */
    const sign = async (proposalId: string, termsSha: string) => {
      clock.tick(4);
      const credential = cfo.sign({ challenge: challengeFor(termsSha), origin: DEMO_ORIGIN, rpId: DEMO_RP_ID, counter: ++counter });
      const out = await processAssertion(db, { ticket: `${spec.slug}-a${++ticket}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: termsSha, credential }), received_at: now().toISOString() }, now());
      if (out.status !== "approved") throw new Error(`${spec.slug}: the test passkey's approval of ${proposalId} was ${out.status}: ${out.message}`);
    };

    // The company's own policy: its EUR reserve floor, set by the CFO with the test passkey.
    clock.tick(20);
    const policy = proposePolicyChange(db, { changes: [{ key: "eur_floor", to: spec.eurFloor }], reason: `${spec.name}: keep at least EUR ${spec.eurFloor} in the account` }, "human", now());
    await sign(policy.proposal_id, policy.terms_sha256);
    executePolicyChange(db, policy.proposal_id, now());

    const deps: InboxDeps = { dir: join(dir, "ap"), reader: parserOnly, now };
    const add = async (at: string, text: string, filename: string): Promise<ApInvoiceRow> => {
      clock.set(at);
      const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename, source: "upload" });
      if (out.kind !== "invoice") throw new Error(`${spec.slug}: ${filename} did not come in as an invoice (${out.kind})`);
      return out.invoice;
    };
    const expect = (id: string, status: string, finding?: string) => {
      const inv = apInvoice(db, id)!;
      if (inv.status !== status || (finding && !inv.findings.some((f) => f.code === finding))) {
        throw new Error(`${spec.slug}: ${inv.invoice_no} is ${inv.status} [${inv.findings.map((f) => f.code).join(", ")}], expected ${status}${finding ? ` with ${finding}` : ""}`);
      }
      return id;
    };
    /** A new supplier: its details verified by a person, then approved by the CFO with the test passkey. */
    const addSupplier = async (id: string) => {
      expect(id, "needs_vendor", "new_supplier");
      clock.tick(25);
      const req = requestPayeeAddForInvoice(db, id, "treasury", now());
      clock.tick(15);
      recordPayeeAddVerification(db, req.add_id, { by: "the CFO (test world)", how: HOW, actor: "human", address: ADDRESS }, now());
      const p = proposePayeeAdd(db, req.add_id, "treasury", now());
      await sign(p.proposal_id, p.terms_sha256);
      await executePayeeAdd(db, awx, p.proposal_id, { now, reader: parserOnly }, now());
    };
    /** Files the payment for the CFO's signature; with `approve`, signs it and pays it on the stand-in rail. */
    const pay = async (id: string, approve: boolean) => {
      expect(id, "ready");
      clock.tick(30);
      const out = await payApInvoice(db, awx, id, now());
      if (out.kind !== "proposed") throw new Error(`${spec.slug}: ${id} was not proposed: ${JSON.stringify(out).slice(0, 300)}`);
      if (!approve) return expect(id, "waiting_cfo");
      await sign(out.proposal.proposal_id, out.proposal.terms_sha256);
      clock.tick(1);
      if (out.proposal.kind === "supplier_payment") await executeSupplierPayment(db, awx, awx, out.proposal.proposal_id, now);
      else await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, now);
      clock.tick(2);
      await syncPayments(db, { now });
      return expect(id, "paid");
    };
    const inv = (s: Supplier, n: string, date: string, due: string, net: string, extra: Partial<Parameters<typeof invoiceText>[2]> = {}) => invoiceText(spec, s, { no: `${s.prefix}${n}`, date, due, net, ...extra });
    const file = (s: Supplier, n: string) => `${s.prefix}${n}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-") + ".pdf";

    // October: three invoices paid. The month is closed afterwards.
    const a1 = await add("2026-10-05T09:10:00Z", inv(spec.a, "41", "2026-10-02", "2026-10-16", spec.net.a[0]), file(spec.a, "41"));
    await addSupplier(a1.id);
    await pay(a1.id, true);
    const b1 = await add("2026-10-12T08:45:00Z", inv(spec.b, "4471", "2026-10-09", "2026-10-23", spec.net.b[0]), file(spec.b, "4471"));
    await addSupplier(b1.id);
    await pay(b1.id, true);
    const a2 = await add("2026-10-19T10:20:00Z", inv(spec.a, "44", "2026-10-16", "2026-10-30", spec.net.a[1]), file(spec.a, "44"));
    await pay(a2.id, true);
    clock.set("2026-11-02T08:30:00Z");
    syncLedger(db, now());
    closeMonth(db, CLOSED_MONTH, "the CFO (test world)", now());

    // November: one paid, one paid in a foreign currency, then the ones a person has to look at.
    const a3 = await add("2026-11-03T09:05:00Z", inv(spec.a, "47", "2026-11-02", "2026-11-16", spec.net.a[2]), file(spec.a, "47"));
    await pay(a3.id, true);
    const fx = await add("2026-11-04T13:15:00Z", spec.foreign.text({ date: "2 November 2026", due: "30 November 2026" }), spec.foreign.filename);
    await addSupplier(fx.id);
    await pay(fx.id, true);
    // The main supplier's next invoice, but with other bank details and pressure to pay: held as possible fraud.
    const forged = await add("2026-11-06T07:50:00Z", inv(spec.a, "49", "2026-11-05", "2026-11-12", spec.net.a[3], {
      bank: spec.forged,
      extra: ["IMPORTANT: our bank details have changed. Please update your records and pay", "to the new account below. Payment is urgent to avoid interruption of your deliveries."],
    }), file(spec.a, "49-bank-change"));
    expect(forged.id, "blocked", "possible_fraud");
    // The first invoice of the second supplier sent again: refused as a duplicate, never paid twice.
    const dup = await add("2026-11-09T08:10:00Z", inv(spec.b, "4471", "2026-10-09", "2026-10-23", spec.net.b[0], { extra: ["SECOND REQUEST: our records show this invoice as unpaid."] }), file(spec.b, "4471-second-request"));
    expect(dup.id, "blocked", "duplicate");
    // A credit note from the second supplier, checked with the supplier and accepted by a person.
    const credit = await add("2026-11-09T11:30:00Z", creditText(spec, spec.b, { no: `${spec.b.prefix}C-0007`, date: "2026-11-06", total: spec.net.credit, about: `${spec.b.prefix}4471` }), file(spec.b, "c-0007-credit-note"));
    if (apInvoice(db, credit.id)!.doc_kind !== "credit_note") throw new Error(`${spec.slug}: the credit note was read as ${apInvoice(db, credit.id)!.doc_kind}`);
    clock.tick(40);
    acceptCreditNote(db, credit.id, "the CFO (test world)", "test world: the credit is as printed on the invented supplier's own credit note", now());
    // A supplier the company never paid before: waits for a person to verify its bank details.
    const c1 = await add("2026-11-10T08:40:00Z", inv(spec.c, "0815", "2026-11-09", "2026-11-23", spec.net.c), file(spec.c, "0815"));
    expect(c1.id, "needs_vendor", "new_supplier");
    // The second supplier's next invoice: read, checked and filed for the CFO, who has not signed yet.
    const b2 = await add("2026-11-10T09:00:00Z", inv(spec.b, "4502", "2026-11-09", "2026-11-23", spec.net.b[1]), file(spec.b, "4502"));
    await pay(b2.id, false);

    // The books and the archive, as of the world's last moment.
    clock.set(WORLD_AS_OF);
    await syncPayments(db, { now });
    syncLedger(db, now());
    const vaultDir = join(dir, "vault");
    const sink = new LocalSink(vaultDir);
    await syncVault(db, sink, { company: spec.name, lang: "en", now: now() });

    // The engine's own checks, before anything leaves this function.
    const ledger = verifyLedger(db);
    if (!ledger.ok) throw new Error(`${spec.slug}: the ledger does not verify: ${JSON.stringify(ledger).slice(0, 300)}`);
    const audit = verifyAuditChain(db);
    if (!audit.ok) throw new Error(`${spec.slug}: the audit chain does not verify: ${JSON.stringify(audit).slice(0, 300)}`);
    const vault = await verifyVault(sink, spec.name, [2026]);
    if (vault.bad.length || vault.checked === 0) throw new Error(`${spec.slug}: the vault does not verify: ${JSON.stringify(vault).slice(0, 300)}`);

    return {
      spec, db, dir, vaultDir, as_of: WORLD_AS_OF, passkey: { credential_id: cfo.credentialId, label: TEST_PASSKEY_LABEL },
      states: { paid: a3.id, paid_closed_month: a1.id, paid_foreign_currency: fx.id, waiting_for_cfo: b2.id, held_possible_fraud: forged.id, duplicate_refused: dup.id, new_supplier: c1.id, credit_note: credit.id },
    };
  });
}

/** The vault's index for 2026, as the engine wrote it. */
export async function vaultIndex(c: BuiltCompany): Promise<YearIndex> {
  const text = await new LocalSink(c.vaultDir).readIndex(yearIndexPath(c.spec.name, 2026));
  if (!text) throw new Error(`${c.spec.slug}: the vault has no index for 2026`);
  return JSON.parse(text) as YearIndex;
}

export const invoicesOf = (c: BuiltCompany): ApInvoiceRow[] => apInvoices(c.db);
