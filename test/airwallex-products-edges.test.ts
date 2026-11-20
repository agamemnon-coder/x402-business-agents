// /airwallex's tiles and folds (src/redesign/airwallexProducts.ts) on records that do not hold what a tile needs: each
// tile is left out (null) rather than shown with a figure its record does not prove, and each fold says only what its
// record says. The real records are read and then changed in memory, one fact at a time; nothing is written.
import { describe, expect, it } from "vitest";
import {
  acceptanceRun, acceptanceTile, airiTile, approvalsTile, batchTile, connectedTile, faceIdFoldHtml, firstConnectedRun, flaggedHtml, fxQuote, fxTile,
  issuingTile, kitSwift, ledgerTile, payeeCheckTile, payoutTile, platformFoldHtml, platformRun, platformRunOfRecord, swiftLineHtml, switchedOnKeys,
  tilesCountWords, twoLocksState, type PlatformRun, type ProductTile, type TwoLocks,
} from "../src/redesign/airwallexProducts.js";
import { awxRun } from "../src/redesign/awxRun.js";
import { airiRun } from "../src/redesign/airiRun.js";
import { agentRun } from "../src/redesign/run.js";
import { liveRuns } from "../src/redesign/runs.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("the Issuing tile needs the whole story in its record", () => {
  const rec = awxRun()!;
  it("as recorded: Airwallex's decline, the raise asked of the CFO, the same charge approved", () => {
    const t = issuingTile(rec)!;
    expect(t.states!.map((s) => s.tone)).toEqual(["bad", "hold", "ok"]);
    expect(issuingTile(null)).toBeNull();
  });
  const broken: [string, (r: typeof rec) => void][] = [
    ["no raise asked for the decline", (r) => { r.declines_met = []; }],
    ["the raise not executed", (r) => { for (const p of r.proposals) p.status = "REJECTED"; }],
    ["no approved retry of the same charge", (r) => { r.card_transactions = r.card_transactions.filter((t) => !t.approved); }],
    ["the card's limit not as Airwallex read it back", (r) => { for (const c of r.cards) (c.read_back as { per_tx: unknown }).per_tx = "about thirty"; }],
    ["the raised limit still under the charge", (r) => { for (const c of r.cards) if (c.read_back_end) (c.read_back_end as { per_tx: unknown }).per_tx = "0.01"; }],
  ];
  for (const [what, f] of broken) it(`no tile with ${what}`, () => { const r = clone(rec); f(r); expect(issuingTile(r)).toBeNull(); });
  it("approved with a test passkey, the tile says the CFO's approval, not Face ID", () => {
    const r = clone(rec);
    for (const p of r.proposals) (p as { virtual_test_passkey?: boolean }).virtual_test_passkey = true;
    expect(issuingTile(r)!.states!.at(-1)!.text).toBe("Approved after the CFO's approval");
  });
});

describe("tiles left out without their facts", () => {
  it("payouts without a matching hash, FX without its quote, Airi without its checked purchase", () => {
    expect(payoutTile(null, "x")).toBeNull();
    expect(payoutTile({ match: false } as never, "x")).toBeNull();
    expect(fxTile(null, "x")).toBeNull();
    const airi = airiRun()!;
    expect(airiTile(null)).toBeNull();
    const failed = clone(airi);
    for (const c of Object.values(failed.checks ?? {})) (c as { ok: boolean }).ok = false;
    expect(airiTile(failed)).toBeNull();
    const cheap = clone(airi);
    cheap.policy.alone_max_eur = "100000.00";
    expect(airiTile(cheap)).toBeNull();
  });

  it("FX only when the ledger proves the quote, the signed hash and the shortfall", () => {
    const r = agentRun().record;
    const q = fxQuote(r);
    expect(q).not.toBeNull();
    expect(fxQuote({ ...r, ledger: undefined })).toBeNull();
    const otherQuote = clone(r);
    otherQuote.ledger!.events.find((e) => e.event === "fx.converted")!.payload.quote_id = "another-quote";
    expect(fxQuote(otherQuote)).toBeNull();
    const otherHash = clone(r);
    otherHash.ledger!.events.find((e) => e.event === "fx.converted")!.payload.approval_sha256 = "0".repeat(64);
    expect(fxQuote(otherHash)).toBeNull();
    const notShort = clone(r);
    const id = (notShort.ledger!.events.find((e) => e.event === "fx.converted")!.payload.origin as { proposal_id: string }).proposal_id;
    const terms = notShort.ledger!.proposals.find((p) => p.proposal_id === id)!.terms as { amount: string; conversion: { buy_amount: string } };
    terms.conversion.buy_amount = (Number(terms.amount) + 1000).toFixed(2);
    expect(fxQuote(notShort)).toBeNull();
  });

  it("the built-on-12-Nov tiles without their rows", () => {
    expect(payeeCheckTile(null)).toBeNull();
    expect(payeeCheckTile({ checks: [] })).toBeNull();
    expect(batchTile(null)).toBeNull();
    expect(batchTile({ audit: [{ ts: "2026-11-12T10:00:00Z" }], awx_batches: [], transfers: [{ amount: "1.00", currency: "EUR" }] })).toBeNull();
    expect(batchTile({ audit: [{ ts: "2026-11-12T10:00:00Z" }], awx_batches: [{ awx_batch_id: "b1", status: "IN_APPROVAL" }], transfers: [] })).toBeNull();
    // Eleven payouts: past the words the page spells out, the count is a figure.
    const many = batchTile({ audit: [{ ts: "2026-11-12T10:00:00Z" }], awx_batches: [{ awx_batch_id: "b1", status: "IN_APPROVAL" }], transfers: Array.from({ length: 11 }, () => ({ amount: "1.00", currency: "USD" })) })!;
    expect(many).toMatchObject({ value: "USD 11.00", what: "11 payouts signed once as one batch, held IN_APPROVAL." });
    expect(ledgerTile(null)).toBeNull();
    expect(ledgerTile({ audit: [{ ts: "t", event: "awx_ft.reconciled", payload: { agree: 1 } }] })).toBeNull();
    expect(ledgerTile({ audit: [{ ts: "t", event: "awx_ft.reconciled", payload: { agree: 1, checked: 1 } }, { ts: "t", event: "awx_ft.read", payload: { items: [] } }] })).toBeNull();
  });

  it("a switch-on record with a flag still set, or none, switches nothing on", () => {
    expect(switchedOnKeys(null).size).toBe(0);
    expect(switchedOnKeys({ flags_in_environment: "AWX_BATCH=on", audit: [], awx_batches: [] }).size).toBe(0);
    expect(switchedOnKeys({ audit: [], awx_batches: [] }).size).toBe(0);
    expect(switchedOnKeys({ flags_in_environment: "none", audit: [], awx_batches: [] }).size).toBe(0);
    expect(flaggedHtml([])).toBe("");
  });
});

describe("the runs read from their logs", () => {
  it("an acceptance run that did not read SUCCEEDED, or did not book from it, is not counted", () => {
    const ok = "# Payment acceptance, 11 November 2026\n- Invoice: NW-1, EUR 12.50\n| 1 | 10:00:00.000 | x |\n| `GET /api/v1/pa/payment_intents/int_abc123` | 200, `SUCCEEDED` |\nBooked the receipt only from the status it read back.";
    expect(acceptanceRun(ok)).toMatchObject({ intentId: "int_abc123", amount: "12.50", iso: "2026-11-11T10:00:00.000Z", testCard: false, testCustomer: false });
    expect(acceptanceRun(ok.replace("SUCCEEDED", "REQUIRES_CAPTURE"))).toBeNull();
    expect(acceptanceRun(ok.replace("Booked the receipt", "Booked the invoice"))).toBeNull();
    expect(acceptanceRun(ok.replace("November", "Brumaire"))).toBeNull();
    expect(acceptanceRun(ok.replace(/\| 1 \| 10:00:00\.000 \| x \|\n/, ""))!.iso).toBe("2026-11-11T00:00:00.000Z");
    expect(acceptanceTile(acceptanceRun(ok))!.what).toBe("A card paid the invoice; booked only after SUCCEEDED.");
    expect(acceptanceTile(null)).toBeNull();
  });

  it("the first connected run needs its account, payout, amount, fee and PAID row", () => {
    expect(firstConnectedRun("")).toBeNull();
    expect(firstConnectedRun("## Third run\n`acct_x1`\n| `POST /transfers/create` | `00000000-0000-0000-0000-000000000001` EUR 5.00, SWIFT |\nAirwallex accepted exactly EUR 0.05\n")).toBeNull();
  });

  it("a platform run needs a PAID payout with both fees; its fold says what the log says", () => {
    expect(platformRun([], "")).toBeNull();
    const p = platformRunOfRecord()!;
    expect(connectedTile(null)).toBeNull();
    expect(connectedTile({ ...p, paid: { ...p.paid, purserFeeStatus: "PENDING" } })!).toMatchObject({ why: "Airwallex carries the application fee." });
    expect(platformFoldHtml(null, null, null)).toBe("");
    const plain: PlatformRun = { ...p, active: p.accounts - 1, simulatedPaid: false, sepa: false, refused: 0, cause: null, testPasskey: false };
    const html = platformFoldHtml(plain, null, null);
    expect(html).toContain(`(${p.accounts - 1} ACTIVE)`);
    expect(html).toContain("Platform run, with its refusals");
    expect(html).not.toContain("test passkey");
    expect(html).not.toContain("(simulated)");
    expect(platformFoldHtml(p, { account: "acct_1", transferId: "t-1", amount: "5.00", fee: "0.05", status: "PAID", simulated: true }, null)).toContain("The first connected-account run: €5.00 payout PAID (simulated)");
  });

  it("the SWIFT line needs the kit's fee rule and a local SEPA payout", () => {
    const p = platformRunOfRecord()!;
    expect(swiftLineHtml(null, p)).toBe("");
    expect(swiftLineHtml("| K1 | \"a SWIFT payout\"", p)).toBe("");
    expect(swiftLineHtml("| K1 | \"a SWIFT payout costs EUR 10.00\"", { ...p, local: false })).toBe("");
    expect(kitSwift(null)).toBeNull();
  });
});

describe("the two-locks tile and the Face ID fold", () => {
  const base: TwoLocks = { transferId: "4074d684-4704-406c-a527-2832753baf4f", amount: "240.00", iso: "2026-11-10T09:02:16.000Z", held: null, now: "APPROVAL_REJECTED", finished: false, testPasskey: false, disagree: false, source: "runs", file: null };
  it("an approval rejected in Airwallex's workflow reads as unpaid and bad; held by the workflow when the log names no status", () => {
    const t = approvalsTile(base)!;
    expect(t.states!.map((s) => [s.text, s.tone])).toEqual([["Signed in Purser", "ok"], ["Held by Airwallex's approval workflow", "hold"], ["Now: APPROVAL_REJECTED, not paid", "bad"]]);
    expect(t.files).toEqual(["src/redesign/runs.ts"]);
    expect(approvalsTile({ ...base, amount: null })).toBeNull();
    expect(approvalsTile(null)).toBeNull();
  });
  it("a run log that names a status but no time, with no row to date it, is no state", () => {
    expect(twoLocksState("## What happened\nTransfer `4074d684-4704-406c-a527-2832753baf4f` went `IN_APPROVAL`.\n", null)).toBeNull();
    expect(twoLocksState(null, null)).toBeNull();
  });
  it("the Face ID fold only with its row", () => {
    expect(faceIdFoldHtml(null)).toBe("");
    const row = liveRuns().find((r) => r.key === "awx-faceid-1");
    if (row) expect(faceIdFoldHtml({ ...row, line: undefined })).toContain(row.what.slice(0, 20).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;"));
  });
});

describe("the count of tiles in words", () => {
  const t = (key: string): ProductTile => ({ key: key as ProductTile["key"], name: key, value: "", what: "", why: "", id: "", idLabel: "", href: "", iso: "", files: [] });
  it("counts Airwallex's features and names Airi apart; past ten the count is a figure", () => {
    expect(tilesCountWords([t("a"), t("b")])).toBe("Two Airwallex features in use");
    expect(tilesCountWords([t("a"), t("airi")], true)).toBe("1 Airwallex features plus Airi (beta)");
    expect(tilesCountWords(Array.from({ length: 12 }, (_, i) => t(`k${i}`)))).toBe("12 Airwallex features in use");
  });
});
