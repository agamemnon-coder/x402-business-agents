// Red team (runner, 27 Nov, finding 3): four eyes (approval.four_eyes_eur) and the second key (approval.second_key_eur)
// never applied to an FX conversion: with "above EUR 500.00 needs two people" and "a security key at or above EUR
// 1,000.00" in force, one person approved the sale of USD 300,000 for EUR 250,000 and the executor ran it. A conversion is
// now valued in euros (what it buys when it buys EUR, at most what it sells when it sells EUR); a pair without EUR has no
// euro value in its terms and counts as above both thresholds. Test money only, no network.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { openDb } from "../src/db/open.js";
import { executeFxConversion } from "../src/executors/fxConversion.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { fourEyes, fxConversionEur } from "../src/policy/fourEyes.js";
import { secondKeyReasons } from "../src/policy/secondKey.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { setSetting } from "../src/world/settings.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const EXP = new Date(NOW.getTime() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const fx = (id: string, o: { buy_currency: string; buy_amount: string; sell_currency: string; sell_max: string }) => ({
  schema: TERMS_SCHEMA, kind: "fx_conversion", proposal_id: id, expires_at: EXP, ...o, indicative_sell: o.sell_max, indicative_rate: "1.16", rate_at: NOW.toISOString(),
  rate_source: "red team", conversion_request_id: randomUUID(), reason: "red team", forecast_as_of: "2026-11-27", forecast_sha256: "0".repeat(64), money: "test",
}) as unknown as Terms;

async function world() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '500.00', ?), ('approval.second_key_eur', '1000.00', ?)").run(NOW.toISOString(), NOW.toISOString());
  await awx.simulateDeposit({ globalAccountId: await awx.usdGlobalAccountId(), amountCents: 40_000_000, reference: "red team", payerName: "red team" });
  db.prepare("UPDATE settings SET value = '0.00' WHERE key = 'usd_floor'").run();
  return { db, awx };
}

describe("four eyes and the second key on an FX conversion (runner finding 3)", () => {
  it("values a conversion in euros: what it buys in EUR, at most what it sells in EUR; another pair has none", () => {
    expect(fxConversionEur(JSON.stringify({ buy_currency: "EUR", buy_amount: "250000.00", sell_currency: "USD", sell_max: "300000.00" }))).toBe("250000.00");
    expect(fxConversionEur(JSON.stringify({ buy_currency: "USD", buy_amount: "1200.00", sell_currency: "EUR", sell_max: "1050.00" }))).toBe("1050.00");
    expect(fxConversionEur(JSON.stringify({ buy_currency: "GBP", buy_amount: "10.00", sell_currency: "USD", sell_max: "13.00" }))).toBeNull();
    expect(fxConversionEur(JSON.stringify({ buy_currency: "EUR", buy_amount: "lots", sell_currency: "USD", sell_max: "13.00" }))).toBeNull();
  });

  it("one person cannot approve the sale of USD 300,000 for EUR 250,000, and nothing is converted", async () => {
    const { db, awx } = await world();
    const p = createProposal(db, { terms: fx("P-0001", { buy_currency: "EUR", buy_amount: "250000.00", sell_currency: "USD", sell_max: "300000.00" }), createdBy: "treasury" }, NOW);
    expect(fourEyes(db, p)).toBe(true);
    expect(secondKeyReasons(db, p, NOW)).toEqual(["amount at or above EUR 1000.00"]);
    expect(() => decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW)).toThrow(/Face ID and your security key|two different people/);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal_id) as { status: string }).status).toBe("PENDING_APPROVAL");
    const ran = await executeFxConversion(db, awx, p.proposal_id, () => NOW).catch(() => null);
    expect(ran?.outcome).not.toBe("EXECUTED");
    expect(awx.conversions).toHaveLength(0);
  });

  it("selling EUR counts what it may sell; a pair without EUR counts as above; a small conversion needs one person", async () => {
    const { db } = await world();
    const sell = createProposal(db, { terms: fx("P-0001", { buy_currency: "USD", buy_amount: "700.00", sell_currency: "EUR", sell_max: "600.00" }), createdBy: "treasury" }, NOW);
    expect(fourEyes(db, sell)).toBe(true);
    expect(secondKeyReasons(db, sell, NOW)).toEqual([]);
    const other = createProposal(db, { terms: fx("P-0002", { buy_currency: "GBP", buy_amount: "10.00", sell_currency: "USD", sell_max: "13.00" }), createdBy: "treasury" }, NOW);
    expect(fourEyes(db, other)).toBe(true);
    expect(secondKeyReasons(db, other, NOW)).toEqual(["amount at or above EUR 1000.00"]);
    const small = createProposal(db, { terms: fx("P-0003", { buy_currency: "EUR", buy_amount: "400.00", sell_currency: "USD", sell_max: "480.00" }), createdBy: "treasury" }, NOW);
    expect(fourEyes(db, small)).toBe(false);
    expect(secondKeyReasons(db, small, NOW)).toEqual([]);
  });
});
