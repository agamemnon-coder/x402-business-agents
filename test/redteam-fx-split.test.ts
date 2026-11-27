// Red team, round 2 on v1.5.3 (finding FX split): four eyes and the second key were asked of each FX conversion on its
// own, so one EUR 250,000 conversion cut into EUR 90,000 + 90,000 + 70,000 was bought by one person, though the whole
// needs two people and a security key. A conversion is now weighed as its own euro value plus the other conversions to
// the same currency approved within the split window (ap.split_days, else 27 days, on Purser's clock) without what the
// rule asks: for four eyes those one person approved (not co-signed), for the second key those not signed with it. Test
// money only, no network.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { openDb } from "../src/db/open.js";
import { executeFxConversion } from "../src/executors/fxConversion.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { secondKeyReasons } from "../src/policy/secondKey.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { setSetting } from "../src/world/settings.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const DAY = 86_400_000;
const fx = (id: string, buy: string, sell: string, at = NOW, buyCurrency = "EUR", sellCurrency = "USD") => ({
  schema: TERMS_SCHEMA, kind: "fx_conversion", proposal_id: id, expires_at: new Date(at.getTime() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  buy_currency: buyCurrency, buy_amount: buy, sell_currency: sellCurrency, sell_max: sell, indicative_sell: sell, indicative_rate: "1.16", rate_at: at.toISOString(),
  rate_source: "red team", conversion_request_id: randomUUID(), reason: "red team", forecast_as_of: "2026-11-27", forecast_sha256: "0".repeat(64), money: "test",
}) as unknown as Terms;

async function world() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '100000.00', ?), ('approval.second_key_eur', '150000.00', ?)").run(NOW.toISOString(), NOW.toISOString());
  await awx.simulateDeposit({ globalAccountId: await awx.usdGlobalAccountId(), amountCents: 40_000_000, reference: "red team", payerName: "red team" });
  db.prepare("UPDATE settings SET value = '0.00' WHERE key = 'usd_floor'").run();
  let n = 0;
  const file = (buy: string, sell: string, at = NOW, buyCurrency = "EUR", sellCurrency = "USD") => createProposal(db, { terms: fx(`P-${String(++n).padStart(4, "0")}`, buy, sell, at, buyCurrency, sellCurrency), createdBy: "treasury" }, at);
  const approve = (p: { proposal_id: string; terms_sha256: string }, at = NOW, approver = "cfo") => decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver, method: "cli" }, at);
  return { db, awx, file, approve };
}

describe("one conversion cut into parts under the thresholds (red team round 2, FX split)", () => {
  it("EUR 250,000 as 90,000 + 90,000 + 70,000: the second part needs two people, the third a security key too", async () => {
    const { db, awx, file, approve } = await world();
    const a = file("90000.00", "108000.00");
    expect(fourEyes(db, a, undefined, NOW)).toBe(false);
    expect(secondKeyReasons(db, a, NOW)).toEqual([]);
    expect(approve(a)).toBe("APPROVED");
    expect((await executeFxConversion(db, awx, a.proposal_id, () => NOW)).outcome).toBe("EXECUTED");

    const b = file("90000.00", "108000.00");
    expect(fourEyes(db, b, undefined, NOW)).toBe(true);
    expect(secondKeyReasons(db, b, NOW)).toEqual(["amount at or above EUR 150000.00"]);
    expect(() => approve(b)).toThrow(/Face ID and your security key|two different people/);

    const c = file("70000.00", "84000.00");
    expect(fourEyes(db, c, undefined, NOW)).toBe(true);
    expect(() => approve(c)).toThrow(/Face ID and your security key|two different people/);
    expect(awx.conversions).toHaveLength(1);
  });

  it("a part two people approved counts for the second key but not for four eyes", async () => {
    const { db, file, approve } = await world();
    const a = file("90000.00", "108000.00");
    approve(a);
    // As if co-signed by two people (four eyes kept), without a security key.
    db.prepare("UPDATE approvals SET approver = 'anna (passkey 1) + max (passkey 2)' WHERE proposal_id = ?").run(a.proposal_id);
    const b = file("70000.00", "84000.00");
    expect(fourEyes(db, b, undefined, NOW)).toBe(false);
    expect(secondKeyReasons(db, b, NOW)).toEqual(["amount at or above EUR 150000.00"]);
    // Signed with both keys: it no longer counts for the second key either.
    db.prepare("UPDATE approvals SET approver = 'anna (passkey and security key) + max (passkey 2)' WHERE proposal_id = ?").run(a.proposal_id);
    expect(secondKeyReasons(db, b, NOW)).toEqual([]);
  });

  it("only conversions to the same currency, approved within the window, count", async () => {
    const { db, file, approve } = await world();
    const old = file("90000.00", "108000.00", new Date(NOW.getTime() - 28 * DAY));
    approve(old, new Date(NOW.getTime() - 28 * DAY));
    // A conversion to GBP (selling EUR 90,000) is another currency's: it does not count against EUR.
    const gbp = file("77000.00", "90000.00", NOW, "GBP", "EUR");
    expect(approve(gbp)).toBe("APPROVED");
    const one = file("90000.00", "108000.00");
    expect(fourEyes(db, one, undefined, NOW)).toBe(false);
    approve(one);
    // 28 days ago is outside the 27-day window; with ap.split_days at 30, it counts.
    setSetting(db, "human", "ap.split_days", "30");
    const next = file("5000.00", "6000.00");
    expect(fourEyes(db, next, undefined, NOW)).toBe(true);
  });

  it("an approved part is not judged again by the parts approved after it", async () => {
    const { db, file, approve } = await world();
    const a = file("90000.00", "108000.00");
    approve(a);
    const later = new Date(NOW.getTime() + 60_000);
    const b = file("9000.00", "10800.00", later);
    approve(b, later);
    // a was within four eyes when it was approved, and stays so when its executor asks again.
    const stored = db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(a.proposal_id) as { kind: string; terms_json: string };
    expect(fourEyes(db, stored, undefined, later)).toBe(false);
    expect(secondKeyReasons(db, stored, later)).toEqual([]);
  });

  it("a single conversion under the thresholds needs one person, as before", async () => {
    const { db, awx, file, approve } = await world();
    const p = file("99000.00", "118800.00");
    expect(fourEyes(db, p, undefined, NOW)).toBe(false);
    expect(approve(p)).toBe("APPROVED");
    expect((await executeFxConversion(db, awx, p.proposal_id, () => NOW)).outcome).toBe("EXECUTED");
  });
});
