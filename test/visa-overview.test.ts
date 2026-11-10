// /visa's overview (Max, 10 Nov: "more Visa"): every figure and id on its three run cards is read again here from the raw
// run records, the cards link to blocks that exist on the page, and a card whose record lacks a fact is left out.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { airiRun } from "../src/redesign/airiRun.js";
import { visaPage } from "../src/redesign/partners.js";
import { tapRun } from "../src/redesign/run.js";
import { vic2Run } from "../src/redesign/vic2Run.js";
import { VISA_OVERVIEW_HEADING, VISA_OVERVIEW_ID, airiCard, tapCard, vic2Card, visaOverviewHtml } from "../src/redesign/visaOverview.js";

const raw = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

describe("/visa overview", () => {
  const airi = raw("docs/demo/airi-run.json"), vic2 = raw("docs/demo/vic-2-run.json"), tap = raw(tapRun()!.file);

  it("reads the VIC card from docs/demo/airi-run.json", () => {
    const c = airiCard(airiRun()!)!;
    const b = airi.purchases.find((p: { route: string }) => p.route === "cfo");
    expect(c.stats).toEqual([
      { v: String(airi.purchases.filter((p: { outcome?: string }) => p.outcome === "SUCCEEDED").length), l: "paid" },
      { v: String(airi.purchases.filter((p: { by?: string }) => p.by === "purser").length), l: "refused by Purser" },
      { v: `${Object.values(airi.checks).filter((x) => (x as { ok: boolean }).ok).length}/${Object.keys(airi.checks).length}`, l: "checks" },
    ]);
    expect(c.ids).toEqual([["Mandate", b.mandate_id], ["Payment", b.payment_intent_id]]);
  });

  it("reads the second Airi run's card from docs/demo/vic-2-run.json: nothing bought, no outside call", () => {
    const c = vic2Card(vic2Run()!);
    expect(c.stats[0]).toEqual({ v: "2", l: "refused" });
    expect(c.stats[1]).toEqual({ v: String(vic2.outside_calls.airi + vic2.outside_calls.airwallex), l: "outside calls" });
    expect(c.stats[1]!.v).toBe("0");
    expect(c.ids).toEqual([["Face ID proposal", vic2.steps.D.outcome.proposalId]]);
    expect(c.label).toMatch(/Nothing bought/);
  });

  it("reads the TAP card from the TAP run record: signatures the proxy accepted, Airwallex's approval and decline", () => {
    const c = tapCard(tapRun()!);
    const steps = tap.steps as { tap: { proxy_status: number }; airwallex: { approved: boolean; failure_reason: string | null; confirmed_by_get: { amount: string } } }[];
    const ok = steps.filter((s) => s.tap.proxy_status === 200).length;
    const yes = steps.find((s) => s.airwallex.approved)!, no = steps.find((s) => !s.airwallex.approved)!;
    expect(c.stats).toEqual([
      { v: `${ok}/${steps.length}`, l: "signatures accepted" },
      { v: `€${yes.airwallex.confirmed_by_get.amount}`, l: "approved" },
      { v: `€${no.airwallex.confirmed_by_get.amount}`, l: `declined (${no.airwallex.failure_reason})` },
    ]);
    expect(c.ids).toEqual([["Visa reference verifier", `commit ${tap.reference.commit.slice(0, 7)}`]]);
    expect(c.label).toMatch(/simulated/);
  });

  it("sits on /visa above the Airi run, and each card links to a block on the page", () => {
    const html = visaPage();
    const at = html.indexOf(`id="${VISA_OVERVIEW_ID}"`);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('id="airi-run"'));
    expect(html).toContain(VISA_OVERVIEW_HEADING);
    const hrefs = [...html.slice(at).matchAll(/<a class="vo-run" href="#([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toHaveLength(3);
    for (const h of hrefs) expect(html).toContain(`id="${h}"`);
  });

  it("leaves a card out when its record lacks the fact, and the whole overview when no record is there", () => {
    const rec = airiRun()!;
    expect(airiCard({ ...rec, purchases: rec.purchases.filter((p) => p.route !== "cfo") })).toBeNull();
    expect(visaOverviewHtml([])).toBe("");
  });
});
