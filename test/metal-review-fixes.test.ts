// Alta review (6 November, docs/metal-review.md), the small fixes besides the pull retry (metal-pull-after-replace):
// a clearing wallet is kept for one Clearing deployment, a clearing payment whose answer was lost is recognised by
// metal-pay's own reason, and a disputed order counts as signed from verifyMandatePayment's outcome, not its wording.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ verification: null as unknown, calls: [] as unknown[] }));
vi.mock("@metalntwx/metal-pay/mandates", async (orig) => ({
  ...(await orig<object>()),
  verifyMandatePayment: async (_c: unknown, opts: unknown) => { h.calls.push(opts); return h.verification; },
}));
vi.mock("../src/metal/chain.js", async (orig) => ({ ...(await orig<object>()), publicClient: () => ({}) }));

const { ClearingRefusal } = await import("@metalntwx/metal-pay");
const { outcomeUnknown, betweenEpochs, walletDirFor } = await import("../src/metal/clearing.js");
const { verifyOrders } = await import("../src/agents/disputes.js");

describe("a clearing wallet belongs to one Clearing deployment (metal-pay 0.3.4)", () => {
  const dir = () => join(mkdtempSync(join(tmpdir(), "kit11-clearing-")), "clearing-customer");
  const A = { settlement: "0x00000000000000000000000000000000000000c1" as const };
  const B = { settlement: "0x00000000000000000000000000000000000000c2" as const };

  it("records the deployment on first use and opens it again for the same one", () => {
    const d = dir();
    expect(walletDirFor("customer", A, d)).toBe(d);
    expect(JSON.parse(readFileSync(`${d}.deployment.json`, "utf8"))).toEqual({ settlement: A.settlement });
    expect(walletDirFor("customer", { settlement: A.settlement.toUpperCase().replace("0X", "0x") as `0x${string}` }, d)).toBe(d);
  });

  it("refuses a wallet kept for another deployment, so a stale record is never paid from", () => {
    const d = dir();
    walletDirFor("customer", A, d);
    expect(() => walletDirFor("customer", B, d)).toThrow(/belongs to the Clearing deployment 0x0+c1.*now names 0x0+c2.*open a new wallet/);
    expect(existsSync(`${d}.deployment.json`)).toBe(true);
  });
});

describe("clearing refusals read by metal-pay's reason", () => {
  const refusal = (reason: "answer_lost" | "payment_held" | "between_epochs" | "insufficient_deposit") =>
    new ClearingRefusal(reason, reason === "between_epochs" ? { action: "retry_after_ms", ms: 2000 } : reason === "insufficient_deposit" ? { action: "deposit" } : { action: "repeat_same_request", url: null, amount: "70000", ms: 1000 }, "refused");

  it("an answer lost or a payment held is an unknown outcome, also as the cause of a fetch error", () => {
    expect(outcomeUnknown(refusal("answer_lost"))).toBe(true);
    expect(outcomeUnknown(refusal("payment_held"))).toBe(true);
    expect(outcomeUnknown(new Error("payment failed", { cause: refusal("payment_held") }))).toBe(true);
  });
  it("a pause between epochs or a short deposit is not", () => {
    expect(outcomeUnknown(refusal("between_epochs"))).toBe(false);
    expect(outcomeUnknown(refusal("insufficient_deposit"))).toBe(false);
    expect(betweenEpochs(refusal("between_epochs"))).toBe(true);
  });
});

describe("a disputed order is signed when verifyMandatePayment passes with it", () => {
  const CUSTOMER = "0x7b71643913d05d14376562b3682dd1a45cca6cdf";
  const sale = (signed: string) => ({ sale_id: 5, seq: 5, price_cents: 5, payer: CUSTOMER, tx_hash: `0x${"ab".repeat(32)}`, signed_offer: signed, body_json: "{}", requirements_json: null });
  const steps = (four: "pass" | "fail", detail: string) => [1, 2, 3].map((step) => ({ step, title: "", outcome: "pass", detail: "" })).concat([{ step: 4, title: "", outcome: four, detail }]);
  const verified = (four: "pass" | "fail", detail: string) => ({ ok: four === "pass", steps: steps(four, detail), mandate: { principal: CUSTOMER, txHash: "0xbound" }, payments: [] });

  it("counts the order as signed from the outcome, whatever the step's wording", async () => {
    h.verification = verified("pass", "1 payment(s) and 0 refusal(s), reworded by a later SDK");
    const [e] = await verifyOrders([sale("eyJ.order") as never], CUSTOMER as `0x${string}`);
    expect(e).toMatchObject({ signed_order: true, within_mandate: true, payer_is_customer: true });
    expect(h.calls.at(-1)).toMatchObject({ checkoutMandate: "eyJ.order" });
  });
  it("is not signed when step 4 fails, or when the seller kept no order", async () => {
    h.verification = verified("fail", "the checkout mandate is another payment's order");
    expect((await verifyOrders([sale("eyJ.other") as never], CUSTOMER as `0x${string}`))[0]).toMatchObject({ signed_order: false, within_mandate: false });
    h.verification = verified("pass", "no checkout mandate was given");
    expect((await verifyOrders([sale("") as never], CUSTOMER as `0x${string}`))[0]!.signed_order).toBe(false);
  });
});

describe("the 'nothing moved' settlement reasons Purser copies from metal-agent", () => {
  it("are exactly the pinned CLI's list (metal-pay exports none; a drift would change what counts as paid)", async () => {
    const { NOTHING_SETTLED } = await import("../src/metal/pay.js");
    const cli = readFileSync(new URL("../node_modules/@metalntwx/metal-agent/dist/commands/pay.js", import.meta.url), "utf8");
    const list = /const NOTHING_SETTLED = new Set\(\[([\s\S]*?)\]\)/.exec(cli)?.[1] ?? "";
    expect([...list.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]).sort()).toEqual([...NOTHING_SETTLED].sort());
  });
});
