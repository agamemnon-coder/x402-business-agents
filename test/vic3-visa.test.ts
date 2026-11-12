// /visa leads with the latest live run (vic-3, 12 Nov): every number, code and id in its block is read from
// docs/runs/2026-11-12-vic-3.json or counted from it; F1/F2 are said as a finding, word for word from one of two
// templates; the first run (7 Nov) follows below; /runs lists it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visaPage } from "../src/redesign/partners.js";
import { liveRuns } from "../src/redesign/runs.js";
import { VIC3_RUN_FILE, VIC3_RUN_ID, vic3Finding, vic3Run, vic3RunHtml, vic3Summary, type Vic3Record } from "../src/redesign/vic3Run.js";

const raw = JSON.parse(readFileSync(new URL(`../${VIC3_RUN_FILE}`, import.meta.url), "utf8")) as Vic3Record;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const html = visaPage();
const block = /<div class="card airi" id="vic3-run">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";

describe("/visa's lead: the vic-3 live run", () => {
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
    expect(/<h2>([^<]*)<\/h2>/.exec(block)![1]).toMatch(new RegExp(`^Latest live run, 12 Nov: purchase ${paid[0]!.step} paid, `));
    expect(text(block)).toContain(`${paid.length} of ${abcde.length} purchases paid`);
    expect(vic3Summary(raw)).toMatchObject({ paid: paid.length, of: abcde.length });
    for (const p of paid) expect(text(block)).toContain(`${p.step}: ${p.request!.currency} ${p.request!.amount}`);
    const a = raw.purchases.find((p) => p.step === "A")!;
    if (a.outcome?.code === "PURSER_NO_TAP") expect(text(block)).toContain("A: the cardholder did not tap in time; nothing was charged.");
  });

  it("says equal for each read-back only where the record says equal", () => {
    const b = raw.purchases.find((p) => p.step === "B")!;
    const w = (x: { equal: boolean } | null) => (x?.equal ? "equal" : "NOT equal");
    expect(text(block)).toContain(`the signed hash read back ${w(b.read_back.mandate)} at Airi and ${w(b.read_back.payment_intent)} at Airwallex`);
    const flipped = JSON.parse(JSON.stringify(raw)) as Vic3Record;
    flipped.purchases.find((p) => p.step === "B")!.read_back.payment_intent!.equal = false;
    expect(text(vic3RunHtml(flipped))).toContain("NOT equal at Airwallex");
  });

  it("lists the refusals by Purser only when the record shows 0 calls, and names who chose the rail with the request id", () => {
    const zero = raw.purchases.filter((p) => p.outcome?.status === "refused" && p.calls.airi + p.calls.airwallex + p.calls.anthropic === 0).map((p) => p.step);
    expect(zero).toEqual(["C", "D", "E"]);
    expect(text(block)).toContain(`${zero.join(", ")} refused by Purser with 0 calls`);
    const first = raw.purchases.find((p) => p.rail_choice?.request_id)!.rail_choice!;
    expect(text(block)).toContain(`Rail chosen by ${first.model} from ${first.menu.length}`);
    expect(block).toContain(first.request_id!.slice(0, 16));
    // Every id of every purchase is in the fold.
    for (const p of raw.purchases) for (const id of [p.mandate_id, p.payment_intent_id, p.rail_choice?.request_id]) if (id) expect(block).toContain(id);
  });

  it("states F1/F2 as a finding, from the sandbox's own answers, and never says Visa refused or approved", () => {
    const fs = raw.purchases.filter((p) => p.negative_test);
    const allAccepted = fs.every((p) => p.negative_test!.airwallex?.outcome === "SUCCEEDED");
    expect(vic3Finding(raw)).toMatch(allAccepted ? /did not refuse it; here only Purser enforces the amount\.$/ : /refused it: /);
    expect(text(block)).toContain(vic3Finding(raw));
    const declined = JSON.parse(JSON.stringify(raw)) as Vic3Record;
    declined.purchases.find((p) => p.step === "F1")!.negative_test!.airwallex = { outcome: "DECLINED", code: "card_declined" };
    expect(vic3Finding(declined)).toMatch(/the Airi\/Airwallex sandbox refused it: card_declined\.$/);
    expect(text(block)).not.toMatch(/Visa (refused|declined|approved)/i);
  });
});

describe("/runs lists the vic-3 run", () => {
  it("as its own row, from the record", () => {
    const row = liveRuns().find((r) => r.key === "vic-3")!;
    expect(row).toBeTruthy();
    expect(row.iso).toBe(raw.started_at);
    expect(row.files.map((f) => f.href).join(" ")).toContain("2026-11-12-vic-3.json");
  });
});
