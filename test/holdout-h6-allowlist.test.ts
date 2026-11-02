// Blind holdout H6 (dry-177, finding 5 of docs/runs/holdouts/2026-11-03-blind/results.md): in a fresh world the
// Treasury agent read its position before any Treasury flow had run, so the ledger's beneficiaries table was still
// empty and its facts called the licensor "an unlisted vendor"; Opus then declined to plan the real licence and asked
// the CFO to add Stockline to the allowlist. The facts now read the allowlist code itself keeps (the payees seedTreasury
// creates), beside the ledger's active beneficiaries, so the first observe states the true fact. Nothing an agent or an
// invoice says adds a payee: an invoice that names an allowlisted vendor with bank details not on file is flagged, and
// plan_invoice's own IBAN/BIC check (checkInvoice, on the ledger's beneficiaries) is unchanged.
// Stand-in Airwallex, no network, no Claude.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_PAYEES, LICENSOR, MANUFACTURER, payeeAllowlist, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { checkInvoice, ibanSha, parseInvoiceFallback } from "../src/agents/invoice.js";
import { publish } from "../src/autonomy/bus.js";
import { invoiceFacts, plannedInvoiceOf } from "../src/autonomy/invoiceFacts.js";
import { treasuryProfile, type TreasurySim } from "../src/autonomy/teamProfiles.js";
import { openDb, type DB } from "../src/db/open.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";

const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");
const PLANNED = plannedInvoiceOf(text)!;
/** The licence with another number and, optionally, other bank lines (a payee change asked for by the invoice itself). */
const variant = (o: { no?: string; iban?: string; bic?: string }) => {
  let t = text;
  if (o.no) t = t.replace("INVOICE SLL-2026-11", `INVOICE ${o.no}`).replace("Payment reference: SLL-2026-11", `Payment reference: ${o.no}`);
  if (o.iban) t = t.replace(/^IBAN:.*$/m, `IBAN: ${o.iban}`);
  if (o.bic) t = t.replace(/^BIC:.*$/m, `BIC: ${o.bic}`);
  return t;
};
const arrive = (db: DB, t: string) => publish(db, "invoice.received", { vendor: "Stockline Data GmbH", file: "x.txt", text: t.slice(0, 1500) }, "treasury");
const beneficiaries = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM beneficiaries").get() as { n: number }).n;

/** The Treasury profile on stand-in rails: nothing reaches Airwallex while it observes. */
function treasury(db: DB, awx: FakeAirwallex) {
  const sim: TreasurySim = {
    mandates: async () => [], client: null, proposePriceRise: async () => [], sweep: async () => ({ ok: true, text: "" }),
    planInvoice: async () => {
      const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
      return { ok: true, text: out.kind === "proposed" ? `PLAN ${out.proposal.proposal_id}` : `ESCALATION ${out.reason}` };
    },
    invoiceText: () => text,
  };
  return treasuryProfile(30 * 60_000, { runFlow: () => { throw new Error("no flow runs on the stand-in rails"); }, sim });
}

describe("H6: a fresh world's first Treasury observe states the true allowlist", () => {
  it("before any Treasury flow ran (no beneficiaries in the ledger), the licensor is named as allowlisted and plan_invoice is offered", async () => {
    const db = openDb(":memory:");
    expect(beneficiaries(db)).toBe(0);
    arrive(db, text);
    const seen = await treasury(db, new FakeAirwallex()).observe(db);
    expect(seen).toMatch(/Open invoice SLL-2026-11, as the invoice states \(unverified\): from Stockline Data GmbH, EUR 240\.00, due 2026-11-15\./);
    expect(seen).not.toMatch(/unlisted vendor/);
    expect(seen).toMatch(/plan_invoice may plan it now/);
    // Observing wrote nothing: the ledger's allowlist is still what code's flow seeds, not the facts.
    expect(beneficiaries(db)).toBe(0);
  });

  it("the allowlist the facts read is code's own (the payees seedTreasury creates), before and after the first flow", async () => {
    const db = openDb(":memory:");
    const before = payeeAllowlist(db);
    expect(before.map((p) => p.name).sort()).toEqual([LICENSOR.name, MANUFACTURER.name].sort());
    expect(ALLOWLISTED_PAYEES.map((p) => p.name)).toEqual([MANUFACTURER.name, LICENSOR.name]);
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    expect(beneficiaries(db)).toBe(2);
    // The same two payees, by name, IBAN and BIC, once each.
    const key = (l: ReturnType<typeof payeeAllowlist>) => l.map((p) => `${p.name}|${p.ibanSha256}|${p.bic}`).sort();
    expect(key(payeeAllowlist(db))).toEqual(key(before));
  });

  it("a payee changed by a person (the old account REPLACED) is the one on file; the code payee's old account is not added back", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    db.prepare("UPDATE beneficiaries SET status = 'REPLACED' WHERE name = ?").run(LICENSOR.name);
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status) VALUES ('ben-new', ?, '3000', ?, 'COBADEFFXXX', 'EUR', 'SWIFT', 'ACTIVE')")
      .run(LICENSOR.name, ibanSha("DE44500105175407324931"));
    const lic = payeeAllowlist(db).filter((p) => p.name === LICENSOR.name);
    expect(lic).toEqual([{ name: LICENSOR.name, ibanSha256: ibanSha("DE44500105175407324931"), bic: "COBADEFFXXX" }]);
    // The licence to the old account is now flagged in the facts.
    arrive(db, text);
    const f = invoiceFacts(db, new Date(), PLANNED);
    expect(f.lines.join("\n")).toMatch(/its IBAN or BIC is not the one on file for Stockline Data GmbH/);
  });
});

describe("H6: an invoice with bank details not on file is still flagged", () => {
  for (const [what, o] of [
    ["an unknown IBAN", { iban: "DE89 3704 0044 0532 0130 99" }],
    ["an unknown BIC", { bic: "DEUTDEFFXXX" }],
  ] as const) {
    it(`a fresh world: another Stockline invoice with ${what} is not presented as the allowlisted payee's, and is not offered for planning`, () => {
      const db = openDb(":memory:");
      arrive(db, variant({ no: "SLL-2026-12", ...o }));
      const f = invoiceFacts(db, new Date(), PLANNED);
      const all = f.lines.join("\n");
      expect(f.open).toEqual([expect.objectContaining({ invoice_no: "SLL-2026-12", conflict: expect.stringMatching(/its IBAN or BIC is not the one on file for Stockline Data GmbH/) })]);
      expect(all).toMatch(/Not offered for planning: its IBAN or BIC is not the one on file for Stockline Data GmbH; a person checks it\./);
      expect(all).not.toMatch(/may plan it now/);
      // The invoice's own bank details are never repeated.
      expect(all).not.toMatch(/0130 99|013099|DEUTDEFF/);
    });
  }

  it("a seeded world: the same", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    arrive(db, variant({ no: "SLL-2026-12", iban: "DE89 3704 0044 0532 0130 99" }));
    expect(invoiceFacts(db, new Date(), PLANNED).lines.join("\n")).toMatch(/Not offered for planning: its IBAN or BIC is not the one on file for Stockline Data GmbH/);
  });

  it("an unknown vendor is still 'an unlisted vendor', also in a fresh world", () => {
    const db = openDb(":memory:");
    arrive(db, `Stockline Data Services Ltd\n${variant({ no: "SLL-2026-12" }).split("\n").slice(1).join("\n")}`);
    expect(invoiceFacts(db, new Date(), PLANNED).open).toEqual([expect.objectContaining({ vendor: "an unlisted vendor" })]);
  });
});

describe("H6: plan_invoice's IBAN/BIC gate is unchanged (it reads the ledger's beneficiaries, which only code's flow seeds)", () => {
  it("before seeding, checkInvoice allows no payee at all: the facts never add one", async () => {
    const db = openDb(":memory:");
    arrive(db, text);
    await treasury(db, new FakeAirwallex()).observe(db);
    const c = checkInvoice(db, parseInvoiceFallback(text), text);
    expect(c.ok).toBe(false);
    expect(beneficiaries(db)).toBe(0);
  });

  it("after seeding: the licence to the account on file passes; the same invoice with another IBAN or BIC is refused as possible fraud", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    expect(checkInvoice(db, parseInvoiceFallback(text), text)).toMatchObject({ ok: true, name: LICENSOR.name, ibanLast4: "2051", bic: LICENSOR.bic });
    for (const t of [variant({ iban: "DE89 3704 0044 0532 0130 99" }), variant({ bic: "DEUTDEFFXXX" })]) {
      const c = checkInvoice(db, parseInvoiceFallback(t), t);
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.reason).toMatch(/possible invoice fraud/);
    }
    // Planning the one with a new IBAN escalates; nothing is proposed and no beneficiary is added.
    const bad = variant({ no: "SLL-2026-12", iban: "DE89 3704 0044 0532 0130 99" });
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(bad), bad);
    expect(out.kind).toBe("escalated");
    expect(beneficiaries(db)).toBe(2);
  });
});

describe("H6: once the ledger holds a payee, the ledger alone speaks for it", () => {
  it("a ledger whose account for a code payee differs from code's: only the ledger's is on the allowlist the facts read", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben-x', ?, '0000', ?, 'COBADEFFXXX', 'EUR', 'SWIFT')")
      .run(MANUFACTURER.name, ibanSha("DE44500105175407324931"));
    const bergtex = payeeAllowlist(db).filter((p) => p.name === MANUFACTURER.name);
    expect(bergtex).toEqual([{ name: MANUFACTURER.name, ibanSha256: ibanSha("DE44500105175407324931"), bic: "COBADEFFXXX" }]);
    // The licensor, not in the ledger yet, comes from code.
    expect(payeeAllowlist(db).filter((p) => p.name === LICENSOR.name)).toEqual([{ name: LICENSOR.name, ibanSha256: ibanSha(LICENSOR.iban), bic: LICENSOR.bic }]);
  });
});
