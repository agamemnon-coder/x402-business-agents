// npm run cloud:guest-seed: writes cloud/src/guest/seed.gen.ts, the demo company a guest opens in Purser Cloud
// ("Try as guest"). It is made here by the runner's own code on stand-ins, with no network and no model: a company's
// agents with their Airwallex cards (charges approved and declined by the issuing stand-in), the CFO's approvals with a
// labelled virtual test passkey, supplier invoices read by code's own parser and paid on the Airwallex stand-in, the
// ledger booked by the ledger feed. Then the same batches the runner would push to a cloud (src/cloudsync/client.ts
// batchesFor). The Worker reads no files, so they are written as a module. Demo data: no real money, no real company.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestDocument, type InboxDeps } from "../../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../../src/ap/pay.js";
import type { Asker } from "../../src/ap/read.js";
import { apInvoice } from "../../src/ap/store.js";
import { matchReceipt, openReceivable } from "../../src/agents/receivables.js";
import { FakePayeeNames } from "../../src/airwallex/payeeName.js";
import { checkThenProposePayeeAdd, executePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../../src/ap/vendors.js";
import { runAwx1 } from "../../src/awx/scenario.js";
import { approveWithVirtualPasskey, executeOnStandIns, standInDeps } from "../../src/awx/standIn.js";
import { batchesFor } from "../../src/cloudsync/client.js";
import { PLANS } from "../../src/config/policy.js";
import { openDb } from "../../src/db/open.js";
import { setSetting } from "../../src/world/settings.js";
import { pdfOf } from "../../src/e2e/documents.js";
import { executeSupplierPayment } from "../../src/executors/supplierPayment.js";
import { syncLedger } from "../../src/ledger/feed.js";
import { pollCardTransactions } from "../../src/policy/cards.js";

/** The day the demo's story ends (its newest activity); everything is dated in the five weeks before it. */
export const DEMO_END = process.env.GUEST_SEED_END ?? "2026-11-12T16:00:00Z";
const DAY = 86_400_000;
const end = Date.parse(DEMO_END);
let t = end - 34 * DAY;
// The world runs on the demo's own clock, everywhere: code that reads the time without being given it (an approval's
// expiry, a card's end date) reads this one, so the five weeks hold together as if they had happened.
const RealDate = Date;
class DemoDate extends RealDate {
  constructor(...a: unknown[]) { if (a.length === 0) super(t); else super(...(a as [string | number])); }
  static override now() { return t; }
}
globalThis.Date = DemoDate as DateConstructor;
const now = () => new Date((t += 1000));
const at = (daysBeforeEnd: number, hour = 10) => { t = Math.max(t, end - daysBeforeEnd * DAY + (hour - 16) * 3_600_000); };

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "demo company: code's own parser" }) } as Asker;
const db = openDb(":memory:");
const w = await standInDeps(db, { client: null, now });
let counter = 0;
const approve = async (proposalId: string) => { await approveWithVirtualPasskey(db, w.auth, proposalId, now(), ++counter); };
// The scenario's own steps approve through the same counter (a passkey's counter only rises).
const deps = { ...w.deps, approve: async (id: string) => { await approve(id); await executeOnStandIns(db, w.issuing, w.awx, id, now); } };

// The story, in date order (days before DEMO_END). Every step is the runner's own code on the stand-ins.
const cardOf = (agent: string) => (db.prepare("SELECT card_id FROM cards WHERE agent = ?").get(agent) as { card_id: string }).card_id;
/** An agent's own purchase on its card: the issuing stand-in approves or declines it by the card's limits and categories. */
async function charge(plan: keyof typeof PLANS) {
  const p = PLANS[plan]!;
  const c = await w.issuing.simulateCardCharge({ cardId: cardOf(p.agent), amountCents: p.amountCents, currency: "EUR", merchant: p.merchant, mcc: p.mcc });
  await deps.awaitWebhooks({ cardTransactions: [c.transactionId] });
}
/** Money in: a retailer pays the company's own invoice into its EUR Global Account; the receivables agent matches it by
 *  the reference (src/agents/receivables.ts). The stand-in's EUR balance rises by the same amount, as Airwallex's would. */
const bal = (w.awx as unknown as { bal: Record<string, { availableCents: number }> }).bal;
let depositN = 0;
function received(r: { invoice_no: string; customer: string; cents: number }) {
  bal.EUR!.availableCents += r.cents;
  matchReceipt(db, { deposit_id: `dep_demo_${++depositN}`, global_account_id: "ga_eur_demo", currency: "EUR", amount_cents: r.cents, reference: `Invoice ${r.invoice_no}`, payer: r.customer, received_at: now().toISOString() }, now());
}
const SALES = [
  [30, "NW-2026-101", "Summit Outfitters", 284_000], [25, "NW-2026-104", "Alpine Sports Retail", 196_500], [21, "NW-2026-107", "Fjord Outdoor AS", 312_040],
  [16, "NW-2026-110", "Summit Outfitters", 227_500], [11, "NW-2026-113", "Alpine Sports Retail", 158_900], [7, "NW-2026-116", "Fjord Outdoor AS", 241_380],
  [3, "NW-2026-119", "Summit Outfitters", 198_750],
] as const;

const dir = mkdtempSync(join(tmpdir(), "guest-seed-"));
const inbox: InboxDeps = { dir, reader: parserOnly, now };
// The demo's fictional suppliers have no bank to ask: a labelled stand-in answers the payee check.
const standInBank = Object.assign(new FakePayeeNames(), { confirmAll: true });
const HOW = "called the supplier's accounts team on the number in the signed purchase contract; they confirmed the account";
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
async function file(text: string, name: string) {
  const out = await ingestDocument(db, inbox, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(`${name}: ${out.kind}`);
  return out.invoice.id;
}
async function addSupplier(id: string) {
  if (apInvoice(db, id)!.status !== "needs_vendor") return;
  const req = requestPayeeAddForInvoice(db, id, "treasury", now());
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now());
  const p = await checkThenProposePayeeAdd(db, standInBank, req.add_id, "treasury", now());
  await approve(p.proposal_id);
  await executePayeeAdd(db, w.awx, p.proposal_id, { now, reader: parserOnly }, now());
}
async function pay(id: string, approveIt = true) {
  const out = await payApInvoice(db, w.awx, id, now());
  if (out.kind !== "proposed") throw new Error(out.reason);
  if (!approveIt) return;
  await approve(out.proposal.proposal_id);
  if (out.proposal.kind === "supplier_payment") await executeSupplierPayment(db, w.awx, w.awx, out.proposal.proposal_id);
  else await executeOnStandIns(db, w.issuing, w.awx, out.proposal.proposal_id, now);
  await syncPayments(db, { now });
}
const inv = (o: { name: string; vat: string; no: string; date: string; due: string; net: string; vatPct: number; vatAmt: string; total: string; iban: string; bic: string }) =>
  `${o.name}\nVAT ID: ${o.vat}\nINVOICE ${o.no}\nInvoice date: ${o.date}\nDue date: ${o.due}\nSubtotal EUR ${o.net}\nVAT ${o.vatPct}% EUR ${o.vatAmt}\nTotal due EUR ${o.total}\nIBAN: ${o.iban}\nBIC: ${o.bic}\nPayment reference: ${o.no}`;
const BERGTEX = { name: "Bergtex Textil GmbH", vat: "DE123456789", iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX" };
const LAGER = { name: "Lagerhaus Nord GmbH", vat: "DE987654321", iban: "DE75 5121 0800 1245 1261 99", bic: "BYLADEM1001" };
const ZEELAND = { name: "Zeeland Verpakkingen B.V.", vat: "NL123456789B01", iban: "NL91 ABNA 0417 1643 00", bic: "ABNANL2A" };

let b1 = "", l1 = "", b2 = "", l2 = "", b3 = "";
const STORY: [number, number, () => Promise<unknown>][] = [
  // The agents' cards, one per agent with the CFO's policy as limits (awx-1's step a), and the sales invoices issued.
  [34, 9, async () => {
    await runAwx1(deps, { to: "a" });
    for (const [d, no, customer, cents] of SALES) openReceivable(db, { invoice_no: no, customer, currency: "EUR", amount_cents: cents, due_date: new Date(end - (d - 3) * DAY).toISOString().slice(0, 10) }, now());
  }],
  ...SALES.map(([d, no, customer, cents]) => [d, 9, async () => received({ invoice_no: no, customer, cents })] as [number, number, () => Promise<unknown>]),
  // The agents' own small purchases, and the issuing stand-in's declines: over the limit, a category the card may not pay.
  ...([[33, "packwise-starter"], [31, "ledgerly-starter"], [28, "packwise-pro"], [26, "packwise-on-support-card"], [24, "replyhub-starter"], [19, "ledgerly-starter"], [12, "packwise-starter"], [9, "replyhub-starter"], [5, "ledgerly-starter"]] as const)
    .map(([d, plan]) => [d, 11, () => charge(plan)] as [number, number, () => Promise<unknown>]),
  // The Treasury agent's invoice payouts, planned from the invoices, approved by the CFO (awx-1's f1 and f2).
  [22, 10, async () => { await runAwx1(deps, { from: "f1", to: "f1" }); setSetting(db, "human", "eur_obligations", "0.00"); }],
  [15, 10, () => runAwx1(deps, { from: "f2", to: "f2" })],
  // Supplier invoices into the payables inbox: read, checked, a new supplier verified and added, paid after the CFO's
  // approval; one waits for the CFO now, one waits for a new supplier, one is a duplicate the check stopped.
  [20, 14, async () => { b1 = await file(inv({ ...BERGTEX, no: "BTX-2026-18", date: "20 October 2026", due: "3 November 2026", net: "840.34", vatPct: 19, vatAmt: "159.66", total: "1,000.00" }), "bergtex-18.pdf"); await addSupplier(b1); }],
  [19, 15, () => pay(b1)],
  [14, 14, async () => { l1 = await file(inv({ ...LAGER, no: "LN-2026-0790", date: "27 October 2026", due: "10 November 2026", net: "1,000.00", vatPct: 19, vatAmt: "190.00", total: "1,190.00" }), "lagerhaus-0790.pdf"); await addSupplier(l1); }],
  [13, 15, () => pay(l1)],
  [9, 14, async () => { b2 = await file(inv({ ...BERGTEX, no: "BTX-2026-20", date: "2 November 2026", due: "16 November 2026", net: "1,554.62", vatPct: 19, vatAmt: "295.38", total: "1,850.00" }), "bergtex-20.pdf"); }],
  [8, 15, () => pay(b2)],
  [6, 14, async () => { l2 = await file(inv({ ...LAGER, no: "LN-2026-0815", date: "4 November 2026", due: "18 November 2026", net: "520.00", vatPct: 19, vatAmt: "98.80", total: "618.80" }), "lagerhaus-0815.pdf"); }],
  [5, 15, () => pay(l2)],
  [3, 14, async () => { b3 = await file(inv({ ...BERGTEX, no: "BTX-2026-24", date: "9 November 2026", due: "23 November 2026", net: "1,100.00", vatPct: 19, vatAmt: "209.00", total: "1,309.00" }), "bergtex-24.pdf"); }],
  [2, 10, () => pay(b3, false)], // waits for the CFO's Face ID
  [2, 13, () => file(inv({ ...ZEELAND, no: "ZV-4471", date: "3 November 2026", due: "17 November 2026", net: "400.00", vatPct: 21, vatAmt: "84.00", total: "484.00" }), "zeeland-4471.pdf")], // a new supplier: waits
  [1, 11, async () => { try { await file(inv({ ...BERGTEX, no: "BTX-2026-20", date: "2 November 2026", due: "16 November 2026", net: "1,554.62", vatPct: 19, vatAmt: "295.38", total: "1,850.00" }), "bergtex-20-again.pdf"); } catch { /* the duplicate is stopped */ } }],
];
// The ledger feed books after each step, as a runner does through the day, so the journal reads in date order (jury,
// 13 Nov: a receipt booked after its payment).
for (const [d, h, step] of STORY.slice().sort((x, y) => y[0] - x[0] || x[1] - y[1])) { at(d, h); await step(); syncLedger(db, now()); }

// 5. One closing poll of the cards, the ledger feed books what moved, and the batches a runner would push.
at(0, 15); await pollCardTransactions(db, w.issuing, now());
syncLedger(db, now());
const batches = batchesFor(db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] }, { now: now() });
const json = JSON.stringify(batches);
writeFileSync(new URL("../src/guest/seed.gen.ts", import.meta.url), `// Generated by npm run cloud:guest-seed (cloud/scripts/guestSeed.ts): the demo company a guest opens. Do not edit.\n// Demo data, made on stand-ins by the runner's own code: no real money, no real company.\nexport const DEMO_END = ${JSON.stringify(DEMO_END)};\nexport const SEED_BATCHES: Record<string, unknown>[] = ${json};\n`);
console.log(`batches ${batches.length}, ${Math.round(json.length / 1024)} KB`);
