// The test world of the Moneybird sandbox run (12 November 2026): one fictional small company whose books the ERP link
// sends. Built offline with the real engine (the payables inbox, the supplier approval, the payment proposal, the
// executor, the ledger) on stand-in rails: the in-memory Airwallex and card stand-ins of the test suite. Nothing here
// calls a network, and no real money, supplier or bank account exists in it.
//
// The four invoices are the platform test world's own (src/e2e/world.ts): the same suppliers, numbers, dates and net
// amounts. One thing differs, and the run record says so: that world has no invoice at the low Dutch VAT rate, so the
// flour supplier's invoice carries 9% here (net as in the fixture, VAT and total follow from it). The company card
// purchase is the software plan from the policy's own price list (src/config/policy.ts).
//
// Step 1 (`buildSandboxWorld`): the four invoices come in as PDFs, each supplier is verified and approved, each invoice
// gets a payment proposal, one is approved and paid, and the company card buys a software plan.
// Step 2 (`recodeSandboxInvoice`): a person moves one invoice to another expense account after it was sent to the ERP,
// which is what makes the ERP link send a credit note and the new version. The product has no screen for that change
// yet, so the test world makes it in the ledger directly and writes it to the audit log.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ingestDocument, type InboxDeps } from "../ap/inbox.js";
import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import { payApInvoice, syncPayments } from "../ap/pay.js";
import { apInvoice, apInvoices } from "../ap/store.js";
import { checkThenProposePayeeAdd, executePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../ap/vendors.js";
import { audit } from "../audit/log.js";
import { CHART } from "../config/gl.js";
import { PLANS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { pdfOf } from "../e2e/documents.js";
import { parserOnly } from "../e2e/setup.js";
import { WORLD } from "../e2e/world.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { executeSupplierPayment } from "../executors/supplierPayment.js";
import { syncLedger } from "../ledger/feed.js";
import { decide } from "../policy/approvals.js";
import { ingestCardTransaction, setupCards } from "../policy/cards.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import { FakePayeeNames } from "../airwallex/payeeName.js";
import { FakeIssuing } from "../redteam/issuing.js";

/** The fixture company the test world is: the platform test world's bakery. */
export const SANDBOX_COMPANY = WORLD.find((c) => c.key === "BAKKERIJ")!.name;
/** The invoice that is paid in step 1, and the one a person recodes in step 2 (their numbers in the fixtures). */
export const PAID_INVOICE = "VE-889";
export const RECODED_INVOICE = "OD-77";
/** The fixture invoice that carries the low VAT rate here. */
export const LOW_VAT_INVOICE = "MM-2026-114";
/** The expense account the recoded invoice moves to: transport, for a supplier of bicycle parts. */
export const RECODED_TO = "6300";
const CARD_PLAN = PLANS["packwise-starter"]!;

/** The fixture invoice texts, with the one change this world makes: 9% VAT on the flour supplier's invoice. */
export function sandboxInvoices(): { filename: string; text: string; changed: string | null }[] {
  return WORLD.flatMap((c) => c.invoices).map((inv) => {
    if (!inv.filename.startsWith(LOW_VAT_INVOICE)) return { filename: inv.filename, text: inv.text, changed: null };
    const text = inv.text.replace("BTW 21% € 0,63", "BTW 9% € 0,27").replace("Totaal te betalen € 3,63", "Totaal te betalen € 3,27");
    if (text === inv.text || !text.includes("BTW 9% € 0,27") || !text.includes("€ 3,27")) throw new Error(`${inv.filename}: the fixture changed; the 9% variant no longer applies`);
    return { filename: inv.filename, text, changed: "VAT 21% (EUR 0.63, total 3.63) in the fixture; 9% (EUR 0.27, total 3.27) here, net EUR 3.00 unchanged" };
  });
}

/** What the test world writes to; all of it must be empty before it is built. */
const WORLD_TABLES = ["beneficiaries", "invoices", "proposals", "transfers", "ap_documents", "cards", "card_transactions"] as const;

export interface SandboxWorldSummary {
  company: string;
  invoices: { id: string; ledgerId: string; supplier: string; number: string; net: string; vat: string; total: string; status: string; account: string; changed: string | null }[];
  paid: { invoice: string; transfer: string; amount: string };
  card: { transaction: string; merchant: string; amount: string; account: string };
}

/**
 * Step 1. `db` is the test world's own ledger (a new file); `dir` is where the inbox keeps the PDFs. Runs on the real
 * clock: the executor checks an approval's terms against it.
 */
export async function buildSandboxWorld(db: DB, dir: string, now = new Date()): Promise<SandboxWorldSummary> {
  if (apInvoices(db).length) throw new Error("this ledger already holds invoices: the test world is built in a new one");
  // Test suppliers, approvals and a stand-in payout never go into a ledger that holds anything else.
  const held = WORLD_TABLES.filter((t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n > 0);
  if (held.length) throw new Error(`this ledger already holds data (${held.join(", ")}): the test world is built in a new one`);
  mkdirSync(dir, { recursive: true });
  const awx = new FakeAirwallex();
  // The test world's fictional suppliers have no bank to ask: a labelled stand-in answers the payee check.
  const standInBank = Object.assign(new FakePayeeNames(), { confirmAll: true });
  // Stand-in test money on the stand-in bank account: enough for the one payout and its stand-in fee.
  awx.bal.EUR.availableCents = 100_000;
  const deps: InboxDeps = { dir: join(dir, "ap"), reader: parserOnly, now: () => now };
  const approve = (proposalId: string) => {
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string };
    decide(db, { proposalId, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  };

  const sources = sandboxInvoices();
  const ids: string[] = [];
  for (const inv of sources) {
    const got = await ingestDocument(db, deps, { bytes: await pdfOf(inv.text), filename: inv.filename, source: "upload" });
    if (got.kind !== "invoice") throw new Error(`${inv.filename} did not come in as an invoice (${got.kind})`);
    const id = got.invoice.id;
    ids.push(id);
    if (apInvoice(db, id)!.status === "needs_vendor") {
      const req = requestPayeeAddForInvoice(db, id, "treasury", now);
      recordPayeeAddVerification(db, req.add_id, { by: "the CFO (test world)", how: "test world: the fictional supplier's bank details as on its own invoice; no real supplier exists to call", actor: "human", address: { street: "Teststraat 2", city: "Amsterdam", postcode: "1011 AB" } }, now);
      const p = await checkThenProposePayeeAdd(db, standInBank, req.add_id, "treasury", now);
      approve(p.proposal_id);
      await executePayeeAdd(db, awx, p.proposal_id, { now: () => now }, now);
    }
    if (apInvoice(db, id)!.status !== "ready") throw new Error(`${inv.filename} is ${apInvoice(db, id)!.status} after its supplier was approved, not ready`);
  }

  // A payment proposal for each invoice; the CFO approves one, and it is paid on the stand-in rail.
  for (const id of ids) {
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(`${id} was not proposed for payment: ${JSON.stringify(out).slice(0, 300)}`);
    if (apInvoice(db, id)!.invoice_no !== PAID_INVOICE) continue;
    approve(out.proposal.proposal_id);
    if (out.proposal.kind === "invoice_payment") await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    else await executeSupplierPayment(db, awx, awx, out.proposal.proposal_id, () => now);
  }
  await syncPayments(db, { now: () => now });
  const t = db.prepare("SELECT invoice_no, transfer_id, amount, currency, status FROM transfers").all() as { invoice_no: string; transfer_id: string | null; amount: string; currency: string; status: string }[];
  if (t.length !== 1 || t[0]!.status !== "PAID" || !t[0]!.transfer_id) throw new Error(`expected one PAID payout, found ${JSON.stringify(t)}`);
  const paid = { invoice: t[0]!.invoice_no, transfer: t[0]!.transfer_id, amount: `${t[0]!.currency} ${t[0]!.amount}` };

  // The company card buys a software plan (the stand-in card rail authorises it).
  const issuing = new FakeIssuing();
  issuing.clock = () => now.getTime();
  const [card] = await setupCards(db, issuing, now, { agents: [CARD_PLAN.agent] });
  const tx = await issuing.simulateCardCharge({ cardId: card!.card_id, amountCents: CARD_PLAN.amountCents, currency: "EUR", merchant: CARD_PLAN.merchant, mcc: CARD_PLAN.mcc });
  if (!tx.approved) throw new Error(`the stand-in card declined the software plan: ${tx.failureReason ?? "no reason"}`);
  ingestCardTransaction(db, tx, "simulation", now, `${CARD_PLAN.merchant}: ${CARD_PLAN.label}`);

  syncLedger(db, now);
  return {
    company: SANDBOX_COMPANY,
    invoices: ids.map((id, i) => {
      const a = apInvoice(db, id)!;
      return { id, ledgerId: ledgerInvoiceNo(a.invoice_no, a.vendor), supplier: a.vendor, number: a.invoice_no, net: a.subtotal, vat: a.tax, total: a.total, status: a.status, account: a.gl_account, changed: sources[i]!.changed };
    }),
    paid,
    card: { transaction: tx.transactionId, merchant: tx.merchant, amount: `EUR ${(CARD_PLAN.amountCents / 100).toFixed(2)}`, account: "6100" },
  };
}

/**
 * Step 2. A person moves the invoice to another expense account. Returns the invoice's id in the ledger, the one the
 * ERP link knows it by (`npm run erp -- correct --object invoice:<that id>`).
 */
export function recodeSandboxInvoice(db: DB, number = RECODED_INVOICE, account = RECODED_TO, now = new Date()): { ledgerId: string; from: string; to: string } {
  if (!CHART[account]) throw new Error(`${account} is not an account on Purser's chart`);
  // Only in the test world's own ledger: its inbox holds the four fixture invoices and nothing else.
  const fixture = sandboxInvoices().map((i) => i.filename.replace(/\.pdf$/, "")).sort();
  if (JSON.stringify(apInvoices(db).map((x) => x.invoice_no).sort()) !== JSON.stringify(fixture)) throw new Error("this is not the test world's ledger (its inbox does not hold exactly the four fixture invoices): nothing was changed");
  const a = apInvoices(db).find((x) => x.invoice_no === number);
  if (!a) throw new Error(`no invoice ${number} in this ledger`);
  if (a.gl_account === account) throw new Error(`invoice ${number} is already on ${account}`);
  db.prepare("UPDATE ap_invoices SET gl_account = ?, gl_rule = ?, updated_at = ? WHERE id = ?").run(account, "moved by a person (test world)", now.toISOString(), a.id);
  audit(db, "human", "ap.account_changed", a.id, { invoice_no: a.invoice_no, vendor: a.vendor, from: a.gl_account, to: account, by: "the bookkeeper (test world)", how: "set in the ledger by the test world: the product has no screen for this change yet" }, now);
  syncLedger(db, now);
  return { ledgerId: ledgerInvoiceNo(a.invoice_no, a.vendor), from: a.gl_account, to: account };
}
