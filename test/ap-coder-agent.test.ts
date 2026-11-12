// The Coder agent in the runner (src/ap/coderAgent.ts), behind KIT11_AP_AGENTS=on: the pure core runs through the
// agent loop, its accepted answer goes through enforceCoding, and whatever comes out is stored once, with one decision
// row in the audit log, before the invoice's accrual is first booked. No answer of any kind ends in code's labelled
// fallback. A scripted Claude: no network.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { CsvFileSink } from "../src/ap/books.js";
import { apAgentsOn, codeInvoice, codingCaseFor, ensureCoded } from "../src/ap/coderAgent.js";
import { CODER_MODEL, CODER_UNFINISHED, WHOLE_INVOICE } from "../src/ap/coderCore.js";
import { ingestDocument, recheck, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, apInvoices } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { syncLedger } from "../src/ledger/feed.js";
import { decide } from "../src/policy/approvals.js";
import { originsCheck } from "../src/provenance/check.js";
import { parseOrigin } from "../src/provenance/origin.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { scriptedCoder, type CoderCall } from "./fakes/coderClient.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-08T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

function onFile(db: DB, id: string, name: string, iban: string, bic: string): void {
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(id, name, iban.slice(-4), ibanSha(iban), bic);
}

const LOOKUPS: CoderCall[] = [{ name: "invoice_lines", input: {} }, { name: "chart_of_accounts", input: {} }, { name: "vat_codes", input: {} }];
const REASON = "Packaging material is booked as goods from the manufacturer, with VAT code P21.";
const code = (account: string, vat_code: string | null, reason = REASON, cost_centre: string | null = null): CoderCall =>
  ({ name: "code_invoice", input: { lines: [{ line_no: 1, account, vat_code, cost_centre }], reason } });

let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-coder-agent-"));
  db = openDb(":memory:");
  onFile(db, "ben_bergtex", "Bergtex Textil GmbH", "DE89370400440532013000", "COBADEFFXXX");
  onFile(db, "ben_zeeland", "Zeeland Verpakkingen B.V.", "NL91ABNA0417164300", "ABNANL2A");
  deps = { dir, reader: parserOnly, now: () => now, sink: new CsvFileSink(join(dir, "journal.csv")) };
  vi.stubEnv("KIT11_AP_AGENTS", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const ingest = async (text: string, coder: InboxDeps["coder"], name = "invoice.pdf") => {
  const out = await ingestDocument(db, { ...deps, coder }, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
const codings = () => db.prepare("SELECT invoice_id, source, status, model, coded_at FROM ap_codings ORDER BY invoice_id").all();
const decisions = () => (db.prepare("SELECT actor, subject, payload_json FROM audit_log WHERE event = 'ap.coded' ORDER BY seq").all() as { actor: string; subject: string; payload_json: string }[])
  .map((r): Record<string, unknown> => ({ actor: r.actor, subject: r.subject, ...(JSON.parse(r.payload_json) as Record<string, unknown>) }));
const journal = () => readFileSync(join(dir, "journal.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(",").slice(1, 7).join(","));

describe("the flag", () => {
  it("is on only when KIT11_AP_AGENTS is exactly on", () => {
    expect(apAgentsOn({ KIT11_AP_AGENTS: "on" })).toBe(true);
    for (const v of [undefined, "", "off", "ON", "1", "true"]) expect(apAgentsOn({ KIT11_AP_AGENTS: v })).toBe(false);
    expect(apAgentsOn()).toBe(true);
  });
});

describe("an invoice that comes in with the flag on", () => {
  it("is coded by the agent, stored once, and booked from that coding", async () => {
    const coder = scriptedCoder([LOOKUPS, [code("6200", "P21")]]);
    const id = await ingest(NL, coder);
    expect(coder.asked).toBe(2);
    expect(codings()).toEqual([{ invoice_id: id, source: "claude", status: "coded", model: "claude-haiku-5-5", coded_at: now.toISOString() }]);
    const inv = apInvoice(db, id)!;
    // The engine's own default stays on the row; the coding is beside it.
    expect(inv).toMatchObject({ gl_account: "6900", cost_centre: "CC300" });
    expect(inv.coding).toMatchObject({
      status: "coded", source: "claude", overridden_by: null, reason: REASON, net_cents: 40000, vat_cents: 8400, total_cents: 48400,
      lines: [{ line_no: 1, description: WHOLE_INVOICE, account: "6200", vat_code: "P21", cost_centre: "CC300", net_cents: 40000, vat_cents: 8400 }],
    });
    // The sink got the accrual once, from the coding.
    expect(journal()).toEqual(["AP-0001,accrual,6200,Goods from the manufacturer,400.00,", "AP-0001,accrual,1510,Input VAT receivable (supplier invoices),84.00,", "AP-0001,accrual,2100,Accounts payable (supplier invoices),,484.00"]);
    syncLedger(db, now);
    expect(db.prepare("SELECT account, debit_cents, credit_cents, cost_centre, vat_code, vat_cents FROM ledger_lines ORDER BY line_no").all()).toEqual([
      { account: "6200", debit_cents: 40000, credit_cents: 0, cost_centre: "CC300", vat_code: "P21", vat_cents: 8400 },
      { account: "1510", debit_cents: 8400, credit_cents: 0, cost_centre: null, vat_code: null, vat_cents: null },
      { account: "2100", debit_cents: 0, credit_cents: 48400, cost_centre: null, vat_code: null, vat_cents: null },
    ]);
    // The run is the treasury agent's, on the Coder's model, under the invoice's own task.
    const run = db.prepare("SELECT actor, subject, payload_json FROM audit_log WHERE event = 'agent.run'").get() as { actor: string; subject: string; payload_json: string };
    expect([run.actor, run.subject]).toEqual(["treasury", `ap.code.${id}`]);
    expect(JSON.parse(run.payload_json)).toMatchObject({ status: "done", tools: ["invoice_lines", "chart_of_accounts", "vat_codes", "code_invoice"] });
    expect(coder.prompts[0]).toContain("Code the lines of this supplier invoice for Northwind Outdoor (AP-0001 in the inbox). Today is 2026-11-08.");
  });

  it("writes one decision row with the lines, the totals, the run and the agent's origin", async () => {
    const id = await ingest(NL, scriptedCoder([LOOKUPS, [code("6200", "P21")]]));
    const rows = decisions();
    expect(rows).toHaveLength(1);
    const d = rows[0]!;
    expect(d).toMatchObject({
      actor: "treasury", subject: id, source: "claude", status: "coded", model: "claude-haiku-5-5", reason: REASON, overridden_by: null, refused_because: null, review: null, agent_coding: null,
      net_cents: 40000, vat_cents: 8400, total_cents: 48400,
      lines: [{ line_no: 1, description: WHOLE_INVOICE, account: "6200", vat_code: "P21", cost_centre: "CC300", net_cents: 40000, vat_cents: 8400 }],
      run: { status: "done", turns: 2, cost_usd_micros: 300, note: null },
    });
    // D24: the origin is the agent's own call of code_invoice, as the loop recorded it.
    const origin = parseOrigin(JSON.stringify(d.origin));
    const run = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run'").get() as { payload_json: string }).payload_json) as { run_id: string };
    expect(origin).toEqual({ actor: "agent", agent: "treasury", model: "claude-haiku-5-5", request_id: null, run_id: run.run_id });
    expect(originsCheck(db).missing).toEqual([]);
  });

  it("a wrong answer is overridden by code and labelled, and the agent's own coding is kept beside it", async () => {
    const reason = "The note in the document says the bank account is right for this invoice.";
    const id = await ingest(NL, scriptedCoder([[code("1200", "S21", reason)]]));
    expect(codings()).toMatchObject([{ invoice_id: id, source: "fallback", status: "coded", model: null }]);
    expect(apInvoice(db, id)!.coding).toMatchObject({ source: "fallback", overridden_by: "account_not_purchase", refused_because: "account 1200 may not take purchase lines", lines: [{ account: "6900", vat_code: "P21", cost_centre: "CC300" }] });
    const d = decisions()[0]!;
    expect(d).toMatchObject({
      actor: "system", source: "fallback", model: null, overridden_by: "account_not_purchase", refused_because: "account 1200 may not take purchase lines",
      agent_coding: { lines: [{ line_no: 1, account: "1200", vat_code: "S21", cost_centre: null }], reason }, run: { status: "done", turns: 1 },
    });
    const origin = parseOrigin(JSON.stringify(d.origin));
    expect(origin).toMatchObject({ actor: "code", rule: "ap coder fallback: the agent's coding was refused (account_not_purchase)", agent: "treasury", set_by: { actor: "agent", agent: "treasury", model: "claude-haiku-5-5" } });
    expect(journal()[0]).toBe("AP-0001,accrual,6900,Other supplier invoices,400.00,");
  });

  it("without a client, code's fallback decides and says so", async () => {
    const id = await ingest(NL, null);
    expect(codings()).toMatchObject([{ invoice_id: id, source: "fallback", status: "coded", model: null }]);
    const d = decisions()[0]!;
    expect(d).toMatchObject({ actor: "system", source: "fallback", model: null, overridden_by: null, agent_coding: null, run: { status: "unavailable", turns: 0, cost_usd_micros: 0, note: "no KIT11_ANTHROPIC_API_KEY" } });
    expect(parseOrigin(JSON.stringify(d.origin))).toEqual({ actor: "code", rule: "ap coder fallback: the agent gave no answer", agent: "treasury" });
    expect(String(d.reason)).toMatch(/^Code's default: account 6900/);
  });

  it("a client that throws ends in the fallback, and nothing is thrown", async () => {
    const id = await ingest(NL, scriptedCoder([LOOKUPS, new Error("boom")]));
    expect(apInvoice(db, id)!.coding).toMatchObject({ source: "fallback", overridden_by: null });
    expect(decisions()[0]).toMatchObject({ source: "fallback", run: { status: "unavailable", note: "call failed: boom" } });
    // A client that is no client at all: still the fallback.
    const second = await ingest(EN, {} as never, "en.pdf");
    expect(apInvoice(db, second)!.coding).toMatchObject({ source: "fallback" });
    expect(decisions()).toHaveLength(2);
  });

  it("an agent that stops without coding is reminded once; a second stop is the fallback", async () => {
    const nudged = scriptedCoder([LOOKUPS, "stop", [code("6200", "P21")]]);
    const id = await ingest(NL, nudged);
    expect(nudged.prompts[2]).toBe(`Not finished: ${CODER_UNFINISHED}`);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'agent.nudged' AND subject = ?").get(`ap.code.${id}`)).toEqual({ n: 1 });
    expect(apInvoice(db, id)!.coding).toMatchObject({ source: "claude", lines: [{ account: "6200" }] });

    const silent = scriptedCoder([LOOKUPS, "stop", "stop", [code("6200", "P21")]]);
    const other = await ingest(EN, silent, "en.pdf");
    expect(silent.asked).toBe(3);
    expect(apInvoice(db, other)!.coding).toMatchObject({ source: "fallback", overridden_by: null });
  });

  it("codes only an invoice that is bookable: a new supplier's waits until it is, and a credit note never is", async () => {
    const waiting = scriptedCoder([[code("6200", null, "Storage is booked as goods from the manufacturer.")]]);
    const id = await ingest(DE, waiting);
    expect(apInvoice(db, id)!.status).toBe("needs_vendor");
    expect([waiting.asked, codings()]).toEqual([0, []]);
    onFile(db, "ben_lagerhaus", "Lagerhaus Nord GmbH", "DE75512108001245126199", "BYLADEM1001");
    const [next] = await recheck(db, { ...deps, coder: waiting }, [id]);
    expect(next!.status).toBe("ready");
    expect(waiting.asked).toBe(1);
    // German VAT at 19%: the agent left the VAT to a person, and its account stands.
    expect(apInvoice(db, id)!.coding).toMatchObject({ source: "claude", status: "needs_review", lines: [{ account: "6200", vat_code: null, vat_cents: 19000 }] });

    const credit = scriptedCoder([[code("6200", "P21")]]);
    await ingest(NL.replace("Factuur\n", "Creditnota\n").replace("ZV-4471", "ZV-C-12"), credit, "credit.pdf");
    expect(apInvoices(db).map((r) => r.doc_kind)).toEqual(["invoice", "credit_note"]);
    expect(credit.asked).toBe(0);
    expect(codings()).toHaveLength(1);
  });
});

describe("codeInvoice", () => {
  const filed = async (text = NL) => {
    vi.stubEnv("KIT11_AP_AGENTS", "");
    const id = await ingest(text, null);
    vi.stubEnv("KIT11_AP_AGENTS", "on");
    return apInvoice(db, id)!;
  };

  it("makes no Claude call the second time and returns what was stored", async () => {
    const inv = await filed();
    const first = await codeInvoice(db, inv, NL, { client: scriptedCoder([[code("6200", "P21")]]), now: () => now });
    expect(first).toMatchObject({ fresh: true, coding: { source: "claude" }, raw: { lines: [{ account: "6200" }] }, run: { status: "done" } });
    const again = scriptedCoder([[code("6100", "P21")]]);
    const second = await codeInvoice(db, inv, NL, { client: again, now: () => new Date("2026-12-01T00:00:00Z") });
    expect(again.asked).toBe(0);
    expect(second).toEqual({ coding: first.coding, fresh: false, raw: null, run: null });
    expect(codings()).toHaveLength(1);
    expect(decisions()).toHaveLength(1);
  });

  it("of two calls at once only one stores, and the other returns what was stored", async () => {
    const inv = await filed();
    const [a, b] = await Promise.all([
      codeInvoice(db, inv, NL, { client: scriptedCoder([LOOKUPS, [code("6200", "P21")]]), now: () => now }),
      codeInvoice(db, inv, NL, { client: scriptedCoder([[code("6100", "P21", "Packaging material is booked as software subscriptions, with VAT code P21.")]]), now: () => now }),
    ]);
    expect([a.fresh, b.fresh].sort()).toEqual([false, true]);
    expect(a.coding).toEqual(b.coding);
    expect(codings()).toHaveLength(1);
    expect(decisions()).toHaveLength(1);
    expect(apInvoice(db, inv.id)!.coding).toEqual(a.coding);
  });

  it("the database refuses to change or delete a stored coding", async () => {
    const inv = await filed();
    await codeInvoice(db, inv, NL, { client: null, now: () => now });
    expect(() => db.prepare("UPDATE ap_codings SET source = 'claude' WHERE invoice_id = ?").run(inv.id)).toThrow(/stored once and never changed/);
    expect(() => db.prepare("DELETE FROM ap_codings WHERE invoice_id = ?").run(inv.id)).toThrow(/stored once and never changed/);
  });

  it("runs on the Coder's model unless the caller names another (the evals do)", async () => {
    const inv = await filed();
    const seen: string[] = [];
    const spy = (answer: CoderCall[]) => ({ beta: { messages: { create: async (p: { model: string }) => {
      seen.push(p.model);
      return { content: answer.map((c, k) => ({ type: "tool_use", id: `t${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: p.model, usage: { input_tokens: 10, output_tokens: 10 } };
    } } } }) as never;
    await codeInvoice(db, inv, NL, { client: spy([code("6200", "P21")]), now: () => now, model: "claude-sonnet-5-5" });
    const other = await filed(EN);
    await codeInvoice(db, other, EN, { client: spy([code("6200", null, "Down jackets are goods from the manufacturer.")]), now: () => now });
    expect(seen).toEqual(["claude-sonnet-5-5", CODER_MODEL]);
    expect(codings()).toMatchObject([{ model: "claude-sonnet-5-5" }, { model: CODER_MODEL }]);
  });
});

describe("the case, built from the ledger", () => {
  it("carries the supplier, the company's books, the engine's default and the supplier's earlier invoices, newest first", async () => {
    const first = await ingest(NL, scriptedCoder([[code("6200", "P21", REASON, "CC100")]]));
    vi.stubEnv("KIT11_AP_AGENTS", "");
    const second = await ingest(NL.replaceAll("ZV-4471", "ZV-4502").replace("03-11-2026", "05-11-2026").replace("€ 400,00", "€ 500,00").replace("€ 84,00", "€ 105,00").replace("€ 484,00", "€ 605,00"), null, "second.pdf");
    const third = await ingest(NL.replaceAll("ZV-4471", "ZV-4533").replace("03-11-2026", "06-11-2026").replace("€ 400,00", "€ 100,00").replace("€ 84,00", "€ 21,00").replace("€ 484,00", "€ 121,00"), null, "third.pdf");
    db.prepare("UPDATE ap_invoices SET received_at = ? WHERE id = ?").run("2026-11-08T11:00:00.000Z", second);
    db.prepare("UPDATE ap_invoices SET received_at = ? WHERE id = ?").run("2026-11-08T12:00:00.000Z", third);
    const inv = apInvoice(db, third)!;
    const c = codingCaseFor(db, inv, "the text", "2026-11-12");
    expect(c.invoice).toMatchObject({ id: third, vendor: "Zeeland Verpakkingen B.V.", invoice_no: "ZV-4533", total: "121.00", text: "the text" });
    expect(c.supplier).toEqual({ name: "Zeeland Verpakkingen B.V.", country: "NL", vat_id: "NL123456789B01" });
    expect(c.company).toEqual({ name: "Northwind Outdoor", country: "NL" });
    expect(c.engineDefault).toEqual({ account: inv.gl_account, rule: inv.gl_rule, cost_centre: "CC300" });
    expect(c.today).toBe("2026-11-12");
    // The chart is the stored ledger's; only the expense accounts a supplier invoice may be booked to take purchases.
    expect(c.chart.filter((a) => a.purchase).map((a) => a.account)).toEqual(["5000", "6100", "6150", "6200", "6300", "6350", "6800", "6900"]);
    expect(c.chart.find((a) => a.account === "2210")).toMatchObject({ purchase: false });
    expect(c.vatCodes.find((v) => v.code === "PRC_EU")).toEqual({ code: "PRC_EU", label: "Purchase from another EU country (reverse charge)", kind: "purchase", rate: 21, reverse: true, deductible: true });
    expect(c.costCentres.map((x) => x.code)).toEqual(["CC100", "CC200", "CC300", "CC400", "CC500"]);
    // The second invoice has no stored coding: the engine's own coding of it, as one line. The first has the agent's.
    expect(c.history).toEqual([
      { invoice_id: second, invoice_no: "ZV-4502", date: "2026-11-05", lines: [{ description: WHOLE_INVOICE, account: "6900", vat_code: "P21", cost_centre: "CC300" }] },
      { invoice_id: first, invoice_no: "ZV-4471", date: "2026-11-03", lines: [{ description: WHOLE_INVOICE, account: "6200", vat_code: "P21", cost_centre: "CC100" }] },
    ]);
  });
});

describe("ensureCoded: before the accrual is first booked, and only then", () => {
  const filedOff = async (text: string, name = "invoice.pdf") => {
    vi.stubEnv("KIT11_AP_AGENTS", "");
    const id = await ingest(text, null, name);
    vi.stubEnv("KIT11_AP_AGENTS", "on");
    return apInvoice(db, id)!;
  };

  it("does nothing with the flag off, and nothing for an accrual the sink or the ledger already holds", async () => {
    const inv = await filedOff(NL);
    const coder = scriptedCoder([[code("6200", "P21")]]);
    expect(await ensureCoded(db, inv, { client: coder, env: {} })).toBe(inv);
    // The sink got this accrual when it came in, with the flag off: it is not coded afterwards.
    expect(await ensureCoded(db, inv, { client: coder })).toBe(inv);
    const other = await filedOff(EN, "en.pdf");
    db.prepare("DELETE FROM ap_sink_events WHERE invoice_id = ?").run(other.id);
    syncLedger(db, now);
    expect(await ensureCoded(db, other, { client: coder })).toBe(other);
    expect([coder.asked, codings()]).toEqual([0, []]);
  });

  it("reads the stored document itself when the caller has no text", async () => {
    const inv = await filedOff(NL);
    db.prepare("DELETE FROM ap_sink_events WHERE invoice_id = ?").run(inv.id);
    const coder = scriptedCoder([[code("6200", "P21")]]);
    const coded = await ensureCoded(db, inv, { client: coder, now: () => now });
    expect(coder.prompts[0]).toContain("Factuurnummer: ZV-4471");
    expect(coded.coding).toMatchObject({ source: "claude", lines: [{ account: "6200" }] });
  });
});

describe("a payment whose accrual the sink never got", () => {
  it("is coded before the accrual is pushed, then the payment follows", async () => {
    const awx = new FakeAirwallex();
    const live = new Date();
    const world = openDb(":memory:");
    await seedTreasury(world, awx, awx);
    // Filed with the flag off and no sink: nothing was booked anywhere yet.
    vi.stubEnv("KIT11_AP_AGENTS", "");
    const out = await ingestDocument(world, { dir, reader: parserOnly, now: () => live }, { bytes: await pdfOf(EN), filename: "en.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    const id = out.invoice.id;
    const filed = await payApInvoice(world, awx, id, live);
    if (filed.kind !== "proposed") throw new Error(filed.reason);
    const p = world.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(filed.proposal.proposal_id) as { terms_sha256: string };
    decide(world, { proposalId: filed.proposal.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, live);
    await executeInvoicePayment(world, awx, awx, filed.proposal.proposal_id);
    vi.stubEnv("KIT11_AP_AGENTS", "on");
    await syncPayments(world, { now: () => live, sink: deps.sink! });
    // No key in the tests: code's fallback coded it (German VAT at 19%: no VAT code), and the sink got accrual then payment.
    expect(apInvoice(world, id)).toMatchObject({ status: "paid", coding: { source: "fallback", status: "needs_review", lines: [{ account: "6200", vat_code: null }] } });
    expect(world.prepare("SELECT event FROM ap_sink_events WHERE invoice_id = ? ORDER BY rowid").all(id)).toEqual([{ event: "accrual" }, { event: "payment" }]);
    expect(world.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.coded'").get()).toEqual({ n: 1 });
  });
});
