// The payment reference travels with a SWIFT payout in at most four lines of 35 characters (140). The Airwallex
// sandbox's transfer validation accepted 140 on 9 November; a longer one would be cut by a bank somewhere along the
// way, so the CFO would sign a reference the supplier never sees whole. Purser refuses it and says why.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import { MAX_REFERENCE, payApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-09T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
let dir: string;
let db: DB;
let awx: FakeAirwallex;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ref-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function readyWithReference(ref: string): Promise<string> {
  const out = await ingestDocument(db, { dir, reader: parserOnly, now: () => now }, { bytes: await pdfOf(EN), filename: "b.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const id = out.invoice.id;
  expect(apInvoice(db, id)!.status).toBe("ready");
  const reading = { ...apInvoice(db, id)!.reading, reference: ref };
  db.prepare("UPDATE ap_invoices SET reading_json = ? WHERE id = ?").run(JSON.stringify(reading), id);
  return id;
}

describe("the payment reference", () => {
  it("is at most 140 characters, what SWIFT carries", () => {
    expect(MAX_REFERENCE).toBe(140);
  });

  it("of 140 characters is filed for the CFO", async () => {
    const id = await readyWithReference("R".repeat(140));
    expect((await payApInvoice(db, awx, id, now)).kind).toBe("proposed");
  });

  it("longer than 140 is refused with the reason, and nothing is filed", async () => {
    const id = await readyWithReference("R".repeat(141));
    await expect(payApInvoice(db, awx, id, now)).rejects.toThrow(/141 characters.*140/);
    expect(apInvoice(db, id)!.status).toBe("ready");
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });
});
