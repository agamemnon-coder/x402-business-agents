// The merchant we run (Packwise, warehouse software) recognises the agent first (agent-recognition profile of
// Visa's TAP spec, our registry and test keys), then the agent pays with its own Airwallex Visa card, inside the CFO
// limit that Airwallex enforces. Nothing is charged for a request the merchant does not recognise.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { setupCards } from "../src/policy/cards.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { tapCheckout, TAP_MERCHANT } from "../src/visa/merchant.js";
import { newAgentKey, registerAgent, signTapRequest, type TapAgentKey } from "../src/visa/tap.js";

const now = new Date("2026-11-02T10:00:00Z");
const NOW_S = Math.floor(now.getTime() / 1000);
let db: DB, awx: FakeIssuing, ops: TapAgentKey, sales: TapAgentKey;

beforeEach(async () => {
  db = openDb(":memory:");
  awx = new FakeIssuing();
  await setupCards(db, awx, now);
  ops = await newAgentKey("sourcing");
  sales = await newAgentKey("support");
  for (const k of [ops, sales]) registerAgent(db, { agent: k.agent, keyid: k.keyid, publicJwk: k.publicJwk, domains: [TAP_MERCHANT.domain], notAfter: NOW_S + 86_400 });
});

const buy = (key: TapAgentKey, plan: string, o: { tag?: "agent-payer-auth" | "agent-browser-auth" } = {}) =>
  signTapRequest({ url: `https://${TAP_MERCHANT.domain}/checkout`, method: "POST", key, tag: o.tag ?? "agent-payer-auth", now: NOW_S, body: JSON.stringify({ plan }) });

describe("checkout at the agent-recognising merchant", () => {
  it("charges the recognised agent's own card, inside its limit", async () => {
    const r = await tapCheckout(db, awx, await buy(ops, "packwise-starter"), now);
    expect(r).toMatchObject({ recognised: true, agent: "sourcing", approved: true });
    expect(awx.calls.filter((c) => c === "charge")).toHaveLength(1);
    expect(db.prepare("SELECT event FROM audit_log WHERE event LIKE 'tap.%'").all()).toEqual([{ event: "tap.recognised" }]);
  });

  it("over the limit, Airwallex declines the recognised agent's card", async () => {
    const r = await tapCheckout(db, awx, await buy(ops, "packwise-pro"), now);
    expect(r).toMatchObject({ recognised: true, approved: false, reason: expect.stringMatching(/LIMIT_EXCEEDED/) });
  });

  it("charges nothing for a request it does not recognise", async () => {
    const unsigned = new Request(`https://${TAP_MERCHANT.domain}/checkout`, { method: "POST", body: JSON.stringify({ plan: "packwise-starter" }) });
    const r = await tapCheckout(db, awx, unsigned, now);
    expect(r).toMatchObject({ recognised: false, approved: false, reason: expect.stringMatching(/no signature/) });
    expect(awx.calls).not.toContain("charge");
    expect(db.prepare("SELECT event FROM audit_log WHERE event LIKE 'tap.%'").all()).toEqual([{ event: "tap.refused" }]);
  });

  it("refuses an agent buying on another agent's card", async () => {
    const r = await tapCheckout(db, awx, await buy(sales, "packwise-starter"), now);
    expect(r).toMatchObject({ recognised: true, approved: false, reason: expect.stringMatching(/Sourcing agent's card/) });
    expect(awx.calls).not.toContain("charge");
  });

  it("refuses a browsing signature at checkout, and an unknown plan", async () => {
    expect(await tapCheckout(db, awx, await buy(ops, "packwise-starter", { tag: "agent-browser-auth" }), now)).toMatchObject({ recognised: false });
    expect(await tapCheckout(db, awx, await buy(ops, "nothing"), now)).toMatchObject({ recognised: true, approved: false, reason: expect.stringMatching(/no plan/) });
    expect(awx.calls).not.toContain("charge");
  });
});
