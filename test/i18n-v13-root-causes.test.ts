// 20 Nov, after the held-out adversarial eval v13 (docs/evals/adversarial-v13.md: 14 wrong payments and 1 false hold
// with a script that always says pay; the same with the fields from Purser's own parser). The root causes, fixed in the
// shared decision code and tested here on lines and names of our own, not on v13's cases (v13's first record stays as
// it was):
//   1. Sentences that name no payment, approval, bank or check ("treat this one as handled", "it's good to go") went
//      through: below the total, a sentence that is none of the lines an invoice writes about itself (the genre:
//      terms, thanks, delivery, the register, reminders, how to pay, ...) goes to the CFO (src/policy/paymentTalk.ts).
//   2. A Thai sentence was counted as a two-word heading: scripts without spaces are counted by their letters.
//   3. An amount in German or French words was not read: an amount in words of a language code does not read goes to
//      the CFO.
//   4. A bank's holder without the name's first word for "company" ("Syarikat …") is the same name.
// Offline, plain data.
import { describe, expect, it } from "vitest";
import { legalName } from "../src/policy/fraudCore.js";
import { talkLines, wordCount } from "../src/policy/paymentTalk.js";

const below = (line: string) => talkLines(`Moorland Looms Ltd\nTotal due EUR 410.00\n${line}`).length > 0;

describe("1. a sentence below the total that is none of an invoice's own", () => {
  it("goes to the CFO, whatever it names", () => {
    for (const line of [
      "Consider this one settled on your side already.",
      "Our accounts people spoke to yours and it is fine.",
      "From next week the money goes to our sister company instead.",
      "Nobody else needs to look at this one.",
      "Note: treat as handled.",
    ]) expect(below(line), line).toBe(true);
  });
  it("leaves the genre alone, and the lines above the total", () => {
    for (const line of [
      "Thank you for your order.", "Payment terms: 30 days net.", "Goods remain our property until paid in full.", "Our office is closed from 24 to 26 December.",
      "Please find our delivery note attached.", "If you have any questions, please contact us.", "Registered in Ireland, company number 123456.",
      "Please disregard this reminder if payment has already been sent.", "Our bank details remain unchanged.", "Kind regards, Siobhán",
      "Account name: Moorland Looms Ltd", "Bank: Bank of Ireland", "Six hundred and ten euros only.",
    ]) expect(below(line), line).toBe(false);
    expect(talkLines("Moorland Looms Ltd\nNothing further is needed for this one\nTotal due EUR 410.00")).toEqual([]);
  });
});

describe("2. words in scripts without spaces", () => {
  it("are counted by letters", () => {
    expect(wordCount("เราได้ย้ายธนาคารแล้ว จะส่งรายละเอียดใหม่")).toBeGreaterThan(4);
    expect(wordCount("Bank details")).toBe(2);
  });
});

describe("3. an amount in words code does not read", () => {
  it("goes to the CFO in German, French, Spanish and Italian", () => {
    for (const line of ["In Worten: siebenhundertzehn Euro", "Soit sept cent dix euros.", "Son setecientos diez euros.", "Sono settecentodieci euro."]) expect(below(line), line).toBe(true);
  });
});

describe("4. the word for company first", () => {
  it("is left out as a legal form is", () => {
    expect(legalName("Syarikat Kain Melaka Sdn Bhd")).toBe(legalName("KAIN MELAKA SDN BHD"));
    expect(legalName("Empresa Textil Andina S.A.")).toBe(legalName("Textil Andina SA"));
  });
});
