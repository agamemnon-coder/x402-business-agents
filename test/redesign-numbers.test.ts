// The redesigned Home and Watch show only what the recorded run holds: every number on them is in the run's record
// (or is a sum or ratio this test counts again from the record itself), every agent's words are its own, every
// proof link is the record's, and the run is named by its own name. Breaks if a page shows a number the record lacks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentRun, loadRecord, stops, tapRun, type RunRecord } from "../src/redesign/run.js";
import { homePage } from "../src/redesign/home.js";
import { watchPage } from "../src/redesign/watch.js";
import { proofPage } from "../src/redesign/proof.js";
import { CORE_SENTENCE, KIT_LINE, VISA_AWARD_ON, VISA_AWARD_STATUS, VISA_CLAIM } from "../src/config/brand.js";
import { buildPages } from "../src/relay/assets.js";

const { file, record } = loadRecord();
const RAW = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const TAP = tapRun();
const TAP_RAW = TAP ? readFileSync(new URL(`../${TAP.file}`, import.meta.url), "utf8") : "";
const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (n: string) => n.replace(/,(?=\d{3}\b)/g, "");
const RECORD_NUMBERS = new Set(((RAW + TAP_RAW).match(NUM) ?? []).map(norm));

/** Figures the pages count from the record, counted again here from the raw file. */
function recount(r: RunRecord): string[] {
  const s = r.snapshot.agent_stats;
  const decisions = s.reduce((n, a) => n + a.decisions, 0);
  const cost = s.reduce((n, a) => n + a.cost_usd_micros, 0);
  const st = stops(r);
  const t = r.snapshot.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
  const checked = t ? new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size : 0;
  const refunded = r.snapshot.flows.filter((f) => f.agent === "support" && /refund/i.test(f.what) && !f.refused).length;
  return [String(decisions), String(s.reduce((n, a) => n + a.by_claude, 0)), (cost / decisions / 1e6).toFixed(4), String(st.metal + st.airwallex + st.cfo),
    // The cost per agent, as /proof writes it (USD to four places), and the dispute's valid orders (checked minus refunded).
    ...s.map((a) => (a.cost_usd_micros / 1e6).toFixed(4)), String(checked - refunded)];
}
const ALLOWED = new Set([...RECORD_NUMBERS, ...recount(JSON.parse(RAW) as RunRecord)]);

/** The words a person reads on a page as served (scripts, styles and markup left out), without the fixed names that carry digits. */
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;|&quot;/g, "'").replace(KIT_LINE, " ").replace(/\bx402\b/g, " ").replace(/Kit 11/g, " ").replace(VISA_CLAIM, " ").replace(/agent run 1/g, " ")
  // Other named records /proof cites, each with its own name and date: the variation test, the red team, the archive.
  .replace(/Variation test[\s\S]*?Red team[\s\S]*?\)\./, " ").replace(/\d+ of \d+ attacks failed \([^)]*\)[^.]*\. Against the agent loop: \d+ of \d+ held \([^)]*\)\./, " ")
  .replace(/Autonomous dry run dry-\d+[^<]*?(, \d{4}-\d{2}-\d{2})?/g, " ");

/** Numbers on the page that are not in the record. */
export const unknownNumbers = (html: string) => (visibleText(html).match(NUM) ?? []).map(norm).filter((n) => !ALLOWED.has(n));

describe("honest wording on the four tabs (review, 2 Nov)", () => {
  const run = agentRun();
  const money = run.events.filter((e): e is Extract<typeof e, { k: "money" }> => e.k === "money");

  it("one refusal, one term: Purser refuses before signing and Metal records the same refusal on chain", () => {
    const rec = money.filter((e) => e.refused?.by === "recorded");
    expect(rec).toHaveLength(1);
    expect(rec[0]!.proof.href).toMatch(/0x3ad8de2f1a4896567f089786438418f0bf3be0d2c61807a9f157b89ed7d9a84d$/);
    // The two rows of the same attempt (Purser's, then Metal's record) are one step, not two.
    expect(money.filter((e) => e.refused && e.amount === "0.04" && Math.abs(Date.parse(e.at) - Date.parse(rec[0]!.at)) < 15_000)).toHaveLength(1);
    expect(run.scenes[0]!.steps.map((s) => s.text)).toContain("Refused · recorded on chain");
    for (const html of [homePage(), watchPage()]) expect(html).not.toMatch(/Metal refuses it on chain|Metal refused/);
  });

  it("fee_unknown is not an Airwallex limit: the sandbox could not price the fee, nothing paid", () => {
    const fee = money.find((e) => e.refused?.code === "fee_unknown")!;
    expect(fee.refused!.by).toBe("airwallex-sandbox");
    expect(fee.refused!.reason).toBe("the sandbox could not price the fee; nothing paid");
    expect(fee.amount).toBe("240.00");
    for (const html of [homePage(), watchPage(), proofPage()]) expect(html).not.toMatch(/says no on its own|as it did to the licence/);
    // Max, 2 Nov: the failed attempt is honest proof on Watch and Proof, not scene 3's end point on Home.
    expect(watchPage()).toMatch(/could not price the fee/);
    expect(proofPage()).toMatch(/fee_unknown|could not price the fee/);
    expect(run.scenes[2]!.steps.map((s) => s.text).join(" ")).not.toMatch(/could not price/);
    expect(run.scenes[2]!.sentence).not.toMatch(/could not price/);
  });

  it("scene 3 ends with the licence paid by SWIFT after the CFO's Face ID (P-0007)", () => {
    const steps = run.scenes[2]!.steps.map((s) => s.text);
    expect(steps).toContain("€240 licence paid by SWIFT · Face ID");
    expect(steps.filter((t) => /licence/.test(t))).toHaveLength(1);
    expect(run.scenes[2]!.sentence).toMatch(/licence paid by SWIFT after Face ID/);
    expect(homePage()).toContain("€240 licence paid by SWIFT · Face ID");
  });

  it("counts the Airwallex limit stop from the TAP run, labelled, and keeps fee_unknown apart", () => {
    const t = run.tiles.find((x) => x.label.startsWith("stopped"))!;
    expect(t.parts).toEqual([{ value: "2", label: "Metal" }, { value: "1", label: "CFO" }, { value: "1", label: "Airwallex · TAP run" }]);
    expect(t.value).toBe("4");
    // At most two short lines on the card; the details in its tooltip.
    expect(t.explain.length).toBeLessThanOrEqual(60);
    expect(t.tip).toMatch(/fee_unknown|could not price the fee/);
    expect(t.tip).toMatch(/not a limit/);
  });

  it("says a decision may be several Claude calls, beside the cost per decision", () => {
    expect(run.tiles.find((x) => /cost per decision/.test(x.label))!.explain).toMatch(/several calls/);
  });

  it("plays the four eyes as it happened: Max's signature first (1 of 2), then the test passkey's (2 of 2), then both replacements on chain", () => {
    const faces = run.events.filter((e): e is Extract<typeof e, { k: "face" }> => e.k === "face" && e.id === "P-0003");
    expect(faces.map((f) => [f.status, f.signers])).toEqual([["COSIGNED", ["Max"]], ["APPROVED", ["Max", "Test-controller"]]]);
    expect(Date.parse(faces[0]!.at)).toBeLessThan(Date.parse(faces[1]!.at));
    const rep = run.events.filter((e): e is Extract<typeof e, { k: "mandate" }> => e.k === "mandate");
    expect(rep.map((r) => r.agent)).toEqual(["treasury", "sourcing"]);
    expect(rep.every((r) => /^https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/.test(r.proof.href ?? ""))).toBe(true);
  });
});

describe("the redesigned Home and Watch", () => {
  it("show no number that is not in the run's record", () => {
    for (const [name, html] of [["home", homePage()], ["watch", watchPage()], ["proof", proofPage()]] as const) expect({ name, unknown: unknownNumbers(html) }).toEqual({ name, unknown: [] });
  });

  it("would catch a number the record does not hold", () => {
    expect(unknownNumbers(homePage().replace("</main>", "<p>9,876.54 saved</p></main>"))).toEqual(["9876.54"]);
  });

  it("play the record's own events: the agents' words, models, amounts and proof links come from it", () => {
    const run = agentRun();
    for (const e of run.events) {
      if (e.k === "say" || e.k === "msg" || e.k === "world") expect(RAW).toContain(JSON.stringify(e.text).slice(1, -1).slice(0, 80));
      if (e.k === "say" && e.model) expect(RAW).toContain(e.model);
      if (e.k === "money") { expect(RAW).toContain(e.proof.href ? `"amount": "${e.amount}"` : e.amount); if (e.proof.href) expect(RAW).toContain(e.proof.href); }
    }
    expect(run.events.filter((e) => e.k === "say").length).toBe(record.snapshot.agent_chat.filter((c) => c.kind === "decision").length);
  });

  it("play agent run 1, labelled as Max asked, and never the dry run as a stand-in", () => {
    const run = agentRun();
    expect(file).toBe("docs/demo/agent-run.json");
    expect(run.label).toBe("Replay of agent run 1 · 2 Nov · test money · real Claude decisions");
    for (const html of [homePage(), watchPage(), proofPage()]) {
      expect(html).toContain(run.label);
      expect(html).not.toMatch(/Stand-in|standing in|Replay of Autonomous dry run/);
    }
  });

  it("carry the Kit line with the Visa Award, the core sentence, and Visa only as text", () => {
    expect(VISA_AWARD_ON).toBe(true);
    expect(KIT_LINE).toBe("Kit 11 · x402 Business Agents · entered for the Metal Award + Visa Award");
    const home = homePage();
    // Two pills, each on one line: the kit, and the awards entered (never read as already won).
    expect(home).toContain(">Kit 11 · x402 Business Agents<");
    expect(home).toContain(">entered for the Metal Award + Visa Award<");
    expect(home).toContain(CORE_SENTENCE.replace(/'/g, "&#39;").replace(/'/g, "'"));
    expect(home).toMatch(/Visa TAP/);
    for (const [name, body] of Object.entries(buildPages())) if (typeof body === "string") expect({ name, img: /<img[^>]*visa/i.test(body), words: body.split(/[.!?"]\s/).filter((s) => /Visa|TAP/.test(s)).map((s) => /\b(certified|endorsed|Visa-approved|open-source)\b/i.exec(s)?.[0]).find(Boolean) ?? null }).toEqual({ name, img: false, words: null });
    expect(buildPages().visa).toContain(VISA_CLAIM.replace(/'/g, "&#39;").replace(/&#39;/g, "'"));
    expect(buildPages().visa).not.toMatch(/Dev test|reference code is not used/);
  });

  it("show only the scenes, and the steps, the run holds", () => {
    const run = agentRun();
    // No refusal on chain is claimed unless the record has one with its tx; scene 3 says what Airwallex did to the licence.
    const chain = record.snapshot.flows.some((f) => f.refused?.by === "metal" && f.proof.href);
    expect(JSON.stringify(run.scenes).includes("Refused · recorded on chain")).toBe(chain);
    expect(homePage().includes("refused, and recorded on chain")).toBe(chain);
    expect(run.scenes.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(run.scenes[2]!.steps.map((s) => s.text)).toContain("€240 licence paid by SWIFT · Face ID");
    expect(run.scenes[0]!.steps.map((s) => s.text)).toEqual(expect.arrayContaining(["2 of 2 signatures"]));
  });

  it("Home's partner row has a fourth card, Visa TAP as text (no logo), linking to /visa (Max, 2 Nov)", () => {
    expect(homePage()).toMatch(/<a class="partner card" href="visa"><span class="logo txt">Visa TAP<\/span>Card checkouts signed with TAP<\/a>/);
    expect(homePage()).not.toMatch(/<img[^>]*visa/i);
  });

  it("the price card's tags stack in one column, so they cannot overlap on a phone (Max, 2 Nov)", () => {
    expect(homePage()).toMatch(/<div class="tags"><span class="tag t1">[\s\S]*?<\/span>\s*<span class="tag t2">/);
    expect(homePage()).not.toMatch(/\.m-price \.t[12] \{ top:/);
  });

  it("the Visa Award status is Max's sentence on Home, Proof and /visa, and no page says TAP was confirmed (2 Nov evening)", () => {
    const pages = buildPages() as unknown as Record<string, unknown>;
    for (const name of ["home", "proof", "visa"]) {
      const html = name === "home" ? homePage() : name === "proof" ? proofPage() : String(pages.visa);
      expect({ name, has: html.includes(VISA_AWARD_STATUS) }).toEqual({ name, has: true });
    }
    for (const [name, body] of Object.entries(pages)) if (typeof body === "string") expect({ name, bad: /confirmed (that )?TAP|TAP counts as Visa tooling|counts as Visa tooling/i.test(body.replace(VISA_AWARD_STATUS, "")) }).toEqual({ name, bad: false });
  });

  it("labels the licence payment honestly: started by the CFO, Treasury had advised paying later (Max, 2 Nov)", () => {
    const label = "payment started by the CFO (npm run licence); Treasury had advised paying later";
    expect(watchPage()).toContain(label);
    const f = loadRecord().record.snapshot.flows.find((x) => (x as { proof?: { full?: string } }).proof?.full === "7bbb3d61-d9f3-4b8e-81cc-cc7cceb9c1df")!;
    expect(f.decided).toBe(label);
  });

  it("claims no '0 unsafe' anywhere until sim-31 is checked (Max, 2 Nov)", () => {
    for (const [name, body] of Object.entries(buildPages() as unknown as Record<string, unknown>)) if (typeof body === "string") expect({ name, zero: /\b0 unsafe\b/i.test(body.replace(/<[^>]+>/g, " ")) }).toEqual({ name, zero: false });
  });
});
