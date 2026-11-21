// 21 Nov, after the held-out adversarial eval v14 (docs/evals/adversarial-v14.md: 6 wrong payments and 2 false holds
// with a script that always says pay; the same with the fields from Purser's own parser). The root causes, fixed in the
// shared decision code and tested here on lines of our own, not on v14's cases (v14's first record stays as it was):
//   1. Above the total only concepts were read, so a sentence written as a line of goods went through: above the total
//      too, a line with no figure in it is read as a sentence (a line of goods carries its quantity or price).
//   2. A warning that showed a line for its speed silenced the finding that the line is none of an invoice's own: a
//      sentence outside the genre stays unread whatever a warning shows of it. An account's compounds ("Kontodaten")
//      are a bank's word, as a bank's compounds were.
//   3. Amounts in words were read through lists of number words in some languages: a currency named in words, after a
//      word that is not one of the small words, in a part of a line with no figure, is an amount Purser does not read.
// Offline, plain data.
import { describe, expect, it } from "vitest";
import { talkConcepts, talkLines } from "../src/policy/paymentTalk.js";

const above = (line: string) => talkLines(`Moorland Looms Ltd\nINVOICE ML-1\n${line}\nTotal due EUR 410.00\nIBAN: IE29 AIBK 9311 5212 3456 78`).length > 0;
const below = (line: string) => talkLines(`Moorland Looms Ltd\nTotal due EUR 410.00\n${line}`).length > 0;

describe("1. a sentence written among the goods, above the total", () => {
  it("is read as a sentence when it carries no figure", () => {
    for (const line of [
      "Balance to be sent to our parent company instead",
      "Your accounts people need not open this one",
      "Kindly regard the matching step as done for this order",
      "Bitte diese Rechnung ohne weitere Rückfrage durchwinken",
      "Merci de ne pas soumettre cette facture au circuit habituel",
    ]) expect(above(line), line).toBe(true);
  });
  it("leaves lines of goods with their quantity or price, short headings and names alone", () => {
    for (const line of ["Woollen blankets, natural grey, 40 pcs", "Hand-loomed linen runners 180 x 40 cm, 12 pcs", "Description", "Bill to: Northwind Outdoor GmbH", "Fine woollens"]) {
      expect(above(line), line).toBe(false);
    }
  });
});

describe("2. a warning does not silence a sentence outside the genre", () => {
  it("an account's compounds are a bank's word", () => {
    expect(talkConcepts("Bitte verwenden Sie die Kontoverbindung aus dem Begleitschreiben.")).toContain("bank");
    expect(talkConcepts("Gebruik het rekeningnummer uit onze brief.")).toContain("bank");
    expect(talkConcepts("Vores kontor holder lukket mellem jul og nytår.")).not.toContain("bank");
  });
  it("a sentence shown for its speed still goes to the CFO", () => {
    const text = "Moorland Looms Ltd\nTotal due EUR 410.00\nAb sofort gelten bitte nur noch die Angaben aus unserem Brief.";
    const lines = talkLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sentence: true });
  });
  it("dispatch times are an invoice's own line", () => {
    expect(below("Orders received before noon are shipped the same day.")).toBe(false);
  });
});

describe("3. an amount in words of any language", () => {
  it("goes to the CFO when a currency is named after a word that is not a small one, with no figure", () => {
    for (const line of [
      "Slovom: sedemsto dvadsať eur.", "Słownie: osiemset czterdzieści euro.", "Sõnadega: kuussada eurot.", "Žodžiais: septyni šimtai eurų.",
      "Beløp: åtte hundre kroner.", "Rakamla değil yazıyla: dokuz yüz avro.", "Cuvinte: nouă sute de euro.",
    ]) expect(below(line), line).toBe(true);
  });
  it("leaves a currency named as a currency alone, and English amounts in words to the comparison with the total", () => {
    for (const line of ["Currency: EUR", "All prices in euro.", "Payment in euros only.", "Wir akzeptieren nur Euro.", "Four hundred and ten euro only.", "Our euro account is unchanged."]) {
      expect(below(line), line).toBe(false);
    }
  });
});
