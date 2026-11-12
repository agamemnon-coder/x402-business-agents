// The ICC block on /visa (src/redesign/iccBlock.ts). With no valid ICC run record it is the one allowed status
// sentence and nothing else; with one, every number and id it shows is the record's and it says no more than the
// record. Fixtures go to a temporary folder made here, never under docs/runs. No network.
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICC_RECORD_SCHEMA, type IccRunRecord } from "../src/icc/record.js";
import { ICC_RUN_EXTRA_WORDS, ICC_STATUS, iccBlock, iccRecordIn } from "../src/redesign/iccBlock.js";
import { visaPage } from "../src/redesign/partners.js";
import { esc } from "../src/redesign/ui.js";

const STATUS = "Intelligent Commerce Connect: access requested, not granted yet; not used in this entry.";
const HASH = "c7".repeat(32);
/** A made-up instruction ID, built from parts. Not a real one. */
const INSTRUCTION = ["7", "QXR4K2"].join("-");

const record = (o: Partial<IccRunRecord> = {}): IccRunRecord => ({
  schema: ICC_RECORD_SCHEMA, run_date: "2026-10-01", environment: "sandbox",
  purchases: [
    { label: "A", amount: "12.00", currency: "EUR", merchant: "Northwind Outdoor test shop", terms_sha256: HASH, instruction_id: INSTRUCTION, approved_with: "passkey", outcome: "credential received, not used; no payment was made", refusal_code: null },
    { label: "B", amount: "250.00", currency: "EUR", merchant: "Northwind Outdoor test shop", terms_sha256: null, instruction_id: null, approved_with: null, outcome: "refused by Purser before any call", refusal_code: "PURSER_ABOVE_HARD_CAP" },
  ],
  checks: [
    { stage: "preflight", name: "keys_read", ok: true, detail: "the signing key and the MLE key were read" },
    { stage: "run", name: "b_refused_before_any_call", ok: true, detail: "B: refused PURSER_ABOVE_HARD_CAP, 0 call(s)" },
  ],
  calls: { total: 5, budget: 9, by_endpoint: [{ endpoint: "POST /acp/v1/instructions", calls: 2 }, { endpoint: "POST /acp/v1/instructions/{id}/credentials", calls: 3 }] },
  not_done: ["No payment was made: the flow stops before checkout, and a credential that came was dropped unused.", "No instruction was cancelled."],
  ...o,
});

const dirWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "icc-block-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};
const json = (r: unknown) => `${JSON.stringify(r, null, 2)}\n`;
/** What a person reads: no tags, entities decoded. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

describe("the ICC block, with no record", () => {
  it("is exactly the status sentence, in a quiet line: no heading, no link, no number", () => {
    expect(ICC_STATUS).toBe(STATUS);
    for (const dir of [dirWith({}), join(tmpdir(), "icc-block-no-such-folder")]) {
      const html = iccBlock(dir);
      expect(text(html)).toBe(STATUS);
      expect(html).toBe(`<p class="septest">${esc(STATUS)}</p>`);
      expect(html).not.toMatch(/<h\d|<a\b|\d/);
    }
  });

  it("treats a record that fails the reader's checks as absent", () => {
    const bad = record();
    (bad as unknown as Record<string, unknown>).signedPayload = "x";
    const broken = record({ calls: { total: 99, budget: 9, by_endpoint: [] } });
    const dir = dirWith({ "2026-10-01-icc.json": json(bad), "2026-10-02-icc.json": json(broken), "2026-10-03-icc.json": "{ not json" });
    expect(iccRecordIn(dir)).toBeNull();
    expect(text(iccBlock(dir))).toBe(STATUS);
  });

  it("reads only *-icc.json files", () => {
    const dir = dirWith({ "2026-10-01-icc.md": "# a run", "2026-10-01-vic-1.json": json(record()), "icc.json.bak": json(record()) });
    expect(text(iccBlock(dir))).toBe(STATUS);
  });
});

describe("the ICC block, with a record", () => {
  const rec = record();
  const dir = dirWith({ "2026-10-01-icc.json": json(rec), "2026-10-01-icc.md": "# the run" });
  const html = iccBlock(dir);
  const words = text(html);
  const raw = JSON.stringify(rec);

  it("is not the status sentence", () => {
    expect(words).not.toContain(STATUS);
  });

  it("shows every number from the record and none that is not in it", () => {
    for (const n of words.match(/\d+/g) ?? []) expect({ n, inRecord: raw.includes(n) }).toEqual({ n, inRecord: true });
    for (const want of ["12.00", "250.00", "EUR", "Northwind Outdoor test shop", INSTRUCTION, HASH, "PURSER_ABOVE_HARD_CAP", "passkey", "POST /acp/v1/instructions", "POST /acp/v1/instructions/{id}/credentials"]) expect(words).toContain(want);
    expect(words).toMatch(/\b5\b[^.]*\b9\b/); // the calls and the budget
  });

  it("leads with the result: the date, each purchase's outcome in the record's own words; details folded, ids and hashes last", () => {
    expect(words).toContain("1 Oct");
    for (const p of rec.purchases) expect(words).toContain(p.outcome);
    const details = html.indexOf("<details");
    expect(details).toBeGreaterThan(html.indexOf(rec.purchases[0]!.outcome));
    expect(html.indexOf(HASH)).toBeGreaterThan(details);
    expect(html.indexOf(INSTRUCTION)).toBeGreaterThan(details);
    expect(html.indexOf(HASH)).toBeGreaterThan(html.indexOf("POST /acp/v1/instructions"));
    expect(html.indexOf("keys_read")).toBeGreaterThan(details);
  });

  it("keeps the record's not-done statements first in the fold, and says in sight that nothing was paid", () => {
    // In sight: the result. The outcome lines carry "no payment was made" in the record's own words; what was not
    // done, sentence by sentence, opens first under Details (progressive disclosure; /visa's word budget).
    const sight = html.slice(0, html.indexOf("<details"));
    expect(text(sight)).toContain("no payment was made");
    const fold = html.slice(html.indexOf("<details"));
    for (const s of rec.not_done) expect(text(fold)).toContain(s);
    expect(fold.indexOf(rec.not_done[0]!)).toBeLessThan(fold.indexOf("keys_read"));
  });

  it("adds at most ICC_RUN_EXTRA_WORDS words in sight to /visa over the status sentence, also with the longest outcomes", () => {
    const visible = (h: string) => text(h.replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ")).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const absent = visible(iccBlock(dirWith({})));
    const longest = record({ purchases: [
      { ...record().purchases[0]!, merchant: "M".repeat(39) + " x", outcome: "the credential call has no answer; nothing was sent again" },
      { ...record().purchases[1]!, outcome: "refused by the service", refusal_code: "PURSER_ICC_CREDENTIAL_SHAPE" },
    ] });
    for (const r of [rec, longest]) expect(visible(iccBlock(dirWith({ "2026-10-01-icc.json": json(r) }))) - absent).toBeLessThanOrEqual(ICC_RUN_EXTRA_WORDS);
  });

  it("says no more than the record: nothing paid, approved by, certified or endorsed", () => {
    expect(words).not.toMatch(/\bpaid\b|approved by|certif|endors/i);
    const paid = iccBlock(dirWith({ "2026-10-01-icc.json": json(record({ not_done: [] })) }));
    expect(text(paid)).not.toMatch(/\bpaid\b|(?<!no )payment was made/i);
  });

  it("marks the refused attempt as refused, and a failing check as failing", () => {
    expect(html).toMatch(/<span class="awm bad">B<\/span>/);
    expect(html).not.toMatch(/<span class="awm (ok|bad)">A<\/span>/);
    const failing = iccBlock(dirWith({ "2026-10-01-icc.json": json(record({ checks: [{ stage: "run", name: "a_stopped_before_checkout", ok: false, detail: "A: not stopped" }] })) }));
    expect(failing).toMatch(/<li class="no">✕ run · a_stopped_before_checkout/);
  });

  it("escapes every text from the record", () => {
    const odd = record({ purchases: [{ ...record().purchases[0]!, merchant: `<b>"Shop" & co</b>` }] });
    const out = iccBlock(dirWith({ "2026-10-01-icc.json": json(odd) }));
    expect(out).not.toContain("<b>\"Shop\"");
    expect(out).toContain("&lt;b&gt;&quot;Shop&quot; &amp; co&lt;/b&gt;");
  });

  it("takes the newest record by its own date when there are several, whatever the file names", () => {
    const older = record({ run_date: "2026-10-05" }), newer = record({ run_date: "2026-10-09" });
    const two = dirWith({ "z-icc.json": json(older), "a-icc.json": json(newer) });
    expect(iccRecordIn(two)?.run_date).toBe("2026-10-09");
    expect(text(iccBlock(two))).toContain("9 Oct");
  });

  it("links the run record's Markdown only when it is there", () => {
    expect(html).toContain("docs/runs/2026-10-01-icc.md");
    expect(iccBlock(dirWith({ "2026-10-01-icc.json": json(rec) }))).not.toContain("-icc.md");
  });
});

describe("/visa in the repository's real state", () => {
  it("docs/runs holds no ICC record, and /visa carries the status sentence exactly once, low on the page", () => {
    expect(readdirSync(new URL("../docs/runs/", import.meta.url)).filter((f) => /-icc\./.test(f))).toEqual([]);
    const html = visaPage();
    expect(html.split(esc(STATUS)).length - 1).toBe(1);
    const at = html.indexOf(esc(STATUS));
    // After the Visa runs (the TAP run's picture is the last of them), before the folds.
    expect(at).toBeGreaterThan(html.indexOf('class="flow card"'));
    expect(at).toBeLessThan(html.indexOf('<div class="folds card">'));
  });
});
