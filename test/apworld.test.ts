// The fresh AP world per run (master-list line 369): the same seed gives the same world, twenty runs meet every trick,
// and each document's expected outcome is what the deterministic checks make of it when the parser reads it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AP_EVENTS, generateApWorld, invoiceText, makeIban, totalOf, type ApWorld } from "../src/apworld/generate.js";
import { FONT_CHARS, glyph } from "../src/apworld/font5x7.js";
import { renderDoc } from "../src/apworld/render.js";
import { setupApWorld } from "../src/apworld/setup.js";
import { ingestDocument, type IngestResult } from "../src/ap/inbox.js";
import { pdfText } from "../src/ap/pdfText.js";
import type { Asker } from "../src/ap/read.js";
import { ibanValid } from "../src/ap/reading.js";
import { openDb } from "../src/db/open.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

describe("the AP world generator", () => {
  it("gives the same world for the same seed and day, and another for another seed", () => {
    expect(generateApWorld(7)).toEqual(generateApWorld(7));
    expect(JSON.stringify(generateApWorld(7))).not.toBe(JSON.stringify(generateApWorld(8)));
    expect(generateApWorld(7, "2026-11-14").docs[0]!.invoice.issue).not.toBe(generateApWorld(7, "2026-11-13").docs[0]!.invoice.issue);
  });

  it("meets every trick, all three languages and both forms within twenty runs", () => {
    const worlds = Array.from({ length: 20 }, (_, i) => generateApWorld(1000 + i));
    const docs = worlds.flatMap((w) => w.docs);
    for (const e of AP_EVENTS) expect(docs.some((d) => d.event === e), e).toBe(true);
    for (const l of ["nl", "en", "de"]) expect(docs.some((d) => d.lang === l), l).toBe(true);
    expect(docs.some((d) => d.form === "scan")).toBe(true);
    expect(docs.some((d) => d.carrier === "eml")).toBe(true);
  });

  it("writes IBANs that pass their checksum, a forged one different from the supplier's, and never a copy before its original", () => {
    expect(makeIban("DE", "370400440532013000")).toBe("DE89370400440532013000");
    for (let seed = 1; seed <= 30; seed++) {
      const w = generateApWorld(seed);
      for (const d of w.docs) {
        expect(ibanValid(d.invoice.iban)).toBe(true);
        if (d.event === "forged_iban" || d.event === "bec") expect(d.invoice.iban).not.toBe(d.invoice.supplier.iban);
        if (d.of) expect(w.docs.findIndex((x) => x.id === d.of)).toBeLessThan(w.docs.indexOf(d));
        if (d.event === "changed_amount") expect(totalOf(d.invoice)).not.toBe(totalOf(w.docs.find((x) => x.id === d.of)!.invoice));
      }
      // Every clean invoice of a supplier has its own total (the same total within 45 days waits for a person as a twin).
      const clean = w.docs.filter((d) => d.event === "clean");
      const keys = clean.map((d) => `${d.invoice.supplier.name}|${totalOf(d.invoice)}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("draws a scan with no text layer, in a font of seven rows of five", async () => {
    for (const c of FONT_CHARS) {
      const g = glyph(c)!;
      expect(g, c).toHaveLength(7);
      for (const row of g) expect(row, c).toHaveLength(5);
    }
    const w = Array.from({ length: 20 }, (_, i) => generateApWorld(i + 1)).find((x) => x.docs.some((d) => d.form === "scan"))!;
    const scan = w.docs.find((d) => d.form === "scan")!;
    expect((await pdfText((await renderDoc(scan, w.day)).bytes)).text).toBe("");
    const text = w.docs.find((d) => d.form === "text" && d.carrier === "pdf")!;
    expect((await pdfText((await renderDoc(text, w.day)).bytes)).text).toContain(text.invoice.no);
  });

  it("agrees with the deterministic checks: read by the parser, each document gets the status its expectation names", async () => {
    const seen = new Set<string>();
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const w: ApWorld = generateApWorld(seed);
      const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "apworld-"));
      try {
        const db = openDb(":memory:");
        const rail = new FakeAirwallex();
        await setupApWorld(db, rail, w);
        const now = new Date(`${w.day}T09:00:00Z`);
        for (const d of w.docs) {
          const file = await renderDoc(d, w.day);
          let out: IngestResult = await ingestDocument(db, { dir, reader: parserOnly, now: () => now }, { bytes: file.bytes, filename: file.filename, mime: file.mime, source: d.carrier === "eml" ? "email" : "upload" });
          if (out.kind === "email") out = out.results[0]!;
          if (out.kind !== "invoice") throw new Error(`${d.id}: ${out.kind}`);
          const status = out.invoice.status;
          const want = d.form === "scan" ? "needs_review" : d.expect.outcome === "pay" ? "ready" : d.expect.outcome === "refuse" ? "blocked" : "needs_vendor";
          expect(status, `seed ${seed} ${d.id} ${d.event} ${d.lang} ${d.form}: ${JSON.stringify(out.invoice.findings.map((f) => f.code))}\n${invoiceText(d.invoice)}`).toBe(want);
          seen.add(`${d.event}:${d.lang}`);
        }
        db.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    expect([...seen].filter((x) => x.startsWith("clean:")).length).toBe(3);
    for (const e of AP_EVENTS) expect([...seen].some((x) => x.startsWith(`${e}:`)), e).toBe(true);
  }, 60_000);
});
