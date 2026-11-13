// /visa leads with the latest live run (vic-4 since 13 Nov; vic-3 on 12 Nov): every number, code and id in its block is
// read from that record or counted from it; F1/F2 are said as a finding, word for word from one of three templates; the
// first run (7 Nov) follows below; /runs lists both.
import { countOf } from "../src/redesign/ui.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visaPage } from "../src/redesign/partners.js";
import { liveRuns } from "../src/redesign/runs.js";
import { VIC3_PREV_FILE, VIC3_RUN_FILE, VIC3_RUN_ID, vic3Finding, vic3Run, vic3RunHtml, vic3Summary, type Vic3Record } from "../src/redesign/vic3Run.js";

const raw = JSON.parse(readFileSync(new URL(`../${VIC3_RUN_FILE}`, import.meta.url), "utf8")) as Vic3Record;
const prev = JSON.parse(readFileSync(new URL(`../${VIC3_PREV_FILE}`, import.meta.url), "utf8")) as Vic3Record;
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const html = visaPage();
const block = /<div class="card airi" id="vic3-run">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";

describe("/visa's lead: the latest live run", () => {
  it("is the live record, and its block comes before the first run's drawing", () => {
    expect(vic3Run()!.mode).toBe("live");
    expect(block.length).toBeGreaterThan(0);
    expect(html.indexOf(`id="${VIC3_RUN_ID}"`)).toBeLessThan(html.indexOf('id="vic-flow"'));
    expect(text(html)).toContain(`The first live run, 7 Nov, follows below.`);
  });

  // The jury check of 12 Nov: the card leads with the paid purchase and its two read-backs; A in one line.
  it("leads with the paid purchase and says N of M paid, counted from the record (A to E; F1 and F2 are the negative test)", () => {
    const abcde = raw.purchases.filter((p) => !/^F/.test(p.step));
    const paid = abcde.filter((p) => p.outcome?.status === "succeeded");
    // The owner's stat tiles (12 Nov): the heading is the run's date; the figures are counted from the record.
    expect(/<h2>([^<]*)<\/h2>/.exec(block)![1]).toBe(`Latest live run, ${dayOf(raw.started_at)}`);
    expect(text(block)).toMatch(new RegExp(`${paid.length} of ${abcde.length} purchases paid`));
    expect(vic3Summary(raw)).toMatchObject({ paid: paid.length, of: abcde.length });
    for (const p of paid) expect(text(block)).toContain(`${p.step}: ${p.request!.currency} ${p.request!.amount}`);
    for (const p of raw.purchases.filter((x) => x.outcome?.code === "PURSER_NO_TAP")) expect(text(block)).toContain(`${p.step}: not confirmed in Airi: the cardholder's confirmation did not come within the 5 minutes; nothing charged.`);
  });

  it("says equal for each read-back only where the record says equal", () => {
    const b = raw.purchases.find((p) => p.step === "B")!;
    const w = (x: { equal: boolean } | null) => (x?.equal ? "equal" : "NOT equal");
    // The tile counts the read-backs that matched (of 2), from the record; the fold names each.
    const matched = [b.read_back.mandate, b.read_back.payment_intent].filter((x) => x?.equal).length;
    // Redesign, 13 Nov: on /visa the hash is the hero's read-back (src/redesign/visaHero.ts); the block keeps its tiles
    // when shown on its own.
    expect(text(html)).toContain(`${countOf(matched, 2)} read-backs equal to the signed hash`);
    expect(text(vic3RunHtml(raw))).toContain(`${matched} of 2 hash matched at Airi and Airwallex`);
    expect(text(block)).toContain(`mandate read-back ${w(b.read_back.mandate)}`);
    expect(text(block)).toContain(`PaymentIntent read-back ${w(b.read_back.payment_intent)}`);
    const flipped = JSON.parse(JSON.stringify(raw)) as Vic3Record;
    flipped.purchases.find((p) => p.step === "B")!.read_back.payment_intent!.equal = false;
    expect(text(vic3RunHtml(flipped))).toContain("PaymentIntent read-back NOT equal");
  });

  it("lists the refusals by Purser only when the record shows 0 calls, and names who chose the rail with the request id", () => {
    const zero = raw.purchases.filter((p) => !p.negative_test && p.outcome?.status === "refused" && p.calls.airi + p.calls.airwallex + p.calls.anthropic === 0).map((p) => p.step);
    expect(zero.slice(0, 3)).toEqual(["C", "D", "E"]);
    expect(text(block)).toContain(`${zero.join(", ")} refused by Purser with 0 calls`);
    const first = raw.purchases.find((p) => p.rail_choice?.request_id)!.rail_choice!;
    expect(text(block)).toContain(`Rail chosen by ${first.model} from ${first.menu.length}`);
    expect(block).toContain(first.request_id!.slice(0, 16));
    // Every id of every purchase is in the fold.
    for (const p of raw.purchases) for (const id of [p.mandate_id, p.payment_intent_id, p.rail_choice?.request_id]) if (id) expect(block).toContain(id);
  });

  it("states F1/F2 as a finding, from the sandbox's own answers (vic-3) or Purser's credential check (vic-4), and never says Visa refused or approved", () => {
    const fs = prev.purchases.filter((p) => p.negative_test);
    const allAccepted = fs.every((p) => p.negative_test!.airwallex?.outcome === "SUCCEEDED");
    expect(vic3Finding(prev)).toMatch(allAccepted ? /The sandbox accepted both, so in this test only Purser's check stops it\.$/ : /refused it: /);
    // vic-4: F1 and F2 refused by Purser's credential check, 0 calls (no negative_test: the sandbox was not asked).
    const f = raw.purchases.filter((p) => /^F/.test(p.step));
    expect(f.map((p) => p.outcome?.code)).toEqual(["PURSER_CREDENTIAL_AMOUNT_MISMATCH", "PURSER_CREDENTIAL_ALREADY_USED"]);
    expect(f.every((p) => p.calls.airi + p.calls.airwallex + p.calls.anthropic === 0)).toBe(true);
    expect(vic3Finding(raw)).toBe("We also tried reusing a credential, for a different amount and a second time (F1, F2). Purser's credential check refused both, with 0 calls to Airi or Airwallex.");
    expect(text(block)).toContain(vic3Finding(raw));
    const declined = JSON.parse(JSON.stringify(prev)) as Vic3Record;
    declined.purchases.find((p) => p.step === "F1")!.negative_test!.airwallex = { outcome: "DECLINED", code: "card_declined" };
    expect(vic3Finding(declined)).toMatch(/The sandbox refused it: card_declined\.$/);
    expect(text(block)).not.toMatch(/Visa (refused|declined|approved)/i);
  });
});

describe("/runs lists the vic-3 and vic-4 runs", () => {
  it("each as its own row, from its record", () => {
    for (const [key, rec, file] of [["vic-3", prev, "2026-11-12-vic-3.json"], ["vic-4", raw, "2026-11-13-vic-4.json"]] as const) {
      const row = liveRuns().find((r) => r.key === key)!;
      expect(row).toBeTruthy();
      expect(row.iso).toBe(rec.started_at);
      expect(row.files.map((f) => f.href).join(" ")).toContain(file);
    }
  });
});
