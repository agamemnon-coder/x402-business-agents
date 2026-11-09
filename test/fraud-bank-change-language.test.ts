// The wording a supplier (or someone posing as one) uses to announce new bank details, in the languages Purser's
// suppliers write in: English, German and Dutch. It is a signal for the person who verifies, never a block on its own.
import { describe, expect, it } from "vitest";
import { assessAgainst } from "../src/policy/fraudCore.js";

const ON_FILE = [{ beneficiary_id: "b1", name: "Bergtex Textil GmbH", iban_sha256: "x".repeat(64), bic: "" }] as Parameters<typeof assessAgainst>[0];
const signal = (text: string) => assessAgainst(ON_FILE, { vendor: "Bergtex Textil GmbH", iban: "", bic: "" }, text, "x".repeat(64)).signals.find((s) => s.code === "bank_change_language");

describe("bank-change wording", () => {
  it.each([
    "Bitte beachten Sie: Unsere Bankverbindung hat sich geändert.",
    "Unsere neue Bankverbindung lautet wie folgt",
    "Bitte nutzen Sie ab sofort unsere geänderte Kontoverbindung",
    "Wir haben geänderte Kontodaten",
    "Bitte aktualisieren Sie Ihre Stammdaten mit unserem neuen Konto",
    "Let op: ons rekeningnummer is gewijzigd",
    "Wij hebben een nieuw rekeningnummer",
    "Onze bankgegevens zijn gewijzigd per 1 november",
    "Please note our bank details have changed",
    "Kindly pay to our new account below",
    "We have changed banks; please update your records",
  ])("flags %s", (text) => {
    const s = signal(text);
    expect(s).toBeDefined();
    expect(s!.blocks).toBe(false);
  });

  it.each([
    "Bankverbindung: Commerzbank, IBAN DE89 3704 0044 0532 0130 00",
    "Rekeningnummer NL91 ABNA 0417 1643 00 t.n.v. Zeeland Verpakkingen",
    "Bank details: IBAN DE89 3704 0044 0532 0130 00",
    "Neue Ware ist eingetroffen",
    "Kontonummer 1234567, Filiale 41460 Neuss",
  ])("leaves %s alone", (text) => {
    expect(signal(text)).toBeUndefined();
  });
});
