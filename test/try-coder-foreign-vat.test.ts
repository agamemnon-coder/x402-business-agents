// The /try step line when the Coder leaves a German supplier's 19% without a VAT code (final-polish, 13 Nov): its codes
// are the Dutch return's, so it sets none; the books code the line from the supplier's German VAT id (PF_DE19, 1515).
// The step says so plainly, under the agent's own words, and never shows that VAT as uncoded.
import { describe, expect, it } from "vitest";
import { eventLine } from "../cloud/src/tryEvents.js";
import { LIVE } from "../cloud/src/tryCopy.js";
import { publicEvent } from "../src/engine/events.js";

const coded = (payload: Record<string, unknown>) => eventLine(publicEvent({ seq: 1, ts: "2026-11-13T12:00:00Z", actor: "treasury", event: "ap.coded", subject: "AP-0001", payload_json: JSON.stringify(payload) }));
const base = {
  source: "claude", model: "claude-haiku-5-5", status: "needs_review", reason: "Bergtex charges 19% German VAT, and no purchase VAT code in Purser reproduces that rate, so the VAT code is left null.",
  lines: [{ account: "6200", vat_code: null, cost_centre: "CC100" }], overridden_by: null,
};

describe("the Coder's step on a German invoice", () => {
  it("names the German VAT and says code booked it to reclaim from Germany", () => {
    const l = coded({ ...base, books_vat_code: "PF_DE19" });
    expect(l.lead).toContain(`6200 expense, VAT ${LIVE.vat.PF_DE19}`);
    expect(l.enforced).toBe(`Purser's code enforced: ${LIVE.booksVat}`);
    expect(LIVE.booksVat).toMatch(/^German VAT 19%: no Dutch purchase code applies; /);
  });

  it("a line with no code and no German VAT id still reads as left for a person, not as German VAT", () => {
    const l = coded({ ...base, books_vat_code: null });
    expect(l.lead).toContain(LIVE.noVat);
    expect(l.enforced).toBe("");
  });

  it("the public event carries only the foreign code, never another value", () => {
    const f = publicEvent({ seq: 1, ts: "t", actor: "treasury", event: "ap.coded", subject: "AP-1", payload_json: JSON.stringify({ ...base, books_vat_code: "<b>x</b>" }) }).fields;
    expect(f.books_vat_code).toBeUndefined();
  });
});
