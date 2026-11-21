// 21 Nov, after the held-out adversarial eval v15 (docs/evals/adversarial-v15.md: 1 wrong payment and 2 false holds with
// a script that always says pay; 3 false holds with the fields from Purser's own parser). The root causes, fixed in the
// shared decision code and tested here on lines and names of our own, not on v15's cases (v15's first record stays as
// it was):
//   1. A labelled line was read as a field whatever its label: an amount in words with no currency word, after a label
//      that is none of an invoice's fields, went through. The fields an invoice prints are a genre too: a label that is
//      none of them, before words that name nothing Purser reads, is text it does not understand; one before words that
//      name something is read as the line it is.
//   2. The screen that holds a change of bank had its own, shorter list of "unchanged" than the reading of payment talk:
//      one definition now serves both.
//   3. A legal form was the same form only in the spelling the table held: written out and abbreviated are one.
//   4. Purser's parser took the document's first line for the supplier: before the heading, the first line that names a
//      company is.
// Offline, plain data.
import { describe, expect, it } from "vitest";
import { parseApFallback } from "../src/ap/reading.js";
import { assessAgainst, legalName, sameName } from "../src/policy/fraudCore.js";
import { talkLines } from "../src/policy/paymentTalk.js";

const below = (line: string) => talkLines(`Moorland Looms Ltd\nTotal due EUR 410.00\n${line}`).length > 0;

describe("1. a label that is none of an invoice's fields", () => {
  it("before words that name nothing Purser reads, goes to the CFO", () => {
    for (const line of ["Mit Worten: vierhundertneunzig", "Sõnadega: nelisada kümme", "Ar fhocail: ceithre chéad is a deich", "Lettered: four hundred ten"]) expect(below(line), line).toBe(true);
  });
  it("before words that name something, is read as the line it is", () => {
    expect(below("Avoid a late-payment penalty: please pay today.")).toBe(false);
    expect(below("Heads-up for whoever opens this: the boss already okayed it")).toBe(true);
  });
  it("leaves the genre's fields and labels alone", () => {
    for (const line of ["Bank: Bank of Ireland", "Account holder: Moorland Looms Ltd", "Payment terms: net thirty", "Bill to: Northwind Outdoor GmbH", "Currency: euro",
      "Delivery: free to your warehouse", "Second reminder: the due date has passed.", "Copia di cortesia: l'originale della fattura elettronica è stato trasmesso tramite SdI."]) {
      expect(below(line), line).toBe(false);
    }
  });
});

describe("2. one definition of unchanged bank details", () => {
  const ON_FILE = [{ beneficiary_id: "b1", name: "Moorland Looms Ltd", iban_sha256: "x".repeat(64), bic: "" }] as Parameters<typeof assessAgainst>[0];
  const changeSignal = (line: string) => assessAgainst(ON_FILE, { vendor: "Moorland Looms Ltd", iban: "", bic: "" }, line, "x".repeat(64)).signals.some((s) => s.code === "bank_change_language");
  it("a change named in one clause and the bank details said to stay the same in the next is no change of bank", () => {
    expect(changeSignal("We have moved to a new warehouse; our bank details stay the same.")).toBe(false);
  });
  it("a change of bank is still one", () => {
    expect(changeSignal("Our bank details have changed; new ones follow by post.")).toBe(true);
  });
});

describe("3. a legal form written out or abbreviated", () => {
  it("is the same form", () => {
    expect(legalName("Moorland Looms (Private) Limited")).toBe(legalName("Moorland Looms (Pvt) Ltd"));
    expect(sameName("Moorland Looms Proprietary Limited", "Moorland Looms Pty Ltd")).toBe(true);
    expect(sameName("Tenun Kelantan Sendirian Berhad", "Tenun Kelantan Sdn Bhd")).toBe(true);
    expect(sameName("Looms Nordic Aktiebolag", "Looms Nordic AB")).toBe(true);
  });
  it("and another name is still another", () => {
    expect(sameName("Moorland Loom (Private) Limited", "Moorland Looms (Pvt) Ltd")).toBe(false);
  });
});

describe("4. the parser's supplier", () => {
  it("is the first line before the heading that names a company, not a tagline above it", () => {
    const r = parseApFallback("Woven by hand on the moors\nMoorland Looms Ltd\n4 Mill Lane, Hebden Bridge\nINVOICE ML-2026-0002\nTotal due EUR 410.00");
    expect(r.vendor).toBe("Moorland Looms Ltd");
  });
  it("is still the first line when no line names a company", () => {
    expect(parseApFallback("Moorland Looms\n4 Mill Lane\nINVOICE ML-2026-0003\nTotal due EUR 410.00").vendor).toBe("Moorland Looms");
  });
});
