// npm run verify's Airwallex checks (src/airwallex/verify.ts) on the paths the main test leaves: a booked chain credit
// whose deposit is found on a later page, is not found at all, or differs in amount; an executed payment whose
// conversion Airwallex lists twice or not at all, or lists without metadata or a quote id; a fee within what the CFO
// approved but above the policy's ceiling (a note, never silent), and a fee on terms approved before the ceiling
// existed (a note, with the estimate or without one). The client is only ever asked to GET. No network.
import { describe, expect, it } from "vitest";
import type { Airwallex } from "../src/airwallex/client.js";
import { getVia, verifyAirwallex, type Get } from "../src/airwallex/verify.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";

const TX = `0x${"ab".repeat(32)}`;
const credit = (db: DB, depositId: string, cents: number) => db.prepare(
  "INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_deposit_id, awx_reference, created_at) VALUES (?, ?, '0xa', '0xb', ?, 10, 12, ?, 'ref', '2026-11-08T10:05:00Z')",
).run(`ev-${depositId}`, TX, (BigInt(cents) * 10n ** 16n).toString(), depositId);

function executed(db: DB, id: string, o: Record<string, unknown> = {}): string {
  const terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-10T00:00:00Z", transfer_request_id: `tr-${id}`, amount: "100.00", currency: "EUR",
    beneficiary_id: "ben_1", beneficiary_name: "Bergtex Textil GmbH", reference: "BTX-1", ...o } as unknown as Terms;
  const sha = termsHash(terms);
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'invoice_payment', ?, ?, 'treasury', 'EXECUTED', '2026-11-10', '2026-11-01')")
    .run(id, JSON.stringify(terms), sha);
  return sha;
}
const transfer = (id: string, sha: string, o: Record<string, unknown> = {}) => ({
  id: `t_${id}`, request_id: `tr-${id}`, status: "PAID", transfer_amount: 100, transfer_currency: "EUR", beneficiary_id: "ben_1", reference: "BTX-1", metadata: { approval_sha256: sha }, ...o,
});

/** Airwallex's read-only answers, by path; deposits in pages. */
function airwallex(w: { deposits?: unknown[][]; conversions?: unknown[]; transfers?: unknown[] }): Get {
  return async (path, q = {}) => {
    if (path === "/deposits") { const n = Number(q.page_num); const pages = w.deposits ?? [[]]; return { items: pages[n] ?? [], has_more: n < pages.length - 1 }; }
    const by = (xs: unknown[] = []) => ({ items: (xs as { request_id: string }[]).filter((x) => x.request_id === q.request_id) });
    if (path === "/fx/conversions") return by(w.conversions);
    if (path === "/transfers") return by(w.transfers);
    throw new Error(`unexpected ${path}`);
  };
}

describe("booked chain credits against Airwallex's deposits", () => {
  it("found on a later page and the same: ok; differing in amount: FAIL; not there: FAIL", async () => {
    const db = openDb(":memory:");
    credit(db, "dep_1", 1000);
    credit(db, "dep_2", 1000);
    credit(db, "dep_3", 500);
    const deposit = (id: string, amount: number) => ({ id, amount, currency: "USD", reference: TX, status: "SETTLED" });
    const checks = await verifyAirwallex(db, airwallex({ deposits: [[deposit("dep_x", 1)], [deposit("dep_1", 10), deposit("dep_2", 9)]] }));
    expect(checks).toEqual([
      { level: "ok", what: "deposit dep_1", detail: `USD 10.00, reference = tx ${TX.slice(0, 12)}…, SETTLED` },
      { level: "FAIL", what: "deposit dep_2", detail: "amount 9.00 != 10.00" },
      { level: "FAIL", what: "deposit dep_3", detail: "not found in Airwallex" },
    ]);
  });
});

describe("an executed payment's conversion and fee", () => {
  const conversion = { request_id: "fx-1", quote_id: "q-123456789", buy_amount: "100.00", sell_amount: "110.00" };

  it("a conversion Airwallex does not list, or lists twice, is a FAIL", async () => {
    const db = openDb(":memory:");
    const sha = executed(db, "P-0001", { conversion });
    const none = await verifyAirwallex(db, airwallex({ transfers: [transfer("P-0001", sha)] }));
    expect(none[0]).toEqual({ level: "FAIL", what: "P-0001 conversion", detail: "0 conversions with request_id fx-1" });
    const c = { conversion_id: "c1", request_id: "fx-1", status: "SETTLED", buy_amount: 100, sell_amount: 110 };
    const two = await verifyAirwallex(db, airwallex({ conversions: [c, { ...c, conversion_id: "c2" }], transfers: [transfer("P-0001", sha)] }));
    expect(two[0]).toEqual({ level: "FAIL", what: "P-0001 conversion", detail: "2 conversions with request_id fx-1" });
  });

  it("a conversion listed without metadata or a quote id is checked on what it has", async () => {
    const db = openDb(":memory:");
    const sha = executed(db, "P-0001", { conversion });
    const checks = await verifyAirwallex(db, airwallex({ conversions: [{ conversion_id: "c1", request_id: "fx-1", status: "SETTLED", buy_amount: 100, sell_amount: 110 }], transfers: [transfer("P-0001", sha)] }));
    expect(checks[0]).toEqual({ level: "ok", what: "P-0001 conversion c1", detail: "EUR 100.00 for USD 110.00 on quote q-123456…, SETTLED" });
  });

  it("a fee within the approved ceiling but above the policy's: ok, and a note says so", async () => {
    const db = openDb(":memory:");
    const sha = executed(db, "P-0001", { fee_max: "30.00" });
    const checks = await verifyAirwallex(db, airwallex({ transfers: [transfer("P-0001", sha, { fee_amount: 25, fee_currency: "EUR" })] }));
    expect(checks.slice(1)).toEqual([
      { level: "ok", what: "P-0001 fee", detail: "EUR 25.00, ceiling EUR 30.00" },
      { level: "note", what: "P-0001 fee above the policy ceiling", detail: "EUR 25.00 is above EUR 20.00; the approved terms reserved EUR 30.00" },
    ]);
  });

  it("a fee on terms from before the ceiling: a note, with the estimate or a question mark", async () => {
    const db = openDb(":memory:");
    const a = executed(db, "P-0001", { fee: "15.00" });
    const b = executed(db, "P-0002");
    const checks = await verifyAirwallex(db, airwallex({ transfers: [transfer("P-0001", a, { fee_amount: 12.5, fee_currency: "EUR" }), transfer("P-0002", b, { fee_amount: 12.5, fee_currency: "EUR" })] }));
    expect(checks.filter((c) => c.level === "note")).toEqual([
      { level: "note", what: "P-0001 fee", detail: "EUR 12.50; the terms estimated EUR 15.00 (approved before the fee ceiling existed)" },
      { level: "note", what: "P-0002 fee", detail: "EUR 12.50; the terms estimated EUR ? (approved before the fee ceiling existed)" },
    ]);
  });
});

describe("the live reader", () => {
  it("only ever GETs, with the query given", async () => {
    const calls: unknown[][] = [];
    const get = getVia({ call: async (...a: unknown[]) => { calls.push(a); return { items: [] }; } } as unknown as Airwallex);
    expect(await get("/transfers", { request_id: "r1" })).toEqual({ items: [] });
    expect(calls).toEqual([["GET", "/transfers", undefined, { request_id: "r1" }]]);
  });
});
