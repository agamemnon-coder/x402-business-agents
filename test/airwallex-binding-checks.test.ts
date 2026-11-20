// The runner's side of the account binding (src/airwallex/binding.ts), check by check: the binding Purser Cloud signs
// is taken only when it is a well-formed token signed with the platform's Ed25519 key, complete, for this company,
// in date and for an active account, each refusal with its own reason; what is stored from a sync; Purser's fee as the
// CFO policy holds it; and the two checks every Airwallex call and payment run first: the card rail acts for the bound
// account, and the terms, the rail and the binding agree on the paying account and on Purser's fee to the cent.
// test/rt6-platform.test.ts runs the same checks through the executors.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signBinding } from "../cloud/src/awxPlatform.js";
import { checkBinding, checkCardAccount, checkPayingAccount, currentBinding, feeBpsOf, platformFeeCents, platformPlan, storeBinding } from "../src/airwallex/binding.js";
import { openDb } from "../src/db/open.js";
import { getSetting, setSetting } from "../src/world/settings.js";
import { BINDING_ENV, PLATFORM_PRIVATE_KEY, PURSER_FEE_ACCOUNT, TENANT, binding } from "./support/platformBinding.js";

const now = new Date("2026-11-20T09:00:00Z");
const ON = { ...BINDING_ENV, AIRWALLEX_PLATFORM: "on" };
const FEE_ON = { ...ON, AIRWALLEX_PLATFORM_FEE: "on" };
const tokenOf = (over: Parameters<typeof binding>[0] = {}, key = PLATFORM_PRIVATE_KEY) => signBinding(key, binding(over, now));
/** A token whose body is any text, signed with the platform key (to reach the checks after the signature). */
const signedText = (text: string) => {
  const body = Buffer.from(text).toString("base64url");
  const key = { key: Buffer.from(PLATFORM_PRIVATE_KEY, "base64"), format: "der" as const, type: "pkcs8" as const };
  return `${body}.${sign(null, Buffer.from(body, "ascii"), key).toString("base64url")}`;
};
const refusal = (token: string, env: Record<string, string | undefined> = BINDING_ENV) => {
  const c = checkBinding(token, now, env);
  return c.ok ? "accepted" : c.reason;
};

describe("a binding token is taken only when everything about it checks", () => {
  it("accepts the cloud's signed binding of this company to its active account", async () => {
    expect(checkBinding(await tokenOf(), now, BINDING_ENV)).toMatchObject({ ok: true, binding: { tenant: TENANT, account_id: "acct_northwind", fee_account: PURSER_FEE_ACCOUNT } });
  });

  it("refuses when this runner cannot check one: no platform key, or no company id of its own", async () => {
    const t = await tokenOf();
    expect(refusal(t, { PURSER_TENANT_ID: TENANT })).toBe("PURSER_PLATFORM_PUBLIC_KEY is not set, so no account binding from Purser Cloud can be checked");
    for (const tenant of [undefined, "", "northwind", "t_abc", `t_${"x".repeat(65)}`]) {
      expect(refusal(t, { ...BINDING_ENV, PURSER_TENANT_ID: tenant })).toBe("PURSER_TENANT_ID is not set to this company's Purser Cloud id");
    }
    expect(refusal("")).toBe("no account binding from Purser Cloud yet; sync with the cloud first (npm run cloud -- sync)");
  });

  it("refuses what is not a signed binding, and a signature by any other key", async () => {
    const t = await tokenOf();
    const [body, sig] = t.split(".");
    for (const bad of [body!, `${t}.extra`, `${body}.`, `.${sig}`, `${body}.${sig}=`, `${body}+.${sig}`]) expect(refusal(bad)).toBe("the account binding is not a signed binding");
    const other = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(refusal(await tokenOf({}, other))).toBe("the account binding's signature does not check against Purser's platform key");
    expect(refusal(`${body}.${sig!.slice(0, -4)}AAAA`)).toBe("the account binding's signature does not check against Purser's platform key");
    // A platform key that is not Ed25519, or not a key at all, checks nothing.
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(refusal(t, { ...BINDING_ENV, PURSER_PLATFORM_PUBLIC_KEY: ec })).toBe("the account binding's signature does not check against Purser's platform key");
    expect(refusal(t, { ...BINDING_ENV, PURSER_PLATFORM_PUBLIC_KEY: "bm90IGEga2V5" })).toBe("the account binding's signature does not check against Purser's platform key");
  });

  it("refuses a signed body that is not a binding, or not a whole one", () => {
    expect(refusal(signedText("not json"))).toBe("the account binding is not readable");
    const whole = binding({}, now);
    for (const over of [{ v: 2 }, { account_id: "northwind" }, { account_id: 7 }, { fee_account: "purser" }, { name: null }, { issued_at: "today" }, { expires_at: null }]) {
      expect(refusal(signedText(JSON.stringify({ ...whole, ...over })))).toBe("the account binding is incomplete");
    }
  });

  it("refuses another company's binding, an expired one, one dated in the future, and an account not active", async () => {
    expect(refusal(await tokenOf({ tenant: "t_otherco01" }))).toBe("the account binding is for another company; nothing is paid from its account");
    expect(refusal(await tokenOf({ expires_at: now.getTime() }))).toBe("the account binding expired at 2026-11-20T09:00:00.000Z; sync with Purser Cloud for a fresh one");
    expect(refusal(await tokenOf({ issued_at: now.getTime() + 5 * 60_000 + 1 }))).toBe("the account binding is dated in the future");
    expect(refusal(await tokenOf({ issued_at: now.getTime() + 5 * 60_000 }))).toBe("accepted");
    for (const status of ["created", "pending", "action_required", "refused", "dormant", "closed"] as const) {
      expect(refusal(await tokenOf({ status }))).toBe(`the company's Airwallex account acct_northwind is ${status}, not active; nothing is paid from it`);
    }
  });
});

describe("what a cloud sync stores", () => {
  it("keeps a binding signed for this company whatever its account's status, and nothing else", async () => {
    const db = openDb(":memory:");
    const pending = await tokenOf({ status: "pending" });
    expect(storeBinding(db, pending, now, BINDING_ENV)).toMatchObject({ ok: false });
    expect(getSetting(db, "platform.binding", "")).toBe(pending);
    // Another company's, or a forged one, is not kept: the one held stays.
    expect(storeBinding(db, await tokenOf({ tenant: "t_otherco01" }), now, BINDING_ENV)).toMatchObject({ ok: false });
    expect(storeBinding(db, "forged.token", now, BINDING_ENV)).toMatchObject({ ok: false, reason: "the account binding's signature does not check against Purser's platform key" });
    expect(getSetting(db, "platform.binding", "")).toBe(pending);
    const active = await tokenOf();
    expect(storeBinding(db, active, now, BINDING_ENV)).toMatchObject({ ok: true });
    expect(currentBinding(db, now, BINDING_ENV)).toMatchObject({ ok: true });
    // The cloud has no account for the company any more: the binding is cleared; cleared twice changes nothing.
    expect(storeBinding(db, null, now, BINDING_ENV)).toBeNull();
    expect(getSetting(db, "platform.binding", "x")).toBe("");
    const audited = () => (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject = 'platform.binding'").get() as { n: number }).n;
    const before = audited();
    expect(storeBinding(db, null, now, BINDING_ENV)).toBeNull();
    expect(audited()).toBe(before);
  });
});

describe("Purser's fee and the plan for a payment", () => {
  it("the fee is a whole number of basis points from 0 to the cap, or nothing is planned", async () => {
    const db = openDb(":memory:");
    expect(feeBpsOf(db)).toBe(0);
    for (const [v, bps] of [["25", 25], ["100", 100], ["0", 0], ["101", null], ["1.5", null], ["-1", null], ["1000", null], ["abc", null]] as const) {
      setSetting(db, "system", "platform.fee_bps", v, now);
      expect(feeBpsOf(db), v).toBe(bps);
    }
    storeBinding(db, await tokenOf(), now, BINDING_ENV);
    expect(platformPlan(db, now, FEE_ON)).toEqual({ ok: false, reason: "Purser's fee in the policy (platform.fee_bps) is not a whole number from 0 to 100 basis points; nothing is planned" });
    setSetting(db, "system", "platform.fee_bps", "25", now);
    expect(platformPlan(db, now, FEE_ON)).toEqual({ ok: true, paying: { id: "acct_northwind", name: "Northwind Outdoor B.V." }, feeBps: 25, feeTo: PURSER_FEE_ACCOUNT });
    setSetting(db, "system", "platform.fee_bps", "0", now);
    expect(platformPlan(db, now, FEE_ON)).toEqual({ ok: true, paying: { id: "acct_northwind", name: "Northwind Outdoor B.V." }, feeBps: 0, feeTo: null });
    // The fee switched off: no fee whatever the policy; the platform off: the company's own account, no binding needed.
    setSetting(db, "system", "platform.fee_bps", "25", now);
    expect(platformPlan(db, now, ON)).toEqual({ ok: true, paying: { id: "acct_northwind", name: "Northwind Outdoor B.V." }, feeBps: 0, feeTo: null });
    expect(platformPlan(openDb(":memory:"), now, {})).toEqual({ ok: true, paying: null, feeBps: 0, feeTo: null });
    expect(platformPlan(openDb(":memory:"), now, ON)).toEqual({ ok: false, reason: "no account binding from Purser Cloud yet; sync with the cloud first (npm run cloud -- sync)" });
  });

  it("the fee on an amount is rounded to the cent", () => {
    expect(platformFeeCents(185_000, 25)).toBe(463);
    expect(platformFeeCents(199, 25)).toBe(0);
    expect(platformFeeCents(200, 25)).toBe(1);
  });
});

describe("the card rail acts for the bound account", () => {
  it("with the platform on, only for the account in a valid binding; off, only for the company's own", async () => {
    const db = openDb(":memory:");
    expect(() => checkCardAccount(db, { payingAccount: null }, now, ON)).toThrow("no account binding from Purser Cloud yet; sync with the cloud first (npm run cloud -- sync); nothing is done at Airwallex");
    storeBinding(db, await tokenOf(), now, BINDING_ENV);
    expect(() => checkCardAccount(db, { payingAccount: "acct_northwind" }, now, ON)).not.toThrow();
    expect(() => checkCardAccount(db, { payingAccount: "acct_other" }, now, ON)).toThrow("card calls must act for acct_northwind, but this runner's card rail acts for acct_other; nothing is done at Airwallex");
    expect(() => checkCardAccount(db, {}, now, ON)).toThrow("card calls must act for acct_northwind, but this runner's card rail acts for the company's own Airwallex account; nothing is done at Airwallex");
    expect(() => checkCardAccount(db, {}, now, {})).not.toThrow();
    expect(() => checkCardAccount(db, { payingAccount: "acct_northwind" }, now, {})).toThrow("card calls must act for the company's own Airwallex account, but this runner's card rail acts for acct_northwind; nothing is done at Airwallex");
  });
});

describe("a payment's paying account and fee, before any money moves", () => {
  const terms = (o: Record<string, unknown> = {}) => ({ amount: "1850.00", currency: "EUR", paying_account: { id: "acct_northwind" }, platform_fee: { amount: "4.63", currency: "EUR", bps: 25, to_account: PURSER_FEE_ACCOUNT }, ...o });
  const rail = { payingAccount: "acct_northwind" };
  async function bound() {
    const db = openDb(":memory:");
    storeBinding(db, await tokenOf(), now, BINDING_ENV);
    return db;
  }

  it("pays when the terms, the rail and the binding name the same account and the fee is the signed share", async () => {
    const db = await bound();
    expect(() => checkPayingAccount(db, terms(), rail, now, FEE_ON)).not.toThrow();
    expect(() => checkPayingAccount(db, terms({ platform_fee: null }), rail, now, ON)).not.toThrow();
    expect(() => checkPayingAccount(openDb(":memory:"), terms({ paying_account: null, platform_fee: null }), {}, now, {})).not.toThrow();
  });

  it("refuses terms signed for another account, and a rail that pays from another", async () => {
    const db = await bound();
    expect(() => checkPayingAccount(db, terms({ paying_account: { id: "acct_other" } }), rail, now, FEE_ON)).toThrow("the terms were signed for payment from acct_other, but the company's bound account is acct_northwind; nothing is paid");
    expect(() => checkPayingAccount(db, terms({ paying_account: null }), rail, now, FEE_ON)).toThrow("the terms were signed for payment from the company's own Airwallex account, but the company's bound account is acct_northwind; nothing is paid");
    expect(() => checkPayingAccount(db, terms(), { payingAccount: "acct_other" }, now, FEE_ON)).toThrow("the terms were signed for payment from acct_northwind, but this runner pays from acct_other; nothing is paid");
    expect(() => checkPayingAccount(db, terms(), {}, now, FEE_ON)).toThrow("the terms were signed for payment from acct_northwind, but this runner pays from the company's own Airwallex account; nothing is paid");
    // The platform off: terms that name an account are not paid from the company's own.
    expect(() => checkPayingAccount(db, terms({ platform_fee: null }), {}, now, {})).toThrow("the terms were signed for payment from acct_northwind, but the company's bound account is the company's own Airwallex account; nothing is paid");
    // A binding that no longer checks stops the payment with its reason.
    expect(() => checkPayingAccount(db, terms(), rail, new Date(now.getTime() + 2 * 60 * 60_000), FEE_ON)).toThrow(/^the account binding expired at .*; nothing is paid$/);
  });

  it("refuses a fee when the fee is off, above the cap, to another account, or not the signed share of the amount", async () => {
    const db = await bound();
    expect(() => checkPayingAccount(db, terms(), rail, now, ON)).toThrow("the terms carry a Purser fee, but Purser's fee is switched off; nothing is paid");
    // Outside 1 to 100 whole basis points (the reason calls each one "above the cap"): refused before anything is paid.
    for (const bps of [0, 101, 2.5, null]) {
      expect(() => checkPayingAccount(db, terms({ platform_fee: { amount: "4.63", currency: "EUR", bps, to_account: PURSER_FEE_ACCOUNT } }), rail, now, FEE_ON)).toThrow(`the Purser fee in the terms (${String(bps)} basis points) is above the cap of 100; nothing is paid`);
    }
    expect(() => checkPayingAccount(db, terms({ platform_fee: { amount: "4.63", currency: "EUR", bps: 25, to_account: "acct_mallory" } }), rail, now, FEE_ON)).toThrow("the Purser fee in the terms goes to acct_mallory, not to Purser's platform account in the binding; nothing is paid");
    for (const fee of [{ amount: "4.64", currency: "EUR" }, { amount: "4.63", currency: "USD" }, { amount: 4.63, currency: "EUR" }]) {
      expect(() => checkPayingAccount(db, terms({ platform_fee: { ...fee, bps: 25, to_account: PURSER_FEE_ACCOUNT } }), rail, now, FEE_ON)).toThrow("the Purser fee in the terms is not its share of the amount; nothing is paid");
    }
    // An amount that is not a plain two-decimal string has no share: refused, never computed from a guess.
    expect(() => checkPayingAccount(db, terms({ amount: "1850" }), rail, now, FEE_ON)).toThrow("the Purser fee in the terms is not its share of the amount; nothing is paid");
  });
});
