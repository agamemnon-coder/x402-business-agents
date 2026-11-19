// The ledger agents' tools as code answers them (src/agents/controllerCore.ts, src/agents/scheduleCore.ts): every tool
// call is answered from the case only; an unknown entry, an unknown tool, a proposal after the review finished, the
// same proposal twice, one without evidence or past the monthly limit are refused with the reason; a schedule is
// accepted once, and after its last refused try code's own schedule is used.
import { describe, expect, it } from "vitest";
import { answerControllerTool, CONTROLLER_MAX_PROPOSALS, type ControllerCase, type ControllerState, type LedgerInvoice } from "../src/agents/controllerCore.js";
import { answerScheduleTool, type ScheduleCase, type ScheduleState } from "../src/agents/scheduleCore.js";

const inv = (o: Partial<LedgerInvoice>): LedgerInvoice => ({ entry_id: 1, date: "2026-11-03", month: "2026-11", party: "Bergtex Textil GmbH", doc_ref: "BTX-1", description: "Fabric", account: "5000", currency: "EUR", net_cents: 100_000, vat_cents: 21_000, vat_code: "P21", total_cents: 121_000, ...o });

describe("the Controller's tools", () => {
  const c: ControllerCase = {
    month: "2026-11",
    invoices: [inv({ entry_id: 10 }), inv({ entry_id: 11, doc_ref: "BTX-2", vat_cents: 20_000, total_cents: 120_000 }), inv({ entry_id: 12, doc_ref: "X-1", party: "Odd Co", vat_code: "mixed" })],
    history: [inv({ entry_id: 1, date: "2026-10-30", month: "2026-10", doc_ref: "BTX-1" }), inv({ entry_id: 2, date: "2026-09-01", month: "2026-09", doc_ref: "BTX-0", currency: "USD", total_cents: 50_000 })],
  };
  const fresh = (): ControllerState => ({ proposals: [], finished: null });

  it("lists the month's invoices, or says there are none", () => {
    expect(answerControllerTool(c, fresh(), { name: "list_invoices", input: {} }).text.split("\n")).toHaveLength(3);
    expect(answerControllerTool({ ...c, invoices: [] }, fresh(), { name: "list_invoices", input: {} }).text).toBe("No supplier invoices were posted this month.");
  });

  it("a supplier's history per currency, or none", () => {
    const h = answerControllerTool(c, fresh(), { name: "supplier_history", input: { party: "Bergtex Textil GmbH" } }).text;
    expect(h).toMatch(/^1 earlier invoices in EUR, median total 1210\.00:/m);
    expect(h).toMatch(/^1 earlier invoices in USD, median total 500\.00:/m);
    expect(answerControllerTool(c, fresh(), { name: "supplier_history", input: { party: "Nobody" } }).text).toBe("No earlier invoices of Nobody in the ledger.");
  });

  it("the VAT recomputed: right, a mismatch, a code code cannot recompute, an unknown entry", () => {
    expect(answerControllerTool(c, fresh(), { name: "check_vat", input: { entry_id: 10 } }).text).toMatch(/^Right: /);
    expect(answerControllerTool(c, fresh(), { name: "check_vat", input: { entry_id: 11 } }).text).toMatch(/^Mismatch: .*posted 200\.00 \(under by 10\.00\)\.$/);
    expect(answerControllerTool(c, fresh(), { name: "check_vat", input: { entry_id: 12 } }).text).toBe("Code cannot recompute the VAT of entry 12: VAT code mixed.");
    expect(answerControllerTool(c, fresh(), { name: "check_vat", input: { entry_id: 99 } })).toEqual({ text: "Entry 99 is not one of this month's supplier invoices.", blocked: "unknown entry" });
  });

  it("duplicates: found, none, or an unknown entry", () => {
    expect(answerControllerTool(c, fresh(), { name: "find_duplicates", input: { entry_id: 10 } }).text).toMatch(/^- same supplier and the same invoice number BTX-1 \(entry 1, /);
    expect(answerControllerTool(c, fresh(), { name: "find_duplicates", input: { entry_id: 12 } }).text).toBe("No earlier invoice of Odd Co has the same invoice number, or the same total within 14 days.");
    expect(answerControllerTool(c, fresh(), { name: "find_duplicates", input: { entry_id: 99 } }).blocked).toBe("unknown entry");
  });

  it("a proposal with evidence goes to a person once; without evidence, twice, after finishing or past the limit it is refused", () => {
    const s = fresh();
    const vat = { entry_id: 11, kind: "vat_mismatch", duplicate_of: null, reason: "VAT is  short by 10.00" };
    expect(answerControllerTool(c, s, { name: "propose", input: vat }).text).toMatch(/^Proposed for a person to approve: vat_mismatch on entry 11/);
    expect(s.proposals[0]!.reason).toBe("VAT is short by 10.00");
    expect(answerControllerTool(c, s, { name: "propose", input: vat })).toMatchObject({ blocked: "proposed already" });
    expect(answerControllerTool(c, s, { name: "propose", input: { ...vat, entry_id: 10 } })).toMatchObject({ blocked: "evidence", text: expect.stringMatching(/^Refused by code: .*\. Nothing was proposed\.$/) });
    const full: ControllerState = { proposals: Array.from({ length: CONTROLLER_MAX_PROPOSALS }, (_, i) => ({ entry_id: 100 + i, kind: "duplicate", reason: "r", correction: null as never })), finished: null };
    expect(answerControllerTool(c, full, { name: "propose", input: vat })).toMatchObject({ blocked: "proposal limit" });
    expect(answerControllerTool(c, s, { name: "finish", input: { summary: "  One VAT  mismatch. " } })).toEqual({ text: "Review finished.", final: true });
    expect(s.finished).toBe("One VAT mismatch.");
    expect(answerControllerTool(c, s, { name: "propose", input: { ...vat, entry_id: 12 } })).toMatchObject({ blocked: "finished" });
    expect(answerControllerTool(c, s, { name: "pay_everything", input: {} })).toEqual({ text: "There is no tool called pay_everything.", blocked: "unknown tool" });
  });
});

describe("the Treasury agent's schedule tools", () => {
  const c: ScheduleCase = {
    today: "2026-11-19", horizon: "2026-12-31",
    payables: [
      { doc_ref: "BTX-1", party: "Bergtex", currency: "EUR", due_date: "2026-11-10", open_cents: 500_000, note: "Fabric \"rush\"" },
      { doc_ref: "SLL-1", party: "Stockline", currency: "USD", due_date: null, open_cents: 10_000, note: "Data" },
    ],
    cash: { EUR: 1_000_000, USD: -5 }, floors: { EUR: 900_000 }, fourEyesEurCents: 100_000,
  } as ScheduleCase;
  const fresh = (): ScheduleState => ({ schedule: null, summary: "", tries: 0 });

  it("open invoices with what is overdue and above four eyes; none; the cash with its room above each floor", () => {
    const open = answerScheduleTool(c, fresh(), { name: "open_invoices", input: {} }).text.split("\n");
    expect(open[0]).toBe("BTX-1 | Bergtex | 5000.00 EUR open | due 2026-11-10 (9 days overdue) | above the four-eyes threshold | \"Fabric 'rush'\"");
    expect(open[1]).toMatch(/^SLL-1 \| Stockline \| 100\.00 USD open \| due not stated \| "Data"$/);
    expect(answerScheduleTool({ ...c, payables: [] }, fresh(), { name: "open_invoices", input: {} }).text).toBe("No open supplier invoices.");
    const cash = answerScheduleTool(c, fresh(), { name: "cash_position", input: {} }).text;
    expect(cash).toContain("EUR: cash 10000.00, floor 9000.00, room above the floor 1000.00");
    expect(cash).toContain("USD: cash 0.00, floor 0.00, room above the floor none");
    expect(cash).toContain("Four eyes: payments above 1000.00 EUR need two people.");
    expect(answerScheduleTool({ ...c, fourEyesEurCents: null }, fresh(), { name: "cash_position", input: {} }).text).toContain("Four eyes: no threshold set.");
  });

  it("a schedule that breaks a rule is refused with each problem; after the last try code's schedule is used; an unknown tool is refused", () => {
    const s = fresh();
    const bad = { payments: [{ doc_ref: "NOPE", pay_on: "2026-11-20" }], deferred: [], summary: "pay it" };
    let last: { text: string; blocked?: string; final?: boolean } = { text: "" };
    for (let i = 0; i < 10 && !last.final; i++) last = answerScheduleTool(c, s, { name: "propose_schedule", input: bad });
    expect(last).toMatchObject({ blocked: "schedule check", final: true, text: expect.stringMatching(/^Refused by code: .* No tries left; code's schedule will be used\.$/) });
    expect(s.schedule).toBeNull();
    expect(answerScheduleTool(c, s, { name: "wire", input: {} })).toEqual({ text: "There is no tool called wire.", blocked: "unknown tool" });
  });
});
