// The autopilot (src/ap/autopilot.ts) on stand-in rails (FakeAirwallex), a scripted Claude and a stand-in for the outside
// books; no network. A batch of twelve mixed documents goes from a folder to its end state with no manual command,
// the test acting only as the people do (a person checks a new supplier's account, the CFO approves). A stop between
// any two steps changes nothing in the end; two processes never run one step twice; nothing above the limit runs
// without the CFO's approval of the exact terms.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { autopilotPass, drain, LEASE_MS, parkedItems, retryItem, takeLease, withinAloneLimit, type AloneGate, type AutopilotDeps } from "../src/ap/autopilot.js";
import { CsvFileSink, type BookkeepingSink } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoices } from "../src/ap/store.js";
import { executePayeeAdd, recordPayeeAddVerification } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import type { ErpConnector } from "../src/erp/connector.js";
import { approvalOrigin } from "../src/executors/index.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { verifyLedger } from "../src/ledger/core.js";
import { decide, resuming } from "../src/policy/approvals.js";
import { chaos } from "../src/policy/saga.js";
import { originsCheck } from "../src/provenance/check.js";
import { withOrigin } from "../src/provenance/origin.js";
import { LocalSink } from "../src/vault/sink.js";
import { setSetting } from "../src/world/settings.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { scriptedCoder } from "./fakes/coderClient.js";
import { US } from "./fakes/fxInvoices.js";
import { pdfOf, scanPdf } from "./fakes/pdf.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };

// The batch. Bergtex and Stockline are suppliers on file (seedTreasury); the others are new.
const LARGE = EN; // Bergtex BTX-2026-21, EUR 1,850.00
const SMALL = EN.replaceAll("BTX-2026-21", "BTX-2026-31").replace("Subtotal EUR 1,554.62", "Subtotal EUR 336.13").replace("VAT 19% EUR 295.38", "VAT 19% EUR 63.87").replace("Total due EUR 1,850.00", "Total due EUR 400.00");
const SAME_NUMBER = `${EN}\nThank you for your order.`;
const SUM_WRONG = EN.replaceAll("BTX-2026-21", "BTX-2026-51").replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00");
const CREDIT = `Bergtex Textil GmbH
Textilweg 4, 72760 Reutlingen
VAT ID: DE123456789
CREDIT NOTE CN-2026-07
Date: 5 November 2026
Credit for returned jackets
Total EUR -150.00
IBAN: DE89 3704 0044 0532 0130 00
BIC: COBADEFFXXX`;

async function batch(folder: string): Promise<void> {
  const put = async (name: string, text: string) => writeFileSync(join(folder, name), await pdfOf(text));
  await put("01-large.pdf", LARGE);
  await put("02-small.pdf", SMALL);
  await put("03-stockline.pdf", fixture("stockline-licence-SLL-2026-11.txt"));
  await put("04-bank-change.pdf", fixture("bergtex-invoice-BTX-2027-01-BANKCHANGE.txt"));
  copyFileSync(join(folder, "01-large.pdf"), join(folder, "05-copy-of-large.pdf"));
  await put("06-same-number.pdf", SAME_NUMBER);
  await put("07-sum-wrong.pdf", SUM_WRONG);
  await put("08-credit-note.pdf", CREDIT);
  writeFileSync(join(folder, "09-scan.pdf"), await scanPdf());
  await put("10-new-de.pdf", DE);
  await put("11-new-us.pdf", US);
  await put("12-new-nl.pdf", NL);
}

const roots: string[] = [];
afterEach(() => {
  chaos.at = null;
  resuming.clear();
  delete process.env.KIT11_AP_AGENTS;
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A stand-in for the outside books: it keeps what it was sent and finds an object it already holds by its id. */
function standInBooks(): ErpConnector & { objects: Map<string, number> } {
  const objects = new Map<string, number>();
  const put = (key: string) => { objects.set(key, (objects.get(key) ?? 0) + 1); return `ext-${key}`; };
  return {
    name: "exact", objects,
    pullChartOfAccounts: async () => [], pullVendors: async () => [],
    findExisting: async (kind, o) => (objects.has(`${kind}:${o.id}`) ? `ext-${kind}:${o.id}` : null),
    pushVendor: async (v) => put(`vendor:${v.id}`),
    pushPurchaseInvoice: async (i) => put(`invoice:${i.id}`),
    pushCreditNote: async (o) => put(`credit:${o.id}`),
    pushPayment: async (p) => put(`payment:${p.id}`),
    pushJournalEntry: async (j) => put(`journal:${j.id}`),
    pullPaymentStatus: async () => "unknown",
  };
}

interface World { db: DB; awx: FakeAirwallex; root: string; folder: string; dbPath: string; deps: AutopilotDeps; erp: ReturnType<typeof standInBooks> }

/** The executors as the runner calls them (src/executors/index.ts), on the stand-in rails, under the approval's origin. */
const executeOn = (awx: FakeAirwallex, inbox: InboxDeps) => async (db: DB, id: string) => {
  const { kind } = db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(id) as { kind: string };
  const run = async () => {
    if (kind === "invoice_payment") await executeInvoicePayment(db, awx, awx, id);
    else if (kind === "supplier_payment") await executeSupplierPayment(db, awx, awx, id);
    else if (kind === "payee_add") await executePayeeAdd(db, awx, id, { now: inbox.now, ...(inbox.sink ? { sink: inbox.sink } : {}), reader: inbox.reader });
    else throw new Error(`no executor for ${kind} in this test`);
  };
  const origin = approvalOrigin(db, id);
  await (origin ? withOrigin(origin, run) : run());
};

async function world(o: { gate?: AloneGate; coder?: boolean; file?: boolean; now?: () => Date; sink?: BookkeepingSink } = {}): Promise<World> {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "autopilot-"));
  roots.push(root);
  const dbPath = join(root, "ledger.sqlite");
  const db = openDb(o.file ? dbPath : ":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  const folder = join(root, "inbox");
  mkdirSync(folder);
  const now = o.now ?? (() => new Date());
  if (o.coder) process.env.KIT11_AP_AGENTS = "on";
  const inbox: InboxDeps = { dir: join(root, "ap"), reader: parserOnly, sink: o.sink ?? new CsvFileSink(join(root, "ap", "journal.csv")), now, ...(o.coder ? { coder: scriptedCoder([]) } : {}) };
  const erp = standInBooks();
  const deps: AutopilotDeps = {
    inbox, folders: [folder], rail: awx, execute: executeOn(awx, inbox), vault: new LocalSink(join(root, "vault")), company: "Northwind Outdoor", erp,
    gate: o.gate ?? null, now, owner: { id: "autopilot-1", pid: 1, host: "test-host" }, alive: () => true, orphanGraceMs: 0,
  };
  return { db, awx, root, folder, dbPath, deps, erp };
}

/** A person checks each new supplier's account with the supplier (or only those named). */
function personChecksSuppliers(db: DB, only?: string[]): void {
  const open = db.prepare("SELECT add_id, vendor FROM payee_adds WHERE status = 'REQUESTED' ORDER BY add_id").all() as { add_id: string; vendor: string }[];
  for (const a of open.filter((x) => !only || only.includes(x.vendor))) recordPayeeAddVerification(db, a.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS });
}

/** The CFO approves every proposal waiting (in the runner a passkey; here the typed prefix, as the payables tests do). */
function cfoApproves(db: DB): string[] {
  const waiting = db.prepare("SELECT proposal_id, terms_sha256 FROM proposals WHERE status = 'PENDING_APPROVAL' ORDER BY proposal_id").all() as { proposal_id: string; terms_sha256: string }[];
  for (const p of waiting) decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" });
  return waiting.map((p) => p.proposal_id);
}

/** A stand-in gate (test only): its limit, and an approval of exactly the proposal's stored terms. */
const standInGate = (amount: string, currency = "EUR"): AloneGate => ({
  name: "a stand-in gate (test)",
  limit: () => ({ currency, amount }),
  approve: (db, id, now) => {
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "stand-in gate (test)", method: "cli" }, now);
  },
});

/** Each invoice's status by supplier and number; a second invoice under the same number is "#2". */
function statuses(db: DB): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of apInvoices(db)) {
    const base = `${i.vendor} ${i.invoice_no || i.doc_sha256.slice(0, 8)}`;
    let key = base;
    for (let n = 2; key in out; n++) key = `${base} #${n}`;
    out[key] = i.status;
  }
  return out;
}
const steps = (db: DB) => db.prepare("SELECT subject, json_extract(payload_json, '$.step') AS step, json_extract(payload_json, '$.outcome') AS outcome FROM audit_log WHERE event = 'autopilot.step' ORDER BY seq").all() as { subject: string; step: string; outcome: string }[];

describe("a batch of twelve documents, from the folder to the end, with no manual command", () => {
  it("pays what the CFO approved, waits for people where it must, and books, files and syncs everything once", async () => {
    const w = await world();
    await batch(w.folder);
    await drain(w.db, w.deps);
    // Nothing is paid before the CFO: three payments wait, three new suppliers wait for a person.
    expect(w.awx.transfers).toHaveLength(0);
    expect(statuses(w.db)).toMatchObject({
      "Bergtex Textil GmbH BTX-2026-21": "waiting_cfo", "Bergtex Textil GmbH BTX-2026-31": "waiting_cfo", "Stockline Data GmbH SLL-2026-11": "waiting_cfo",
      "Lagerhaus Nord GmbH LN-2026-0815": "needs_vendor", "Pinecrest Outdoor Supply LLC PC-7781": "needs_vendor", "Zeeland Verpakkingen B.V. ZV-4471": "needs_vendor",
    });
    expect(w.db.prepare("SELECT vendor, status FROM payee_adds ORDER BY vendor").all()).toEqual([
      { vendor: "Lagerhaus Nord GmbH", status: "REQUESTED" }, { vendor: "Pinecrest Outdoor Supply LLC", status: "REQUESTED" }, { vendor: "Zeeland Verpakkingen B.V.", status: "REQUESTED" },
    ]);

    // A person checks two of the three new suppliers; the autopilot files them for the CFO.
    personChecksSuppliers(w.db, ["Lagerhaus Nord GmbH", "Pinecrest Outdoor Supply LLC"]);
    await drain(w.db, w.deps);
    expect(w.db.prepare("SELECT vendor, status FROM payee_adds WHERE status = 'PROPOSED' ORDER BY vendor").all()).toHaveLength(2);
    // The CFO approves everything waiting: three payments and two suppliers. The autopilot executes them, checks the
    // new suppliers' invoices again and plans their payments.
    expect(cfoApproves(w.db)).toHaveLength(5);
    await drain(w.db, w.deps);
    expect(w.awx.transfers).toHaveLength(3);
    expect(statuses(w.db)).toMatchObject({ "Lagerhaus Nord GmbH LN-2026-0815": "waiting_cfo", "Pinecrest Outdoor Supply LLC PC-7781": "waiting_cfo" });
    expect(cfoApproves(w.db)).toHaveLength(2);
    await drain(w.db, w.deps);

    const end = statuses(w.db);
    expect(end).toEqual({
      "Bergtex Textil GmbH BTX-2026-21": "paid", "Bergtex Textil GmbH BTX-2026-31": "paid", "Stockline Data GmbH SLL-2026-11": "paid",
      "Lagerhaus Nord GmbH LN-2026-0815": "paid", "Pinecrest Outdoor Supply LLC PC-7781": "paid",
      "Zeeland Verpakkingen B.V. ZV-4471": "needs_vendor",
      "Bergtex Textil GmbH BTX-2027-01": "needs_review", "Bergtex Textil GmbH BTX-2026-21 #2": "blocked", "Bergtex Textil GmbH BTX-2026-51": "blocked",
      ...Object.fromEntries(Object.entries(end).filter(([k]) => !/BTX-2026-21|BTX-2026-31|SLL|LN-2026|PC-7781|ZV-4471|BTX-2027-01|BTX-2026-51/.test(k)).map(([k]) => [k, "needs_review"])),
    });
    // The same file twice is one invoice; the same number under another file is blocked as its copy; the wrong sum is
    // blocked; the new bank account, the credit note and the scan wait for a person.
    const rows = apInvoices(w.db);
    expect(rows).toHaveLength(11);
    expect(rows.filter((i) => i.invoice_no === "BTX-2026-21").map((i) => i.status).sort()).toEqual(["blocked", "paid"]);
    expect(rows.find((i) => i.invoice_no === "BTX-2026-51")?.status).toBe("blocked");
    expect(rows.find((i) => i.doc_kind === "credit_note")?.status).toBe("needs_review");
    expect(rows.find((i) => i.findings.some((f) => f.code === "no_text"))?.status).toBe("needs_review");

    // Exactly one transfer per paid invoice, in its own currency.
    expect(w.awx.transfers.map((t) => `${t.currency} ${(t.amountCents / 100).toFixed(2)}`).sort()).toEqual(["EUR 1190.00", "EUR 1850.00", "EUR 240.00", "EUR 400.00", "USD 2400.00"]);
    // The books balance; every money movement says who decided it; the vault holds one receipt per paid invoice.
    expect(verifyLedger(w.db).ok).toBe(true);
    expect(originsCheck(w.db).missing).toEqual([]);
    const files = walk(join(w.root, "vault"));
    expect(files.filter((f) => f.includes("/Betalingen/"))).toHaveLength(5);
    expect(new Set(files).size).toBe(files.length);
    expect([...w.erp.objects.values()].every((n) => n === 1)).toBe(true);
    expect(w.erp.objects.size).toBeGreaterThan(0);
    // Every step is in the audit log, with its outcome.
    const s = steps(w.db);
    expect(new Set(s.map((x) => x.step))).toEqual(new Set(["take in", "ask for the supplier", "file the supplier for the CFO", "plan the payment", "execute", "follow the payments", "post the ledger", "file the vault", "sync the books"]));
    expect(s.filter((x) => x.step === "take in")).toHaveLength(12);
    expect(s.filter((x) => x.step === "execute").map((x) => x.outcome)).toEqual(Array(7).fill("executed"));
    expect(s.filter((x) => x.outcome === "failed")).toEqual([]);
  }, 120_000);

  it("with a stand-in gate (EUR 500.00), pays what is within the limit alone; everything above it waits for the CFO", async () => {
    const w = await world({ gate: standInGate("500.00") });
    await batch(w.folder);
    await drain(w.db, w.deps);
    expect(statuses(w.db)).toMatchObject({ "Bergtex Textil GmbH BTX-2026-31": "paid", "Stockline Data GmbH SLL-2026-11": "paid", "Bergtex Textil GmbH BTX-2026-21": "waiting_cfo" });
    expect(w.awx.transfers.map((t) => (t.amountCents / 100).toFixed(2)).sort()).toEqual(["240.00", "400.00"]);
    const approvals = w.db.prepare("SELECT approver FROM approvals ORDER BY approval_id").all() as { approver: string }[];
    expect(approvals.map((a) => a.approver)).toEqual(["stand-in gate (test)", "stand-in gate (test)"]);
    // The 1,850.00 payment waits: nothing executes it until the CFO approves.
    const large = apInvoices(w.db).find((i) => i.invoice_no === "BTX-2026-21" && i.status === "waiting_cfo")!;
    expect(w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(large.proposal_id)).toEqual({ status: "PENDING_APPROVAL" });
    await drain(w.db, w.deps);
    expect(w.awx.transfers).toHaveLength(2);
    expect(originsCheck(w.db).missing).toEqual([]);
  }, 120_000);
});

describe("nothing above the limit runs without the CFO", () => {
  it("the limit: the same currency, a plain amount, at or below it; a new supplier is never within it", () => {
    const lim = { currency: "EUR", amount: "500.00" };
    expect(withinAloneLimit({ kind: "invoice_payment", amount: "500.00", currency: "EUR" }, lim)).toBe(true);
    expect(withinAloneLimit({ kind: "supplier_payment", amount: "499.99", currency: "EUR" }, lim)).toBe(true);
    expect(withinAloneLimit({ kind: "invoice_payment", amount: "500.01", currency: "EUR" }, lim)).toBe(false);
    expect(withinAloneLimit({ kind: "supplier_payment", amount: "100.00", currency: "USD" }, lim)).toBe(false);
    for (const amount of ["1e2", "-1.00", "100", "100.0", " 100.00", "100.00 ", "0x10.00", 100] as unknown[]) expect(withinAloneLimit({ kind: "invoice_payment", amount, currency: "EUR" }, lim)).toBe(false);
    expect(withinAloneLimit({ kind: "payee_add", amount: "1.00", currency: "EUR" }, lim)).toBe(false);
    expect(withinAloneLimit({ kind: "invoice_payment", amount: "1.00", currency: "EUR" }, null)).toBe(false);
    expect(withinAloneLimit({ kind: "invoice_payment", amount: "1.00", currency: "EUR" }, { currency: "EUR", amount: "five" })).toBe(false);
  });

  it("without a gate nothing executes before the CFO decides, and terms changed after the approval never run", async () => {
    const w = await world();
    writeFileSync(join(w.folder, "small.pdf"), await pdfOf(SMALL));
    await drain(w.db, w.deps);
    const inv = apInvoices(w.db)[0]!;
    expect(inv.status).toBe("waiting_cfo");
    expect(w.awx.transfers).toHaveLength(0);
    cfoApproves(w.db);
    // Someone changes the approved terms afterwards: the executor finds they are not what the CFO signed.
    const p = w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(inv.proposal_id) as { terms_json: string };
    w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(p.terms_json.replace('"amount":"400.00"', '"amount":"4000.00"'), inv.proposal_id);
    await drain(w.db, w.deps);
    expect(w.awx.transfers).toHaveLength(0);
    expect(steps(w.db).filter((s) => s.step === "execute").map((s) => s.outcome)).toContain("failed");
  }, 60_000);

  it("a gate that approves other terms than the stored ones cannot make the executor run them", async () => {
    const lying: AloneGate = {
      name: "a lying gate (test)", limit: () => ({ currency: "EUR", amount: "500.00" }),
      approve: (db, id, now) => {
        standInGate("500.00").approve(db, id, now);
        const t = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string };
        db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(t.terms_json.replace('"amount":"400.00"', '"amount":"499.00"'), id);
      },
    };
    const w = await world({ gate: lying });
    writeFileSync(join(w.folder, "small.pdf"), await pdfOf(SMALL));
    await drain(w.db, w.deps);
    expect(w.awx.transfers).toHaveLength(0);
  }, 60_000);
});

describe("a failing step is tried again later, then parked for a person", () => {
  it("backs off after the first and second failure, parks after the third, and a person puts it back", async () => {
    let t = Date.parse("2026-11-12T09:00:00Z");
    const now = () => new Date(t);
    let down = true;
    const sink: BookkeepingSink = { name: "flaky", push: () => { if (down) throw new Error("the bookkeeping package is down"); } };
    const w = await world({ now, sink });
    w.deps.rail = null;
    writeFileSync(join(w.folder, "small.pdf"), await pdfOf(SMALL));
    await drain(w.db, w.deps);
    const id = apInvoices(w.db)[0]!.id;
    const tries = () => steps(w.db).filter((s) => s.subject === id && s.step === "book").map((s) => s.outcome);
    expect(tries()).toEqual(["failed"]);
    // Not due yet: nothing happens.
    expect((await autopilotPass(w.db, w.deps)).moved).toBe(0);
    expect(tries()).toEqual(["failed"]);
    t += 61_000;
    await drain(w.db, w.deps);
    expect(tries()).toEqual(["failed", "failed"]);
    t += 5 * 60_000 + 1000;
    await drain(w.db, w.deps);
    expect(tries()).toEqual(["failed", "failed", "failed"]);
    expect(parkedItems(w.db)).toMatchObject([{ item: id, step: "book", attempts: 3, reason: expect.stringMatching(/did not take the accrual/) }]);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'autopilot.parked'").get()).toEqual({ n: 1 });
    // Parked: never tried again by itself, however long it waits.
    t += 24 * 3_600_000;
    await drain(w.db, w.deps);
    expect(tries()).toHaveLength(3);
    // A person fixes the sink and puts it back: it goes through, and the count is gone.
    down = false;
    expect(retryItem(w.db, id, "the CFO")).toBe(true);
    expect(retryItem(w.db, id, "the CFO")).toBe(false);
    await drain(w.db, w.deps);
    expect(tries()).toEqual(["failed", "failed", "failed", "done"]);
    expect(parkedItems(w.db)).toEqual([]);
  }, 60_000);

  it("a success in between clears the count", async () => {
    let t = Date.parse("2026-11-12T09:00:00Z");
    const now = () => new Date(t);
    // Down for the inbox's own push and for the autopilot's first try; up for its second.
    let fail = 2;
    const sink: BookkeepingSink = { name: "flaky", push: () => { if (fail-- > 0) throw new Error("down for a moment"); } };
    const w = await world({ now, sink });
    w.deps.rail = null;
    writeFileSync(join(w.folder, "small.pdf"), await pdfOf(SMALL));
    await drain(w.db, w.deps);
    t += 61_000;
    await drain(w.db, w.deps);
    const id = apInvoices(w.db)[0]!.id;
    expect(steps(w.db).filter((s) => s.subject === id && s.step === "book").map((s) => s.outcome)).toEqual(["failed", "done"]);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM autopilot_items").get()).toEqual({ n: 0 });
  }, 60_000);
});

describe("one autopilot per ledger", () => {
  it("a live lease keeps a second process out; a dead holder's or a stale lease is taken over", async () => {
    const w = await world();
    const now = new Date("2026-11-12T09:00:00Z");
    const a = { id: "a", pid: 101, host: "h" }, b = { id: "b", pid: 102, host: "h" };
    expect(takeLease(w.db, a, now)).toEqual({ ok: true });
    expect(takeLease(w.db, b, now, () => true)).toMatchObject({ ok: false, holder: { owner: "a", pid: 101 } });
    // The holder's process is gone on this host: taken over at once.
    expect(takeLease(w.db, b, now, (pid) => pid !== 101)).toEqual({ ok: true });
    // On another host the holder cannot be seen: only a heartbeat older than the lease frees it.
    const c = { id: "c", pid: 103, host: "elsewhere" };
    expect(takeLease(w.db, c, new Date(now.getTime() + LEASE_MS - 1), () => false)).toMatchObject({ ok: false });
    expect(takeLease(w.db, c, new Date(now.getTime() + LEASE_MS), () => true)).toEqual({ ok: true });
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'autopilot.lease_taken_over'").get()).toEqual({ n: 2 });
  });

  it("two autopilots on one ledger file: the second does nothing while the first runs, and no step ever runs twice", async () => {
    const w = await world({ file: true });
    await batch(w.folder);
    const second = openDb(w.dbPath);
    const other: AutopilotDeps = { ...w.deps, owner: { id: "autopilot-2", pid: 2, host: "test-host" } };
    const [r1, r2] = await Promise.all([drain(w.db, w.deps), drain(second, other)]);
    expect([r1.lease, r2.lease].sort()).toEqual(["busy", "held"]);
    // Handing the ledger back and forth between two processes (each finding the other gone) changes nothing either.
    const handed: AutopilotDeps = { ...other, alive: () => false };
    for (let i = 0; i < 6; i++) {
      await autopilotPass(second, handed);
      await autopilotPass(w.db, { ...w.deps, alive: () => false });
    }
    personChecksSuppliers(w.db);
    cfoApproves(w.db);
    for (let i = 0; i < 6; i++) {
      await autopilotPass(second, handed);
      await autopilotPass(w.db, { ...w.deps, alive: () => false });
    }
    cfoApproves(w.db);
    for (let i = 0; i < 6; i++) {
      await autopilotPass(second, handed);
      await autopilotPass(w.db, { ...w.deps, alive: () => false });
    }
    cfoApproves(w.db);
    for (let i = 0; i < 6; i++) {
      await autopilotPass(second, handed);
      await autopilotPass(w.db, { ...w.deps, alive: () => false });
    }
    // Every step that did something did it once.
    const done = steps(w.db).filter((s) => s.outcome !== "failed" && !["post the ledger", "file the vault", "sync the books", "follow the payments"].includes(s.step));
    const keys = done.map((s) => `${s.subject} ${s.step}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(w.awx.transfers).toHaveLength(6);
    const paid = apInvoices(w.db).filter((i) => i.status === "paid");
    expect(paid).toHaveLength(6);
    expect(verifyLedger(w.db).ok).toBe(true);
    second.close();
  }, 180_000);
});

describe("a pass with nothing to do", () => {
  it("writes nothing and changes nothing", async () => {
    const w = await world();
    writeFileSync(join(w.folder, "small.pdf"), await pdfOf(SMALL));
    await drain(w.db, w.deps);
    const count = (t: string) => (w.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const before = { audit: count("audit_log"), ledger: count("ledger_entries"), items: count("autopilot_items"), lease: w.db.prepare("SELECT * FROM autopilot_lease").get() };
    expect((await autopilotPass(w.db, w.deps)).moved).toBe(0);
    expect((await autopilotPass(w.db, w.deps)).moved).toBe(0);
    expect({ audit: count("audit_log"), ledger: count("ledger_entries"), items: count("autopilot_items"), lease: w.db.prepare("SELECT * FROM autopilot_lease").get() }).toEqual(before);
  }, 60_000);
});

describe("a document filed but never read", () => {
  it("is read when the autopilot asks for it, and is a duplicate otherwise; one document never gets two invoices", async () => {
    const w = await world();
    const bytes = await pdfOf(SMALL);
    let stop: () => void = () => {};
    const stopped = new Promise<void>((r) => { stop = r; });
    chaos.at = (p) => { if (p === "ap.ingest:filed") { stop(); return new Promise<void>(() => {}); } };
    void ingestDocument(w.db, w.deps.inbox, { bytes, filename: "small.pdf", source: "upload" });
    await stopped;
    chaos.at = null;
    expect(apInvoices(w.db)).toHaveLength(0);
    expect(await ingestDocument(w.db, w.deps.inbox, { bytes, filename: "small.pdf", source: "upload" })).toMatchObject({ kind: "duplicate_document", invoice_id: null });
    const r = await ingestDocument(w.db, w.deps.inbox, { bytes, filename: "small.pdf", source: "upload" }, 0, { resumeUnread: true });
    expect(r).toMatchObject({ kind: "invoice", invoice: { status: "ready" } });
    expect(await ingestDocument(w.db, w.deps.inbox, { bytes, filename: "small.pdf", source: "upload" }, 0, { resumeUnread: true })).toMatchObject({ kind: "duplicate_document" });
    expect(apInvoices(w.db)).toHaveLength(1);
  }, 60_000);
});

// ── Stopped between any two steps ──

interface EndState { invoices: Record<string, string>; transfers: string[]; ledger: string[]; journal: string[]; vault: string[]; books: [string, number][]; codings: string[]; proposals: string[] }

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])).sort();
}

/**
 * A payment's request id is new in every run (randomUUID), and a restart may number the invoices in another order:
 * both are compared as placeholders, so only real differences count (a second payment or booking is still one more).
 */
const anyId = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>").replace(/AP-\d{4}/g, "AP-n");

function endState(w: World): EndState {
  const db = w.db;
  const ledger = (db.prepare("SELECT entry_id, source_key, description FROM ledger_entries ORDER BY entry_id").all() as { entry_id: number; source_key: string | null; description: string }[])
    .map((e) => anyId(`${e.source_key} ${e.description}: ${(db.prepare("SELECT account, debit_cents, credit_cents, currency, vat_code, cost_centre FROM ledger_lines WHERE entry_id = ? ORDER BY line_no").all(e.entry_id) as Record<string, unknown>[]).map((l) => Object.values(l).join("/")).join(" ")}`)).sort();
  const journalPath = join(w.root, "ap", "journal.csv");
  return {
    invoices: statuses(db),
    transfers: w.awx.transfers.map((t) => `${t.currency} ${t.amountCents} ${t.reference ?? ""} ${t.status}`).sort(),
    ledger,
    journal: existsSync(journalPath) ? readFileSync(journalPath, "utf8").split("\n").filter(Boolean).map(anyId).sort() : [],
    vault: walk(join(w.root, "vault")).map((f) => anyId(relative(join(w.root, "vault"), f))).filter((f) => /Inkoopfacturen|Betalingen/.test(f)).sort(),
    books: [...w.erp.objects.entries()].map(([k, n]): [string, number] => [anyId(k), n]).sort(),
    codings: (db.prepare("SELECT i.vendor, i.invoice_no, c.source, c.status, c.coding_json FROM ap_codings c JOIN ap_invoices i ON i.id = c.invoice_id ORDER BY i.vendor, i.invoice_no").all() as { vendor: string; invoice_no: string; source: string; status: string; coding_json: string }[])
      .map((c) => { const j = JSON.parse(c.coding_json) as { lines: unknown[] }; return `${c.vendor} ${c.invoice_no} ${c.source} ${c.status} ${JSON.stringify(j.lines)}`; }),
    proposals: (db.prepare("SELECT kind, status, COUNT(*) AS n FROM proposals GROUP BY kind, status ORDER BY kind, status").all() as { kind: string; status: string; n: number }[]).map((p) => `${p.kind} ${p.status} ${p.n}`),
  };
}

/**
 * The run that is stopped: a small batch (an invoice from a supplier on file, one from a new supplier, a scan), with the
 * Coder on (a scripted Claude that gives no answer, so code's fallback codes), the vault and the stand-in books; the
 * test acts as the person and the CFO between the drains. `kill` stops the process at the n-th time it reaches a
 * point: nothing after it runs (the awaited promise never settles), its lease is not given back. A new process (a new
 * owner, that finds the old one gone) then carries on.
 */
async function stoppedRun(kill?: { point: string; nth: number }): Promise<{ points: string[]; state: EndState; killed: boolean }> {
  const w = await world({ coder: true });
  writeFileSync(join(w.folder, "a-small.pdf"), await pdfOf(SMALL));
  writeFileSync(join(w.folder, "b-new-de.pdf"), await pdfOf(DE));
  writeFileSync(join(w.folder, "c-scan.pdf"), await scanPdf());
  const points: string[] = [];
  let seen = 0;
  let killed = false;
  let onKill: () => void = () => {};
  const died = new Promise<void>((r) => { onKill = r; });
  chaos.at = (p) => {
    points.push(p);
    if (!killed && kill && p === kill.point && ++seen === kill.nth) {
      killed = true;
      onKill();
      return new Promise<void>(() => {});
    }
  };
  let deps = w.deps;
  const run = async () => {
    if (killed) { await drain(w.db, deps); return; }
    const r = await Promise.race([drain(w.db, deps).then(() => "drained" as const), died.then(() => "killed" as const)]);
    if (r === "killed") {
      // A new process: module state starts empty, the old owner is gone, and it carries on from the ledger.
      resuming.clear();
      deps = { ...deps, owner: { id: "autopilot-2", pid: 2, host: "test-host" }, alive: (pid) => pid !== 1 };
      await drain(w.db, deps);
    }
  };
  await run();
  personChecksSuppliers(w.db);
  await run();
  cfoApproves(w.db);
  await run();
  cfoApproves(w.db);
  await run();
  chaos.at = null;
  return { points, state: endState(w), killed };
}

describe("stopped between any two steps", () => {
  it("every cut point: a restart reaches the same end state, with no second payment, booking or document", async () => {
    const clean = await stoppedRun();
    // The clean run pays both invoices, codes them, books, files and syncs them.
    expect(clean.state.invoices).toMatchObject({ "Bergtex Textil GmbH BTX-2026-31": "paid", "Lagerhaus Nord GmbH LN-2026-0815": "paid" });
    expect(clean.state.transfers).toHaveLength(2);
    expect(clean.state.codings).toHaveLength(2);
    expect(clean.state.vault.length).toBeGreaterThan(0);
    expect(clean.state.books.length).toBeGreaterThan(0);
    const cuts = [...new Set(clean.points)];
    // Every kind of boundary is among them: the autopilot's own steps, the inbox's, the Coder's and booking's, and
    // the executors' (src/policy/saga.ts).
    expect(cuts).toEqual(expect.arrayContaining(["autopilot:take in", "autopilot:take in:done", "ap.ingest:filed", "ap.ingest:stored", "ap.book:coded", "ap.book:booked", "autopilot:execute", "autopilot:plan the payment", "autopilot:post the ledger", "autopilot:file the vault", "autopilot:sync the books"]));
    expect(cuts.length).toBeGreaterThan(20);
    // Each point the first time it is reached, and the last time when it is reached more than once (a later drain:
    // after a person's check or the CFO's approval).
    const times = (p: string) => clean.points.filter((x) => x === p).length;
    const stops = cuts.flatMap((point) => (times(point) > 1 ? [{ point, nth: 1 }, { point, nth: times(point) }] : [{ point, nth: 1 }]));
    for (const stop of stops) {
      const r = await stoppedRun(stop);
      expect.soft(r.killed, `${stop.point} #${stop.nth}`).toBe(true);
      expect.soft(r.state, `stopped at ${stop.point} #${stop.nth}`).toEqual(clean.state);
    }
  }, 600_000);
});
