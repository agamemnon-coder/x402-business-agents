// The payment rationale record (src/payouts/rationale.ts): for every supplier payment Purser executed or refused, a short
// structured "why" is stored in the audit log (payment.rationale) and shown on the invoice's page (src/ap/detail.ts,
// in words by src/servers/rationaleWords.ts): the account and currency that funded it, the rail (LOCAL or SWIFT) and its
// fee, the CFO policy rule and version it ran under, and the approval that covered it. Every value must come from the
// record (the signed terms, the approval row, the policy version, the transfer row), never be written by hand. Breaks
// if a payment ends without its rationale, if a value disagrees with the record, or if a refusal loses its reason.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoiceDetail } from "../src/ap/detail.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { buildRationale, RATIONALE_EVENT, readRationale, type PaymentRationale } from "../src/payouts/rationale.js";
import { policyAt } from "../src/policy/versions.js";
import { setSetting } from "../src/world/settings.js";
import { detailPage } from "../src/servers/payablesPage.js";
import { RATIONALE_WORDS_JS } from "../src/servers/rationaleWords.js";
import { NL } from "./fakes/apInvoices.js";
import { CN, US } from "./fakes/fxInvoices.js";
import { supplierWorld, type SupplierWorld } from "./support/supplierWorld.js";

let w: SupplierWorld;
beforeEach(async () => { w = await supplierWorld(); });
afterEach(() => w.done());

const stored = (id: string) => (w.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ? AND subject = ?").get(RATIONALE_EVENT, id) as { n: number }).n;
const approvalRow = (id: string) => w.db.prepare("SELECT approver, method, approved_sha256, policy_version, created_at FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(id) as
  { approver: string; method: string; approved_sha256: string; policy_version: number; created_at: string };
/** The page's own words function, run on the same text the browser gets. */
const words = new Function(`${RATIONALE_WORDS_JS}; return rationaleWords;`)() as (r: PaymentRationale) => Record<"funding" | "rail" | "rule" | "approval" | "replacement" | "refused", string>;

describe("an executed payment's rationale", () => {
  it("EUR to a Dutch IBAN: from the EUR balance with no conversion, on LOCAL (SEPA), under the recorded policy version and approval", async () => {
    const { invoiceId, proposalId, terms } = await w.approvedPayment(NL, "nl.pdf");
    await executeSupplierPayment(w.db, w.awx, w.awx, proposalId);
    expect(stored(proposalId)).toBe(1);
    const r = readRationale(w.db, proposalId)!;
    const a = approvalRow(proposalId);
    const tr = w.awx.transfers.at(-1)!;
    expect(r).toMatchObject({
      proposal_id: proposalId, kind: "supplier_payment", outcome: "executed", amount: terms.amount, currency: "EUR", payee: terms.beneficiary_name, invoice_no: terms.invoice_no,
      funding: { account: null, balance: terms.balances_before.EUR, floor: terms.floors.EUR, conversion: null },
      rail: { method: "LOCAL", clearing: terms.clearing, to: terms.account, fee_held: `EUR ${terms.fee_reserve}` },
      approval: { decision: "APPROVED", by: a.approver, method: a.method, at: a.created_at, terms_sha256: a.approved_sha256 },
      rule: { key: "ap.alone_eur", policy_version: a.policy_version, policy_sha256: policyAt(w.db, a.policy_version)!.sha256, by_code: false },
      transfer: { request_id: terms.transfer_request_id, transfer_id: tr.id, status: "PAID" },
      replacement: null, refused: null,
    });
    // In words, with the record's own numbers.
    const say = words(r);
    expect(say.funding).toBe(`Paid EUR from the EUR balance, no conversion: it held EUR ${terms.balances_before.EUR}, enough for EUR ${terms.amount} and its fee above the floor of EUR ${terms.floors.EUR}`);
    expect(say.rail).toMatch(new RegExp(`^LOCAL: ${terms.account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} takes EUR on a local route, so it is not sent by SWIFT`));
    expect(say.approval).toBe(`cfo approved the exact terms (hash ${a.approved_sha256.slice(0, 8)}) by cli`);
    expect(say.rule).toMatch(/^no limit to pay alone is set \(ap\.alone_eur\), so a person decides every supplier payment$/);
    // Shown on the invoice's page, exactly as stored.
    expect((await invoiceDetail(w.db, invoiceId))!.rationale).toEqual(r);
  });

  it("CNY to China: the shortfall bought from EUR on the locked quote, sent by SWIFT", async () => {
    const { proposalId, terms } = await w.approvedPayment(CN, "cn.pdf");
    await executeSupplierPayment(w.db, w.awx, w.awx, proposalId);
    const r = readRationale(w.db, proposalId)!;
    const c = terms.conversion!;
    expect(r.funding.conversion).toEqual({ sell: `${c.sell_currency} ${c.sell_amount}`, buy: `${c.buy_currency} ${c.buy_amount}`, rate: c.client_rate, quote_id: c.quote_id });
    expect(words(r).funding).toContain(`after buying CNY ${c.buy_amount} with EUR ${c.sell_amount} at ${c.client_rate} (quote ${c.quote_id})`);
    expect(r.rail).toMatchObject({ method: "SWIFT", fee_held: `CNY ${terms.fee_reserve}` });
    expect(words(r).rail).toMatch(/^SWIFT: Airwallex has no local route for CNY/);
  });

  it("USD by ACH: the clearing system is named and the fee Airwallex charged is read from the transfer row", async () => {
    const { proposalId } = await w.approvedPayment(US, "us.pdf");
    await executeSupplierPayment(w.db, w.awx, w.awx, proposalId);
    const r = readRationale(w.db, proposalId)!;
    const fee = (w.db.prepare("SELECT fee_actual FROM transfers").get() as { fee_actual: string | null }).fee_actual;
    expect(r.rail).toMatchObject({ method: "LOCAL", clearing: "ACH", fee_charged: fee });
    expect(words(r).rail).toMatch(/^LOCAL \(ACH\)/);
  });

  it("is stored once: running the payment again stores nothing new while nothing changed", async () => {
    const { proposalId } = await w.approvedPayment(NL, "nl.pdf");
    await executeSupplierPayment(w.db, w.awx, w.awx, proposalId);
    await executeSupplierPayment(w.db, w.awx, w.awx, proposalId).catch(() => {});
    expect(stored(proposalId)).toBe(1);
  });
});

describe("a refused payment's rationale", () => {
  it("the emergency stop pulled after the approval: refused with the reason, nothing at Airwallex, still with the approval that covered it", async () => {
    const { invoiceId, proposalId } = await w.approvedPayment(NL, "nl.pdf");
    setSetting(w.db, "human", "freeze", "on");
    await expect(executeSupplierPayment(w.db, w.awx, w.awx, proposalId)).rejects.toThrow(/emergency stop/);
    expect(w.awx.transfers).toHaveLength(0);
    const r = readRationale(w.db, proposalId)!;
    expect(r.outcome).toBe("refused");
    expect(r.refused).toMatch(/emergency stop/);
    expect(words(r).refused).toBe(r.refused);
    expect(r.transfer).toBeNull();
    expect(r.approval).toMatchObject({ by: "cfo", method: "cli" });
    expect((await invoiceDetail(w.db, invoiceId))!.rationale).toEqual(r);
  });

  it("terms changed after the approval get no rationale: their values are not the record", async () => {
    const { proposalId } = await w.approvedPayment(NL, "nl.pdf");
    const t = JSON.parse((w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string }).terms_json) as Record<string, unknown>;
    w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, amount: "9.00" }), proposalId);
    expect(buildRationale(w.db, proposalId)).toBeNull();
    expect(buildRationale(w.db, "P-9999")).toBeNull();
  });
});

describe("the invoice page shows it", () => {
  it("the detail script carries the words function and draws the card from the detail's own fields", () => {
    const html = detailPage("c", "n", "AP-0001", "en");
    expect(html).toContain(RATIONALE_WORDS_JS);
    expect(html).toContain("rationaleWords(why)");
    expect(html).toContain("WHY_LABELS[NL?'nl':'en']");
  });
});
