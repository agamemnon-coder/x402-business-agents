// The redesigned Home and Watch show only what the recorded run holds: every number on them is in the run's record
// (or is a sum or ratio this test counts again from the record itself), every agent's words are its own, every
// proof link is the record's, and the run is named by its own name. Breaks if a page shows a number the record lacks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentRun, loadRecord, type RunRecord } from "../src/redesign/run.js";
import { homePage } from "../src/redesign/home.js";
import { watchPage } from "../src/redesign/watch.js";
import { KIT_LINE, VISA_AWARD_ON } from "../src/config/brand.js";

const { file, record } = loadRecord();
const RAW = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (n: string) => n.replace(/,(?=\d{3}\b)/g, "");
const RECORD_NUMBERS = new Set((RAW.match(NUM) ?? []).map(norm));

/** Figures the pages count from the record, counted again here from the raw file. */
function recount(r: RunRecord): string[] {
  const s = r.snapshot.agent_stats;
  const decisions = s.reduce((n, a) => n + a.decisions, 0);
  const cost = s.reduce((n, a) => n + a.cost_usd_micros, 0);
  return [String(decisions), String(s.reduce((n, a) => n + a.by_claude, 0)), (cost / decisions / 1e6).toFixed(4)];
}
const ALLOWED = new Set([...RECORD_NUMBERS, ...recount(JSON.parse(RAW) as RunRecord)]);

/** The words a person reads on a page as served (scripts, styles and markup left out), without the fixed names that carry digits. */
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(KIT_LINE, " ").replace(/\bx402\b/g, " ");

/** Numbers on the page that are not in the record. */
export const unknownNumbers = (html: string) => (visibleText(html).match(NUM) ?? []).map(norm).filter((n) => !ALLOWED.has(n));

describe("the redesigned Home and Watch", () => {
  it("show no number that is not in the run's record", () => {
    for (const [name, html] of [["home", homePage()], ["watch", watchPage()]] as const) expect({ name, unknown: unknownNumbers(html) }).toEqual({ name, unknown: [] });
  });

  it("would catch a number the record does not hold", () => {
    expect(unknownNumbers(homePage().replace("</main>", "<p>9,876.54 saved</p></main>"))).toEqual(["9876.54"]);
  });

  it("play the record's own events: the agents' words, models, amounts and proof links come from it", () => {
    const run = agentRun();
    for (const e of run.events) {
      if (e.k === "say" || e.k === "msg" || e.k === "world") expect(RAW).toContain(JSON.stringify(e.text).slice(1, -1).slice(0, 80));
      if (e.k === "say" && e.model) expect(RAW).toContain(e.model);
      if (e.k === "money") { expect(RAW).toContain(`"amount": "${e.amount}"`); if (e.proof.href) expect(RAW).toContain(e.proof.href); }
    }
    expect(run.events.filter((e) => e.k === "say").length).toBe(record.snapshot.agent_chat.filter((c) => c.kind === "decision").length);
  });

  it("name the run by its own name and say when it stands in for agent run 1", () => {
    const run = agentRun();
    expect(run.label).toContain(record.run.split(":")[0]!.trim());
    expect(run.label).toMatch(/test money/);
    for (const html of [homePage(), watchPage()]) {
      expect(html).toContain(run.label);
      if (run.standIn) expect(html).toMatch(/standing in until agent run 1's record is added/);
      expect(html).not.toMatch(/agent run 1, 2 Nov/);
    }
  });

  it("keep the Visa Award off the Kit line until Max switches it on", () => {
    expect(VISA_AWARD_ON).toBe(false);
    expect(KIT_LINE).toBe("Kit 11 · x402 Business Agents · Metal Award");
    expect(homePage()).not.toMatch(/Visa Award/);
  });

  it("show only the scenes, and the steps, the run holds", () => {
    const run = agentRun();
    // No refusal on chain is claimed unless the record has one.
    const chain = record.snapshot.flows.some((f) => f.refused?.by === "metal");
    expect(JSON.stringify(run.scenes).includes("Refused on chain")).toBe(chain);
    expect(homePage().includes("Metal refuses on chain")).toBe(chain);
  });
});
