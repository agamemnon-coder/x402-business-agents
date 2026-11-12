// Master list 684 and 685: token status per invoice, read only from token records and labelled where they came from;
// and "Finance this invoice": the proposal's hash is what the CFO signs, and an advance changed after signing is
// refused before the token is sent. In memory, no network, no chain.
import { describe, expect, it } from "vitest";
import { canFinance, executeFinancing, financeTerms, FinanceRefused, localFinanceSource, proposalCard, proposeFinancing, type TokenizedInvoice } from "../cloud/src/financeFlow.js";
import { ORIGIN_LABEL, tokenStatus, type TokenRecordView } from "../cloud/src/tokenStatus.js";
import { openDb } from "../src/db/open.js";
import { termsHash } from "../src/lib/terms.js";
import { decide } from "../src/policy/approvals.js";
import { CHAIN_ID, EXPLORER_TX } from "../src/metal/network.js";
import { discountedPrice } from "../src/tokenize/flow.js";
import { baseUnitsToCents, centsToBaseUnits, toCents } from "../src/lib/money.js";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const TERMS = "ab".repeat(32);

function record(o: { live?: boolean; steps?: ("mint" | "accept" | "settle")[]; status?: "success" | "reverted" | "signed" } = {}): TokenRecordView {
  const keys = o.steps ?? ["mint", "accept", "settle"];
  return {
    kind: "tokenize-run",
    labels: o.live ? { network: "Metal testnet", chain_id: CHAIN_ID, test_money: true, financier: "simulated", face_value_scaled_by: 100 } : undefined,
    invoice: { invoice_no: "SLL-2026-11B", proposal_id: "P-0001", terms_sha256: TERMS, approval: { approved_at: "2026-11-11T09:00:00.000Z", test_passkey: true } },
    transactions: keys.map((key, i) => ({ key, hash: h(i + 1), explorer: `${EXPLORER_TX}${h(i + 1)}`, status: key === keys.at(-1) ? (o.status ?? "success") : "success", at: `2026-11-11T09:0${i + 1}:00.000Z` })),
    verify: { ok: true, at: "2026-11-11T09:10:00.000Z", mismatches: [] },
  };
}

describe("token status per invoice", () => {
  it("shows no token row for an invoice without a record", () => {
    expect(tokenStatus("OTHER-1", [record()])).toBeNull();
    expect(tokenStatus("SLL-2026-11B", [])).toBeNull();
  });

  it("reads every step from the record, with explorer links only for a Metal testnet record", () => {
    const live = tokenStatus("SLL-2026-11B", [record({ live: true })])!;
    expect(live.origin).toBe("metal-testnet");
    expect(live.label).toBe(ORIGIN_LABEL["metal-testnet"]);
    expect(live.steps.map((s) => [s.step, s.done])).toEqual([["signed", true], ["tokenized", true], ["financed", true], ["settled", true]]);
    expect(live.steps[0]!.tx).toBeNull();
    expect(live.steps[1]!.tx).toEqual({ hash: h(1), url: `${EXPLORER_TX}${h(1)}` });
    expect(live.reached).toBe("settled");
    expect(live.terms_sha256).toBe(TERMS);
  });

  it("labels a record that does not say Metal testnet as a local test chain or a stand-in, and links nothing", () => {
    const local = tokenStatus("SLL-2026-11B", [record()])!;
    expect(local.origin).toBe("local-test-chain");
    expect(local.label).toMatch(/^Local test chain/);
    expect(local.steps.every((s) => s.tx === null || s.tx.url === null)).toBe(true);
    const standIn = tokenStatus("SLL-2026-11B", [record()], { otherwise: "stand-in" })!;
    expect(standIn.label).toMatch(/^Stand-in/);
    // A record that claims the network with another chain id is not Metal testnet.
    const other = record({ live: true });
    other.labels!.chain_id = 1;
    expect(tokenStatus("SLL-2026-11B", [other])!.origin).toBe("local-test-chain");
  });

  it("marks a step done only with a successful receipt, and never invents a hash", () => {
    const minted = tokenStatus("SLL-2026-11B", [record({ steps: ["mint"] })])!;
    expect(minted.steps.map((s) => s.done)).toEqual([true, true, false, false]);
    expect(minted.steps[2]!.tx).toBeNull();
    const reverted = tokenStatus("SLL-2026-11B", [record({ steps: ["mint", "accept"], status: "reverted" })])!;
    expect(reverted.steps[2]).toMatchObject({ done: false, note: "the transaction reverted", tx: { hash: h(2) } });
    expect(reverted.reached).toBe("tokenized");
    const pending = tokenStatus("SLL-2026-11B", [record({ steps: ["mint"], status: "signed" })])!;
    expect(pending.steps[1]).toMatchObject({ done: false, note: "sent, no receipt yet" });
    const bad = record({ steps: ["mint"] });
    bad.transactions[0]!.hash = "not-a-hash";
    expect(tokenStatus("SLL-2026-11B", [bad])!.steps[1]).toMatchObject({ done: false, tx: null });
  });
});

const INV: TokenizedInvoice = { invoice_no: "SLL-2026-11B", token_id: h(99), currency: "EUR", face_cents: 24_000, due_date: "2026-11-15", document_sha256: "cd".repeat(32) };
const NOW = new Date("2026-11-12T10:00:00.000Z");

describe("Finance this invoice", () => {
  it("is offered only on a minted token that is not financed or settled", () => {
    expect(canFinance(tokenStatus("SLL-2026-11B", [record({ steps: ["mint"] })]))).toBe(true);
    expect(canFinance(tokenStatus("SLL-2026-11B", [record()]))).toBe(false);
    expect(canFinance(null)).toBe(false);
  });

  it("proposes discount, advance, cost and settlement date in whole cents, the advance being the contract's price", () => {
    const t = financeTerms(INV, localFinanceSource(), "P-0001", "2026-11-12T10:20:00Z");
    expect(t).toMatchObject({ face_value: "240.00", discount_bps: "200", advance: "235.20", cost: "4.80", settlement_date: "2026-11-15", financier: "Simulated financier (testnet)" });
    expect(toCents(t.advance)).toBe(baseUnitsToCents(discountedPrice(centsToBaseUnits(24_000), 200)));
    expect(t.credit_check).toMatch(/no credit check/);
    expect(proposalCard(t)).toMatchObject({ advance: "235.20", cost: "4.80", discount: "2.00%", financier: "Simulated financier (testnet)" });
    expect(() => localFinanceSource({ FINANCE_DISCOUNT_BPS: "0" })).toThrow();
    expect(financeTerms(INV, localFinanceSource({ FINANCE_DISCOUNT_BPS: "350" }), "P-1", "2026-11-12T10:20:00Z").advance).toBe("231.60");
  });

  it("files the proposal whose hash is what the CFO signs, sends the token once approved, and refuses a changed advance", async () => {
    const db = openDb(":memory:");
    const status = tokenStatus("SLL-2026-11B", [record({ steps: ["mint"] })]);
    const p = proposeFinancing(db, INV, status, localFinanceSource(), NOW);
    expect(p.terms_sha256).toBe(termsHash(p.terms));
    decide(db, { proposalId: p.proposal.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW);
    const signed = (db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ?").get(p.proposal.proposal_id) as { approved_sha256: string }).approved_sha256;
    expect(signed).toBe(p.terms_sha256);

    // A second proposal, changed after signing: refused before anything is sent.
    const db2 = openDb(":memory:");
    const q = proposeFinancing(db2, INV, status, localFinanceSource(), NOW);
    decide(db2, { proposalId: q.proposal.proposal_id, decision: "APPROVED", typedPrefix: q.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW);
    const row = db2.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(q.proposal.proposal_id) as { terms_json: string };
    db2.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(row.terms_json.replace('"advance":"235.20"', '"advance":"235.21"'), q.proposal.proposal_id);
    let sent = 0;
    const send = async () => { sent += 1; return { tx_hash: h(7) }; };
    await expect(executeFinancing(db2, q.proposal.proposal_id, send, () => NOW)).rejects.toThrow(`terms do not match the approved hash ${q.terms_sha256}`);
    expect(sent).toBe(0);

    // The untouched one goes to the simulated financier.
    const r = await executeFinancing(db, p.proposal.proposal_id, send, () => NOW);
    expect(r).toEqual({ tx_hash: h(7), terms_sha256: signed });
    expect(sent).toBe(1);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal.proposal_id) as { status: string }).status).toBe("EXECUTED");
  });

  it("refuses to propose for a token that is not ready, or when a credit check said no", () => {
    const db = openDb(":memory:");
    expect(() => proposeFinancing(db, INV, null, localFinanceSource(), NOW)).toThrow(FinanceRefused);
    const no = { name: "test source", offer: () => ({ discount_bps: 200, credit_check: { done: true, ok: false, note: "limit reached" } }) };
    expect(() => proposeFinancing(db, INV, tokenStatus("SLL-2026-11B", [record({ steps: ["mint"] })]), no, NOW)).toThrow(/credit check said no \(limit reached\)/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });
});
