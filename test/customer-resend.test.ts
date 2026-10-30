// A clearing payment whose answer was lost holds the wallet until the same request is sent again (Metal's documented
// behaviour; the load test hit it once in 2,000). Summit sends the same request again, a few times, and only then
// reports the payment in doubt. It never pays the same stock check a second way.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithPayment = vi.fn<(url: string) => Promise<Response>>();
const closed = vi.fn();

vi.mock("../src/metal/clearing.js", async (orig) => ({
  ...(await orig<typeof import("../src/metal/clearing.js")>()),
  customerClearingClient: async () => ({ client: {}, wallet: { close: closed } }),
}));
vi.mock("../src/metal/mandate.js", () => ({ activeMandate: async () => ({ credential: {}, signDigest: async () => "0x" }) }));
vi.mock("@metalntwx/metal-pay/mandates", () => ({ createMandatePaymentClient: () => ({ client: {}, fetchWithPayment }) }));
vi.mock("@metalntwx/metal-pay", () => ({ registerClearingClient: () => undefined }));

const { CustomerAgent } = await import("../src/agents/customer.js");
const { outcomeUnknown } = await import("../src/metal/clearing.js");

const SELLER = "0x00000000000000000000000000000000000000f1";
const lost = () => new Error("Failed to create payment payload", { cause: new Error("the wallet holds an earlier payment whose outcome is unknown") });
const noReceipt = () => new Error("Failed to create payment payload: no receipt this wallet could check came back for this payment");

beforeEach(() => { fetchWithPayment.mockReset(); closed.mockReset(); });

describe("a clearing payment whose outcome is unknown", () => {
  it("is recognised, also inside an error's causes", () => {
    expect(outcomeUnknown(lost())).toBe(true);
    expect(outcomeUnknown(noReceipt())).toBe(true);
    expect(outcomeUnknown(new Error("insufficient_deposit"))).toBe(false);
  });

  it("sends the same request again and reports the sale once it resolves", async () => {
    const urls: string[] = [];
    fetchWithPayment.mockImplementationOnce(async (u) => { urls.push(u); throw noReceipt(); })
      .mockImplementationOnce(async (u) => { urls.push(u); throw lost(); })
      .mockImplementationOnce(async (u) => { urls.push(u); return new Response("{}", { status: 200 }); });
    const a = new CustomerAgent("http://seller", SELLER, { sleep: async () => undefined });
    expect(await a.tryClearing(9)).toEqual({ kind: "paid", status: 200, body: "{}" });
    expect(new Set(urls).size).toBe(1);
    expect(urls).toHaveLength(3);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("stays in doubt after the resends run out, and is never paid a second way", async () => {
    fetchWithPayment.mockImplementation(async () => { throw lost(); });
    const a = new CustomerAgent("http://seller", SELLER, { sleep: async () => undefined, resends: 2 });
    let mandateBuys = 0;
    a.buy = async () => { mandateBuys++; throw new Error("must not pay a second way"); };
    expect(await a.buyPrepaid(9)).toMatchObject({ via: "clearing", charged: true });
    expect(fetchWithPayment).toHaveBeenCalledTimes(3);
    expect(mandateBuys).toBe(0);
  });
});
