// /visa's hero (13 Nov redesign): the flow, every purchase's outcome and the signed hash read back, each read from the
// latest live run's record (docs/runs/2026-11-13-vic-4.json). No figure on it that the record does not hold, and no
// count of checks anywhere on the page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visaPage } from "../src/redesign/partners.js";
import { VIC3_RUN_FILE, type Vic3Record } from "../src/redesign/vic3Run.js";
import { VISA_FLOW_ID, VISA_HASH_ID, VISA_OUTCOMES_ID, outcomeOf, visaHashHtml } from "../src/redesign/visaHero.js";
import { VISA_ICC_LINE } from "../src/config/brand.js";

const rec = JSON.parse(readFileSync(new URL(`../${VIC3_RUN_FILE}`, import.meta.url), "utf8")) as Vic3Record & { purchases: (Vic3Record["purchases"][number] & { terms_sha256?: string })[] };
const html = visaPage();
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const section = (id: string) => new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";

describe("/visa's hero, from the vic-4 record", () => {
  it("comes first under the run's line, before anything folded", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at('class="vlead"')).toBeLessThan(at(`id="${VISA_FLOW_ID}"`));
    expect(at(`id="${VISA_FLOW_ID}"`)).toBeLessThan(at(`id="${VISA_OUTCOMES_ID}"`));
    expect(at(`id="${VISA_OUTCOMES_ID}"`)).toBeLessThan(at(`id="${VISA_HASH_ID}"`));
    expect(at(`id="${VISA_HASH_ID}"`)).toBeLessThan(at('id="visa-details"'));
  });

  it("puts each purchase where it ended: paid alone, paid after Face ID, not tapped at the tap, refused before any call", () => {
    const flow = section(VISA_FLOW_ID);
    for (const p of rec.purchases) {
      const chip = `<b>${p.step}</b><span class="vh-am">${p.request!.currency} ${p.request!.amount}</span>`;
      expect(flow).toContain(chip);
      expect(flow).toContain(`vh-c vh-${outcomeOf(p)}`);
    }
    const lanes = flow.split('<div class="vh-lane ');
    const inLane = (cls: string) => lanes.find((l) => l.startsWith(cls)) ?? "";
    const steps = (o: string) => rec.purchases.filter((p) => outcomeOf(p) === o).map((p) => p.step);
    for (const s of steps("paid")) expect(inLane("vh-l-ok")).toContain(`<b>${s}</b>`);
    for (const s of steps("notap")) expect(inLane("vh-l-ok")).toContain(`<b>${s}</b>`);
    for (const s of steps("paid-faceid")) expect(inLane("vh-l-face")).toContain(`<b>${s}</b>`);
    for (const s of steps("refused")) expect(inLane("vh-l-bad")).toContain(`<b>${s}</b>`);
    // The refused ones made 0 calls of any kind, as the lane says.
    for (const p of rec.purchases.filter((x) => outcomeOf(x) === "refused")) expect(p.calls.airi + p.calls.airwallex + p.calls.anthropic).toBe(0);
    expect(text(inLane("vh-l-bad"))).toContain("Stopped before any call; nothing charged");
  });

  it("counts each outcome in the strip's legend from the record, every purchase once, in the record's order", () => {
    const out = section(VISA_OUTCOMES_ID);
    const n = (o: string) => rec.purchases.filter((p) => outcomeOf(p) === o).length;
    for (const [o, words] of [["paid", "Paid within the limit"], ["paid-faceid", "Paid after Face ID"], ["refused", "Refused by Purser"], ["notap", "Not tapped"]] as const) if (n(o)) expect(text(out)).toContain(`${words}: ${n(o)}`);
    const order = [...out.matchAll(/<li><span class="vh-c [^"]+"[^>]*>[\s\S]*?<b>([A-Z]\d?)<\/b>/g)].map((m) => m[1]);
    expect(order).toEqual(rec.purchases.map((p) => p.step));
  });

  it("shows the signed hash equal at Airi and Airwallex only where the record says so, character for character", () => {
    const b = rec.purchases.find((p) => outcomeOf(p) === "paid-faceid")!;
    const h = section(VISA_HASH_ID);
    expect(h).toContain(b.terms_sha256!);
    expect(text(h)).toContain(`${b.terms_sha256!.slice(0, 8)}…${b.terms_sha256!.slice(-4)}`);
    expect((h.match(/vh-tick/g) ?? []).length).toBe(2);
    expect(text(h)).toContain("2 of 2 read-backs equal");
    const flipped = JSON.parse(JSON.stringify(rec)) as Vic3Record;
    flipped.purchases.find((p) => p.step === b.step)!.read_back.payment_intent!.equal = false;
    expect(text(visaHashHtml(flipped))).toContain("not equal");
    expect(text(visaHashHtml(flipped))).toContain("1 of 2 read-backs equal");
  });

  it("says no count of checks above the details fold, and keeps the Intelligent Commerce Connect line", () => {
    // In the closed fold, the older runs keep their own checks lines (7 Nov, vic-2, TAP), each from its record.
    const main = text(/<main[\s\S]*?<details class="sumd" id="visa-details">/.exec(html)![0]);
    expect(main).not.toMatch(/\b\d+\s*\/\s*\d+\b|\b\d+ of \d+ checks\b|checks passed/i);
    expect(main).toContain(VISA_ICC_LINE);
    // No script was added: the page's own scripts are the ones it had (CSP hashes unchanged).
    expect(section(VISA_FLOW_ID) + section(VISA_OUTCOMES_ID) + section(VISA_HASH_ID)).not.toMatch(/<script|style="|on[a-z]+=/i);
  });
});
