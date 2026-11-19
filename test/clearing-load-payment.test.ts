// One payment of the clearing load test (npm run clearing-load, src/cli/clearingLoad.ts), as src/metal/loadPayment.ts
// makes it. Run 1 of 30 Oct (docs/runs/clearing-load-1.json) paid 1,879 of 2,000: one wallet's sixth payment got no
// receipt back, and the script did not send that request again, so the wallet refused its other 120 itself ("the wallet
// holds an earlier payment whose outcome is unknown"). Those are the 121 misses of the evidence wall's "3,879 of 4,000".
// The script resent from run 2 on (2,000 of 2,000); here that is held by tests, and resends are counted apart from the
// epoch-boundary waits, which they had shared a counter (and a budget) with.
import { describe, expect, it } from "vitest";
import { payLoadRequest } from "../src/metal/loadPayment.js";

const noReceipt = () => new Error("Failed to create payment payload: no receipt this wallet could check came back for this payment");
const held = () => new Error("Failed to create payment payload", { cause: new Error("the wallet holds an earlier payment whose outcome is unknown") });
const epoch = () => Object.assign(new Error("clearing refused"), { reason: "between_epochs" });
const ok = () => new Response("{\"ok\":true}", { status: 200 });

/** A pay function answering from a script of throws and answers, recording each request it was asked for. */
function scripted(steps: (() => Response | Error)[]) {
  const asked: number[] = [];
  let i = 0;
  const pay = async () => {
    asked.push(i);
    const s = steps[Math.min(i++, steps.length - 1)]!();
    if (s instanceof Error) throw s;
    return s;
  };
  return { pay, asked };
}
const waits: number[] = [];
const opts = { wait: async (ms: number) => { waits.push(ms); } };

describe("a clearing load payment", () => {
  it("run 1's lost receipt: without a resend the wallet's payment fails, as 121 did", async () => {
    const { pay } = scripted([noReceipt, held, held, ok]);
    const r = await payLoadRequest(pay, { ...opts, maxResends: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no receipt this wallet could check/);
  });

  it("sends the same request again after a lost receipt, and the wallet pays on", async () => {
    const { pay, asked } = scripted([noReceipt, held, ok]);
    const r = await payLoadRequest(pay, opts);
    expect(r).toMatchObject({ ok: true, resends: 2, epochRetries: 0, reason: null });
    expect(asked).toHaveLength(3);
  });

  it("stops after five resends and says why", async () => {
    const { pay, asked } = scripted([held]);
    const r = await payLoadRequest(pay, opts);
    expect(r).toMatchObject({ ok: false, resends: 5, epochRetries: 0 });
    expect(r.reason).toMatch(/outcome is unknown|Failed to create payment payload/);
    expect(asked).toHaveLength(6);
  });

  it("counts epoch-boundary waits apart from resends, each with its own budget", async () => {
    const { pay } = scripted([noReceipt, noReceipt, noReceipt, noReceipt, noReceipt, ...Array.from({ length: 10 }, () => epoch), ok]);
    const r = await payLoadRequest(pay, opts);
    expect(r).toMatchObject({ ok: true, resends: 5, epochRetries: 10 });
  });

  it("waits 3 s before each retry, and gives up on the 11th epoch refusal", async () => {
    waits.length = 0;
    const { pay } = scripted([epoch]);
    const r = await payLoadRequest(pay, opts);
    expect(r).toMatchObject({ ok: false, epochRetries: 10, resends: 0 });
    expect(waits).toEqual(Array.from({ length: 10 }, () => 3000));
  });

  it("an answer that is not 2xx is a failure with its status, not retried", async () => {
    const { pay, asked } = scripted([() => new Response("no", { status: 402 })]);
    expect(await payLoadRequest(pay, opts)).toMatchObject({ ok: false, reason: "HTTP 402", resends: 0, epochRetries: 0 });
    expect(asked).toHaveLength(1);
  });

  it("any other error fails at once, its first line kept and secrets redacted", async () => {
    const { pay } = scripted([() => new Error("insufficient_deposit at https://rpc-testnet.metalntwx.com/v1/abcdefabcdefabcdefabcdef\n    at stack")]);
    const r = await payLoadRequest(pay, opts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_deposit at [rpc-url]");
  });
});
