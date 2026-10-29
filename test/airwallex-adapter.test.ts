// Contract tests: the requests the adapter sends match the documented field names and types.
import { describe, expect, it } from "vitest";
import { cents, AirwallexRest } from "../src/airwallex/adapter.js";
import { Airwallex } from "../src/airwallex/client.js";

function recorder(replies: Record<string, unknown>) {
  const sent: { method: string; path: string; body: unknown; query: string }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace("/api/v1", "");
    if (path === "/authentication/login") return new Response(JSON.stringify({ token: "t" }), { status: 201 });
    sent.push({ method: init.method ?? "GET", path, body: init.body ? JSON.parse(String(init.body)) : undefined, query: u.search });
    const key = Object.keys(replies).find((k) => path.startsWith(k));
    return new Response(JSON.stringify(key ? replies[key] : {}), { status: 200 });
  }) as typeof fetch;
  const rest = new AirwallexRest(new Airwallex({ clientId: "c", apiKey: "k", fetchImpl: impl, minGapMs: 0 }));
  return { rest, sent };
}

describe("Airwallex adapter", () => {
  it("converts major units to cents exactly", () => {
    expect(cents(362.85)).toBe(36285);
    expect(cents("1850.00")).toBe(185000);
    expect(cents(100000)).toBe(10_000_000);
    expect(() => cents(0.001)).toThrow(/finer/);
    expect(() => cents(-1)).toThrow();
  });

  it("quotes with a number amount and a validity", async () => {
    const { rest, sent } = recorder({ "/fx/quotes/create": { quote_id: "q1", buy_amount: 362.85, sell_amount: 393.69, client_rate: 1.085, valid_from_at: "2026-11-05T10:00:00+0000", valid_to_at: "2026-11-05T10:15:00+0000" } });
    const q = await rest.createQuote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 36285, validity: "MIN_15" });
    expect(sent[0]).toMatchObject({ method: "POST", path: "/fx/quotes/create", body: { buy_currency: "EUR", sell_currency: "USD", buy_amount: 362.85, validity: "MIN_15" } });
    expect(q).toMatchObject({ quoteId: "q1", buyAmountCents: 36285, sellAmountCents: 39369, clientRate: "1.085", validTo: "2026-11-05T10:15:00.000Z" });
  });

  it("converts with a string amount, the quote and the approval hash", async () => {
    const { rest, sent } = recorder({ "/fx/conversions/create": { conversion_id: "c1", request_id: "r1", status: "SETTLED", buy_amount: "362.85", sell_amount: 393.69 } });
    await rest.createConversion({ requestId: "r1", approvalSha256: "ab", quote: { quoteId: "q1", buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 36285, sellAmountCents: 39369, clientRate: "1.085", validFrom: "", validTo: "" } });
    expect(sent[0]!.body).toEqual({ request_id: "r1", quote_id: "q1", buy_currency: "EUR", sell_currency: "USD", buy_amount: "362.85", metadata: { approval_sha256: "ab" } });
  });

  it("creates a SWIFT transfer with a string amount, reason and metadata", async () => {
    const { rest, sent } = recorder({ "/transfers/create": { id: "t1", request_id: "r2", status: "PROCESSING", transfer_amount: 1850, transfer_currency: "EUR" } });
    const t = await rest.createTransfer({ requestId: "r2", beneficiaryId: "b1", amountCents: 185000, currency: "EUR", sourceCurrency: "EUR", reference: "BTX-2026-11", reason: "professional_business_services", approvalSha256: "ab" });
    expect(sent[0]!.body).toEqual({
      request_id: "r2", beneficiary_id: "b1", transfer_amount: "1850.00", transfer_currency: "EUR", source_currency: "EUR", transfer_method: "SWIFT",
      reference: "BTX-2026-11", reason: "professional_business_services", metadata: { approval_sha256: "ab" },
    });
    expect(t).toMatchObject({ id: "t1", status: "PROCESSING", amountCents: 185000 });
  });

  it("simulates a deposit on the singular path with a number amount", async () => {
    const { rest, sent } = recorder({ "/simulation/deposit/create": { id: "d1", amount: 1.35, currency: "USD", reference: "0xabc", status: "SETTLED" } });
    const d = await rest.simulateDeposit({ globalAccountId: "ga", amountCents: 135, reference: "0xabc", payerName: "x" });
    expect(sent[0]).toMatchObject({ path: "/simulation/deposit/create", body: { global_account_id: "ga", amount: 1.35, reference: "0xabc", payer_name: "x", status: "SETTLED" } });
    expect(d.amountCents).toBe(135);
  });

  it("transitions with next_status and reads flat or nested failure fields", async () => {
    const { rest, sent } = recorder({ "/simulation/transfers/t1/transition": { id: "t1", request_id: "r", status: "CANCELLED", transfer_amount: 1, transfer_currency: "EUR", failure_type: "BENEFICIARY_BANK_RETURNED" } });
    const t = await rest.transitionTransfer("t1", "FAILED", "BENEFICIARY_BANK_RETURNED");
    expect(sent[0]!.body).toEqual({ next_status: "FAILED", failure_type: "BENEFICIARY_BANK_RETURNED" });
    expect(t.failureType).toBe("BENEFICIARY_BANK_RETURNED");
  });

  it("finds deposits by reference across pages", async () => {
    let page = 0;
    const impl = (async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "t" }), { status: 201 });
      page = Number(u.searchParams.get("page_num"));
      const items = page === 0 ? [{ id: "a", amount: 1, currency: "USD", reference: "x", status: "SETTLED" }] : [{ id: "b", amount: 1.35, currency: "USD", reference: "0xabc", status: "SETTLED" }];
      return new Response(JSON.stringify({ has_more: page === 0, items }), { status: 200 });
    }) as typeof fetch;
    const rest = new AirwallexRest(new Airwallex({ clientId: "c", apiKey: "k", fetchImpl: impl, minGapMs: 0 }));
    expect((await rest.findDepositsByReference("0xabc", "2026-10-01T00:00:00Z")).map((d) => d.id)).toEqual(["b"]);
  });
});
