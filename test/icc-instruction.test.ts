// The ICC instruction, built from the signed terms and nothing else, and the instruction check (src/icc/instruction.ts,
// docs/visa-icc.md sections 4 and 5). Pure functions: no database, no network, no clock but the one passed in.
import { describe, expect, it } from "vitest";
import { TERMS_SCHEMA, sha256Hex, termsHash } from "../src/lib/terms.js";
import {
  ICC_EXPIRY_MARGIN_MS, ICC_PURCHASE_KIND, IccFieldRefusal, buildCredentialsRequest, buildInstruction, checkInstruction, expiryEpochSeconds,
  instructionRequestBody, purchaseFromTerms, recordOf, type IccCheckInput, type IccTerms,
} from "../src/icc/instruction.js";
import { firstInvalidField } from "./support/iccStandIn.js";

const TOKEN = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const NOW = new Date("2026-11-12T10:00:00Z");
const IDS = { actionId: "P-0001", correlationId: "3e1b7943-6567-4965-a32b-5aa93d057d35" };
const INSTRUCTION_ID = `1-${"5C8B7367EC00"}c229ec8a-c96c-4932-a1f3-1faa8f138b01`;

function terms(over: Partial<IccTerms> = {}): IccTerms {
  return {
    schema: TERMS_SCHEMA, kind: ICC_PURCHASE_KIND, proposal_id: "P-0001", expires_at: "2026-11-12T10:30:00Z",
    agent: "sourcing", amount: "12.00", currency: "EUR", merchant: { name: "Northwind test shop", url: "https://kit11.max-31b.workers.dev/", country: "NL" },
    items: [{ name: "Trail map pack", unit_price: "6.00", quantity: "2" }], description: "Trail map packs for the spring range", payment_method_id: TOKEN, ...over,
  };
}

const passthrough = () => ({
  deviceInformation: { applicationName: "from the file", fingerprintSessionId: "fp-1", deviceData: { type: "Mobile", brand: "Test" }, ipAddress: "192.168.0.100" },
  assuranceData: [{ verificationMethod: "23", verificationResults: "01", verificationTimestamp: "1794477000", authenticatedIdentities: { id: "identity-1" } }],
});

describe("the expiry conversion", () => {
  it("writes whole UTC seconds as digits, with no floating point", () => {
    expect(expiryEpochSeconds("2026-11-12T10:30:00Z")).toBe("1794479400");
    expect(expiryEpochSeconds("2026-11-12T10:30:00.000Z")).toBe("1794479400");
    expect(expiryEpochSeconds("1970-01-01T00:00:01Z")).toBe("1");
  });
  it("refuses a time with a fraction of a second, a time without Z, and anything that is not a time", () => {
    expect(() => expiryEpochSeconds("2026-11-12T10:30:00.500Z")).toThrow(IccFieldRefusal);
    expect(() => expiryEpochSeconds("2026-11-12T10:30:00+01:00")).toThrow(/UTC/);
    expect(() => expiryEpochSeconds("2026-13-40T10:30:00Z")).toThrow(IccFieldRefusal);
    expect(() => expiryEpochSeconds("soon")).toThrow(IccFieldRefusal);
  });
});

describe("the instruction, from the signed terms only", () => {
  const t = terms();
  const sha = termsHash(t);
  const record = buildInstruction(t, sha, IDS);

  it("maps each signed term to its documented field", () => {
    expect(record).toEqual({
      clientCorrelationId: IDS.correlationId,
      paymentInformation: { instrumentIdentifier: { id: TOKEN } },
      deviceInformation: { applicationName: "Purser sourcing agent" },
      mandates: [{
        mandateId: "P-0001", preferredMerchantName: "Northwind test shop", declineThreshold: { amount: "12.00", currencyCode: "EUR" },
        effectiveUntilTime: "1794479400", description: `Trail map packs for the spring range purser-terms-sha256 ${sha}`,
      }],
      consumerPrompt: `The sourcing agent may pay at most 12.00 EUR at Northwind test shop until 2026-11-12T10:30:00Z. Purser proposal P-0001; purser-terms-sha256 ${sha}.`,
    });
  });

  it("the request body adds the device and assurance data unchanged; the application name stays the terms'", () => {
    const p = passthrough();
    const body = instructionRequestBody(record, p);
    expect(Object.keys(body)).toEqual(["clientCorrelationId", "paymentInformation", "deviceInformation", "assuranceData", "mandates", "consumerPrompt"]);
    expect(body.assuranceData).toEqual(p.assuranceData);
    expect(body.deviceInformation).toEqual({ ...p.deviceInformation, applicationName: "Purser sourcing agent" });
    expect(body.mandates).toEqual(record.mandates);
    // It passes the published field rules as the test stand-in holds them.
    expect(firstInvalidField("create", body)).toBeNull();
  });

  it("the record is kept as canonical text with its SHA-256; no device or assurance data is in it", () => {
    const r = recordOf(record);
    expect(r.sha256).toBe(sha256Hex(r.json));
    expect(JSON.parse(r.json)).toEqual(record);
    expect(r.json).not.toContain("fingerprint");
    expect(r.json).not.toContain("assurance");
  });

  it("a long description is shortened to make room for the hash, which still covers the full text", () => {
    const long = terms({ description: "A very long description of the goods. ".repeat(20) });
    const m = buildInstruction(long, termsHash(long), IDS).mandates[0];
    expect(m.description.length).toBeLessThanOrEqual(255);
    expect(m.description.endsWith(` purser-terms-sha256 ${termsHash(long)}`)).toBe(true);
    expect(m.description.startsWith("A very long description of the goods.")).toBe(true);
  });

  it("refuses before any call, and never cuts: a merchant name over 40 characters, and every other limit", () => {
    const refusal = (over: Partial<IccTerms>, ids = IDS) => {
      const x = terms(over);
      try { buildInstruction(x, termsHash(x), ids); buildCredentialsRequest(x, termsHash(x), ids, purchaseFromTerms(x, ids.actionId)); } catch (e) { return e instanceof IccFieldRefusal ? e.field : `other: ${(e as Error).message}`; }
      return null;
    };
    expect(refusal({})).toBeNull();
    const long = "Northwind Outdoor test shop (Airwallex sandbox)";
    expect(long).toHaveLength(47);
    expect(refusal({ merchant: { name: long, url: "https://kit11.max-31b.workers.dev/", country: "NL" } })).toBe("merchant.name");
    expect(refusal({ merchant: { name: "N".repeat(40), url: "https://kit11.max-31b.workers.dev/", country: "NL" } })).toBeNull();
    expect(refusal({ merchant: { name: "", url: "https://kit11.max-31b.workers.dev/", country: "NL" } })).toBe("merchant.name");
    expect(refusal({ merchant: { name: "---", url: "https://kit11.max-31b.workers.dev/", country: "NL" } })).toBe("merchant.name");
    expect(refusal({ merchant: { name: "Shop", url: "http://kit11.max-31b.workers.dev/", country: "NL" } })).toBe("merchant.url");
    expect(refusal({ merchant: { name: "Shop", url: `https://kit11.max-31b.workers.dev/${"a".repeat(250)}`, country: "NL" } })).toBe("merchant.url");
    expect(refusal({ merchant: { name: "Shop", url: "https://kit11.max-31b.workers.dev/a./b", country: "NL" } })).toBe("merchant.url");
    expect(refusal({ merchant: { name: "Shop", url: "https://kit11.max-31b.workers.dev/", country: "Netherlands" } })).toBe("merchant.country");
    expect(refusal({ amount: "12" })).toBe("amount");
    expect(refusal({ amount: "0.00" })).toBe("amount");
    expect(refusal({ amount: "1234567890.00" })).toBe("amount");
    expect(refusal({ currency: "euro" })).toBe("currency");
    expect(refusal({ payment_method_id: "short" })).toBe("payment_method_id");
    expect(refusal({ payment_method_id: "x".repeat(33) })).toBe("payment_method_id");
    expect(refusal({ agent: "a\nb" })).toBe("agent");
    expect(refusal({ description: "line\nbreak" })).toBe("description");
    expect(refusal({ description: "see ./file" })).toBe("description");
    expect(refusal({ expires_at: "2026-11-12T10:30:00.250Z" })).toBe("expires_at");
    expect(refusal({}, { actionId: "x".repeat(51), correlationId: IDS.correlationId })).toBe("action id");
    expect(refusal({}, { actionId: "P-0001", correlationId: "c".repeat(256) })).toBe("correlation id");
    expect(refusal({ proposal_id: "p".repeat(51) })).toBe("proposal_id");
    expect(() => buildInstruction(t, "not-a-hash", IDS)).toThrow(IccFieldRefusal);
  });
});

describe("the credentials request", () => {
  it("is built from the terms: the amount as signed, the merchant, the action as reference, the hash where it fits", () => {
    const t = terms();
    const sha = termsHash(t);
    const body = buildCredentialsRequest(t, sha, IDS, purchaseFromTerms(t, IDS.actionId));
    expect(body).toEqual({
      clientCorrelationId: IDS.correlationId,
      paymentInformation: { instrumentIdentifier: { id: TOKEN } },
      transactionData: [{
        clientReferenceInformation: { code: "P-0001" },
        mandateReferenceData: [{ mandateId: "P-0001" }],
        type: "PURCHASE",
        orderInformation: { amountDetail: { totalAmount: "12.00", currency: "EUR" }, lineItems: [{ items: { additionalInfo: [{ key: "purser-terms-sha256", value: sha }] } }] },
        merchantOrderId: "P-0001",
        merchantInformation: { merchantName: "Northwind test shop", merchantDescriptor: { url: "https://kit11.max-31b.workers.dev/", country: "NL" } },
      }],
    });
    expect(firstInvalidField("credentials", body)).toBeNull();
  });
});

describe("the instruction check: Purser's record of the instruction it sent, against the signed terms", () => {
  const t = terms();
  const sha = termsHash(t);
  const record = buildInstruction(t, sha, IDS);
  const input = (over: Partial<IccCheckInput> = {}): IccCheckInput => ({
    terms: t, approvedSha256: sha, actionId: IDS.actionId, recorded: recordOf(record),
    answer: { httpStatus: 200, clientCorrelationId: IDS.correlationId, instructionId: INSTRUCTION_ID, status: null, pendingEvents: [] },
    purchase: purchaseFromTerms(t, IDS.actionId), now: NOW, ...over,
  });
  const codes = (i: IccCheckInput) => { const c = checkInstruction(i); return c.ok ? [] : c.findings.map((f) => f.code); };
  /** The record with one field changed, re-hashed as a tamperer who can write both columns would. */
  const changed = (change: (r: typeof record) => void) => { const r = structuredClone(record); change(r); return recordOf(r); };

  it("passes when nothing differs", () => {
    expect(checkInstruction(input())).toEqual({ ok: true });
  });

  it("a changed amount is refused", () => {
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].declineThreshold.amount = "120.00"; }) }))).toEqual(["PURSER_ICC_AMOUNT_DIFFERS", "PURSER_ICC_RECORD_DIFFERS"]);
    // Compared in integer cents: a value that is no two-decimal amount is a difference too.
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].declineThreshold.amount = "12"; }) }))).toContain("PURSER_ICC_AMOUNT_DIFFERS");
  });

  it("a changed merchant is refused", () => {
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].preferredMerchantName = "Another shop"; }) }))).toEqual(["PURSER_ICC_MERCHANT_DIFFERS", "PURSER_ICC_RECORD_DIFFERS"]);
    expect(codes(input({ purchase: { ...purchaseFromTerms(t, IDS.actionId), merchantUrl: "https://shop.example/" } }))).toEqual(["PURSER_ICC_MERCHANT_DIFFERS"]);
    expect(codes(input({ purchase: { ...purchaseFromTerms(t, IDS.actionId), merchantCountry: "US" } }))).toEqual(["PURSER_ICC_MERCHANT_DIFFERS"]);
  });

  it("a changed expiry is refused", () => {
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].effectiveUntilTime = "1794565800"; }) }))).toEqual(["PURSER_ICC_EXPIRY_DIFFERS", "PURSER_ICC_RECORD_DIFFERS"]);
  });

  it("an expired instruction is refused, and one that expires within the margin", () => {
    expect(codes(input({ now: new Date("2026-11-12T10:30:00Z") }))).toEqual(["PURSER_ICC_EXPIRED"]);
    expect(codes(input({ now: new Date("2026-11-12T11:00:00Z") }))).toEqual(["PURSER_ICC_EXPIRED"]);
    const edge = Date.parse("2026-11-12T10:30:00Z") - ICC_EXPIRY_MARGIN_MS;
    expect(codes(input({ now: new Date(edge) }))).toEqual(["PURSER_ICC_EXPIRED"]);
    expect(codes(input({ now: new Date(edge - 1000) }))).toEqual([]);
  });

  it("an over-cap purchase is refused", () => {
    expect(codes(input({ purchase: { ...purchaseFromTerms(t, IDS.actionId), amount: "12.01" } }))).toEqual(["PURSER_ICC_ABOVE_CAP"]);
    expect(codes(input({ purchase: { ...purchaseFromTerms(t, IDS.actionId), amount: "11.99" } }))).toEqual([]);
    // A record whose cap was lowered: the cap differs, and the purchase is above it.
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].declineThreshold.amount = "10.00"; }) }))).toEqual(["PURSER_ICC_AMOUNT_DIFFERS", "PURSER_ICC_ABOVE_CAP", "PURSER_ICC_RECORD_DIFFERS"]);
    expect(codes(input({ purchase: { ...purchaseFromTerms(t, IDS.actionId), amount: "twelve" } }))).toEqual(["PURSER_ICC_ABOVE_CAP"]);
  });

  it("a changed currency, agent, reference or carried hash is refused", () => {
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].declineThreshold.currencyCode = "USD"; }) }))).toContain("PURSER_ICC_CURRENCY_DIFFERS");
    expect(codes(input({ purchase: { ...purchaseFromTerms(t, IDS.actionId), currency: "USD" } }))).toEqual(["PURSER_ICC_CURRENCY_DIFFERS"]);
    expect(codes(input({ recorded: changed((r) => { r.deviceInformation.applicationName = "Purser treasury agent"; }) }))).toContain("PURSER_ICC_REFERENCE_DIFFERS");
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].mandateId = "P-0002"; }) }))).toContain("PURSER_ICC_REFERENCE_DIFFERS");
    expect(codes(input({ purchase: { ...purchaseFromTerms(t, IDS.actionId), actionId: "P-0002" } }))).toEqual(["PURSER_ICC_REFERENCE_DIFFERS"]);
    expect(codes(input({ recorded: changed((r) => { r.mandates[0].description = "Trail map packs"; }) }))).toContain("PURSER_ICC_HASH_NOT_CARRIED");
    expect(codes(input({ recorded: changed((r) => { r.consumerPrompt = r.consumerPrompt.replace(sha, "0".repeat(64)); }) }))).toContain("PURSER_ICC_HASH_NOT_CARRIED");
    expect(codes(input({ recorded: changed((r) => { r.paymentInformation.instrumentIdentifier.id = "B".repeat(32); }) }))).toEqual(["PURSER_ICC_RECORD_DIFFERS"]);
  });

  it("terms that no longer hash to what the CFO approved are refused, whatever the record says", () => {
    const other = terms({ amount: "13.00" });
    expect(codes(input({ terms: other }))).toContain("PURSER_ICC_TERMS_HASH_DIFFERS");
    expect(codes(input({ approvedSha256: "0".repeat(64) }))).toContain("PURSER_ICC_TERMS_HASH_DIFFERS");
  });

  it("a record that does not match the hash stored before sending, or cannot be read, is refused", () => {
    const r = recordOf(record);
    expect(codes(input({ recorded: { json: r.json.replace('"amount":"12.00"', '"amount":"12.50"'), sha256: r.sha256 } }))).toEqual(expect.arrayContaining(["PURSER_ICC_AMOUNT_DIFFERS", "PURSER_ICC_RECORD_DIFFERS"]));
    expect(codes(input({ recorded: { json: r.json, sha256: "0".repeat(64) } }))).toEqual(["PURSER_ICC_RECORD_DIFFERS"]);
    expect(codes(input({ recorded: { json: "{not json", sha256: sha256Hex("{not json") } }))).toEqual(["PURSER_ICC_RECORD_UNREADABLE"]);
    expect(codes(input({ recorded: { json: "{}", sha256: sha256Hex("{}") } }))).toEqual(["PURSER_ICC_RECORD_UNREADABLE"]);
    const two = changed((x) => { (x.mandates as unknown[]).push(structuredClone(x.mandates[0])); });
    expect(codes(input({ recorded: two }))).toEqual(["PURSER_ICC_RECORD_DIFFERS"]);
  });

  it("the create answer: 202, PENDING, a missing ID or another correlation ID is refused", () => {
    const answer = input().answer;
    expect(codes(input({ answer: { ...answer, httpStatus: 202, status: "PENDING", pendingEvents: ["PENDING_CARDHOLDER_AUTHENTICATION"] } }))).toEqual(["PURSER_ICC_INSTRUCTION_PENDING"]);
    expect(codes(input({ answer: { ...answer, status: "PENDING" } }))).toEqual(["PURSER_ICC_INSTRUCTION_PENDING"]);
    expect(codes(input({ answer: { ...answer, instructionId: null } }))).toEqual(["PURSER_ICC_ANSWER_INVALID"]);
    expect(codes(input({ answer: { ...answer, instructionId: "too-short" } }))).toEqual(["PURSER_ICC_ANSWER_INVALID"]);
    expect(codes(input({ answer: { ...answer, clientCorrelationId: "another" } }))).toEqual(["PURSER_ICC_ANSWER_INVALID"]);
  });

  it("says what was compared in exact words: Purser's record, never a read from the service", () => {
    const c = checkInstruction(input({ recorded: changed((r) => { r.mandates[0].declineThreshold.amount = "120.00"; }) }));
    if (c.ok) throw new Error("expected a refusal");
    expect(c.findings[0]!.reason).toBe("Purser's record of the instruction it sent has the cap 120.00; the signed terms say 12.00");
    for (const f of c.findings) expect(f.reason).not.toMatch(/read back|from Visa|Visa's copy/i);
  });
});
