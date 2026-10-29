// Tier 3 item 7, invoice fraud (business email compromise): code decides from the ledger, nothing is paid, and the
// Airwallex rail is never called for a blocked invoice. Opus only explains; its answer cannot say "pay".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment } from "../src/agents/euroBill.js";
import { checkInvoice, ibanSha, parseInvoiceFallback, type Invoice } from "../src/agents/invoice.js";
import type { AirwallexRail } from "../src/airwallex/port.js";
import { openDb, type DB } from "../src/db/open.js";
import { assessInvoice, editDistance, skeleton } from "../src/policy/fraud.js";
import { fraudExplanationFallback } from "../src/claude/tools.js";

const LIZ = "Lizenzhaus Beispiel GmbH";
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const legitText = fixture("lizenzhaus-invoice-LIC-2026-11.txt");
const bankText = fixture("lizenzhaus-invoice-LIC-2027-01-BANKCHANGE.txt");
const lookText = fixture("lizenzhaus-invoice-LIC-2027-02-LOOKALIKE.txt");

function ledger(): DB {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('b-1', ?, '3000', ?, 'COBADEFFXXX', 'EUR', 'SWIFT')")
    .run(LIZ, ibanSha("DE89370400440532013000"));
  return db;
}

/** A rail that fails the test if anything touches it: a blocked invoice must not reach Airwallex at all. */
const untouchable = new Proxy({}, { get: (_t, prop) => () => { throw new Error(`Airwallex was called (${String(prop)}) for a blocked invoice`); } }) as AirwallexRail;

describe("names", () => {
  it("reduces lookalike letters from other scripts to the same skeleton", () => {
    expect(skeleton("Lizenzhaus Beispiel GmbH")).toBe(skeleton("Lizenzhaus Bеispiеl GmbH")); // Cyrillic е
    expect(skeleton("Lizenzhaus Beispiel GmbH")).toBe(skeleton("LIZENZHAUS  Beispiel GmbH."));
    expect(skeleton("Lizenzhaus Beispiel GmbH")).not.toBe(skeleton("Lizenzhaus Beispeil GmbH"));
  });

  it("counts a swap of two letters as one edit", () => {
    expect(editDistance("beispiel", "beispeil")).toBe(1);
    expect(editDistance("beispiel", "beispiell")).toBe(1);
    expect(editDistance("abc", "xyz")).toBe(3);
  });
});

describe("invoice fraud check", () => {
  it("passes the real invoice: same name, IBAN, BIC and account name as on file", () => {
    const db = ledger();
    const f = assessInvoice(db, parseInvoiceFallback(legitText), legitText);
    expect(f.blocked).toBe(false);
    expect(checkInvoice(db, parseInvoiceFallback(legitText), legitText)).toMatchObject({ ok: true, beneficiaryId: "b-1" });
  });

  it("blocks changed bank details for a known supplier, and names what changed and what is on file", () => {
    const db = ledger();
    const inv = parseInvoiceFallback(bankText);
    const f = assessInvoice(db, inv, bankText);
    expect(f.blocked).toBe(true);
    expect(f.signals.find((s) => s.code === "bank_details_changed")).toMatchObject({
      blocks: true, detail: "the invoice asks for IBAN ...1000 (LT) and BIC CBVILT2XXXX; on file: IBAN ...3000 (DE) and BIC COBADEFFXXX",
    });
    // The wording that usually comes with such a change is evidence, never the reason on its own.
    expect(f.signals.filter((s) => !s.blocks).map((s) => s.code).sort()).toEqual(["bank_change_language", "pressure_language"]);
    const c = checkInvoice(db, inv, bankText);
    expect(c).toMatchObject({ ok: false, reason: expect.stringMatching(/^possible invoice fraud: .*a person verifies with Lizenzhaus Beispiel GmbH on the phone number on file$/) });
  });

  it("blocks a vendor name that only looks like an allowlisted one", () => {
    const db = ledger();
    const inv = parseInvoiceFallback(lookText);
    const f = assessInvoice(db, inv, lookText);
    expect(f.blocked).toBe(true);
    expect(f.signals.find((s) => s.code === "lookalike_vendor")).toMatchObject({ blocks: true, detail: `"Lizenzhaus Beispeil GmbH" is not the allowlisted "${LIZ}" but looks like it (1 letter differs)` });
    // Its bank details are compared with the supplier it pretends to be.
    expect(f.signals.find((s) => s.code === "bank_details_changed")?.detail).toBe("the invoice asks for IBAN ...6789 (DE) and BIC PBNKDEFFXXX; on file: IBAN ...3000 (DE) and BIC COBADEFFXXX");
  });

  it("blocks letters from another script, even with the allowlisted IBAN", () => {
    const db = ledger();
    const inv: Invoice = { ...parseInvoiceFallback(legitText), vendor: "Lizenzhaus Bеispiеl GmbH" };
    const f = assessInvoice(db, inv, legitText);
    expect(f.signals.map((s) => s.code)).toEqual(expect.arrayContaining(["lookalike_vendor", "mixed_scripts"]));
    expect(f.signals.find((s) => s.code === "lookalike_vendor")!.detail).toMatch(/same letters, some from another alphabet/);
    expect(f.blocked).toBe(true);
  });

  it("blocks when the account holder on the invoice is someone else", () => {
    const db = ledger();
    const text = legitText.replace("Account name: Lizenzhaus Beispiel GmbH", "Account name: J. Smith Consulting");
    const f = assessInvoice(db, parseInvoiceFallback(text), text);
    expect(f.signals.find((s) => s.code === "account_name_mismatch")).toMatchObject({ blocks: true });
  });

  it("keeps an unknown vendor an escalation, not a fraud claim", () => {
    const db = ledger();
    const text = legitText.replace(/Lizenzhaus Beispiel GmbH/g, "Datenwerk Nord AG");
    const inv = parseInvoiceFallback(text);
    expect(checkInvoice(db, inv, text)).toEqual({ ok: false, reason: "Datenwerk Nord AG is not an allowlisted beneficiary", fraud: expect.objectContaining({ blocked: true, suspicious: false }) });
  });

  it("escalates a blocked invoice without calling Airwallex, and audits the signals", async () => {
    const db = ledger();
    const inv = parseInvoiceFallback(bankText);
    const out = await proposeInvoicePayment(db, untouchable, inv, bankText);
    expect(out).toMatchObject({ kind: "escalated", fraud: { blocked: true } });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'invoice.fraud_suspected'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ vendor: LIZ, amount: "1850.00", iban_last4: "1000", signals: expect.arrayContaining([expect.objectContaining({ code: "bank_details_changed" })]) });
  });

  it("explains without a model in plain words, and never says to pay", () => {
    const db = ledger();
    const f = assessInvoice(db, parseInvoiceFallback(bankText), bankText);
    const e = fraudExplanationFallback(f);
    expect(e.recommendation).toBe("do_not_pay");
    expect(e.red_flags.length).toBeGreaterThan(0);
    expect(e.verify_steps.join(" ")).toMatch(/phone number on file/);
  });
});
