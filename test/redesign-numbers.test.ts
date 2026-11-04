// The redesigned Home and Watch show only what the recorded run holds: every number on them is in the run's record
// (or is a sum or ratio this test counts again from the record itself), every agent's words are its own, every
// proof link is the record's, and the run is named by its own name. Breaks if a page shows a number the record lacks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_RUN_1_FILE, agentRun, faceIdDecisions, fxOf, loadRecord, payments, split, stoppedAtLimit, stops, tapLimitLine, tapRun, timings, type RunRecord } from "../src/redesign/run.js";
import { deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";
import { homePage } from "../src/redesign/home.js";
import { watchPage } from "../src/redesign/watch.js";
import { proofPage } from "../src/redesign/proof.js";
import { DEFENSE_IN_DEPTH, HOME_BADGE, KIT_LINE, SECOND_APPROVER, VISA_AWARD_ON, VISA_AWARD_STATUS, VISA_CLAIM } from "../src/config/brand.js";
import { buildPages } from "../src/relay/assets.js";

const { file, record } = loadRecord();
const RAW = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const TAP = tapRun();
const TAP_RAW = TAP ? readFileSync(new URL(`../${TAP.file}`, import.meta.url), "utf8") : "";
const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (n: string) => n.replace(/,(?=\d{3}\b)/g, "");
const RECORD_NUMBERS = new Set(((RAW + TAP_RAW).match(NUM) ?? []).map(norm));
/** Max, 4 Nov: the main run's figure, and the separate TAP run's decline on its own line directly below it. */
const STOPPED = stoppedAtLimit(stops(record));
const TAP_LINE = "Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November";

/** Figures the pages count from the record, counted again here from the raw file. */
function recount(r: RunRecord): string[] {
  const s = r.snapshot.agent_stats;
  const decisions = s.reduce((n, a) => n + a.decisions, 0);
  const cost = s.reduce((n, a) => n + a.cost_usd_micros, 0);
  const st = stops(r);
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
  return [String(decisions), String(s.reduce((n, a) => n + a.by_claude, 0)), (cost / decisions / 1e6).toFixed(4), String(st.metal + st.cfo + st.airwallex),
    // The cost per agent, as /proof writes it (USD to four places), and the dispute's valid orders (checked minus refunded).
    ...s.map((a) => (a.cost_usd_micros / 1e6).toFixed(4)), String(checked - refunded),
    // D3 and the one Face ID number, counted by their own functions (test/site-v4.test.ts counts them again).
    String(split(r).routine), String(faceIdDecisions(r)), String(s.reduce((n, a) => n + a.claude_calls, 0)), String(onChain), String(atAirwallex), ...calls].filter(Boolean);
}
const ALLOWED = new Set([...RECORD_NUMBERS, ...recount(JSON.parse(RAW) as RunRecord)]);

/** The words a person reads on a page as served (scripts, styles and markup left out), without the fixed names that carry digits. */
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;|&quot;/g, "'").replace(KIT_LINE, " ").replace(/\bx402\b/g, " ").replace(/Kit 11/g, " ").replace(VISA_CLAIM, " ").replace(/agent run 1/g, " ").replace(HOME_BADGE, " ").replace(/\b404\b/g, " ").replace(/\breq_[A-Za-z0-9]+/g, " ")
  // Other named records /proof cites, each with its own name and date: the variation test, the red team, the archive.
  .replace(/Variation test[\s\S]*?Red team[\s\S]*?\)\./, " ").replace(/\d+ of \d+ attacks failed \([^)]*\)[^.]*\. Against the agent loop: \d+ of \d+ held \([^)]*\)\./, " ")
  .replace(/Autonomous dry run dry-\d+[^<]*?(, \d{4}-\d{2}-\d{2})?/g, " ");

/** Numbers on the page that are not in the record. */
export const unknownNumbers = (html: string) => (visibleText(html).match(NUM) ?? []).map(norm).filter((n) => !ALLOWED.has(n));

describe("honest wording on the four tabs (review, 2 Nov)", () => {
  const run = agentRun();
  const money = run.events.filter((e): e is Extract<typeof e, { k: "money" }> => e.k === "money");

  it("one attempt, one step: the purchase let through to Metal, refused by Metal itself, with the run's own label", () => {
    const lt = money.filter((e) => e.letThrough);
    expect(lt).toHaveLength(1);
    expect(lt[0]!.refused).toMatchObject({ by: "metal", reason: DEFENSE_IN_DEPTH, code: "mandate_cap_exceeded" });
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
    for (const [name, html] of [["watch", watchPage()], ["proof", proofPage()], ["metal", pages.metal!]] as const) expect({ name, has: html.replace(/&#39;/g, "'").includes(DEFENSE_IN_DEPTH) }).toEqual({ name, has: true });
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

  it("scene 3 ends with the licence PAID by SWIFT after the CFO's Face ID (P-0005), the FX before it", () => {
    const steps = run.scenes[2]!.steps.map((s) => s.text);
    expect(steps).toContain("EUR 110.00 bought by FX for the shortfall");
    expect(steps).toContain("€240 licence PAID by SWIFT · 6 s after Face ID");
    expect(steps.filter((t) => /licence/.test(t))).toHaveLength(1);
    expect(run.scenes[2]!.sentence).toMatch(/licence paid by SWIFT after Face ID/);
    expect(homePage()).toContain("€240 licence PAID by SWIFT · 6 s after Face ID");
    expect(run.scenes[0]!.steps.map((s) => s.text).join(" ")).toMatch(/options in 40 s/);
  });

  it("counts only the main run's stops (Metal at the cap, the CFO's rejection); the TAP run's decline on its own labelled line", () => {
    const t = run.tiles.find((x) => x.label.startsWith("stopped"))!;
    // At a limit: Metal at the cap; the payment refused because its mandate had just been replaced is told apart.
    const st = stops(record);
    expect(st.revoked).toBe(record.snapshot.flows.filter((f) => f.refused?.by === "metal" && /mandate_revoked/.test(f.refused.reason)).length);
    expect([st.metal, st.cfo, st.airwallex, st.revoked, st.tapDeclines]).toEqual([1, 1, 0, 1, 1]);
    expect(t.parts).toEqual([{ value: "1", label: "Metal" }, { value: "1", label: "CFO" }]);
    expect(t.value).toBe("2");
    // Not inside the card: its own row, labelled as the separate test it was (agent X's review, 4 Nov).
    expect(t.note).toBeUndefined();
    expect(t.separate).toBe(TAP_LINE);
    for (const html of [homePage(), proofPage()]) {
      expect(html).toContain(`<p class="septest"><b>Separate test, 2 November:</b> ${TAP_LINE}; not counted in the figures above.</p>`);
      expect(html).not.toContain(`<span class="note">${TAP_LINE}</span>`);
    }
    if (st.revoked) expect(t.tip).toMatch(/mandate had just been replaced/);
    // At most two short lines on the card; the details in its tooltip.
    expect(t.explain.length).toBeLessThanOrEqual(60);
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
    for (const html of [homePage(), watchPage(), proofPage()]) {
      expect(html).toContain(run.label);
      expect(html).not.toMatch(/Stand-in|standing in|Replay of Autonomous dry run/);
    }
  });

  it("carry Home's badge with the Visa Award entered, and Visa only as text, never certified or endorsed", () => {
    expect(VISA_AWARD_ON).toBe(true);
    expect(KIT_LINE).toBe("Kit 11 · x402 Business Agents · entered for the Metal Award + Visa Award");
    expect(HOME_BADGE).toBe("Kit 11 · Metal Award + Visa Award · built on Airwallex, Metal, Claude");
    // Two pills, each on one line: the kit, and the awards entered (never read as already won).
    expect(homePage()).toContain(">Kit 11 · x402 Business Agents<");
    expect(homePage()).toContain(">entered for the Metal Award + Visa Award<");
    expect(homePage()).toMatch(/Visa TAP/);
    for (const [name, body] of Object.entries(PAGES)) if (typeof body === "string") expect({ name, img: /<img[^>]*visa/i.test(body), words: body.split(/[.!?"]\s/).filter((s) => /Visa|TAP/.test(s)).map((s) => /\b(certified|endorsed|Visa-approved|open-source)\b/i.exec(s)?.[0]).find(Boolean) ?? null }).toEqual({ name, img: false, words: null });
    expect(PAGES.visa).toContain(VISA_CLAIM.replace(/'/g, "&#39;").replace(/&#39;/g, "'"));
    expect(PAGES.visa).not.toMatch(/Dev test|reference code is not used/);
  });

  it("show only the scenes, and the steps, the run holds", () => {
    const run = agentRun();
    // No refusal on chain is claimed unless the record has one with its tx.
    const chain = record.snapshot.flows.some((f) => f.refused?.by === "metal" && f.proof.href);
    expect(JSON.stringify(run.scenes).includes("Metal refused it · on chain")).toBe(chain);
    expect(homePage().includes("Metal refuses it on chain")).toBe(chain);
    expect(run.scenes.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(run.scenes[2]!.steps.map((s) => s.text)).toContain("€240 licence PAID by SWIFT · 6 s after Face ID");
    expect(run.scenes[0]!.steps.map((s) => s.text)).toEqual(expect.arrayContaining(["2 of 2 signatures"]));
  });

  it("the Visa Award status is Max's sentence on Home, Proof and /visa, and no page says TAP was confirmed (2 Nov evening)", () => {
    const pages = buildPages() as unknown as Record<string, unknown>;
    for (const name of ["home", "proof", "visa"]) {
      const html = name === "home" ? homePage() : name === "proof" ? proofPage() : String(pages.visa);
      expect({ name, has: html.includes(VISA_AWARD_STATUS) }).toEqual({ name, has: true });
    }
    for (const [name, body] of Object.entries(pages)) if (typeof body === "string") expect({ name, bad: /confirmed (that )?TAP|TAP counts as Visa tooling|counts as Visa tooling/i.test(body.replace(VISA_AWARD_STATUS, "")) }).toEqual({ name, bad: false });
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

  it("claims no '0 unsafe' anywhere until sim-31 is checked (Max, 2 Nov)", () => {
    for (const [name, body] of Object.entries(buildPages() as unknown as Record<string, unknown>)) if (typeof body === "string") expect({ name, zero: /\b0 unsafe\b/i.test(body.replace(/<[^>]+>/g, " ")) }).toEqual({ name, zero: false });
  });
});

describe("one 'stopped at a limit' figure everywhere, from the main run (Max, 4 Nov)", () => {
  const doc = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  // Words as read: tags, Markdown emphasis and line breaks gone.
  const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/[*\\]/g, "").replace(/\s+/g, " ");
  const shots = new Proxy({}, { get: () => "" }) as DeckShots;
  const SOURCES: [string, string][] = [
    ["home", homePage()], ["proof", proofPage()],
    ["README.md", doc("README.md")], ["docs/claims.md", doc("docs/claims.md")], ["docs/submission/README.md", doc("docs/submission/README.md")],
    ["deck", deckHtml(packFacts(), shots, "")], ["docs/video-script.md", doc("docs/video-script.md")],
  ];

  it("is 2 in the main run's record: Metal at the cap and the CFO's rejection; neither #37 nor the TAP run counted", () => {
    expect(STOPPED).toBe(2);
    expect(tapLimitLine()).toBe(TAP_LINE);
    expect(packFacts().main.stopped).toBe(STOPPED);
  });

  it("is the same figure on the site, the README, the claims, the deck, the submission README and the video script", () => {
    for (const [name, raw] of SOURCES) {
      const t = text(raw);
      const figures = [...t.matchAll(/(\d+) stopped at a limit/gi)].map((m) => Number(m[1]));
      expect({ name, figures: figures.length > 0, wrong: figures.filter((n) => n !== STOPPED) }).toEqual({ name, figures: true, wrong: [] });
      // The TAP run's decline is there, on its own labelled line, after the figure.
      expect({ name, line: t.includes(TAP_LINE) }).toEqual({ name, line: true });
      expect({ name, after: t.lastIndexOf(TAP_LINE) > t.search(/\d+ stopped at a limit/i) }).toEqual({ name, after: true });
    }
  });

  it("tells the main run's card story in the README, the submission README and the deck; the decline only as the TAP run's line", () => {
    const c = packFacts().main.card_raise;
    for (const [name, raw] of SOURCES.filter(([n]) => ["README.md", "docs/submission/README.md", "deck"].includes(n))) {
      const t = text(raw);
      expect({ name, raise: t.includes(`${c.proposal}, EUR ${c.from} → ${c.to}`), auth: t.includes(c.auth.slice(0, 8)) }).toEqual({ name, raise: true, auth: true });
      // No Airwallex decline from another run outside the labelled TAP line.
      expect({ name, other: /30 October[^.]*declin|declin[^.]*30 October|in the recorded run it declined/i.test(t) }).toEqual({ name, other: false });
    }
  });

  it("tells the main run's dispute in the README and the deck: the refunds with their tx, the refund-all rejected; no 30 October figure (Max's rule)", () => {
    const m = packFacts().main;
    const events = record.ledger?.events ?? [];
    const txs = events.filter((e) => e.event === "refund.paid").map((e) => String((e.payload as { tx?: unknown }).tx ?? ""));
    const rejected = (record.ledger?.proposals ?? []).find((p) => p.kind === "refund_batch" && p.status === "REJECTED")?.proposal_id ?? "";
    expect({ refunds: m.refunded.length, txs: txs.length, rejected: !!rejected }).toEqual({ refunds: 3, txs: 3, rejected: true });
    const readme = text(doc("README.md"));
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
    expect([...text(doc("docs/claims.md").replace("2 stopped at a limit, both", "3 stopped at a limit, both")).matchAll(/(\d+) stopped at a limit/gi)].map((m) => m[1])).toContain("3");
  });
});

describe("one payment breakdown everywhere, and a clean refusal line (jury review, 4 Nov)", () => {
  const pay = payments(record);
  const PAGES = buildPages() as unknown as Record<string, string>;
  const words = (html: string) => html.replace(/<\/?code>/g, "").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

  it("adds up: 87 inside the limits = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy", () => {
    expect(pay.sums).toBe(true);
    expect(pay.sales + pay.purchases + pay.refunds + pay.sweeps + pay.cards).toBe(record.snapshot.counts.alone);
    expect(pay.line).toBe("87 inside the limits = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy");
    // On Metal: all but the card buy; routine by code: the sales and the supplier purchases; reconcile: Metal + SWIFT + card.
    expect([pay.onChain, pay.routine, pay.transfers, pay.reconciled]).toEqual([86, 82, 1, 88]);
    expect(pay.routine).toBe(pay.sales + pay.purchases);
    expect(pay.reconciled).toBe((record.snapshot as unknown as { reconciliation: { checked: number } }).reconciliation.checked);
    // The 14 queries that got an error: 14 refused supplier purchases, none settled.
    expect(record.snapshot.refusals.filter((x) => x.what === "Supplier purchase refused")).toHaveLength(14);
  });

  it("shows that one line on Home, Proof and /metal", () => {
    expect(words(homePage())).toContain("41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy");
    expect(words(proofPage())).toContain(pay.line);
    expect(words(proofPage())).toContain(pay.onChainLine);
    expect(words(PAGES.metal!)).toContain(pay.line);
  });

  it("says the let-through refusal in one clean line, the Defense-in-depth label on its own line", () => {
    for (const [name, html] of [["proof", proofPage()], ["metal", PAGES.metal!]] as const) {
      const t = words(html);
      expect({ name, line: t.includes("Refused by Metal: Stockline at 0.04, over the 0.03 cap (mandate_cap_exceeded); nothing moved.") }).toEqual({ name, line: true });
      expect({ name, garbled: /Stockline, Defense in depth|nothing moved\.; nothing moved/.test(t) }).toEqual({ name, garbled: false });
      expect({ name, own: html.replace(/&#39;/g, "'").includes(`<small>${DEFENSE_IN_DEPTH}</small>`) }).toEqual({ name, own: true });
    }
  });

  it("claims no safety count on /proof, and links the dispute to its own scene", () => {
    expect(proofPage()).not.toMatch(/Safety count|variation runs/);
    expect(proofPage()).toContain('href="watch?scene=2"');
    expect(agentRun().scenes.find((x) => x.n === 2)!.title).toBe("The dispute");
  });
});
