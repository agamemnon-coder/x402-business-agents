// Red team (runner, 27 Nov, finding 7, read in code): the cash check before an agent pays alone (src/ap/pay.ts
// cashHoldsFiled) read only an invoice payment's terms and let every other kind through, so a supplier payment within the
// limit skipped it, one that needs a conversion included. Now it holds a payment of a kind it does not know, one whose
// terms convert another currency (the CFO signs a conversion, never the agent alone), and a supplier payment that would
// take its currency below its floor, as it does an invoice payment. Test money only, no network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import { checkThenProposePayeeAdd, executePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb } from "../src/db/open.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { getSetting, setSetting } from "../src/world/settings.js";
import { pdfOf } from "./fakes/pdf.js";
import { standInBank } from "./support/standInBank.js";
import { parserOnly } from "./support/supplierWorld.js";

// The fake bank quotes on its own clock, so the plan runs on it too.
const NOW = new Date();
const inv = (no: string) => `Zeeland Verpakkingen B.V.
BTW-nummer: NL123456789B01
Factuur
Factuurnummer: ${no}
Factuurdatum: 20-11-2026
Vervaldatum: 15-12-2026
Subtotaal € 400,00
BTW 21% € 84,00
Totaal te betalen € 484,00
IBAN: NL91 ABNA 0417 1643 00
BIC: ABNANL2A
Betalingskenmerk: ${no}`;

/** Zeeland on file, a EUR 500.00 limit to pay alone, and its first invoice ready: what the agent would pay alone. */
async function world() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  const deps: InboxDeps = { dir: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cash-")), reader: parserOnly, now: () => NOW };
  const d = await ingestDocument(db, deps, { bytes: await pdfOf(inv("ZV-7000")), filename: "zv-7000.pdf", source: "upload" });
  if (d.kind !== "invoice") throw new Error(d.kind);
  const req = requestPayeeAddForInvoice(db, d.invoice.id, "treasury", NOW);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: "called the supplier on the number in our contract", actor: "human", address: { street: "1 Supplier Street", city: "Middelburg", postcode: "4331" } }, NOW);
  const add = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", NOW);
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(add.proposal_id) as { terms_sha256: string };
  decide(db, { proposalId: add.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW);
  await executePayeeAdd(db, awx, add.proposal_id, { now: () => NOW, reader: parserOnly }, NOW);
  setSystemDefaultAloneLimit(db, "500.00", NOW);
  return { db, awx, id: d.invoice.id };
}

describe("the cash check before an agent pays a supplier payment alone (runner finding 7)", () => {
  it("a supplier payment that needs a conversion is left to the CFO", async () => {
    const w = await world();
    // EUR short: what is free after the floor is EUR 100.00, so the plan buys the rest with USD.
    const eur = w.awx.bal.EUR.availableCents;
    setSetting(w.db, "human", "eur_obligations", ((eur - Number(getSetting(w.db, "eur_floor", "0").replace(".", "")) - 10_000) / 100).toFixed(2));
    w.awx.bal.USD.availableCents += 1_000_000;
    setSetting(w.db, "human", "usd_floor", "0.00");
    setSetting(w.db, "human", "payout.funding_currency", "USD");
    const out = await payApInvoice(w.db, w.awx, w.id, NOW);
    if (out.kind !== "proposed") throw new Error(`not planned: ${out.reason}`);
    const terms = JSON.parse((w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { terms_json: string }).terms_json) as { kind: string; conversion: unknown };
    expect(terms.kind).toBe("supplier_payment");
    expect(terms.conversion).toBeTruthy();
    expect(out.alone).toBeFalsy();
    expect(out.declined, JSON.stringify(out.declined)).toMatchObject({ by: "cash" });
  });

  it("a plain supplier payment within its own currency's room is still paid alone", async () => {
    const w = await world();
    const out = await payApInvoice(w.db, w.awx, w.id, NOW);
    if (out.kind !== "proposed") throw new Error(`not planned: ${out.reason}`);
    expect(out.alone).toBeTruthy();
  });
});
