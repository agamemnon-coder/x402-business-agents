// /x402/proof (master-list line 107): a correct 402 a juror can call, a wrong amount and a replay refused, a labelled
// local stand-in payment served while testnet settlement is off (the default), signed payments refused while it is
// off, and the caps per request and per day when it is on (with a stand-in facilitator; no network).
import Database from "better-sqlite3";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { USDZ as METAL_USDZ } from "@metalntwx/metal-pay";
import { describe, expect, it } from "vitest";
import { sqlOver } from "./support/trySign.js";
import { DAILY_SETTLE_CAP, DEFAULT_PAY_TO, NETWORK, PRICE_BASE_UNITS, STAND_IN_LABEL, USDZ_EXTRA, X402Desk, X402_PATH, type Facilitator } from "../worker/src/x402.js";
import { USDZ } from "../src/metal/network.js";

const URL0 = `https://kit11.example${X402_PATH}`;
const desk = (o: ConstructorParameters<typeof X402Desk>[1] = {}) => new X402Desk(sqlOver(new Database(":memory:")), o);
const get = (d: X402Desk, header?: string) => d.fetch(new Request(URL0, { headers: header ? { "payment-signature": header } : {} }));
let n = 0;
const nonce = () => `nonce-${++n}-${Math.random().toString(36).slice(2)}`;
const requirements = { scheme: "exact", network: NETWORK, asset: USDZ, amount: PRICE_BASE_UNITS, payTo: DEFAULT_PAY_TO, maxTimeoutSeconds: 60, extra: { ...USDZ_EXTRA } };
const pay = (payload: Record<string, unknown>, accepted: Record<string, unknown> = requirements) => encodePaymentSignatureHeader({ x402Version: 2, accepted, payload } as never);
const standIn = (id = nonce()) => pay({ standIn: STAND_IN_LABEL, nonce: id });
const signed = (id = nonce(), value = PRICE_BASE_UNITS) => pay({ signature: "0xsig", authorization: { from: "0x00000000000000000000000000000000000000b1", to: DEFAULT_PAY_TO, value, validAfter: "0", validBefore: "9999999999", nonce: id } });

describe("the x402 endpoint a juror can call", () => {
  it("answers 402 with x402 v2 requirements, in the header and the body, labelled as test money", async () => {
    const r = await get(desk());
    expect(r.status).toBe(402);
    const pr = decodePaymentRequiredHeader(r.headers.get("PAYMENT-REQUIRED")!);
    expect(pr.x402Version).toBe(2);
    expect(pr.resource.url).toBe(URL0);
    expect(pr.accepts).toEqual([requirements]);
    const body = await r.json() as Record<string, unknown>;
    expect(body.money).toMatch(/test money, Alta testnet/);
    expect(body.settlement).toMatch(/^off/);
    expect(r.headers.get("access-control-expose-headers")).toContain("PAYMENT-REQUIRED");
    // The token's domain is Alta's own (the scheme signs against it).
    expect(USDZ_EXTRA).toMatchObject({ name: METAL_USDZ.name, version: METAL_USDZ.version });
    expect(USDZ.toLowerCase()).toBe(METAL_USDZ.address.toLowerCase());
  });

  it("serves the signed receipt for a labelled local stand-in payment, and says nothing moved", async () => {
    const r = await get(desk(), standIn());
    expect(r.status).toBe(200);
    const body = await r.json() as { paid_with: string; money: string; resource: { terms: { proposal_id: string } } };
    expect(body.paid_with).toBe(STAND_IN_LABEL);
    expect(body.resource.terms.proposal_id).toBe("P-0002");
    expect(decodePaymentResponseHeader(r.headers.get("PAYMENT-RESPONSE")!)).toMatchObject({ success: true, payer: "stand-in" });
  });

  it("refuses a wrong amount, another payee or asset, and a payment without a nonce", async () => {
    const d = desk();
    const wrong = await get(d, pay({ standIn: STAND_IN_LABEL, nonce: nonce() }, { ...requirements, amount: "1" }));
    expect(wrong.status).toBe(402);
    expect((await wrong.json() as { error: string }).error).toMatch(/amount must be exactly 10000000000000000/);
    expect((await get(d, pay({ standIn: STAND_IN_LABEL, nonce: nonce() }, { ...requirements, payTo: "0x0000000000000000000000000000000000000bad" }))).status).toBe(402);
    expect((await get(d, pay({ standIn: STAND_IN_LABEL, nonce: nonce() }, { ...requirements, asset: "0x0000000000000000000000000000000000000001" }))).status).toBe(402);
    expect((await get(d, pay({ standIn: STAND_IN_LABEL }))).status).toBe(402);
    expect((await get(d, "not base64 json")).status).toBe(402);
  });

  it("refuses a replayed payment", async () => {
    const d = desk();
    const h = standIn();
    expect((await get(d, h)).status).toBe(200);
    const again = await get(d, h);
    expect(again.status).toBe(409);
    expect((await again.json() as { error: string }).error).toMatch(/replay is refused/);
  });

  it("with testnet settlement off (the default), refuses a signed payment before anything is sent", async () => {
    let calls = 0;
    const f: Facilitator = { verify: async () => { calls++; return { isValid: true }; }, settle: async () => { calls++; return { success: true, transaction: "0xt", network: NETWORK }; } };
    for (const settle of [undefined, "off", "yes", ""]) {
      const r = await get(desk({ settle, facilitator: async () => f }), signed());
      expect(r.status).toBe(503);
      expect((await r.json() as { error: string }).error).toMatch(/testnet settlement is switched off/);
    }
    expect(calls).toBe(0);
  });

  it("with settlement on: verifies and settles through the facilitator, within the cap per request and per day", async () => {
    const seen: string[] = [];
    const f: Facilitator = {
      verify: async (p, r) => { seen.push(`verify ${r.amount}`); return { isValid: (p.payload.authorization as { from: string }).from !== "0xbad" }; },
      settle: async () => { seen.push("settle"); return { success: true, transaction: `0x${"ab".repeat(32)}`, network: NETWORK, payer: "0xb1" }; },
    };
    let clock = new Date("2026-11-14T09:00:00Z");
    const d = desk({ settle: "on", facilitator: async () => f, now: () => clock });
    const ok = await get(d, signed());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ paid_with: "Alta testnet, settled by Alta's facilitator", transaction: `0x${"ab".repeat(32)}` });
    expect(seen).toEqual([`verify ${PRICE_BASE_UNITS}`, "settle"]);
    // Over the cap per request: refused before any call.
    expect((await get(d, signed(nonce(), "20000000000000000"))).status).toBe(402);
    expect(seen).toHaveLength(2);
    // A payment the facilitator refuses is not served, and its nonce stays used.
    const bad = pay({ signature: "0x", authorization: { from: "0xbad", value: PRICE_BASE_UNITS, nonce: "nonce-bad-1" } });
    expect((await get(d, bad)).status).toBe(402);
    expect((await get(d, bad)).status).toBe(409);
    // The day's cap: DAILY_SETTLE_CAP settlements, then 429; the next UTC day opens again.
    for (let i = 1; i < DAILY_SETTLE_CAP; i++) expect((await get(d, signed())).status).toBe(200);
    const capped = await get(d, signed());
    expect(capped.status).toBe(429);
    expect(seen.filter((x) => x === "settle")).toHaveLength(DAILY_SETTLE_CAP);
    clock = new Date("2026-11-15T09:00:00Z");
    expect((await get(d, signed())).status).toBe(200);
  });

  // Code review 13 Nov: a settle that throws (a timeout) may still have moved money on chain, so it counts against the
  // day's cap as 'unknown'; only a verify refusal or a settle that answers success: false is 'refused' and uncounted.
  it("with settlement on: settle timeouts count against the day's cap, so repeated timeouts cannot settle past it", async () => {
    let settles = 0;
    let mode: "timeout" | "refuse" = "timeout";
    const f: Facilitator = {
      verify: async () => ({ isValid: true }),
      settle: async () => {
        settles++;
        if (mode === "timeout") throw new Error("the operation timed out");
        return { success: false, errorReason: "insufficient_funds", transaction: "", network: NETWORK };
      },
    };
    const d = desk({ settle: "on", facilitator: async () => f, now: () => new Date("2026-11-14T09:00:00Z") });
    // A settle that answers success: false is refused and does not count.
    mode = "refuse";
    expect((await get(d, signed())).status).toBe(402);
    expect((await get(d, signed())).status).toBe(402);
    mode = "timeout";
    for (let i = 0; i < DAILY_SETTLE_CAP + 5; i++) await get(d, signed());
    expect(settles - 2).toBe(DAILY_SETTLE_CAP);
    const capped = await get(d, signed());
    expect(capped.status).toBe(429);
    expect(settles - 2).toBe(DAILY_SETTLE_CAP);
  });

  it("answers only GET and HEAD on its own path", async () => {
    expect((await desk().fetch(new Request(URL0, { method: "POST" }))).status).toBe(405);
    expect((await desk().fetch(new Request(`https://kit11.example/x402/other`))).status).toBe(404);
  });
});
