// The Payer agent in the runner's payables chain (KIT11_AP_AGENTS=on): the engine plans a ready invoice's payment as
// always, Claude proposes the rail, the day and the currency on that plan, and code enforces it. Breaks if a proposal
// that would take a balance below its floor is filed, if a rail the supplier does not accept gets through, if a
// payment the agent set for a later day is filed today, if the CFO's signature over the exact terms changes, if a run
// without Claude is not labelled as code's fallback, or if the flag being off changes anything. A scripted stand-in
// for the Claude client and the in-memory Airwallex stand-in: no network, test money.
import { standInBank } from "./support/standInBank.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import { PAY_LATER, PAYER_DECISION } from "../src/ap/payerAgent.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, setStatus } from "../src/ap/store.js";
import { executePayeeAdd, checkThenProposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { audit } from "../src/audit/log.js";
import { MODELS } from "../src/claude/reader.js";
import { agentStats } from "../src/dashboard/agentStats.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { payoutBeneficiary } from "../src/payouts/plan.js";
import { decide } from "../src/policy/approvals.js";
import { originsCheck } from "../src/provenance/check.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

// The executor checks the terms against the real clock, so the test runs on it too.
const now = new Date();
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const TODAY = day(0);
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "Havenweg 2", city: "Vlissingen", postcode: "4381 AA" };
const HOW = "called Zeeland Verpakkingen on the number in our signed 2025 contract; their accounts team confirmed the IBAN";
/** The Dutch invoice with a due date ten days from now, so a later day within it exists whenever the test runs. */
const dutch = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const NL_DUE_LATER = NL.replace("Vervaldatum: 17-11-2026", `Vervaldatum: ${dutch(day(10))}`).replace("Factuurdatum: 03-11-2026", `Factuurdatum: ${dutch(day(-4))}`);

type Call = { name: string; input: unknown };
function fake(turns: Call[][], model: string = MODELS.classify): Anthropic & { asked: number } {
  const client = { asked: 0, beta: { messages: { create: async () => {
    const t = turns[client.asked++];
    const usage = { input_tokens: 700, output_tokens: 90 };
    if (!t) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model, usage, _request_id: `req_pay${client.asked}` };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${client.asked}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model, usage, _request_id: `req_pay${client.asked}` };
  } } } };
  return client as unknown as Anthropic & { asked: number };
}
const never = (): Anthropic => ({ beta: { messages: { create: async () => { throw new Error("Claude was called"); } } } }) as unknown as Anthropic;
const propose = (rail: string, payOn: string, payCurrency: string, reason: string): Call => ({ name: "propose_payment", input: { rail, pay_on: payOn, pay_currency: payCurrency, reason } });
const LOOKUPS: Call[] = [{ name: "cash_position", input: {} }, { name: "supplier_rails", input: {} }, { name: "fx_quote", input: {} }, { name: "due_date", input: {} }];
const ON_QUOTE = "Paying today from the USD balance on the locked quote keeps every balance above its floor.";

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  process.env.KIT11_AP_AGENTS = "on";
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-payer-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  // The Checker has no Claude here: code's checks decide each invoice, labelled as the fallback.
  deps = { dir, reader: parserOnly, now: () => now, claude: null };
});
afterEach(() => {
  delete process.env.KIT11_AP_AGENTS;
  rmSync(dir, { recursive: true, force: true });
});

const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
};
const add = async (text: string, name = "invoice.pdf") => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
/** The three steps for the invoice's supplier (a request, a person's verification, the CFO's approval). */
const addSupplier = async (id: string) => {
  const req = requestPayeeAddForInvoice(db, id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
  approve(p.proposal_id);
  await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly, claude: null }, now);
};
const proposals = () => (db.prepare("SELECT actor, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(PAYER_DECISION) as { actor: string; subject: string; payload_json: string }[])
  .map((r): Record<string, unknown> => ({ actor: r.actor, subject: r.subject, ...(JSON.parse(r.payload_json) as Record<string, unknown>) }));
const filed = () => (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind IN ('invoice_payment', 'supplier_payment')").get() as { n: number }).n;
const created = () => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.created' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined);
const blockedBy = () => (db.prepare("SELECT json_extract(payload_json, '$.blocked_by') AS b FROM audit_log WHERE event = 'agent.tool' AND actor = 'payer' ORDER BY seq").all() as { b: string | null }[]).map((r) => r.b);

describe("the Payer agent proposes, code enforces, the CFO signs", () => {
  it("proposes today on the supplier's rail from the quote: the engine's exact terms are filed, signed and paid as before", async () => {
    const id = await add(EN);
    const claude = fake([LOOKUPS, [propose("bank_swift", TODAY, "USD", ON_QUOTE)]]);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude });
    if (out.kind !== "proposed") throw new Error(out.reason);
    const terms = JSON.parse(out.proposal.terms_json) as { kind: string; method: string; amount: string; conversion: { sell_currency: string; buy_amount: string } | null };
    expect(terms).toMatchObject({ kind: "invoice_payment", method: "SWIFT", amount: "1850.00", conversion: { sell_currency: "USD", buy_currency: "EUR" } });
    expect(apInvoice(db, id)!.status).toBe("waiting_cfo");

    const [d] = proposals();
    expect(d).toMatchObject({
      actor: "payer", subject: id, invoice_id: id, invoice_no: "BTX-2026-21", source: "claude", model: MODELS.classify,
      rail: "bank_swift", pay_on: TODAY, pay_currency: "USD", reason: ON_QUOTE,
      outcome: "ask_cfo", overridden_by: "no_alone_limit", overridden: false, next: "file_for_cfo",
      terms: { rail: "bank_swift", method: "SWIFT", pay_on: TODAY, pay_currency: "USD", amount: "1850.00", currency: "EUR", conversion: { sell_currency: "USD", buy_amount: terms.conversion!.buy_amount } },
      origin: { actor: "agent", agent: "payer", model: MODELS.classify, request_id: "req_pay2" },
    });
    // The proposal records the agent's run as who started it; the CFO's signature over the exact terms is unchanged.
    const origin = (JSON.parse(created()!.payload_json) as { origin: { actor: string; agent: string; run_id: string } }).origin;
    expect(origin).toMatchObject({ actor: "agent", agent: "payer", run_id: (d!.origin as { run_id: string }).run_id });
    // Nothing the agents wrote is a money movement without an origin (npm run origins).
    expect(originsCheck(db).missing).toEqual([]);
    approve(out.proposal.proposal_id);
    await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(agentStats(db).find((s) => s.agent === "payer")).toMatchObject({ decisions: 1, by_claude: 1, fallback: 0, overridden: 0 });
  });

  it("proposes paying from a balance that would fall below its floor: code holds it, nothing is filed, the override is counted", async () => {
    const id = await add(EN);
    const claude = fake([[propose("bank_swift", TODAY, "EUR", "Paying today from the EUR balance is the simplest way and avoids a conversion.")]]);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude });
    expect(out.kind).toBe("escalated");
    expect(filed()).toBe(0);
    const [d] = proposals();
    expect(d).toMatchObject({ source: "claude", pay_currency: "EUR", outcome: "hold", overridden: true, next: "hold", terms: null });
    expect(["below_floor", "not_enough_money"]).toContain(d!.overridden_by);
    const inv = apInvoice(db, id)!;
    expect(inv.status).toBe("ready");
    expect(inv.findings.find((f) => f.code === "payment_not_planned")?.detail).toMatch(/the Payer agent's proposal is held by code: .*EUR/);
    expect(agentStats(db).find((s) => s.agent === "payer")).toMatchObject({ decisions: 1, by_claude: 1, overridden: 1 });
  });

  it("an invoice a person rejects while the agent works is not filed, and the rejection stands (review round 1)", async () => {
    const id = await add(EN);
    const script = fake([[propose("bank_swift", TODAY, "USD", ON_QUOTE)]]);
    const create = script.beta.messages.create.bind(script.beta.messages);
    let rejected = false;
    const claude = { beta: { messages: { create: async (...a: unknown[]) => {
      if (!rejected) { rejected = true; setStatus(db, id, "rejected", "human", { reason: "looks like fraud" }, now); }
      return (create as (...b: unknown[]) => unknown)(...a);
    } } } } as unknown as Anthropic;
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude });
    expect(out.kind).toBe("escalated");
    if (out.kind === "escalated") expect(out.reason).toMatch(/rejected now, no longer ready/);
    expect(filed()).toBe(0);
    expect(apInvoice(db, id)!.status).toBe("rejected");
    const moves = (db.prepare("SELECT json_extract(payload_json, '$.from') AS f, json_extract(payload_json, '$.to') AS t FROM audit_log WHERE event = 'ap.status' AND subject = ? ORDER BY seq").all(id) as { f: string; t: string }[]).map((r) => `${r.f}->${r.t}`);
    expect(moves).not.toContain("rejected->waiting_cfo");
    expect(moves.at(-1)).toBe("ready->rejected");
  });

  it("of two proposals in one turn, the first stands: the second is refused and changes nothing (review round 1)", async () => {
    const id = await add(EN);
    // The first (from EUR) is held by code at the floor; the second (from the quote) would be filed if it counted.
    const claude = fake([[propose("bank_swift", TODAY, "EUR", "Paying today from the EUR balance avoids a conversion."), propose("bank_swift", TODAY, "USD", ON_QUOTE)]]);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude });
    expect(out.kind).toBe("escalated");
    expect(filed()).toBe(0);
    expect(blockedBy()).toEqual([null, "already proposed"]);
    expect(proposals()).toHaveLength(1);
    expect(proposals()[0]).toMatchObject({ source: "claude", pay_currency: "EUR", outcome: "hold", next: "hold" });
  });

  it("a rail the supplier does not accept is refused by the tool, and the agent proposes again", async () => {
    const id = await add(EN);
    const claude = fake([[propose("bank_local", TODAY, "USD", ON_QUOTE)], [propose("bank_swift", TODAY, "USD", ON_QUOTE)]]);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude });
    expect(out.kind).toBe("proposed");
    expect(blockedBy()).toEqual(["rail_not_accepted", null]);
    expect(proposals()[0]).toMatchObject({ rail: "bank_swift", next: "file_for_cfo" });
  });

  it("names a later day within the due date: nothing is filed today, and the invoice says which day; filed when the agent says today", async () => {
    const id = await add(NL_DUE_LATER, "zeeland.pdf");
    await addSupplier(id);
    expect(apInvoice(db, id)!.status).toBe("ready");
    const rail = payoutBeneficiary(db, "Zeeland Verpakkingen B.V.")!.details.method === "LOCAL" ? "bank_local" : "bank_swift";
    const later = day(3);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude: fake([[propose(rail, later, "EUR", `Paying on ${later} keeps the cash a little longer and is still before the due date.`)]]) });
    expect(out.kind).toBe("escalated");
    expect(filed()).toBe(0);
    expect(proposals()[0]).toMatchObject({ source: "claude", pay_on: later, outcome: "ask_cfo", overridden: false, next: "pay_later", terms: { pay_on: later, method: rail === "bank_local" ? "LOCAL" : "SWIFT" } });
    const waiting = apInvoice(db, id)!;
    expect(waiting.status).toBe("ready");
    expect(waiting.findings.find((f) => f.code === PAY_LATER)).toMatchObject({ level: "warn", detail: expect.stringContaining(`the Payer agent plans to pay it on ${later}, not today`) });
    expect(waiting.findings.some((f) => f.code === "payment_not_planned")).toBe(false);

    const again = await payApInvoice(db, awx, id, now, parserOnly, { claude: fake([[propose(rail, TODAY, "EUR", "Paying today from the EUR balance keeps it above its floor.")]]) });
    if (again.kind !== "proposed") throw new Error(again.reason);
    expect(JSON.parse(again.proposal.terms_json)).toMatchObject({ kind: "supplier_payment", method: rail === "bank_local" ? "LOCAL" : "SWIFT", conversion: null });
    const sent = apInvoice(db, id)!;
    expect(sent.status).toBe("waiting_cfo");
    expect(sent.findings.some((f) => f.code === PAY_LATER)).toBe(false);
  });

  it("a day after the due date is refused by the tool: the CFO's policy does not allow paying late", async () => {
    const id = await add(NL_DUE_LATER, "zeeland.pdf");
    await addSupplier(id);
    const rail = payoutBeneficiary(db, "Zeeland Verpakkingen B.V.")!.details.method === "LOCAL" ? "bank_local" : "bank_swift";
    const late = day(12);
    const claude = fake([[propose(rail, late, "EUR", `Paying on ${late} is late, after the due date, but it keeps the cash longer.`)], [propose(rail, TODAY, "EUR", "Paying today from the EUR balance keeps it above its floor.")]]);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude });
    expect(out.kind).toBe("proposed");
    expect(blockedBy()).toEqual(["after_due_date", null]);
  });

  it("without Claude, the engine's own plan stands and is labelled as the fallback", async () => {
    const id = await add(EN);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude: null });
    expect(out.kind).toBe("proposed");
    const [d] = proposals();
    expect(d).toMatchObject({ source: "fallback", model: null, rail: "bank_swift", pay_on: TODAY, pay_currency: "USD", outcome: "ask_cfo", overridden: false, next: "file_for_cfo", note: "no KIT11_ANTHROPIC_API_KEY", origin: { actor: "code", agent: "payer" } });
    expect(String(d!.reason)).toMatch(/^Code's plan, without Claude:/);
    expect((JSON.parse(created()!.payload_json) as { origin: { actor: string } }).origin).toMatchObject({ actor: "code", agent: "payer" });
    expect(agentStats(db).find((s) => s.agent === "payer")).toMatchObject({ decisions: 1, by_claude: 0, fallback: 1, fallback_pct: 100, overridden: 0 });
  });

  it("at its cost cap it makes no call: the engine's plan stands, labelled as the fallback with the cap as the reason", async () => {
    const id = await add(EN);
    audit(db, "payer", "agent.run", "ap.pay.earlier", { agent: "payer", cost_usd_micros: 10_000_000 });
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude: never() });
    expect(out.kind).toBe("proposed");
    expect(proposals()[0]).toMatchObject({ source: "fallback", next: "file_for_cfo" });
    expect(String(proposals()[0]!.note)).toMatch(/^cost cap: /);
  });

  it("an agent that never proposes is sent back once; then the engine's plan stands", async () => {
    const id = await add(EN);
    const claude = fake([LOOKUPS]);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude });
    expect(claude.asked).toBe(3);
    expect(out.kind).toBe("proposed");
    expect(proposals()[0]).toMatchObject({ source: "fallback" });
  });

  it("each invoice of a batch gets its own proposal by the agent, and one Face ID covers the batch as before", async () => {
    const id = await add(EN);
    const out = await payApInvoices(db, awx, [id], now, parserOnly, { claude: fake([[propose("bank_swift", TODAY, "USD", ON_QUOTE)]]) });
    expect(out.planned).toHaveLength(1);
    expect(out.batch).not.toBeNull();
    expect(proposals()).toHaveLength(1);
  });

  it("an invoice the engine itself will not plan never reaches the agent", async () => {
    const id = await add(EN);
    // The CFO's policy blocks the payee after the invoice was checked: the engine stops before any plan exists.
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('counterparty:Bergtex Textil GmbH', 'blocked', ?)").run(now.toISOString());
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude: never() });
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringContaining("blocked by the CFO policy") });
    expect(proposals()).toHaveLength(0);
    expect(filed()).toBe(0);
  });
});

describe("with the flag off nothing changes", () => {
  it("the engine files its plan, Claude is never asked, and no agent row is written", async () => {
    delete process.env.KIT11_AP_AGENTS;
    const id = await add(EN);
    const out = await payApInvoice(db, awx, id, now, parserOnly, { claude: never() });
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(JSON.parse(out.proposal.terms_json)).toMatchObject({ kind: "invoice_payment", method: "SWIFT", conversion: { sell_currency: "USD" } });
    expect((JSON.parse(created()!.payload_json) as { origin: unknown }).origin).toBeNull();
    const events = (db.prepare("SELECT event FROM audit_log ORDER BY seq").all() as { event: string }[]).map((r) => r.event);
    expect(events.filter((e) => e.startsWith("agent.") || e.startsWith("ap.payer") || e.startsWith("ap.checker"))).toEqual([]);
    expect(agentStats(db)).toEqual([]);
  });
});
