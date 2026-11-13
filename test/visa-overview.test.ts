// /visa is one Visa Intelligent Commerce story (12 Nov, jury panel; Visa, 5 Nov: TAP is not Visa tooling for this
// hackathon). Held here, on the built page and against the raw run records:
//   - the title and the first heading name Visa Intelligent Commerce via Airi; a visible line gives the basis for
//     calling it that, with its date, channel and source ("as reported by the builder");
//   - one line reads "We have requested Visa Intelligent Commerce Connect access; it is not used here", and no
//     other claim about it exists on the site or in the README;
//   - one summary of the paid run: purchase B paid after the CFO's Face ID, scripted with no Claude call; the day's
//     attempts ("1 of 4 paid") and its failures in a fold;
//   - "TAP" appears only inside one closed fold, the last thing on the page, labelled as outside the entry;
//   - the footer cites docs/demo/airi-run.json and has no main-run paragraph;
//   - Home and /proof no longer carry "Extra, not an award entry"; "Visa (VIC via Airi)" is in Home's "Built on"; /judge
//     links the Visa run; the 7 November run is called scripted wherever it appears.
// The page build fails when any of it is lost (assertVicFirst).
import { vic3Run } from "../src/redesign/vic3Run.js";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as brand from "../src/config/brand.js";
import { VISA_BUILT_ON, VISA_CLAIM, VISA_ICC_LINE, VISA_TAP_STATUS, VISA_VIC_BUILT_ON } from "../src/config/brand.js";
import { buildPages } from "../src/relay/assets.js";
import { AIRI_RUN_FILE, AIRI_SCRIPTED, AIRI_SUMMARY, airiAsker, airiRun, airiSummaryLine } from "../src/redesign/airiRun.js";
import { homePage } from "../src/redesign/home.js";
import { ICC_LINE, VISA_ENTRY_LINE, VISA_H1, VISA_LEAD, VISA_TAP_HEADING, VISA_TITLE, airwallexPage, assertVicFirst, visaLatestLabel, visaPage, visaRunLabel } from "../src/redesign/partners.js";
import { proofPage } from "../src/redesign/proof.js";
import { loadRecord, ownTap, tapRun } from "../src/redesign/run.js";
import { MAIN_RUN_REAL, esc } from "../src/redesign/ui.js";
import { VIC2_HEADING, VIC2_LABEL } from "../src/redesign/vic2Run.js";
import { VIC_CREDENTIAL_WHO, VIC_FLOW_CSS, vicFlow } from "../src/redesign/vicFlow.js";
import { VISA_OVERVIEW_ID, VISA_SUMMARY_HEADING, VISA_TAP_ID, airiCard, tapCard, visaOverviewBlock, visaOverviewHeading, visaOverviewHtml } from "../src/redesign/visaOverview.js";

const raw = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const text = (html: string) => html.replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ").replace(/<svg\b[\s\S]*?<\/svg\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
/** A page without what its folds hide: every <details> reduced to its summary. */
const unfolded = (html: string) => html.replace(/<details\b[^>]*>\s*(<summary[^>]*>[\s\S]*?<\/summary>)[\s\S]*?<\/details>/g, " $1 ");
const TAP = /\bTAP\b|Trusted Agent Protocol/;

describe("/visa: one summary of the paid run", () => {
  const airi = raw("docs/demo/airi-run.json"), tap = raw(tapRun()!.file);

  // The jury check of 12 Nov: the card leads with the paid purchase; the day's attempts are counted in their fold.
  it("reads the paid run's card from docs/demo/airi-run.json: the paid purchase B, its amount and ids; the attempts in their fold", () => {
    const c = airiCard(airiRun()!)!;
    const b = airi.purchases.find((p: { route: string }) => p.route === "cfo");
    const attempts = airi.attempts as { outcome: string; at: string }[];
    expect(attempts.every((a) => a.at.slice(0, 10) === airi.started_at.slice(0, 10))).toBe(true);
    expect(attempts.filter((a) => a.outcome === "passed")).toHaveLength(1);
    expect(c.kind).toBe("paid");
    expect(c.stats).toEqual([{ v: `${b.currency} ${b.amount}`, l: "paid after the CFO's Face ID" }]);
    expect(c.stats[0]!.v).toBe("EUR 45.00");
    const fold = /<details class="fold" id="vic-attempts">[\s\S]*?<\/details>/.exec(visaPage())![0];
    expect(text(fold)).toContain(`${attempts.filter((a) => a.outcome === "passed").length} of ${attempts.length} attempts that day paid.`);
    expect(c.ids).toEqual([["Mandate", b.mandate_id], ["Payment", b.payment_intent_id]]);
  });

  it("calls the 7 November run scripted, with no Claude call, from the record; a record with a Claude request id for the rail choice names Claude and shows the id", () => {
    const rec = airiRun()!;
    // The record of 7 November: no purchase carries a rail choice by Claude (the run log: "Claude: 0 calls").
    expect(airi.purchases.some((p: { rail_choice?: unknown }) => p.rail_choice)).toBe(false);
    expect(readFileSync(new URL("../docs/runs/2026-11-07-vic-1.md", import.meta.url), "utf8")).toMatch(/\*\*Claude:\*\* 0 calls/);
    expect(AIRI_SCRIPTED).toBe("scripted, no Claude call");
    expect(airiCard(rec)!.tag).toBe("VIC via Airi · 7 Nov · scripted, no Claude call");
    expect(airiSummaryLine(rec)).toBe(`A scripted run, no Claude call: ${AIRI_SUMMARY}`);
    expect(AIRI_SUMMARY).toMatch(/within Purser's limit with no Purser approval/);
    expect(AIRI_SUMMARY).not.toMatch(/without the CFO/);
    // A later record with purchase B asked for inside the Sourcing agent's Claude call: that purchase names Claude, with
    // the request id beside the mandate and the payment; the others stay scripted. Never "chose": the prompt names the rail.
    const chosen = { ...rec, purchases: rec.purchases.map((p) => (p.step === "B" ? { ...p, rail_choice: { by: "claude" as const, model: "claude-haiku-4-5", request_id: "req_011CTest" } } : p)) };
    expect(airiSummaryLine(chosen)).toBe(`Purchase B was asked for inside the Sourcing agent's Claude call (request req_011CTest); purchases A and C scripted, no Claude call: ${AIRI_SUMMARY}`);
    const c = airiCard(chosen)!;
    expect(c.tag).toBe("VIC via Airi · 7 Nov · 1 of 3 purchases asked for in a Claude call");
    expect(c.ids).toEqual([["Mandate", expect.any(String)], ["Payment", expect.any(String)], ["Claude request", "req_011CTest"]]);
    // A Claude call with no request id is still Claude's, said so; code's own choice is scripted.
    const noId = { ...rec, purchases: rec.purchases.map((p) => ({ ...p, rail_choice: { by: "claude" as const, request_id: null } })) };
    expect(airiAsker(noId)).toEqual({ scripted: false, short: "asked for in a Claude call", sentence: "Purchase A was asked for inside the Sourcing agent's Claude call (no request id returned); purchase B was asked for inside the Sourcing agent's Claude call (no request id returned); purchase C was asked for inside the Sourcing agent's Claude call (no request id returned)" });
    expect(airiCard(noId)!.ids.map(([k]) => k)).toEqual(["Mandate", "Payment"]);
    expect(airiSummaryLine({ ...rec, purchases: rec.purchases.map((p) => ({ ...p, rail_choice: { by: "code" as const } })) })).toMatch(/^A scripted run, no Claude call:/);
    for (const r of [rec, chosen, noId]) expect(airiSummaryLine(r)).not.toMatch(/\bchose\b/);
  });

  it("builds /visa's description and \"What's real?\" line from the same words as the summary", () => {
    const page = visaPage();
    const asker = airiAsker(airiRun()!);
    expect(/<meta name="description" content="([^"]*)"/.exec(page)![1]!.replace(/&#39;/g, "'")).toMatch(new RegExp(`${asker.sentence}\\.$`));
    expect(page.replace(/&#39;/g, "'")).toContain(`(7 Nov), ${asker.short}:`);
  });

  it("reads the TAP card from the TAP run record: signatures the proxy accepted, Airwallex's approval and decline", () => {
    const c = tapCard(tapRun()!);
    const steps = tap.steps as { tap: { proxy_status: number }; airwallex: { approved: boolean; failure_reason: string | null; confirmed_by_get: { amount: string } } }[];
    const ok = steps.filter((s) => s.tap.proxy_status === 200).length;
    const yes = steps.find((s) => s.airwallex.approved)!, no = steps.find((s) => !s.airwallex.approved)!;
    expect(c.kind).toBe("tap");
    expect(c.stats).toEqual([
      { v: `${ok}/${steps.length}`, l: "signatures accepted" },
      // "EUR 45.00" everywhere (the review at 390 px, 12 Nov), never "€".
      { v: `EUR ${yes.airwallex.confirmed_by_get.amount}`, l: "approved" },
      { v: `EUR ${no.airwallex.confirmed_by_get.amount}`, l: `declined (${no.airwallex.failure_reason})` },
    ]);
    expect(c.ids).toEqual([["Visa reference verifier", `commit ${tap.reference.commit.slice(0, 7)}`]]);
    expect(c.label).toMatch(/simulated/);
  });

  it("is one card, the paid run's, linking to the run's block; the TAP run and the control test are never counted in it", () => {
    const html = visaPage(), paid = airiCard(airiRun()!)!;
    const overview = /<section class="card vo"[\s\S]*?<\/section>/.exec(html)![0];
    expect(visaOverviewHeading([paid])).toBe(VISA_SUMMARY_HEADING);
    expect(text(overview)).toMatch(/^The paid run VIC via Airi · 7 Nov · scripted, no Claude call Single-use Visa credential EUR 45\.00 paid after the CFO's Face ID/);
    expect([...overview.matchAll(/<a class="vo-run" href="#([^"]+)"/g)].map((m) => m[1]!)).toEqual(["airi-run"]);
    expect(html.indexOf(`id="${VISA_OVERVIEW_ID}"`)).toBeLessThan(html.indexOf('id="airi-run"'));
    expect(overview).not.toMatch(TAP);
    expect(text(html)).not.toMatch(/three live runs|What ran:|controls run/);
    expect(() => visaOverviewHtml([paid, tapCard(tapRun()!)])).toThrow(/TAP/);
    expect(() => visaOverviewHtml([paid, paid])).toThrow(/one paid VIC run/);
    // The control test: retitled, so nobody counts it as a second Visa run; it made no outside call, by its own record.
    expect(VIC2_HEADING).toBe("Control test of Purser's own checks, not a Visa run");
    expect(`${VIC2_HEADING} ${VIC2_LABEL}`).not.toMatch(/second|live run|separate run/i);
    expect(raw("docs/demo/vic-2-run.json").outside_calls).toMatchObject({ airi: 0, airwallex: 0 });
    expect(text(html)).toContain(`${VIC2_HEADING} (7 Nov) ${VIC2_LABEL}`);
    expect(text(html)).not.toMatch(/a second live run/);
  });

  it("leaves the card out when its record lacks the fact, and the whole summary when no record is there", () => {
    const rec = airiRun()!;
    expect(airiCard({ ...rec, purchases: rec.purchases.filter((p) => p.route !== "cfo") })).toBeNull();
    expect(visaOverviewBlock(null)).toBe("");
    expect(visaOverviewHtml([])).toBe("");
  });
});

describe("/visa is one Visa Intelligent Commerce story; TAP folded away", () => {
  const html = visaPage(), main = mainOf(html);
  const rec = raw("docs/demo/airi-run.json");

  it("names Visa Intelligent Commerce via Airi in its title and first heading, then the story in one line and the drawing from the record", () => {
    // #216 (12 Nov): every <title> reads "Purser · <Page>".
    expect(/<title>([^<]*)<\/title>/.exec(html)![1]).toBe(`Purser · ${VISA_TITLE}`);
    expect(VISA_TITLE).toBe("Visa Intelligent Commerce via Airi");
    // One h1, the first heading of the page.
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/.exec(main)![0]).toBe(`<h1>${esc(VISA_H1)}</h1>`);
    expect(VISA_H1).toMatch(/Visa Intelligent Commerce via Airi/);
    expect(`${VISA_H1} ${VISA_LEAD}`).not.toMatch(/TAP|sign/i);
    // The label beside it is the Airi run's, from its record: its date and "Airwallex sandbox · test card · test money".
    expect(visaRunLabel(airiRun()!)).toBe(`7 Nov · ${String(rec.label).split(", ").join(" · ")}`);
    expect(rec.started_at.slice(0, 10)).toBe("2026-11-07");
    const head = main.slice(0, main.indexOf("</h1>"));
    // Since the review at 390 px (12 Nov) the latest live run leads, so the label beside the heading is its date, marked latest.
    expect(text(head)).toContain(visaLatestLabel(airiRun()!, vic3Run()!.started_at));
    expect(visaLatestLabel(airiRun()!, vic3Run()!.started_at)).toBe(`13 Nov (latest) · ${String(rec.label).split(", ").join(" · ")}`);
    // 12 Nov (wire-in): the mark is Visa's official file (docs/evidence/logo-permissions.md), its name in alt.
    expect(head).toContain('<span class="logo"><img src="assets/logo-visa.png" alt="Visa" width="46" height="15"></span>');
    // The order: heading, the story, the basis, the drawing, the five facts, purchase B's table, the summary, the run,
    // the control test, the folded rows, and last the TAP fold.
    // Redesign, 13 Nov: the latest run's line, its flow, every purchase's outcome and the signed hash read back; the entry
    // and ICC lines; then the fold, which opens with the story (the four cards went: the hero says what they said).
    const order = ["</h1>", 'class="vlead"', 'id="visa-flow"', 'id="visa-outcomes"', 'id="visa-hash"', esc(VISA_ENTRY_LINE), esc(VISA_ICC_LINE), 'id="visa-details"', esc(VISA_LEAD), 'id="vic-flow"', 'id="vic-facts"', 'id="vic-compare"', `id="${VISA_OVERVIEW_ID}"`, 'id="airi-run"', 'id="airi-run-2"', 'id="vic-more"', `id="${VISA_TAP_ID}"`].map((x) => ({ x, at: main.indexOf(x) }));
    for (const o of order) expect({ x: o.x, found: o.at >= 0 }).toEqual({ x: o.x, found: true });
    expect(order.map((o) => o.at)).toEqual([...order.map((o) => o.at)].sort((a, b) => a - b));
    // The drawing's five beats, in order, each with the record's own value: the CFO's limit, the Airi mandate, the
    // cardholder's passkey, the single-use credential, the Airwallex PaymentIntent.
    const b = rec.purchases.find((p: { step: string }) => p.step === "B");
    const flow = text(/<section class="card vicflow"[\s\S]*?<\/section>/.exec(main)![0]);
    const beats = [`Limit ${b.currency} ${rec.policy.alone_max_eur}`, b.mandate_id, "Passkey in Airi", `${b.credential_type} · test card`, b.payment_intent_id].map((x) => flow.indexOf(x));
    expect(beats.every((i) => i >= 0)).toBe(true);
    expect(beats).toEqual([...beats].sort((x, y) => x - y));
  });

  it("labels steps 3 and 4 Airi and only step 5 Airi · VIC, in a neutral badge colour", () => {
    const steps = vicFlow(airiRun()!).steps;
    expect(steps.map((s) => s.who ?? s.owner)).toEqual(["Script", "purser", "airi", "airi", VIC_CREDENTIAL_WHO, "airwallex", "purser"]);
    expect(VIC_CREDENTIAL_WHO).toBe("Airi · VIC");
    const labels = [...main.matchAll(/<span class="vf-who">([^<]*)<\/span>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    expect(labels).toEqual(["Script", "Purser", "Airi", "Airi", "Airi · VIC", "Airwallex", "Purser"]);
    expect(labels.filter((l) => /VIC|Visa/.test(l))).toEqual(["Airi · VIC"]);
    // Neutral: the Airi steps take the text's own colour; no colour of their own, in light or dark.
    expect(VIC_FLOW_CSS).toContain("ol.vf > li.vf-airi { --vf-c: var(--text); }");
    expect(VIC_FLOW_CSS).not.toMatch(/--vf-airi|#be185d|#f472b6/);
  });

  // The jury check of 12 Nov: the second-hand basis sentence ("as reported by the builder") went; the record names no
  // poster's role to put in its place. The line says which runs are the entry, and nothing more.
  it("says in a visible line which runs are the Visa entry, and repeats no second-hand basis", () => {
    expect(VISA_ENTRY_LINE).toBe("The Airi runs are Purser's entry for the Visa Award.");
    expect(text(html)).not.toMatch(/as reported by the builder/);
    expect(text(unfolded(main))).toContain(VISA_ENTRY_LINE);
    // What is on record for it: the evidence list's row of 7 November, reported by the owner, with no quote from Visa.
    const row = readFileSync(new URL("../docs/evidence/README.md", import.meta.url), "utf8").split("\n").find((l) => l.startsWith("| 7 November 2026"))!;
    expect(row).toMatch(/the hackathon Slack \(Visa\), as reported by the owner/);
    expect(row).toMatch(/the VIC run counts for the Visa Award/);
    // Judge panel, 13 Nov: the 5 November row said Purser "is entered for the Metal Award only", against the README's
    // Metal and Visa. The list keeps its history, in the past tense, and says what holds since 7 November.
    const evidence = readFileSync(new URL("../docs/evidence/README.md", import.meta.url), "utf8");
    expect(evidence).not.toMatch(/is entered for the Metal Award only/);
    expect(evidence.split("\n").find((l) => l.startsWith("| 5 November 2026"))).toMatch(/until 7 November/);
    // Never more than that: nothing says Visa confirmed, certified, endorsed or approved anything.
    expect(text(html)).not.toMatch(/confirmed by Visa|Visa confirmed|certified|endorsed|approved by Visa/i);
  });

  it("says exactly where Intelligent Commerce Connect stands, once, and nowhere else on the site or in the README", () => {
    expect(VISA_ICC_LINE).toBe("We have requested Visa Intelligent Commerce Connect access; it is not used here.");
    expect(text(unfolded(main))).toContain(VISA_ICC_LINE);
    expect(text(html).split("Intelligent Commerce Connect")).toHaveLength(2);
    for (const [name, page] of Object.entries(buildPages() as unknown as Record<string, unknown>)) {
      // The phone's approval script ("client", src/approve/client.ts) carries the sentence the CFO signs for an ICC
      // proposal (src/icc/purchase.ts); it shows only for such a proposal, which needs KIT11_ICC_RAIL=on (12 Nov).
      if (typeof page !== "string" || name === "visa" || name === "client") continue;
      // The partner pages' "Built on" strip (owner, 12 Nov; test/t0-page.test.ts) ends with its one ICC note, the same
      // state in short ("access requested, not used in this entry"): left out here, and nothing else may name ICC.
      expect({ name, icc: /Intelligent Commerce Connect|\bICC\b/.test(page.replace(esc(ICC_LINE), " ")) }).toEqual({ name, icc: false });
    }
    expect(readFileSync(new URL("../README.md", import.meta.url), "utf8")).not.toMatch(/Intelligent Commerce Connect|\bICC\b/);
  });

  it("names TAP only inside one closed fold, the last thing on the page, labelled as outside the entry", () => {
    const tapAt = main.indexOf(`<details class="fold" id="${VISA_TAP_ID}">`);
    expect(tapAt).toBeGreaterThan(-1);
    expect(text(main.slice(0, tapAt))).not.toMatch(TAP);
    // Closed, and one fold: nothing inside it is folded again.
    const fold = main.slice(tapAt, main.lastIndexOf("</details>") + "</details>".length);
    expect(fold.match(/<details\b/g)).toHaveLength(1);
    expect(fold).not.toMatch(/<details\b[^>]*\bopen\b/);
    expect(text(main.slice(tapAt + fold.length))).toBe("");
    // Its line, then at once the status, word for word (Visa, 5 Nov), then the TAP run's card and picture.
    expect(VISA_TAP_HEADING).toBe("Outside the entry: Visa TAP");
    expect(/<summary>([^<]*)<\/summary>/.exec(fold)![1]).toBe(VISA_TAP_HEADING);
    expect(text(fold).startsWith(`${VISA_TAP_HEADING} ${VISA_TAP_STATUS}`)).toBe(true);
    expect(VISA_TAP_STATUS).toContain("not eligible Visa tooling for this hackathon (Visa, 5 Nov)");
    expect(fold.indexOf('class="vo-run tap"')).toBeGreaterThan(fold.indexOf(esc(VISA_TAP_STATUS)));
    expect(fold.indexOf('class="flow card"')).toBeGreaterThan(fold.indexOf('class="vo-run tap"'));
    expect(main.match(/class="vo-run tap"/g)).toHaveLength(1);
    expect(text(fold)).toMatch(/commit 16d59bd/);
    // With every fold shut, the only TAP on the whole page (footer included) is that fold's own line.
    const shut = text(unfolded(html));
    expect(shut.match(/\bTAP\b/g)).toHaveLength(1);
    expect(shut).toContain(VISA_TAP_HEADING);
    // Every VIC block is above it.
    for (const id of ["vic-flow", "vic-facts", "vic-compare", VISA_OVERVIEW_ID, "airi-run", "airi-run-2", "vic-more"]) expect({ id, above: main.indexOf(`id="${id}"`) < tapAt && main.indexOf(`id="${id}"`) >= 0 }).toEqual({ id, above: true });
  });

  it("cites docs/demo/airi-run.json in its footer, with no main-run paragraph", () => {
    // The shared "Built on" strip aside: each of its figures names its own run (jury, 13 Nov), the main run's among them.
    const foot = text(html.slice(html.indexOf("</main>")).replace(/<ul class="builton">[\s\S]*?<\/ul>/, " "));
    expect(foot).toContain(`Source: ${AIRI_RUN_FILE} (the Airi run)`);
    expect(foot).toMatch(/Visa Intelligent Commerce via Airwallex's Airi \(7 Nov\), scripted, no Claude call: Airwallex sandbox, test card, test money\./);
    for (const line of MAIN_RUN_REAL) expect({ line, there: foot.includes(line) }).toEqual({ line, there: false });
    expect(foot).not.toMatch(/main run|3 Nov|Northwind Outdoor is|real Claude decisions/i);
    expect(foot).not.toMatch(TAP);
  });

  it("fails the page build when the story is lost: TAP above or open, the status dropped, the old heading, the basis or the Connect line gone, a second run counted", () => {
    expect(() => assertVicFirst(html)).not.toThrow();
    const fold = main.slice(main.indexOf(`<details class="fold" id="${VISA_TAP_ID}">`), main.lastIndexOf("</details>") + "</details>".length);
    expect(fold.length).toBeGreaterThan(200);
    // The TAP fold moved above the Airi run.
    const moved = html.replace(fold, "").replace('<div class="awrb"><div class="card airi" id="airi-run">', `${fold}<div class="awrb"><div class="card airi" id="airi-run">`);
    expect(moved).not.toBe(html);
    expect(() => assertVicFirst(moved)).toThrow(/last thing|TAP/);
    // The fold open on arrival.
    expect(() => assertVicFirst(html.replace(`<details class="fold" id="${VISA_TAP_ID}">`, `<details class="fold" id="${VISA_TAP_ID}" open>`))).toThrow(/TAP/);
    // A TAP word in the top, or in the footer.
    expect(() => assertVicFirst(html.replace(esc(VISA_LEAD), `${esc(VISA_LEAD)} Signed with TAP.`))).toThrow(/TAP is named above/);
    expect(() => assertVicFirst(html.replace("<li>Source: ", "<li>The TAP extra. Source: "))).toThrow(/footer/);
    // The status dropped from the head of the fold.
    expect(() => assertVicFirst(html.replace(`<p class="claim">${esc(VISA_TAP_STATUS)}</p>`, ""))).toThrow(/status/);
    // The old headings.
    expect(() => assertVicFirst(html.replace(`<h1>${esc(VISA_H1)}</h1>`, "<h1>The agent signs before it pays</h1>"))).toThrow(/heading/);
    expect(() => assertVicFirst(html.replace(`<title>Purser · ${esc(VISA_TITLE)}</title>`, "<title>Visa</title>"))).toThrow(/title/);
    // The basis or the Connect line gone, or Connect claimed a second time.
    expect(() => assertVicFirst(html.replace(esc(VISA_ENTRY_LINE), ""))).toThrow(/entry line/);
    expect(() => assertVicFirst(html.replace(esc(VISA_ICC_LINE), ""))).toThrow(/Intelligent Commerce Connect/);
    expect(() => assertVicFirst(html.replace(esc(VISA_LEAD), `${esc(VISA_LEAD)} Built with Intelligent Commerce Connect.`))).toThrow(/more than once/);
    // The old overview, which counted the TAP run and the run that bought nothing as "three live runs".
    expect(() => assertVicFirst(html.replace(`>${VISA_SUMMARY_HEADING}</h2>`, ">Visa in Purser: three live runs</h2>"))).toThrow(/summary/);
    // The footer without the record.
    expect(() => assertVicFirst(html.replace(`Source: ${AIRI_RUN_FILE}`, "Source: the main run"))).toThrow(/footer/);
  });
});

describe("the Visa entry on the rest of the site", () => {
  const home = homePage(), proof = proofPage(), airwallex = airwallexPage(), visa = visaPage();

  it("drops \"Extra, not an award entry\" from Home and /proof: no footer link, and the constant is gone", () => {
    // The footer's Built on list links /visa on every page since #216; the old "Extra" link is what must stay gone.
    for (const [name, html] of Object.entries({ home, proof })) expect({ name, extra: /Extra, not an award entry/.test(html), flink: /<a class="flink" href="visa">(?!Visa \(VIC)/.test(html) }).toEqual({ name, extra: false, flink: false });
    expect("VISA_EXTRA_LINK" in brand).toBe(false);
  });

  // Since 12 Nov "Built on" is one strip in the partner pages' footer, not on Home (the owner; src/redesign/partners.ts,
  // builtOnItems): Home is one story and has none. Visa stands in it as text, on the VIC run, never TAP, never a logo.
  it("puts Visa (VIC through Airwallex's Airi) in the partner pages' \"Built on\", as text; the flag is renamed and TAP is never in it", () => {
    expect(VISA_VIC_BUILT_ON).toBe(true);
    expect("VISA_AWARD_ON" in brand).toBe(false);
    expect(VISA_BUILT_ON).toBe("Visa (VIC via Airi)");
    // #216: the list is in every page's footer, never in <main>.
    expect(/<main[\s\S]*<\/main>/.exec(home)![0]).not.toMatch(/<div class="built">|class="builton"/);
    const built = /<ul class="builton">[\s\S]*?<\/ul>/.exec(airwallex)![0];
    // The latest run's own count first, as /visa leads with it, then the purchases paid across the live Airi runs (the
    // jury check, 12 Nov; the jury, 13 Nov: the two read as a clash without the run named).
    expect(built).toMatch(/<a class="flink" href="visa">Visa \(VIC through Airwallex's Airi\): \d+ paid in the \d{1,2} [A-Z][a-z]{2} run \(\d+ paid across \d+ live Visa runs\)<\/a>/);
    expect(built).not.toMatch(/TAP|<img[^>]*visa/i);
  });

  it("calls the 7 November run scripted wherever it appears: /visa, /airwallex, /proof and the README; nowhere \"Agents paid with a single-use Visa\"", () => {
    const line = airiSummaryLine(airiRun()!);
    for (const [name, html] of Object.entries({ visa, airwallex, proof })) expect({ name, scripted: text(html).includes(line) }).toEqual({ name, scripted: true });
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\s+/g, " ");
    // The README of 12 Nov (#185) names the 7 November Airi run in one table row: it says the purchase was scripted, with
    // no model call. Any README line that names that run says so.
    // Since the final review (13 Nov) that row is in docs/in-depth.md, "What ran live, one id per rail", which the README links.
    const lines = ["../README.md", "../docs/in-depth.md"].flatMap((f) => readFileSync(new URL(f, import.meta.url), "utf8").split("\n")).filter((l) => /7 November/.test(l) && /Airi/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const l of lines) expect({ l: l.slice(0, 80), scripted: /scripted (?:run, no Claude call|purchase with no model call)/.test(l) }).toEqual({ l: l.slice(0, 80), scripted: true });
    expect(readme).not.toMatch(/a second live run|second run \(vic-2\)/i);
    expect(readFileSync(new URL("../llms.txt", import.meta.url), "utf8")).toMatch(/a scripted run, no Claude call/);
    for (const [name, t] of Object.entries({ readme, ...(buildPages() as unknown as Record<string, unknown>) })) {
      if (typeof t === "string") expect({ name, old: /Agents paid with a single-use Visa/.test(t) }).toEqual({ name, old: false });
    }
  });

  it("renamed the award note and wrote the dated resolution into the plans", () => {
    expect(existsSync(new URL("../docs/submission/visa-award-pending.md", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../docs/submission/visa-award.md", import.meta.url))).toBe(true);
    for (const f of ["docs/plans/vic-airi.md", "docs/runs/vic-1-plan.md"]) {
      const t = readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\s+/g, " ");
      expect({ f, resolved: /Resolved \(12 November 2026\)/.test(t) && /7 November/.test(t) && /scripted/.test(t) }).toEqual({ f, resolved: true });
    }
  });
});

describe("only the Sourcing agent signed with TAP", () => {
  const main = mainOf(visaPage());

  it("says only the Sourcing agent signed with TAP: the claim, the README, the form texts, llms.txt and the claims list", () => {
    expect(VISA_CLAIM).toBe("Visa: the Sourcing agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the merchant is ours.");
    // Only the Sourcing agent ran TAP live: the TAP run's card and every step's origin are the Sourcing agent's, and so
    // is the key of the main run's own TAP-signed buy.
    const tap = raw(tapRun()!.file) as { card: { agent: string }; steps: { origin: { agent: string } }[] };
    expect([...new Set([tap.card.agent, ...tap.steps.map((s) => s.origin.agent)])]).toEqual(["sourcing"]);
    expect(ownTap(loadRecord().record)!.keyId).toMatch(/^sourcing-/);
    expect(main).toContain(esc(VISA_CLAIM));
    const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\s+/g, " ");
    for (const f of ["README.md", "llms.txt", "docs/claims.md", "docs/submission/README.md", "docs/submission/long-description.md"]) {
      const t = read(f);
      // "each agent signs … with TAP" and "our agents sign … TAP" only where a "Was" note quotes the old wording.
      const stale = [...t.matchAll(/(each agent signs|every agent signs|our agents sign)[^.|]{0,160}(TAP|Trusted Agent Protocol)/gi)].filter((m) => !/\bWas\b[^|]{0,400}$/.test(t.slice(Math.max(0, m.index - 400), m.index)));
      expect({ f, stale: stale.map((m) => m[0]) }).toEqual({ f, stale: [] });
    }
    // The README of 12 Nov (#185) no longer carries the claim itself: it links the TAP note in the long description, which
    // says it word for word.
    expect(read("docs/submission/long-description.md").replace(/\*\*/g, "").includes(VISA_CLAIM)).toBe(true);
    expect(read("README.md")).toContain("(docs/submission/long-description.md#visa)");
  });
});
