// The redesigned Home and Watch show only what the recorded run holds: every number on them is in the run's record
// (or is a sum or ratio this test counts again from the record itself), every agent's words are its own, every
// proof link is the record's, and the run is named by its own name. Breaks if a page shows a number the record lacks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_RUN_1_FILE, agentRun, disputeStory, faceIdDecisions, fxOf, loadRecord, metalDetail, payments, split, stopFigure, stopStory, stopSub, stops, stopsLine, tapLimitLine, tapRun, timings, type RunRecord } from "../src/redesign/run.js";
import { deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";
import { homePage } from "../src/redesign/home.js";
import { watchPage } from "../src/redesign/watch.js";
import { proofPage } from "../src/redesign/proof.js";
import { CHAIN_TEST, DEFENSE_IN_DEPTH, HOME_BADGE, KIT_LINE, PRICE_LINE, SECOND_APPROVER, VISA_CLAIM, VISA_TAP_STATUS, VISA_VIC_BUILT_ON } from "../src/config/brand.js";
import { buildPages } from "../src/relay/assets.js";
import { hostileClaimText } from "../src/redesign/partners.js";

const HOSTILE_CLAIM = hostileClaimText();
import { esc } from "../src/redesign/ui.js";

const { file, record } = loadRecord();
const RAW = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const TAP = tapRun();
const TAP_RAW = TAP ? readFileSync(new URL(`../${TAP.file}`, import.meta.url), "utf8") : "";
const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (n: string) => n.replace(/,(?=\d{3}\b)/g, "");
const RECORD_NUMBERS = new Set(((RAW + TAP_RAW).match(NUM) ?? []).map(norm));
/** Max, 5 Nov: the main run's stops, all of them; the separate TAP run's decline on its own line directly below. */
const STOPPED = stopStory(record).total;
const TAP_LINE = "Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November";

/** Figures the pages count from the record, counted again here from the raw file. */
function recount(r: RunRecord): string[] {
  const s = r.snapshot.agent_stats;
  const decisions = s.reduce((n, a) => n + a.decisions, 0);
  const cost = s.reduce((n, a) => n + a.cost_usd_micros, 0);
  const st = stopStory(r);
  const t = r.snapshot.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
  const checked = t ? new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size : 0;
  const refunded = r.snapshot.flows.filter((f) => f.agent === "support" && /refund/i.test(f.what) && !f.refused).length;
  // The Claude call badge (D2): each trace's tokens summed, its Claude time and its whole time in seconds.
  const calls = r.snapshot.traces.flatMap((t) => {
    const x = t as unknown as { tokens?: { input: number; output: number; cache_read: number; cache_write: number }; claude_ms?: number[]; latency_ms?: number };
    return [x.tokens ? String(x.tokens.input + x.tokens.output + x.tokens.cache_read + x.tokens.cache_write) : "", ((x.claude_ms ?? []).reduce((n, v) => n + v, 0) / 1000).toFixed(1), ((x.latency_ms ?? 0) / 1000).toFixed(1)];
  });
  const flows = r.snapshot.flows;
  // Money on chain (not refused, counted by query), movements at Airwallex, and the Claude calls of all agents.
  const onChain = flows.filter((f) => (f.rail === "metal" || f.rail === "purser") && !f.refused).reduce((n, f) => n + (f.count ?? 1), 0);
  const atAirwallex = flows.filter((f) => f.rail.startsWith("airwallex") && !f.refused).length + (r.ledger?.events.some((e) => e.event === "fx.converted") ? 1 : 0);
  return [String(decisions), String(s.reduce((n, a) => n + a.by_claude, 0)), (cost / decisions / 1e6).toFixed(4), String(st.total), String(st.claude), String(st.metal), String(st.cfo), String(st.planted),
    // The cost per agent, as /proof writes it (USD to four places), and the dispute's valid orders (checked minus refunded).
    ...s.map((a) => (a.cost_usd_micros / 1e6).toFixed(4)), String(checked - refunded),
    // D3 and the one Face ID number, counted by their own functions (test/site-v4.test.ts counts them again).
    String(split(r).routine), String(faceIdDecisions(r)), String(s.reduce((n, a) => n + a.claude_calls, 0)), String(onChain), String(atAirwallex), ...calls].filter(Boolean);
}
const ALLOWED = new Set([...RECORD_NUMBERS, ...recount(JSON.parse(RAW) as RunRecord)]);

/** The words a person reads on a page as served (scripts, styles and markup left out), without the fixed names that carry digits. */
const visibleText = (html: string) => html
  // /airwallex (jury panel, 12 Nov): a block that names its own record (data-rec: a product tile, the platform run's fold,
  // the line on SWIFT) is dated with that record; its figures are checked against it in test/airwallex-products.test.ts.
  .replace(/<(article|details|p|li)\b[^>]*\sdata-rec="[^"]+"[\s\S]*?<\/\1>/g, " ")
  // The partner pages' "Built on" strip (owner, 12 Nov): one proof number per partner, each from its own record (the
  // Airwallex tiles, the Airi run, the T:0 posting); test/t0-page.test.ts holds each to its record.
  .replace(/<p class="builton">[\s\S]*?<\/p>/g, " ")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#39;|&quot;/g, "'").replace(/&amp;/g, "&").replace(KIT_LINE, " ").replace(/\bx402\b/g, " ").replace(/Kit 11/g, " ").replace(VISA_CLAIM, " ").replace(/agent run 1/g, " ").replace(HOME_BADGE, " ").replace(/\b404\b/g, " ").replace(/\breq_[A-Za-z0-9]+/g, " ")
  // Other named records /proof cites, each with its own name and date: the variation test, the red team, the archive.
  .replace(/Variation test[\s\S]*?Red team[\s\S]*?\)\./, " ").replace(/\d+ of \d+ attacks failed \([^)]*\)[^.]*\. Against the agent loop: \d+ of \d+ held \([^)]*\)\./, " ")
  .replace(/Autonomous dry run dry-\d+[^<]*?(, \d{4}-\d{2}-\d{2})?/g, " ")
  // A commit is a name, not a figure (Proof's reliability note names the fix's; test/proof-first.test.ts reads it from its records).
  .replace(/\(commit [0-9a-f]{7,40}\)/g, " ")
  // /metal's separate runs, each dated with its own run record; their figures are checked against those records in
  // test/metal-story.test.ts.
  .replace(/Beyond the kit: separate runs, each dated \(not the main run\)[\s\S]*?(?=The Metal features we use)/, " ")
  // The invoice token (prototype) on /metal, shown only when its run record exists (docs/runs/<date>-tokenize.json): a
  // separate run, dated with its own record; its figures are checked against that record in test/tokenize-record.test.ts.
  .replace(/Invoice token \(prototype\)[\s\S]*?run record/, " ")
  // awx-1 (7 Nov), the separate Airwallex-only run on /airwallex and /proof, dated with its own record; its figures are
  // checked against that record (docs/demo/airwallex-run.json) in test/awx-run-page.test.ts.
  .replace(/\d{1,2} November, awx-1: a separate run[\s\S]*?docs\/demo\/airwallex-run\.json/g, " ")
  // The Airi run (7 Nov, Visa Intelligent Commerce via Airwallex's Airi; /airwallex, /visa and /proof), the same way:
  // dated with its own record, its figures checked against docs/demo/airi-run.json in test/airi-run-page.test.ts.
  .replace(/Visa Intelligent Commerce via Airwallex's Airi: a live run[\s\S]*?docs\/demo\/airi-run\.json/g, " ")
  // The second Airi run (vic-2, 7 Nov), dated with its own record; its figures are checked against docs/demo/vic-2-run.json
  // in test/vic2-run-page.test.ts.
  // (Its heading since 12 Nov: a control test, not a Visa run.)
  .replace(/Control test of Purser's own checks, not a Visa run[\s\S]{0,4000}?run log/g, " ")
  // /visa since 12 Nov (jury panel): purchase B in three columns (docs/demo/airi-run.json and Airwallex's own record),
  // the one summary of the paid run and the attempts that failed first, each from the Airi run's record; their figures
  // are checked against the records in test/vic-facts.test.ts and test/visa-overview.test.ts.
  .replace(/Purchase B: signed, sent, charged[\s\S]*?Airwallex's own record, read \d{1,2} \w{3}\./g, " ")
  .replace(/The paid run VIC via Airi[\s\S]*?cardholder confirmed each purchase in Airi/g, " ")
  .replace(/The \d+ attempts that failed first[\s\S]*?Each cause in full: run log/g, " ")
  .replace(/It passed on the \w+ attempt that day\./g, " ")
  // What the Airwallex sandbox reports for the Airi run's two payments (12 Nov, folded on /visa), dated with its own
  // record; its values are checked against docs/runs/airwallex-vic-payment-intents-<date>.json in test/vic-network.test.ts.
  .replace(/As reported by the Airwallex sandbox[\s\S]*?airwallex-vic-payment-intents-[\d-]+\.json/g, " ")
  // The CFO's policy next to Visa's published VIC rules (12 Nov, folded on /visa): Purser's figures from the two Airi
  // records and the code's constants, Visa's from its own quoted words; all checked in test/vic-rules.test.ts.
  .replace(/The CFO's policy next to Visa's VIC rules[\s\S]*?developer\.visa\.com, read \d{1,2} \w{3} \d{4}\./g, " ")
  // How the Airi rail handles card data (12 Nov, folded on /visa): two figures, the code's own constants (the folder's
  // mode, the digit run cut from kept text), not the run's; held to src/airi/cardData.ts in test/airi-card-data.test.ts.
  .replace(/Card data: not a network-tokenised checkout[\s\S]*?held by\s+test\/airi-card-data\.test\.ts/g, " ")
  // The intended price (a hypothesis, not a figure of the run): one sentence, its numbers checked against
  // src/business/unitEconomics.ts's inputs in test/unit-economics-hypothesis.test.ts.
  .replace(PRICE_LINE, " ")
  // Watch's playback speeds (Max, 10 Nov) are a control, not a figure of the run.
  .replace(/\b(?:0\.5|1|2)×/g, " ")
  // Home's hero, its one provenance line and its three proof rows (home-story, 12 Nov): the Airwallex-only run's
  // invoice, dated with its own record, the hero's receipt and the rows' ids; every figure is checked against
  // docs/demo/airwallex-run.json, the published receipt (docs/runs/2026-11-07-awx-1/receipt-P-0002.json) and
  // docs/demo/main-run.json in test/hero-demo.test.ts and test/home-story.test.ts. The same run's and the receipt's own
  // notes in Home's "What's real?" fold likewise.
  .replace(/\b1\s+Ask\s+2\s+Face ID[\s\S]*?See the proof/g, " ")
  .replace(/The hero's steps 1 to 3 and the two Airwallex rows:[\s\S]*?The terms are exactly as signed\./g, " ")
  // Home's "About Purser" fold (the owner, 12 Nov): how many runs /runs lists, and the payout and fee of the run of 10
  // November, dated in that run's own record; each figure is read from liveRuns() and checked against
  // docs/runs/2026-11-10-platform-e2e.md in test/home-about.test.ts.
  .replace(/About Purser\s+The problem:[\s\S]*?No customers, pilots or revenue yet\./g, " ")
  // 12 Nov (jury panel): /claude's hostile-model eval line, from its own record (docs/evals/ap-hostile.json), which
  // test/ap-agent-evals.test.ts holds to a fresh run of the eval.
  .replace(HOSTILE_CLAIM || "\u0000", " ");

/** Numbers on the page that are not in the record. */
export const unknownNumbers = (html: string) => (visibleText(html).match(NUM) ?? []).map(norm).filter((n) => !ALLOWED.has(n));

describe("honest wording on the four tabs (review, 2 Nov)", () => {
  const run = agentRun();
  const money = run.events.filter((e): e is Extract<typeof e, { k: "money" }> => e.k === "money");

  it("one attempt, one step: the purchase let through to Metal, refused by Metal itself, framed as the test it was", () => {
    const lt = money.filter((e) => e.letThrough);
    expect(lt).toHaveLength(1);
    // Jury review, 7 Nov (#13): CHAIN_TEST says it; the run's own label stays in its ledger row, not beside it.
    expect(lt[0]!.refused).toMatchObject({ by: "metal", reason: CHAIN_TEST, code: "mandate_cap_exceeded" });
    expect(lt[0]!.amount).toBe("0.04");
    expect(lt[0]!.proof.href).toMatch(/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871$/);
    // The facilitator's 402 and its record on chain are one step, not two; and counted once at the limit.
    expect(money.filter((e) => e.refused && e.refused.code === "mandate_cap_exceeded")).toHaveLength(1);
    expect(stops(record).metal).toBe(1);
    expect(money.filter((e) => e.refused?.by === "recorded")).toHaveLength(0);
    expect(run.scenes[0]!.steps.map((s) => s.text)).toContain("Metal refused it · on chain");
    // The run's own ledger row carries Max's label word for word.
    expect(record.ledger!.events.find((e) => e.event === "upstream.let_through_refused")!.payload.label).toBe(DEFENSE_IN_DEPTH);
    const pages = buildPages() as unknown as Record<string, string>;
    for (const [name, html] of [["watch", watchPage()], ["proof", proofPage()], ["metal", pages.metal!]] as const) {
      const t = html.replace(/&#39;/g, "'");
      expect({ name, label: t.includes(DEFENSE_IN_DEPTH), test: t.includes(CHAIN_TEST) }).toEqual({ name, label: false, test: true });
    }
  });

  it("the licence: euros for the shortfall bought by FX first, then PAID by SWIFT 6 s after the CFO's Face ID; Treasury's options 40 s after the refusal", () => {
    const fx = fxOf(record)!;
    expect(fx).toMatchObject({ buy: "EUR 110.00", sell: "USD 124.29", proposal: "P-0005" });
    const fxEv = money.find((e) => e.via === "FX")!, swift = money.find((e) => e.via === "SWIFT")!;
    expect(fxEv.amount).toBe("110.00");
    expect(Date.parse(fxEv.at)).toBeLessThan(Date.parse(swift.at));
    expect(swift.refused).toBeNull();
    expect(timings(record)).toEqual({ toOptions: 40, faceToPaid: 6 });
    expect(money.some((e) => e.refused?.code === "fee_unknown")).toBe(false);
  });

  it("scene 3 ends with the licence by SWIFT, accepted by Airwallex after the CFO's Face ID (P-0005), the FX before it", () => {
    const steps = run.scenes[2]!.steps.map((s) => s.text);
    expect(steps).toContain("EUR 110.00 bought by FX for the shortfall");
    // PAID in the sandbox, where Purser itself moves the transfer to SENT, then PAID (final review, 4 Nov).
    expect(steps).toContain("€240 licence by SWIFT, accepted by Airwallex with the signed hash · in the sandbox, where the settlement is simulated");
    expect(steps.filter((t) => /licence/.test(t))).toHaveLength(1);
    expect(run.scenes[2]!.sentence).toMatch(/licence paid by SWIFT after Face ID/);
    expect(run.scenes[0]!.steps.map((s) => s.text).join(" ")).toMatch(/options in 40 s/);
  });

  it("counts all of the main run's stops, by who stopped them; the TAP run's decline on its own labelled line (Max, 5 Nov)", () => {
    const t = run.tiles.find((x) => x.href === "proof#stops")!;
    // The rails' own counts (the partner pages): Metal at the cap, and the purchase refused because its mandate had
    // just been replaced, each one attempt once.
    const st = stops(record);
    expect(st.revoked).toBe(record.snapshot.flows.filter((f) => f.refused?.by === "metal" && /mandate_revoked/.test(f.refused.reason)).length);
    expect([st.metal, st.cfo, st.airwallex, st.revoked, st.tapDeclines]).toEqual([1, 1, 0, 1, 1]);
    // The stops: every refusal row of the record, by who stopped it, adding up to its own count.
    const story = stopStory(record);
    expect(story).toEqual({ total: 16, claude: 12, metal: 2, metalCap: 1, metalReplaced: 1, cfo: 1, planted: 1, other: 0, overLimitEur: "0.00" });
    expect(story.claude + story.metal + story.cfo + story.planted + story.other).toBe(record.snapshot.counts.blocked);
    expect(record.snapshot.refusals).toHaveLength(record.snapshot.counts.blocked);
    expect(story.metal).toBe(record.proof.chain_refusals);
    expect(story.metalCap + story.metalReplaced).toBe(story.metal);
    expect([story.metalCap, story.metalReplaced]).toEqual([st.metal, st.revoked]);
    expect(story.cfo).toBe(record.snapshot.decisions.filter((d) => d.status === "REJECTED").length);
    expect(story.planted).toBe((record.proof as { ai_tricks: number }).ai_tricks);
    // Max, 5 Nov: "16 stops" with "nothing paid over a limit" under it, and the sentence.
    expect([t.value, t.label]).toEqual(["16 stops", "nothing paid over a limit"]);
    expect(t.explain).toBe(stopsLine(story));
    expect(t.parts).toBeUndefined();
    // Not inside the card: its own row, labelled as the separate test it was (agent X's review, 4 Nov).
    expect(t.note).toBeUndefined();
    expect(t.separate).toBe(TAP_LINE);
    // Proof leaves it out since Max's last round (item 2): TAP is on /visa, linked from Proof's footer.
    expect(proofPage()).not.toContain(TAP_LINE);
    // Home shows no figures since Max's round of 7 Nov: no TAP line there either; it is on /visa.
    expect(homePage()).not.toContain(TAP_LINE);
    // Metal's two in detail, in the tooltip.
    expect(t.tip).toContain(`Metal's 2: ${metalDetail(story)}.`);
    expect(metalDetail(story)).toBe("1 over the mandate's cap, 1 on a mandate that had just been replaced");
    expect(t.tip).not.toMatch(/fee_unknown|TAP/);
  });

  it("says a decision may be several Claude calls, beside the cost per decision", () => {
    expect(run.tiles.find((x) => /cost per decision/.test(x.label))!.explain).toMatch(/several calls/);
  });

  it("plays the four eyes as it happened: Max's signature first (1 of 2), then the test passkey's (2 of 2), then both replacements on chain", () => {
    const faces = run.events.filter((e): e is Extract<typeof e, { k: "face" }> => e.k === "face" && e.id === "P-0002");
    expect(faces.map((f) => [f.status, f.signers])).toEqual([["COSIGNED", ["Max"]], ["APPROVED", ["Max", "Test-controller"]]]);
    expect(Date.parse(faces[0]!.at)).toBeLessThan(Date.parse(faces[1]!.at));
    const rep = run.events.filter((e): e is Extract<typeof e, { k: "mandate" }> => e.k === "mandate");
    expect(rep.map((r) => r.agent)).toEqual(["treasury", "sourcing"]);
    expect(rep.every((r) => /^https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/.test(r.proof.href ?? ""))).toBe(true);
  });
});

describe("the redesigned public pages", () => {
  const PAGES = buildPages();
  it("show no number that is not in the run's record (the four tabs, the partner pages, the 404)", () => {
    for (const [name, html] of [["home", homePage()], ["watch", watchPage()], ["proof", proofPage()], ["metal", PAGES.metal], ["airwallex", PAGES.airwallex!], ["visa", PAGES.visa], ["claude", PAGES.claude!], ["404", PAGES.notFound!]] as const) expect({ name, unknown: unknownNumbers(html) }).toEqual({ name, unknown: [] });
  });

  it("would catch a number the record does not hold", () => {
    expect(unknownNumbers(homePage().replace("</main>", "<p>9,876.54 saved</p></main>"))).toEqual(["9876.54"]);
  });

  it("play the record's own events: the agents' words, models, amounts and proof links come from it", () => {
    const run = agentRun();
    for (const e of run.events) {
      if (e.k === "say" || e.k === "msg" || e.k === "world") expect(RAW.replace(/warehouse software/gi, "warehouse app")).toContain(JSON.stringify(e.text).slice(1, -1).slice(0, 80));
      if (e.k === "say" && e.model) expect(RAW).toContain(e.model);
      if (e.k === "say" && e.call) for (const id of e.call.requestIds) expect(RAW).toContain(id);
      if (e.k === "money") { expect(RAW).toContain(e.proof.href ? `"amount": "${e.amount}"` : e.amount); if (e.proof.href) expect(RAW).toContain(e.proof.href); }
    }
    expect(run.events.filter((e) => e.k === "say").length).toBe(record.snapshot.agent_chat.filter((c) => c.kind === "decision").length);
  });

  it("play the main run, labelled as Max asked, and never the dry run as a stand-in", () => {
    const run = agentRun();
    expect(file).toBe("docs/demo/main-run.json");
    // Its name, its day and its time span from its own rows (and "and its follow-up" after a pause of over an hour).
    expect(run.label).toMatch(/^Replay of the main run, 3 Nov \d\d:\d\d–\d\d:\d\d UTC · test money · real Claude decisions$/);
    const ts = record.snapshot.agent_chat.map((c) => c.ts).concat(record.snapshot.flows.map((f) => f.at)).sort();
    expect(run.label).toContain(`${ts[0]!.slice(11, 16)}–`);
    expect(run.label).toContain(`–${ts[ts.length - 1]!.slice(11, 16)} UTC`);
    // Home no longer replays the main run (home-story, 12 Nov): Proof carries its label, Home only names the run
    // behind its Metal row, in its "What's real?" fold. The replay at /watch says the label in two parts: its heading
    // is the label's start with the day in full, the pill beside it the rest (the hours, test money, who decided).
    expect(proofPage()).toContain(run.label);
    const [start, rest] = [run.label.slice(0, run.label.indexOf(",")), run.label.replace(/^[^,]+, \d+ \S+ /, "")];
    expect(start).toBe("Replay of the main run");
    expect(rest).toBe(`${ts[0]!.slice(11, 16)}–${ts[ts.length - 1]!.slice(11, 16)} UTC · test money · real Claude decisions`);
    expect(watchPage()).toContain(`<h1>${start}, ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(ts[0]!))}</h1><span class="pill run">`);
    expect(watchPage()).toMatch(new RegExp(`<span class="pill run"><svg[^>]*>.*?</svg>${rest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span>`));
    expect(homePage()).not.toContain(run.label);
    expect(homePage()).toMatch(/The Metal row: the main run of 3 November\./);
    for (const html of [homePage(), watchPage(), proofPage()]) expect(html).not.toMatch(/Stand-in|standing in|Replay of Autonomous dry run/);
  });

  it("keep the Kit line and the badge as the form and the deck say them, off Home (home-story, 12 Nov: no Kit 11 chip, no awards strip, no \"Built on\" row), and Visa only as text, never certified or endorsed", () => {
    // "Visa (VIC via Airi)" in "Built on" since 12 Nov (jury panel): the Visa entry is the Airi run. Never "Visa TAP":
    // TAP is not the eligible tooling. (The switch was VISA_AWARD_ON, off.)
    expect(VISA_VIC_BUILT_ON).toBe(true);
    expect(KIT_LINE).toBe("Kit 11 · x402 Business Agents · entered for the Metal Award and the Visa Award");
    expect(HOME_BADGE).toBe("Kit 11 · Metal Award and Visa Award · built on Airwallex, Metal, Claude");
    // Home said both "entered for the Visa Award" and "not an award entry" (jury panel, 12 Nov): it now says nothing
    // about awards or Visa, and carries no chip, strip or "Built on" row. /visa and /proof say what is true there.
    expect(homePage()).not.toMatch(/Kit 11|x402 Business Agents|Metal Award|Visa Award|Built on|class="built"/);
    expect(homePage().replace(/<header class="top">[\s\S]*?<\/header>/, "")).not.toMatch(/Visa|href="visa"/);
    // Proof has no footer link to /visa since 12 Nov either: Visa TAP is on /visa only, in its closed fold.
    expect(proofPage()).not.toMatch(/<a class="flink" href="visa">|Extra, not an award entry/);
    expect(JSON.stringify(agentRun().scenes)).not.toMatch(/Visa|TAP/);
    for (const [name, body] of Object.entries(PAGES)) if (typeof body === "string") expect({ name, img: /<img[^>]*visa/i.test(body), words: body.split(/[.!?"]\s/).filter((s) => /Visa|TAP/.test(s)).map((s) => /\b(certified|endorsed|Visa-approved|open-source)\b/i.exec(s)?.[0]).find(Boolean) ?? null }).toEqual({ name, img: false, words: null });
    expect(PAGES.visa).toContain(VISA_CLAIM.replace(/'/g, "&#39;").replace(/&#39;/g, "'"));
    expect(PAGES.visa).not.toMatch(/Dev test|reference code is not used/);
  });

  it("show only the scenes, and the steps, the run holds", () => {
    const run = agentRun();
    // No refusal on chain is claimed unless the record has one with its tx.
    const chain = record.snapshot.flows.some((f) => f.refused?.by === "metal" && f.proof.href);
    expect(JSON.stringify(run.scenes).includes("Metal refused it · on chain")).toBe(chain);
    expect(homePage().includes("Metal refused the purchase on chain")).toBe(false);
    expect(run.scenes.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(run.scenes[2]!.steps.map((s) => s.text)).toContain("€240 licence by SWIFT, accepted by Airwallex with the signed hash · in the sandbox, where the settlement is simulated");
    expect(run.scenes[0]!.steps.map((s) => s.text)).toEqual(expect.arrayContaining(["2 of 2 signatures"]));
  });

  it("TAP's status is Max's wording (5 Nov), said once, on /visa; Home says nothing about Visa (12 Nov); the Visa Award only in the Kit line and /visa's entry line, never on TAP", () => {
    const pages = buildPages() as unknown as Record<string, unknown>;
    expect(VISA_TAP_STATUS).toBe("Visa TAP: built and verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon (Visa, 5 Nov).");
    // Said once: on /visa, inside its closed TAP fold; Home and Proof say nothing of it (their footer link went on 12 Nov).
    for (const name of ["home", "proof", "visa"]) {
      const html = name === "home" ? homePage() : name === "proof" ? proofPage() : String(pages.visa);
      expect({ name, has: html.split(esc(VISA_TAP_STATUS)).length - 1 }).toEqual({ name, has: name === "visa" ? 1 : 0 });
      if (name !== "visa") expect({ name, link: /Extra, not an award entry/.test(html) }).toEqual({ name, link: false });
    }
    for (const [name, body] of Object.entries(pages)) if (typeof body === "string") expect({ name, bad: /confirmed (that )?TAP|TAP counts as Visa tooling|counts as Visa tooling|still being confirmed with Visa|\+ Visa Award|Visa Award entry/i.test(body) || /Visa Award/i.test(body.split("entered for the Metal Award and the Visa Award").join(" ").split("This Airi run is Purser's entry for the Visa Award.").join(" ")) }).toEqual({ name, bad: false });
  });

  it("labels the licence payment by who planned it: the Treasury agent itself in the main run; agent run 1's honest note is kept", () => {
    const f = record.snapshot.flows.find((x) => (x as { proof?: { full?: string } }).proof?.full === "03360bfa-afce-457b-89d1-e1097fbe3985")!;
    expect(f.decided).toBe("planned by the Treasury agent (Claude Opus), the CFO approved it with Face ID");
    expect(watchPage()).toContain(f.decided);
    expect(record.ledger!.proposals.find((p) => p.proposal_id === "P-0005")!.created_by).toBe("treasury");
    // Agent run 1 (2 Nov): its licence was started by the CFO; that note stays with its record, which is not played.
    const notes = JSON.parse(readFileSync(new URL("../docs/demo/agent-run-notes.json", import.meta.url), "utf8")) as { flows: { transfer_id: string; decided: string }[] };
    expect(notes.flows.find((n) => n.transfer_id === "7bbb3d61-d9f3-4b8e-81cc-cc7cceb9c1df")!.decided).toBe("payment started by the CFO (npm run licence); Treasury had advised paying later");
    expect(readFileSync(new URL(`../${AGENT_RUN_1_FILE}`, import.meta.url), "utf8")).toContain("7bbb3d61-d9f3-4b8e-81cc-cc7cceb9c1df");
    expect(watchPage()).not.toContain("7bbb3d61");
  });

  it("names the second approver honestly wherever four eyes is shown (Home's footer, Watch, Proof)", () => {
    for (const html of [homePage(), watchPage(), proofPage()]) expect(html).toContain(SECOND_APPROVER);
  });

  // 12 Nov (jury panel): one exception, /claude's hostile-model eval line, which CI computes and its record holds (not sim-31).
  it("claims no '0 unsafe' anywhere until sim-31 is checked (Max, 2 Nov)", () => {
    for (const [name, body] of Object.entries(buildPages() as unknown as Record<string, unknown>)) if (typeof body === "string") expect({ name, zero: /\b0 unsafe\b/i.test(body.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(HOSTILE_CLAIM || "\u0000", " ")) }).toEqual({ name, zero: false });
  });
});

describe("one sentence for the stops everywhere, from the main run (Max, 4 and 5 Nov)", () => {
  const doc = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  // Words as read: tags, Markdown emphasis and line breaks gone.
  const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/[*\\]/g, "").replace(/\s+/g, " ");
  const shots = new Proxy({}, { get: () => "" }) as DeckShots;
  const SOURCES: [string, string][] = [
    ["proof", proofPage()],
    ["docs/in-depth.md", doc("docs/in-depth.md")], ["docs/claims.md", doc("docs/claims.md")], ["docs/submission/README.md", doc("docs/submission/README.md")],
    ["docs/submission/long-description.md", doc("docs/submission/long-description.md")],
    ["deck", deckHtml(packFacts(), shots, "")], ["docs/video-script.md", doc("docs/video-script.md")],
  ];

  it("is 16 in the main run's record, nothing paid over a limit; the TAP run not counted", () => {
    expect(STOPPED).toBe(16);
    expect(STOPPED).toBe(record.snapshot.counts.blocked);
    expect(tapLimitLine()).toBe(TAP_LINE);
    expect(packFacts().main.stopped).toBe(STOPPED);
    expect(packFacts().main.stop_line).toBe(stopsLine(stopStory(record)));
  });

  const LINE = "16 stops, nothing paid over a limit: one buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.";
  /** Every "N stops, …: Claude skipped A …, Metal refused B …, the CFO rejected C …, and D planted …" in a text, as [N, A, B, C, D]. */
  const said = (t: string) => [...t.matchAll(/(\d+) stops, nothing paid over a limit: one buy rule Claude set stopped (\d+) overpriced checks?, Metal refused (\d+) purchases?, the CFO rejected (\d+) proposals?, and (\d+) planted instructions? changed nothing/g)].map((m) => m.slice(1).map(Number));

  it("is one sentence on the site, the claims, the forms, the deck and the video script, with the record's counts (5 Nov)", () => {
    const st = stopStory(record);
    expect(stopsLine(st)).toBe(LINE);
    expect([stopFigure(st), stopSub(st)]).toEqual(["16 stops", "nothing paid over a limit"]);
    const want = [st.total, st.claude, st.metal, st.cfo, st.planted];
    for (const [name, raw] of SOURCES) {
      const t = text(raw);
      const counts = said(t);
      expect({ name, said: counts.length > 0, wrong: counts.filter((c) => c.join() !== want.join()) }).toEqual({ name, said: true, wrong: [] });
      // The old sentence is gone (the claims keep it once, as what the row "was").
      expect({ name, old: t.replace(/\b[Ww]as:? "Metal refused 1 purchase over its cap; the CFO rejected 1 proposal\."|"1 \+ 1" told too little/g, "").match(/over its cap; the CFO rejected|\b1 \+ 1\b/g)?.length ?? 0 }).toEqual({ name, old: 0 });
      // The TAP run's decline is there, on its own labelled line, after the sentence (the deck leaves that other run
      // out: it overrides the 4 Nov rule for the deck).
      // The form's Description leaves it out too since 6 Nov (jury review, #7: no TAP there; the long text keeps it).
      // Proof leaves it out too since Max's last round (item 2): TAP only on /visa and in Proof's footer link.
      if (name === "deck" || name === "docs/submission/README.md" || name === "proof") expect({ name, tap: t.includes(TAP_LINE) }).toEqual({ name, tap: false });
      // The main run's section (docs/in-depth.md since the README went under 150 lines, 12 Nov) says it in its own
      // words since the jury review of 7 Nov (#15): what is not counted first.
      else if (name === "docs/in-depth.md") expect({ name, after: t.lastIndexOf("Not counted (a separate TAP run, 2 November): Airwallex declined EUR 45.00 over the card limit (`LIMIT_EXCEEDED`).") > t.indexOf(LINE) }).toEqual({ name, after: true });
      else expect({ name, after: t.lastIndexOf(TAP_LINE) > t.indexOf(LINE) }).toEqual({ name, after: true });
    }
    // On the site's tiles, a big "16 stops" with "nothing paid over a limit" under it, then the sentence.
    for (const [name, raw] of SOURCES.filter(([n]) => ["proof"].includes(n))) expect({ name, tile: text(raw).includes(`${stopFigure(st)} ${stopSub(st)}`) }).toEqual({ name, tile: true });
  });

  it("no longer says \"stopped at a limit\" anywhere it is shown (Max, 5 Nov)", () => {
    for (const [name, raw] of [...SOURCES, ["README.md", doc("README.md")] as [string, string]]) expect({ name, old: /stopped at a limit/i.test(text(raw)) }).toEqual({ name, old: false });
    for (const [name, body] of Object.entries(buildPages() as unknown as Record<string, unknown>)) if (typeof body === "string") expect({ name, old: /stopped at a limit/i.test(text(body)) }).toEqual({ name, old: false });
  });

  it("says Metal's two in detail where they are told: the main run's section (docs/in-depth.md), the claims, the Proof page", () => {
    const d = metalDetail(stopStory(record));
    for (const [name, raw] of SOURCES.filter(([n]) => ["proof", "docs/claims.md"].includes(n))) expect({ name, detail: text(raw).includes(d) }).toEqual({ name, detail: true });
    expect(text(doc("docs/in-depth.md"))).toMatch(/Metal's 2: 1 over the mandate's cap \(#24[^)]*\), 1 on a mandate that had just been replaced \(#37/);
  });

  it("tells the main run's card story in its section (docs/in-depth.md), the long form text and the deck; the decline only as the TAP run's line", () => {
    const c = packFacts().main.card_raise;
    // The short Description (Max, 5 Nov) leaves the card story to the long text it links; it names no other decline either.
    expect(/30 October[^.]*declin|declin[^.]*30 October|in the recorded run it declined/i.test(text(doc("docs/submission/README.md")))).toBe(false);
    for (const [name, raw] of SOURCES.filter(([n]) => ["docs/in-depth.md", "docs/submission/long-description.md", "deck"].includes(n))) {
      const t = text(raw);
      expect({ name, raise: t.includes(`${c.proposal}, EUR ${c.from} → ${c.to}`), auth: t.includes(c.auth.slice(0, 8)) }).toEqual({ name, raise: true, auth: true });
      // No Airwallex decline from another run outside the labelled TAP line.
      expect({ name, other: /30 October[^.]*declin|declin[^.]*30 October|in the recorded run it declined/i.test(t) }).toEqual({ name, other: false });
    }
  });

  it("tells the main run's dispute in its section (docs/in-depth.md) and the deck: the refunds with their tx, the refund-all rejected; no 30 October figure (Max's rule)", () => {
    const m = packFacts().main;
    const events = record.ledger?.events ?? [];
    const txs = events.filter((e) => e.event === "refund.paid").map((e) => String((e.payload as { tx?: unknown }).tx ?? ""));
    const rejected = (record.ledger?.proposals ?? []).find((p) => p.kind === "refund_batch" && p.status === "REJECTED")?.proposal_id ?? "";
    expect({ refunds: m.refunded.length, txs: txs.length, rejected: !!rejected }).toEqual({ refunds: 3, txs: 3, rejected: true });
    const readme = text(doc("docs/in-depth.md"));
    expect(readme).toContain(`${m.disputed} orders`);
    expect(readme).toContain(`#${m.refunded.slice(0, -1).join(", #")} and #${m.refunded.at(-1)}`);
    for (const tx of txs) expect(readme).toContain(tx);
    expect(readme).toMatch(new RegExp(`${rejected}[^.]*rejected by Max with Face ID`));
    // The deck's dispute slide is the main run's, picture and caption.
    const deck = text(deckHtml(packFacts(), shots, ""));
    expect(deck).toMatch(/The main run, 3 November \(\/watch\): #\d+, #\d+, #\d+ refunded, each on chain; (?:"|&quot;)refund the other \d+(?:"|&quot;) rejected by Max with Face ID/);
    // Figures from other runs are gone from the demo: the 30 October dispute ("all 12 hold") and agent run 1's 38 of 38.
    expect({ allHold: /All 12 hold|all 12 hold/.test(readme), run1: readme.includes("38 of 38"), oct30Dispute: /Disputes tab of the earlier recorded run/.test(deck) }).toEqual({ allHold: false, run1: false, oct30Dispute: false });
    const s = record.snapshot.agent_stats;
    const [decisions, byClaude] = [s.reduce((n, a) => n + a.decisions, 0), s.reduce((n, a) => n + a.by_claude, 0)];
    expect(readme).toContain(`${byClaude} of ${decisions} decisions by Claude`);
  });

  it("would catch a stray 3 or 4", () => {
    expect(said(text(doc("docs/claims.md").replace("Metal refused 2 purchases", "Metal refused 3 purchases")))).toContainEqual([16, 12, 3, 1, 1]);
  });
});

describe("one payment breakdown everywhere, and a clean refusal line (jury review, 4 Nov)", () => {
  const pay = payments(record);
  const PAGES = buildPages() as unknown as Record<string, string>;
  const words = (html: string) => html.replace(/<\/?code>/g, "").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

  it("adds up: 86 Metal payments + 1 card charge, all inside the limits (one canonical set, jury review, 6 Nov)", () => {
    expect(pay.sums).toBe(true);
    expect(pay.sales + pay.purchases + pay.refunds + pay.sweeps + pay.cards).toBe(record.snapshot.counts.alone);
    expect(pay.canonical).toBe("86 Metal payments + 1 card charge");
    expect(pay.metalParts).toBe("41 sales + 41 supplier purchases + 3 refunds + 1 sweep");
    expect(pay.line).toBe("86 Metal payments + 1 card charge, all inside the limits: 41 sales + 41 supplier purchases + 3 refunds + 1 sweep on Metal, and 1 card charge at Airwallex");
    expect(pay.onChainLine).toBe("86 on Metal = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep");
    // On Metal: all but the card buy; routine by code: the sales and the supplier purchases; reconcile: Metal + SWIFT + card.
    expect([pay.onChain, pay.routine, pay.transfers, pay.reconciled]).toEqual([86, 82, 1, 88]);
    expect(pay.routine).toBe(pay.sales + pay.purchases);
    expect(pay.reconciled).toBe((record.snapshot as unknown as { reconciliation: { checked: number } }).reconciliation.checked);
    // The 14 queries that got an error: 14 refused supplier purchases, none settled.
    expect(record.snapshot.refusals.filter((x) => x.what === "Supplier purchase refused")).toHaveLength(14);
  });

  it("shows that one set on Home, Proof and /metal, and no 87 or 82 beside it (jury review, 6 Nov, #5)", () => {
    // Home shows no figures since Max's round of 7 Nov (the way through: watch, try, proof).
    expect(words(homePage())).not.toMatch(/Metal payments \+ 1 card charge/);
    expect(words(proofPage())).toContain(`${pay.onChain} Metal payments + 1 card charge`);
    expect(words(proofPage())).toContain(pay.onChainLine);
    expect(words(PAGES.metal!)).toContain(pay.line);
    for (const [name, html] of [["home", homePage()], ["proof", proofPage()], ["metal", PAGES.metal!]] as const) {
      const main = words(/<main[\s\S]*<\/main>/.exec(html)![0]);
      expect({ name, other: main.match(/(?<![\d.#])\b(87|82)\b(?![.\d])/g) ?? [] }).toEqual({ name, other: [] });
    }
  });

  it("says the let-through refusal in one clean line, the chain test on its own line and no Defense-in-depth label beside it", () => {
    for (const [name, html] of [["proof", proofPage()], ["metal", PAGES.metal!]] as const) {
      const t = words(html);
      expect({ name, line: t.includes("Refused by Metal: Stockline at 0.04, over the 0.03 cap (mandate_cap_exceeded); nothing moved.") }).toEqual({ name, line: true });
      expect({ name, garbled: /Stockline, Defense in depth|nothing moved\.; nothing moved/.test(t) }).toEqual({ name, garbled: false });
      expect({ name, own: html.replace(/&#39;/g, "'").includes(`<small>${CHAIN_TEST}</small>`), label: html.replace(/&#39;/g, "'").includes(DEFENSE_IN_DEPTH) }).toEqual({ name, own: true, label: false });
    }
  });

  it("claims no safety count on /proof, and links the dispute to its own scene", () => {
    expect(proofPage()).not.toMatch(/Safety count|variation runs/);
    expect(proofPage()).toContain('href="watch?scene=2"');
    expect(agentRun().scenes.find((x) => x.n === 2)!.title).toBe("The dispute");
  });
});

describe("the dispute, one text everywhere (jury review, 4 Nov)", () => {
  const STORY = "A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. \"Refund the other 9\" goes to the CFO, who rejects it with Face ID.";
  const doc = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/[ \t]*\n[ \t]*/g, " ");
  it("is told from the run's own dispute case", () => {
    expect(disputeStory(record)).toBe(STORY);
    expect(agentRun().scenes.find((x) => x.n === 2)!.sentence).toBe(STORY);
    // Home tells no scene since Max's round of 7 Nov; the form and the main run's section tell it (next test).
    expect(homePage().replace(/&quot;/g, '"').replace(/&#39;/g, "'")).not.toContain(STORY);
  });
  it("is the same text in the submission form and the main run's section (docs/in-depth.md), and the same figures in the deck's one-line beat", () => {
    expect(doc("docs/submission/README.md")).toContain(STORY);
    expect(doc("docs/in-depth.md")).toContain(STORY);
    const deck = deckHtml(packFacts(), new Proxy({}, { get: () => "" }) as DeckShots, "").replace(/&quot;/g, '"');
    // Pitch round, 5 Nov: the deck's beat says the story in two short lines (the juror's review: one message per
    // slide, readable on a shared screen), with the story's own figures, counted from the record.
    const m = packFacts().main;
    expect(deck).toContain(`Only the ${m.refunded.length} bad ones refunded`);
    expect(deck).toContain(`${m.disputed} orders disputed; "refund the other ${m.disputed - m.refunded.length}" rejected by the CFO with Face ID.`);
    expect(STORY).toContain(`refunds those ${m.refunded.length} (0.15 test USD) itself. "Refund the other ${m.disputed - m.refunded.length}"`);
    // The deck: slide 1 does not open with the awards (Max, 5 Nov; it overrides the jury review of 4 Nov); no photo
    // placeholder on the team slide.
    expect(deck).not.toContain(`<p class="kicker">${KIT_LINE}</p>`);
    expect(deck).toContain('<p class="kicker">Purser · Starter Kit 11 · x402 Business Agents</p>');
    expect(deck).not.toContain("Photo of Max");
  });
});
