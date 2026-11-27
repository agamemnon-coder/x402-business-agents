// Red team (runner, 27 Nov, finding 1): one supplier's bill cut into parts under the CFO's limit to pay alone, each part's
// printed issue date 30 days from the next, all received the same day. The split check measured its window on the dates the
// supplier prints, so no part was ever added to another, and approveWithinLimit had no total per payee: every part was paid
// alone. Now the split check measures on when Purser received each invoice (printed periods do not exempt a part), and
// approveWithinLimit refuses when this payment and what was approved alone to the same payee within the split window (on
// Purser's own clock) pass the limit. Breaks if a bill split by its printed dates is paid alone past the limit again, or if
// one supplier's monthly invoices received in different months stop being paid alone. Test money only, no network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import { apInvoice } from "../src/ap/store.js";
import { checkThenProposePayeeAdd, executePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { approveWithinLimit, createProposal, decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { setSetting } from "../src/world/settings.js";
import { pdfOf } from "./fakes/pdf.js";
import { standInBank } from "./support/standInBank.js";
import { parserOnly } from "./support/supplierWorld.js";

const inv = (no: string, date: string, total: string, net: string, vat: string, extra = "") => `Zeeland Verpakkingen B.V.
BTW-nummer: NL123456789B01
Factuur
Factuurnummer: ${no}
Factuurdatum: ${date}
Vervaldatum: 15-12-2026${extra}
Subtotaal € ${net}
BTW 21% € ${vat}
Totaal te betalen € ${total}
IBAN: NL91 ABNA 0417 1643 00
BIC: ABNANL2A
Betalingskenmerk: ${no}`;

/** Zeeland on file as a verified supplier (its first invoice is used for that), and a EUR 500.00 limit to pay alone. */
async function zeeland(now: Date, firstDate: string) {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  let clock = now;
  const deps: InboxDeps = { dir: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "split-")), reader: parserOnly, now: () => clock };
  const approveCli = (id: string) => {
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, clock);
  };
  const first = await ingestDocument(db, deps, { bytes: await pdfOf(inv("ZV-5000", firstDate, "484,00", "400,00", "84,00")), filename: "zv-5000.pdf", source: "upload" });
  if (first.kind !== "invoice") throw new Error(first.kind);
  const req = requestPayeeAddForInvoice(db, first.invoice.id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: "called the supplier on the number in our contract", actor: "human", address: { street: "1 Supplier Street", city: "Middelburg", postcode: "4331" } }, now);
  const add = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
  approveCli(add.proposal_id);
  await executePayeeAdd(db, awx, add.proposal_id, { now: () => now, reader: parserOnly }, now);
  setSystemDefaultAloneLimit(db, "500.00", now);
  const ingest = async (no: string, date: string, total: string, net: string, vat: string, extra = "") => {
    const d = await ingestDocument(db, deps, { bytes: await pdfOf(inv(no, date, total, net, vat, extra)), filename: `${no}.pdf`, source: "upload" });
    if (d.kind !== "invoice") throw new Error(d.kind);
    return d.invoice.id;
  };
  /** Pays one invoice through the inbox as the agent would: alone when code approves it, else left for the CFO. */
  const pay = async (id: string): Promise<"alone" | "cfo" | string> => {
    const i = apInvoice(db, id)!;
    if (i.status !== "ready") return `${i.status}: ${i.findings.map((f) => f.code).join(",")}`;
    const out = await payApInvoice(db, awx, id, clock);
    if (out.kind !== "proposed") return `not planned: ${out.reason}`;
    if (!out.alone) return "cfo";
    await executeSupplierPayment(db, awx, awx, out.proposal.proposal_id, () => clock);
    return "alone";
  };
  return { db, firstId: first.invoice.id, ingest, pay, setClock: (d: Date) => { clock = d; } };
}

describe("a bill split into parts under the limit, with backdated printed dates (runner finding 1)", () => {
  it("pays the first part alone and leaves the rest to the CFO, though their printed dates are 30 days apart", async () => {
    const now = new Date("2026-11-27T10:00:00Z");
    const w = await zeeland(now, "01-08-2026");
    const parts = [w.firstId,
      await w.ingest("ZV-5001", "31-08-2026", "476,00", "393,39", "82,61"),
      await w.ingest("ZV-5002", "30-09-2026", "480,00", "396,69", "83,31"),
      await w.ingest("ZV-5003", "30-10-2026", "472,00", "390,08", "81,92")];
    // Received the same day: the split check adds them up on Purser's clock, whatever dates they print.
    for (const id of parts.slice(1)) expect(apInvoice(w.db, id)!.findings.map((f) => f.code)).toContain("possible_split");
    const out: string[] = [];
    for (const id of parts) out.push(await w.pay(id));
    expect(out[0]).toBe("alone");
    expect(out.filter((x) => x === "alone")).toHaveLength(1);
  });

  it("does not exempt parts that print different service months", async () => {
    const now = new Date("2026-11-27T10:00:00Z");
    const w = await zeeland(now, "01-11-2026");
    const a = await w.ingest("ZV-5101", "05-11-2026", "476,00", "393,39", "82,61", "\nLeistungszeitraum: August 2026");
    const b = await w.ingest("ZV-5102", "06-11-2026", "480,00", "396,69", "83,31", "\nLeistungszeitraum: September 2026");
    const split = apInvoice(w.db, b)!.findings.find((f) => f.code === "possible_split");
    expect(split?.detail).toContain(a);
  });

  it("keeps a supplier's monthly invoices, received in different months, paid alone", async () => {
    const w = await zeeland(new Date("2026-08-03T10:00:00Z"), "01-08-2026");
    expect(await w.pay(w.firstId)).toBe("alone");
    w.setClock(new Date("2026-09-02T10:00:00Z"));
    const sep = await w.ingest("ZV-5201", "01-09-2026", "363,00", "300,00", "63,00", "\nLeistungszeitraum: September 2026");
    expect(apInvoice(w.db, sep)!.findings.map((f) => f.code)).not.toContain("possible_split");
    expect(await w.pay(sep)).toBe("alone");
    w.setClock(new Date("2026-10-02T10:00:00Z"));
    const oct = await w.ingest("ZV-5202", "01-10-2026", "242,00", "200,00", "42,00", "\nLeistungszeitraum: Oktober 2026");
    expect(await w.pay(oct)).toBe("alone");
  });
});

describe("approveWithinLimit adds up what was approved alone to one payee (runner finding 1)", () => {
  const NOW = new Date("2026-11-27T10:00:00Z");
  const world = () => { const db = openDb(":memory:"); setSystemDefaultAloneLimit(db, "500.00", NOW); return db; };
  const file = (db: DB, id: string, amount: string, beneficiary_id: string, at: Date) =>
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: new Date(at.getTime() + 3_600_000).toISOString(), amount, currency: "EUR", vendor: "Zeeland Verpakkingen B.V.", beneficiary_id } as Terms, createdBy: "treasury" }, at);
  const approve = (db: DB, id: string, at: Date) => approveWithinLimit(db, { proposalId: id, limit: { currency: "EUR", amount: "500.00" }, rule: "within the EUR 500.00 limit", agent: "payer", invoice: { issueDate: "2026-08-01" } }, at);
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

  it("refuses alone-approval when this payment and the payee's alone approvals within the window pass the limit", () => {
    const db = world();
    file(db, "P-0001", "300.00", "ben_z", NOW);
    expect(approve(db, "P-0001", NOW)).toEqual({ ok: true });
    file(db, "P-0002", "250.00", "ben_z", day(1));
    const r = approve(db, "P-0002", day(1));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toMatch(/approved alone .* within 27 days/);
    // Another payee is its own total.
    file(db, "P-0003", "250.00", "ben_other", day(1));
    expect(approve(db, "P-0003", day(1))).toEqual({ ok: true });
  });

  it("counts on Purser's clock: past the window the payee starts again, and the company's own window is used", () => {
    const db = world();
    file(db, "P-0001", "300.00", "ben_z", NOW);
    expect(approve(db, "P-0001", NOW)).toEqual({ ok: true });
    file(db, "P-0002", "250.00", "ben_z", day(28));
    expect(approve(db, "P-0002", day(28))).toEqual({ ok: true });
    setSetting(db, "human", "ap.split_days", "40");
    file(db, "P-0003", "260.00", "ben_z", day(60));
    expect(approve(db, "P-0003", day(60)).ok).toBe(false);
  });
});
