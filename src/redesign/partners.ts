// The partner pages in the redesign's style (mega-prompt v4, C1): /metal, /airwallex, /visa, /claude. Each is short
// (about 150 visible words at most): a picture of the flow first, three or four numbers, one sentence, and everything
// else folded (<details>): the live proof from the main run (the same list as Proof's card), the docs we built on, what
// is simulated. /airwallex also carries Airwallex read back (section B, 6 Nov; src/redesign/airwallexProof.ts): the hash
// the CFO signed beside the one Airwallex returns with the payment, and each card's controls beside the CFO policy; and
// below them awx-1 (7 Nov, src/redesign/awxRun.ts), the separate Airwallex-only run, dated, every step folded.
// Every figure from the record (src/redesign/run.ts), the TAP run's record or the read-back records; logos only as "built on",
// never a Visa logo. No script. Also the clean 404 page.
// /visa is one story since 12 Nov (visaPage; jury panel the same day): Visa Intelligent Commerce via Airi. The title and
// the heading name it; under them which runs are the entry and the exact
// state of Intelligent Commerce Connect; then the drawing of purchase B, what the sandbox could not show (five lines),
// purchase B side by side, one summary of the paid run, the run in full, the control test, and folded rows. All TAP
// material sits in one closed fold at the very end, labelled as outside the entry (Visa, 5 Nov: TAP is not Visa tooling
// for this hackathon). assertVicFirst fails the page build if any of that is lost.

import { altaFacts, altaFactsHtml, altaTilesHtml, ALTA_FACTS_CSS, ALTA_FACTS_ID, ALTA_TILES_CSS, NO_ENDORSEMENT_ALTA } from "./altaFacts.js";
import { ALTA_SCENE_CSS, altaArchHtml, altaScene, altaSceneHtml } from "./altaScene.js";
import { ALTA_FIRST, quotedNote } from "../ui/formerly.js";
import { WATCH_IN_MENU } from "../config/film.js";
import { existsSync, readFileSync } from "node:fs";
import { AIRI_CREDENTIAL, SANDBOX_SETTLED, VISA_CLAIM, VISA_ICC_LINE, VISA_TAP_STATUS } from "../config/brand.js";
import { airwallexData } from "../partners/data.js";
import { agentRun, callBadge, cardRaiseOf, decisionsOf, faceIdDecisions, family, fxOf, ownTap, payments, split, tapRun, timings, type AgentRun, type Ev } from "./run.js";
import { PROOF_FIRST_CSS, proofFirstHtml, visaFirstFacts, visaLimitsLine } from "./proofFirst.js";
import { VISA_REUSE_ID } from "./visaStory.js";
import { ENDORSE_NOTE, LOGO, earlierLine, fold, partnerProof } from "./proof.js";
import { EXPLORER, REPO_BLOB, metalStory } from "./metalStory.js";
import { READBACK_CSS, cardControlRows, cardsReadback, controlsSideBySideHtml, hashBlockHtml, hashTravel } from "./airwallexProof.js";
import { centHtml, centRecord, LIVE_CARDS_JS, liveCardsHtml } from "./cardCent.js";
import { AIRI_CSS, AIRI_RUN_FILE, AIRI_RUN_LOG, AIRI_RUN_ID, airiAsker, airiRun, airiRunBlock, type AiriRunRecord } from "./airiRun.js";
import { awxRunBlock } from "./awxRun.js";
import { VISA_HERO_CSS, visaFlowHtml, visaHashHtml, visaOutcomesHtml } from "./visaHero.js";
import { VIC3_RUN_FILE, VIC3_RUN_LOG, VIC_LATER_FILES, vic3Lead, vic3Run, vic3RunHtml, vic3Summary } from "./vic3Run.js";
import { COUNT_JS, STATS_CSS } from "./stats.js";
import { PLATFORM_RUN_FILE, PRODUCTS_CSS, airwallexBody, airwallexDescription, productTiles, tilesCountWords } from "./airwallexProducts.js";
import { CARD_DATA_CSS, cardDataHtml } from "./cardData.js";
import { ICC_RUN_ID, iccBlock, iccRecordIn } from "./iccBlock.js";
import { VIC2_RUN_FILE, vic2Run, vic2RunBlock } from "./vic2Run.js";
import { VIC_FACTS_CSS, VIC_FACTS_ID, vicAttemptsHtml, vicCompare, vicCompareHtml, vicFacts, vicFactsHtml } from "./vicFacts.js";
import { VIC_FLOW_CSS, VIC_FLOW_ID, vicFlowBlock } from "./vicFlow.js";
import { VIC_NETWORK_CSS, vicNetworkBlock, vicNetworkRecord } from "./vicNetwork.js";
import { VIC_RULES_CSS, vicRulesBlock } from "./vicRules.js";
import { VISA_ASKS_ID, VISA_MEETS_ID, VISA_PLAN_FILE, VISA_RUNS3_ID, VISA_STORY_CSS, VISA_TAP_SECTION_HEADING, visaAsksHtml, visaMeetsHtml, visaNotYetHtml, visaReuseHtml, visaTapSectionHtml, visaThreeRunsHtml } from "./visaStory.js";
import { GUARD_FILE, GUARD_TEST, VISA_CARD_SCENE_CSS, VISA_CARD_SCENE_JS, cardSceneData, visaCardSceneHtml } from "./visaCardScene.js";
import { VISA_CARD_HERO_CSS, visaArchHtml, visaCardHeroHtml, visaCardScene } from "./visaCardHero.js";
import { ARCH_CSS } from "./altaScene.js";
import { VISA_OVERVIEW_CSS, VISA_OVERVIEW_ID, VISA_SUMMARY_HEADING, VISA_TAP_ID, tapCardHtml, visaOverviewBlock } from "./visaOverview.js";
import { tokenizeRun, tokenizeRunBlock, type TokenizeRun } from "./tokenizeRun.js";
import { METAL_ONCHAIN_CSS, faceIdOnChainSection } from "./metalOnchain.js";
import { HOLD_NOT_FINISHED, METAL_CSS, METAL_HOLD_RECORD, METAL_INSPECT_JS, holdState, metalBody } from "./metalMandates.js";
import { EVIDENCE_CSS, claudeEvidence, failureFold, mcpFold, newestHeldOut, sweepFold } from "./claudeEvidence.js";
import { CLAUDE_CSS, HELD_OUT_CSS, IN_PRODUCT_CSS, claudeMain } from "./claudePage.js";
import { BOOKS_CSS, BOOKS_JS, MONEYBIRD_RECORD, RUN_FILE, booksBody, booksData } from "./booksPage.js";
import { T0_CLOSE_JS, t0RunData } from "./t0CloseTile.js";
import { T0_CSS, T0_JOURNAL_RECORD, T0_READBACK_RECORD, t0Data, t0SectionHtml } from "./t0Page.js";
import { RAILS_FILE, railsHtml } from "./booksLedger.js";
import { OPEN_TARGET_JS, esc, icon, page, pageTitle, setBuiltOn, TRY_URL, withRec } from "./ui.js";
import { EVIDENCE_WALL_CSS, evidenceLeadHtml, evidenceStripHtml, notLiveLine } from "./evidenceWall.js";

const CSS = `.pp { padding: 26px 0 24px; }
.pp .wrap { max-width: 1040px; display: grid; gap: 18px; }
.phd { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.phd .noend { font-size: 13px; color: var(--muted); }
.phd h1 { font-size: clamp(30px, 4vw, 48px); font-weight: 780; letter-spacing: -.03em; flex: 1 1 100%; }
.logo { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid var(--border); flex: none; }
.logo.dark { background: #191919; border-color: #191919; } .logo img { display: block; height: 15px; width: auto; }
.logo.tname { font-weight: 700; font-size: 15px; color: #111827; }
.logo.txt { background: var(--surface); color: var(--text); font-weight: 750; font-size: 14px; white-space: nowrap; }
.flow { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; padding: 18px; }
.node { flex: 1 1 150px; display: grid; gap: 4px; align-content: start; padding: 14px; border-radius: 16px; background: var(--sunken); min-width: 0; }
.node .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--surface); color: var(--accent); }
.node b { font-size: 16px; line-height: 1.3; } .node span { font-size: 15px; color: var(--muted); line-height: 1.35; }
.node.ok .ic { color: var(--ok); } .node.bad .ic { color: var(--bad); } .node.metal .ic { color: var(--metal); } .node.awx .ic { color: var(--awx); } .node.claude .ic { color: var(--claude); }
.arrow { display: grid; place-items: center; color: var(--faint); flex: none; }
@media (max-width: 700px) { .flow { flex-direction: column; padding: 12px; gap: 4px; } .arrow { transform: rotate(90deg); height: 22px; }
  .node { flex: none; grid-template-columns: 40px minmax(0, 1fr); column-gap: 12px; align-items: center; padding: 10px 12px; } .node .ic { grid-row: span 2; } }
.nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 800px) { .nums { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.num { padding: 16px 18px; display: grid; gap: 2px; }
.num .v { font-size: clamp(28px, 3vw, 38px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.num .l { font-size: 15px; font-weight: 650; color: var(--muted); line-height: 1.3; }
.line { margin: 0; font-size: clamp(18px, 1.8vw, 21px); font-weight: 600; max-width: 44em; }
.claim { margin: 0; font-size: 16px; line-height: 1.5; border-left: 4px solid var(--accent); padding: 4px 0 4px 12px; max-width: 52em; }
.folds { padding: 6px 20px 12px; }
.vintro { margin: 0; font-size: clamp(17px, 1.7vw, 19px); font-weight: 620; line-height: 1.45; max-width: 46em; }
.vbasis { margin: 0; font-size: 15px; line-height: 1.5; color: var(--muted); max-width: 52em; }
details.fold { border-top: 1px solid var(--border); padding-top: 6px; } details.fold:first-child { border-top: 0; }
details.fold > summary { cursor: pointer; font-weight: 650; font-size: 16px; color: var(--accent); list-style: none; display: flex; align-items: center; gap: 6px; min-height: 44px; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::after { content: "▾"; font-size: 14px; } details.fold[open] > summary::after { content: "▴"; }
ul.pl { list-style: none; margin: 6px 0 10px; padding: 0; display: grid; gap: 8px; }
ul.pl li { font-size: 15.5px; line-height: 1.45; border-left: 3px solid var(--border); padding-left: 11px; overflow-wrap: anywhere; }
ul.pl li.no { border-left-color: var(--bad); } ul.pl li.ok { border-left-color: var(--ok); } ul.pl li.face { border-left-color: var(--accent); }
ul.pl small { display: block; color: var(--faint); font-size: 14px; }
ul.pl code { font: 600 14.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
ul.pl .call { margin-top: 4px; }
abbr[title] { text-decoration: underline dotted; text-underline-offset: 3px; }
a.pf { color: var(--accent); font-weight: 600; text-decoration: none; font-size: 15px; }
.open { font-size: 16px; font-weight: 650; color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
h2.vsec { font-size: clamp(22px, 2.2vw, 28px); font-weight: 750; margin: 18px 0 0; scroll-margin-top: 80px; }
details.fold > .flow.card, details.fold > .claim, details.fold > .vo-run, details.fold > .phd { margin: 0 0 12px; }
details.fold > p.src { color: var(--faint); font-size: 14px; overflow-wrap: anywhere; }
.nf { padding: 64px 0; } .nf .wrap { display: grid; gap: 16px; justify-items: start; } .nf h1 { font-size: clamp(34px, 5vw, 56px); font-weight: 800; }
.nf .tabs2 { display: flex; flex-wrap: wrap; gap: 10px; }
${READBACK_CSS}
${AIRI_CSS}
${VIC_FLOW_CSS}
${VISA_OVERVIEW_CSS}
${VISA_CARD_SCENE_CSS}
${VIC_NETWORK_CSS}
${VIC_RULES_CSS}
${CARD_DATA_CSS}
${VIC_FACTS_CSS}`;

/** A page's body with `html` put right after its heading block (the first <div class="phd">…</h1></div>). */
const afterHeading = (body: string, html: string) => {
  if (!html) return body;
  const at = body.indexOf("</h1></div>", body.indexOf('<div class="phd'));
  return at < 0 ? body : `${body.slice(0, at + "</h1></div>".length)}\n  ${html}${body.slice(at + "</h1></div>".length)}`;
};
const readJsonOr = <T>(p: string): T | null => { try { return JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as T; } catch { return null; } };

const SOURCE = (run: AgentRun) => `Source: ${run.file} (${run.name}); the card run from ${tapRun()?.file ?? "docs/runs"}.`;
const node = (ic: string, title: string, sub: string, tone = "") => `<div class="node ${tone}"><span class="ic">${icon(ic, 22)}</span><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
const arrow = `<span class="arrow" aria-hidden="true">${icon("arrow-right", 22)}</span>`;
const docsLi = (title: string, docs: { label: string; href: string }[]) => `<li>${esc(title)}: ${docs.map((d) => `<a class="pf" href="${esc(d.href)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join(" · ")}</li>`;
const plainLi = (t: string) => `<li>${esc(t)}</li>`;

const moneyOf = (run: AgentRun) => run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");

const ext = (p: { label: string; href: string | null }, label = p.label) => p.href ? `<a class="pf" href="${esc(p.href)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : "";

/**
 * Every Alta transaction of the main run, one line each (review 9 Nov: "86 payments, each its own transaction" could not
 * be clicked one by one). From the trace derived from the main run's ledger (docs/demo/main-run-trace.json), which the
 * tests hold to the record; no chain call.
 */
/** The main run's Alta transactions as a list on GitHub (made by metalTxList(), held to the trace by its test). */
export const METAL_TX_LIST = "docs/runs/2026-11-03-main-run-metal-transactions.md";
/** That list as Markdown. */
export function metalTxList(): string {
  const txs = metalTxs();
  return `# The main run's ${txs.length} Metal transactions (3 November 2026)\n\nEvery Metal payment of the main run, one line each, with its link to Metal's testnet explorer. Derived from\n[the trace](../demo/main-run-trace.json) of the main run's ledger; each one is also checked against the chain in\n[the data check](2026-11-03-main-run-data-qa.md). Test money only. Made by \`metalTxList()\` in \`src/redesign/partners.ts\`.\n\n${txs.map((t, i) => `${i + 1}. ${t.what}: [\`${t.tx}\`](${EXPLORER}/tx/${t.tx})`).join("\n")}\n`;
}

export function metalTxs(): { what: string; tx: string }[] {
  const trace = JSON.parse(readFileSync(new URL("../../docs/demo/main-run-trace.json", import.meta.url), "utf8")) as { payments: { kind: string; ref: string; amount: string; currency: string; rail: string; rail_id: string | null; at: string }[] };
  const word: Record<string, string> = { sale: "Sale", purchase: "Supplier purchase", refund: "Refund", sweep: "Sweep" };
  return trace.payments.filter((p) => p.rail === "metal" && typeof p.rail_id === "string" && /^0x[0-9a-f]{64}$/.test(p.rail_id))
    .map((p) => ({ what: `${word[p.kind] ?? p.kind} ${/^\d+$/.test(p.ref) ? `#${p.ref}` : p.ref}, ${p.amount} test ${p.currency === "USDZ" ? "USD" : p.currency}, ${p.at.slice(11, 19)} UTC`, tx: p.rail_id! }));
}

/**
 * `tokenize`: the invoice-token run's record (src/redesign/tokenizeRun.ts). Without one (no live run recorded) the
 * page is byte for byte what it was; with one, one short block follows the main run's proof.
 */
export function metalPage(run: AgentRun = agentRun(), tokenize: TokenizeRun | null = tokenizeRun()): string {
  const metal = JSON.parse(readFileSync(new URL("../../docs/demo/metal.json", import.meta.url), "utf8")) as { features: { title: string; docs: { label: string; href: string }[] }[] };
  // The features' titles and doc labels are our own words, recorded in docs/demo/metal.json before Metal renamed itself
  // Alta (14 Nov): shown under the new name; the file keeps the old one.
  const alta = (t: string) => t.replace(/\bMetal\b/g, "Alta");
  const used = metal.features.filter((f) => /mandate per agent|Replace and revoke|x402|facilitator|Refunds as mandate|Sweep after finality|Four eyes/i.test(f.title))
    .map((f) => ({ ...f, title: alta(f.title), docs: f.docs.map((d) => ({ ...d, label: alta(d.label) })) }));
  // One honest story (jury panel, 12 Nov; src/redesign/metalMandates.ts): the four mandates with their spend, read live
  // by the read-only inspector or labelled as recorded; the payments; the refusal as it ran; who signed on chain; what
  // else ran on Alta, each dated, the unfinished hold said as such. The live proof's fold keeps every line but one:
  // "A mandate per agent, on chain" states the end terms beside the first bind's link; the table links each term's own
  // transaction instead.
  const p = partnerProof(run), pay = payments(run.record), story = metalStory(run.record);
  const folds = fold("The live proof, with every tx", [...(pay.sums && pay.onChain === story.payments.total ? [plainLi(`${pay.line}.`)] : []), ...p.metal.filter((li) => !li.includes("A mandate per agent, on chain"))])
    + fold(`All ${metalTxs().length} transactions`, [`<li>${ext({ label: "Each with its link to the explorer", href: `${REPO_BLOB}${METAL_TX_LIST}` })}</li>`])
    + fold("The Alta features we use, and their docs", used.map((f) => docsLi(f.title, f.docs)))
    + fold("What is simulated", [plainLi("Test money on Alta testnet only (*USDZ)."), plainLi("Stockline, the supplier, and Summit, the customer whose agent buys from us, are simulated; their payments are real testnet transactions."),
      plainLi("The second approver on the mandate change is a labelled test passkey; in production it is a second person."), plainLi("Passkeys as the account's owners ran on 1 November with software passkeys, not a phone."), ...(holdState(readFileSync(new URL(`../../${METAL_HOLD_RECORD}`, import.meta.url), "utf8"))?.finished === false ? [plainLi(`${HOLD_NOT_FINISHED}.`)] : [])])
    + fold("Archive", [`<li><a class="pf" href="metal/report">The Dispute desk's evidence report (30 October)</a></li>`]);
  // The opening (Metal Award, 15 Nov): three facts with their explorer links and records, then the main run's count.
  // 21 Nov (the owner, Max: "Our Kit 11 point is: a supplier raises its price, and you see it refused on chain. That has
  // to go at the top, not so much text."): the main run's price rise as one scene on top (src/redesign/altaScene.ts),
  // the three facts of the Metal Award (15 Nov) as short proof tiles under it, then the architecture. Their full text,
  // the main run's count, the "Live on Alta" strip (19 Nov), the passkeys on chain and the invoice token are folded below,
  // each with its transactions and records.
  const facts = altaFacts(), scene = altaSceneHtml(altaScene(run.record));
  const full = altaFactsHtml(facts, { count: metalTxs().length, list: METAL_TX_LIST }).replace(`id="${ALTA_FACTS_ID}"`, `id="${ALTA_FACTS_ID}-full"`).replace(/ id="fact-/g, ' id="factfull-');
  const strip = evidenceStripHtml("alta");
  const more = (full ? `<details class="fold" id="alta-facts-more"><summary>${esc("The three facts in full, and the main run's count")}</summary>${full}</details>` : "")
    + (strip ? `<details class="fold" id="alta-live"><summary>${esc("Live on Alta: six tiles from the evidence wall")}</summary>${strip}</details>` : "")
    + `<details class="fold" id="alta-onchain"><summary>${esc("Separate runs on Alta, each with its record")}</summary>${faceIdOnChainSection()}${tokenize ? `\n  ${tokenizeRunBlock(tokenize)}` : ""}</details>`;
  const body = metalBody(run.record, { logo: LOGO.metal, logoNote: NO_ENDORSEMENT_ALTA, intro: altaTilesHtml(facts), label: run.label, folds, proofHash: "metal",
    scene, lead: `Each agent's limit is a mandate on ${ALTA_FIRST}. Over the cap, the chain refuses the payment.`, arch: altaArchHtml(), more });
  return page({ title: "Alta", description: "How Purser uses Alta: each agent's limit is a mandate on chain; when a supplier raised its price over the cap, Alta refused the payment on chain.", tab: "metal", css: `${CSS}\n${EVIDENCE_WALL_CSS}\n${METAL_CSS}\n${METAL_ONCHAIN_CSS}\n${STATS_CSS}\n${ALTA_FACTS_CSS}\n${ALTA_TILES_CSS}\n${ALTA_SCENE_CSS}\n.mlead { margin: -6px 0 0; font-size: clamp(17px, 1.7vw, 19px); font-weight: 600; max-width: 44em; }`, body, source: SOURCE(run), js: METAL_INSPECT_JS + COUNT_JS + OPEN_TARGET_JS, stage: false, builtOn: builtOnHtml(run) });
}

export function airwallexPage(run: AgentRun = agentRun()): string {
  const p = partnerProof(run), money = moneyOf(run);
  const booked = money.find((e) => e.via === "deposit" && e.dir === "in");
  const licence = money.find((e) => e.via === "SWIFT" && !e.refused);
  const fx = fxOf(run.record), t = timings(run.record);
  const eur = licence ? `€${licence.amount.replace(/\.00$/, "")}` : "";
  // Airwallex, read back (section B): the CFO's hash with the payment, and each card's controls beside the CFO policy.
  const hash = hashTravel(run.record), cards = cardsReadback(), rows = cards ? cardControlRows(run.record, cards) : [];
  // One story about Airwallex's own products (jury panel, 12 Nov; src/redesign/airwallexProducts.ts): a tile per product
  // on top, each from its own run's record; the hash block under them; everything else folded. The main run's flow
  // (Alta earnings booked, the licence paid) is one of the folds, as are awx-1 and the Airi runs, in the blocks /proof
  // and /visa show. Proof's "Policy and card side by side" opens the cards' fold (#controls, or #card-<agent>).
  const body = airwallexBody(run, {
    logo: LOGO.airwallex + ENDORSE_NOTE, proofHash: "airwallex", hash: hashBlockHtml(hash), controls: liveCardsHtml() + centHtml(centRecord()) + (cards ? controlsSideBySideHtml(rows, cards.rec.read_at, cards.file) : ""),
    awx1: awxRunBlock(), airi: airiRunBlock() + vic2RunBlock(undefined, { short: true }),
    picture: [node("zap", "Alta earnings", "final on chain", "metal"), arrow, node("landmark", booked ? `${booked.amount} USD booked` : "Booked at Airwallex", "simulated deposit", "awx"), arrow,
      node("scan-face", "CFO · Face ID", "approves the invoice"), arrow, ...(fx ? [node("arrow-left-right", `${fx.buy} by FX`, "only the shortfall", "awx"), arrow] : []),
      node("circle-check", licence ? `${eur} by SWIFT, accepted` : "SWIFT, accepted", licence ? `Airwallex accepted it with the signed hash; ${SANDBOX_SETTLED}` : "", "ok")].join(""),
    mainProof: p.airwallex, deposit: booked?.amount ?? null, depositDocs: airwallexData().features.find((f) => f.id === "deposit")?.docs ?? [],
    simulated: [...(licence ? [`The SWIFT payout's settlement: Purser moves the sandbox transfer to SENT, then PAID, through Airwallex's simulation API${t.faceToPaid !== null ? `; the ${t.faceToPaid} s are measured from the CFO's Face ID to PAID` : ""}.`] : []),
      ...money.filter((e) => e.earlier).map((e) => earlierLine(e))],
  });
  // 19 Nov (the owner: "the evidence where judges look"): the wall's Airwallex tiles under the heading, and the one
  // endpoint not live with its reason, from the coverage report and its live record.
  const strip = evidenceStripHtml("airwallex", { note: notLiveLine(readJsonOr("docs/evidence/airwallex-api-coverage.json"), readJsonOr("docs/runs/2026-11-19-airwallex-coverage.json")) });
  // Under the heading's path of products and its charts, before the product cards (the first screen stays about
  // Airwallex's products: test/browser/pages.check.ts; the path and charts stay one block: test/airwallex-visual.test.ts).
  const cardsAt = body.indexOf('id="awg-on"');
  const at = cardsAt < 0 ? -1 : body.lastIndexOf("<", cardsAt);
  const withStrip = at < 0 || !strip ? afterHeading(body, strip) : `${body.slice(0, at)}${strip}\n  ${body.slice(at)}`;
  // 19 Nov (the owner: "lead with the strongest live-proven result"): the wall's five strongest Airwallex figures as one
  // row of chips right under the heading, each linked to its record; the path of products follows, still on the first
  // screen at 390 px (test/browser/pages.check.ts).
  const led = afterHeading(withStrip, evidenceLeadHtml("airwallex"));
  return page({ title: "Airwallex", description: airwallexDescription(run), tab: "airwallex", css: `${CSS}\n${PRODUCTS_CSS}\n${EVIDENCE_WALL_CSS}`, body: led, source: SOURCE(run), js: OPEN_TARGET_JS + COUNT_JS + LIVE_CARDS_JS, stage: false, builtOn: builtOnHtml(run) });
}

/**
 * The separate TAP run's labels as /visa shows them under the main run's label (final review, 4 Nov). Its "No approval
 * was asked for or given in this run" was read as the main run's, where the card buy came after the CFO's Face ID on
 * the card raise; the labels only the TAP run had (Visa's reference proxy and registry) say so.
 */
export function visaLabels(run: AgentRun, tap: NonNullable<ReturnType<typeof tapRun>>): string[] {
  const own = ownTap(run.record), raise = cardRaiseOf(run.record);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(tap.ranAt));
  return tap.labels.map((l) => l.replace(/not a Visa-approved agent/g, "no approval by Visa of this agent")).map((l) => {
    if (!own) return l;
    if (/^No approval was asked for or given in this run\.$/.test(l)) return `In the separate TAP run (${day}) no approval was asked for or given.${raise ? ` In ${run.name} the card buy came after the CFO approved ${raise.proposal} with Face ID, which raised the card's limit per purchase from EUR ${raise.from} to EUR ${raise.to}.` : ""}`;
    return /reference proxy|reference registry/.test(l) && !/^Signature/.test(l) ? `In the TAP run, ${l.replace(/^The /, "the ")}` : l;
  });
}

/** /visa's title and its large heading (jury panel, 12 Nov): the Airi run by its name. */
/** Partner scan, 14 Nov: the full name of what Purser used, and that it is the sandbox. */
export const VISA_TITLE = "Visa Intelligent Commerce via Airwallex Airi (sandbox)";
export const VISA_H1 = VISA_TITLE;
/**
 * The story in one line, right under the heading, true of the run's three purchases: Purser's policy came before any
 * request to Airi (within the limit it passed; above it the CFO signed first; the disallowed merchant got no credential).
 */
export const VISA_LEAD = `First the CFO's limit, then an ${AIRI_CREDENTIAL} Purser binds to one purchase.`;
/**
 * Which runs are the entry, and for which award. No dated quote from Visa is on record (docs/evidence/README.md,
 * 7 November: "as reported by the owner"), and the poster's role is not on record either, so since the jury check of
 * 12 Nov the page says no more than this: no second-hand basis sentence.
 */
export const VISA_ENTRY_LINE = "The Airi runs are Purser's entry for the Visa Award.";
/** The one closed fold at the end of /visa that holds all TAP material: its line says it is outside the entry. */
export const VISA_TAP_HEADING = VISA_TAP_SECTION_HEADING;
/** The TAP run in full, a fold inside the open TAP section (Visa judge, 14 Nov: TAP is shown, not hidden). */
export const VISA_TAP_MORE_ID = "visa-tap-more";
/** The card of folded lines under the runs on /visa: more on the VIC run, each one line until opened. */
export const VISA_MORE_ID = "vic-more";

const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** The label beside /visa's heading, from the Airi run's record: its date and its own label, "7 Nov · Airwallex sandbox · test card · test money". */
export const visaRunLabel = (rec: AiriRunRecord) => `${dayShort(rec.started_at)} · ${rec.label.split(", ").join(" · ")}`;
/** The label once a later live run leads the page (the review at 390 px, 12 Nov): its date, marked latest, in the same environment's words. */
export const visaLatestLabel = (rec: AiriRunRecord, latestIso: string) => `${dayShort(latestIso)} (latest) · ${rec.label.split(", ").join(" · ")}`;
/** The fold that holds the first live run's summary card and full block, under the latest run (12 Nov). */
export const VISA_FIRST_RUN_ID = "visa-first-run";

const plainWords = (html: string) => html.replace(/<svg\b[\s\S]*?<\/svg\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const TAP_WORDS = /\bTAP\b|Trusted Agent Protocol/;

/**
 * /visa is one Visa Intelligent Commerce story, then TAP shown openly as outside the entry (Visa judge, 14 Nov: TAP was
 * hidden in a closed fold and judges missed it): throws otherwise, so the page does not build. Checked on the built page:
 *   - the title and the first heading name Visa Intelligent Commerce via Airi;
 *   - the basis line and the Intelligent Commerce Connect line are there, visible, and Intelligent Commerce Connect is
 *     named nowhere else on the page;
 *   - TAP has one open section (in no fold), headed as outside the entry and opening with TAP's status word for word;
 *     above it TAP is named only in the "agent identity" row that points to it, never in the heading, the lead or what
 *     Visa asks for; nothing after </main> (the footer) names TAP;
 *   - every VIC block (what Visa asks, how Purser meets it, the reuse finding, the three runs and the details fold's
 *     blocks) is above the TAP section;
 *   - the summary is the one paid run's, and counts neither the TAP run nor the control test;
 *   - the footer cites the Airi run's record.
 */
export function assertVicFirst(html: string): void {
  const fail = (why: string): never => { throw new Error(`/visa must be one Visa Intelligent Commerce story, with TAP openly outside the entry: ${why}`); };
  if (/<title>([^<]*)<\/title>/.exec(html)?.[1] !== esc(pageTitle(VISA_TITLE))) fail("the title does not name Visa Intelligent Commerce via Airwallex Airi");
  const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? fail("no <main>");
  if (/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/.exec(main)?.[0] !== `<h1>${esc(VISA_H1)}</h1>`) fail("the page's first heading is not the VIC heading");
  // The section's opening tag, with its records (data-rec) after its id.
  const tapAt = main.search(new RegExp(`<section class="card vs vs-tap" id="${VISA_TAP_ID}"(?: data-rec="[^"]*")?>`));
  if (tapAt < 0) fail("there is no open TAP section");
  const before = main.slice(0, tapAt);
  // The TAP section sits in no fold: every <details> opened before it is closed before it.
  if ((before.match(/<details\b/g) ?? []).length !== (before.match(/<\/details>/g) ?? []).length) fail("the TAP section is inside a fold");
  const asksAt = before.indexOf(`id="${VISA_ASKS_ID}"`);
  if (asksAt < 0) fail("what Visa Intelligent Commerce asks for is not above the TAP section");
  if (TAP_WORDS.test(plainWords(before.slice(0, before.indexOf("</section>", asksAt))))) fail("TAP is named in the heading, the lead or what Visa asks for");
  const rowsAbove = before.replace(/<li class="vs-row [^"]*"><span class="vs-k">Agent identity<\/span>[\s\S]*?<\/li>/, " ");
  if (TAP_WORDS.test(plainWords(rowsAbove))) fail("TAP is named above its section, outside the agent identity row");
  const after = html.slice(html.indexOf("</main>"));
  if (TAP_WORDS.test(plainWords(after.replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ")))) fail("TAP is named below the page's body (the footer)");
  const section = main.slice(tapAt);
  if (!plainWords(section).startsWith(`${VISA_TAP_HEADING} ${VISA_TAP_STATUS}`)) fail("the TAP section does not open with its heading and its status");
  for (const id of [VIC_FLOW_ID, VIC_FACTS_ID, VISA_OVERVIEW_ID, AIRI_RUN_ID]) if (!main.includes(`id="${id}"`)) fail(`the VIC block #${id} is missing`);
  // The VIC story is above the TAP section; the details fold (its blocks) comes after, closed.
  for (const id of [VISA_ASKS_ID, VISA_MEETS_ID, VISA_RUNS3_ID]) if (!before.includes(`id="${id}"`)) fail(`the VIC block #${id} is not above the TAP section`);
  const unfolded = before.replace(/<details\b[\s\S]*?<\/details>/g, " ");
  const seen = plainWords(unfolded);
  if (!seen.includes(VISA_ENTRY_LINE)) fail("the entry line (which runs are the Visa entry) is not on the page, outside any fold");
  if (!seen.includes(VISA_ICC_LINE) && !main.includes(`id="${ICC_RUN_ID}"`)) fail("the Intelligent Commerce Connect line is not on the page, outside any fold");
  if (plainWords(html.replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ")).split("Intelligent Commerce Connect").length !== 2) fail("Intelligent Commerce Connect is named more than once");
  const overview = /<section class="card vo"[\s\S]*?<\/section>/.exec(main)?.[0] ?? "";
  if (!overview.includes(`>${esc(VISA_SUMMARY_HEADING)}</h2>`) || (overview.match(/class="vo-run[ "]/g) ?? []).length !== 1 || /class="vo-run tap"/.test(overview)) fail("the summary is not the one paid run's");
  if (!plainWords(after).includes(AIRI_RUN_FILE)) fail(`the footer does not cite ${AIRI_RUN_FILE}`);
}

/**
 * The TAP work: one closed fold, the last thing on /visa, whose line says it is outside the entry. Inside, at once its
 * status (Visa, 5 Nov), then the TAP run's card, the picture, the claim, the live proof and what this is and is not,
 * and its sources. Nothing inside is folded again, so the whole of it is one fold.
 */
function visaTapFold(run: AgentRun): string {
  const tap = tapRun(), p = partnerProof(run), own = ownTap(run.record);
  const buy = own ?? tap?.steps.find((x) => x.approved && x.model), decline = tap?.steps.find((x) => !x.approved);
  const picture = [node("package", "Agent signs", buy?.model ? `Sourcing · Claude ${family(buy.model)}` : "TAP signature"), arrow,
    node("shield-check", own ? "Both signatures verified" : "Reference verifier", own ? "by our layer, in this run" : `Visa's, commit ${tap?.commit ?? "16d59bd"}`), arrow,
    node("credit-card", buy ? `€${buy.amount} paid` : "Card pays", own ? `Airwallex card ····${own.last4}` : "Airwallex card", "ok"), arrow,
    node("ban", decline ? `€${decline.amount} declined` : "Over the limit", tap && own ? `by Airwallex · ${tap.label.replace(/ · test money$/, "")}` : "by Airwallex, at the limit", "bad")].join("");
  const list = (title: string, items: string[]) => (items.length ? `<p><b>${esc(title)}</b></p><ul class="pl">${items.join("")}</ul>` : "");
  return `<details class="fold" id="${VISA_TAP_MORE_ID}"><summary>${esc("The TAP run in full: the picture, the card, every check")}</summary>
  ${tapCardHtml(tap)}
  <div class="phd"><span class="pill run">${icon("database", 14)}${esc(own ? run.label : tap?.label ?? run.label)}</span></div>
  <div class="flow card" role="img" aria-label="${esc("How Visa TAP fits in, step by step")}">${picture}</div>
  <p class="claim">${esc(VISA_CLAIM)}</p>
  ${list(own ? "The live proof" : "The live TAP run", p.visa)}${list("What this is, and is not", (tap ? visaLabels(run, tap) : []).map(plainLi))}
  <p class="src">${esc(`Source: ${run.file} (${run.name}); the card run from ${tapRun()?.file ?? "docs/runs"}.`)}</p></details>`;
}

/** The code that sets the numbers of the CFO's Airi rules and of the card data's handling (cited as their record). */
const VIC_RULES_CODE = ["src/airi/policy.ts", "src/airi/purchase.ts"] as const;
const CARD_DATA_CODE = ["src/airi/cardData.ts"] as const;

export function visaPage(run: AgentRun = agentRun()): string {
  const rec = airiRun();
  // Intelligent Commerce Connect (12 Nov): the status line until an ICC run record exists under docs/runs; then, in its
  // place, the block read from that record (src/redesign/iccBlock.ts).
  const icc = iccRecordIn() ? iccBlock() : "";
  const iccLine = icc ? "" : esc(VISA_ICC_LINE);
  // Without the Airi run's live record there is no VIC story to tell: the page says so and keeps the TAP work folded.
  if (!rec) {
    const body = `<main class="pp"><div class="wrap">
  <div class="phd">${LOGO.visa}<h1>${esc(VISA_H1)}</h1></div>
  <p class="vbasis">${esc("No live record of the Airi run is on this build.")} ${iccLine}</p>${icc}
  ${visaTapSectionHtml(VISA_TAP_ID, visaTapFold(run))}
</div></main>`;
    return page({ title: VISA_TITLE, description: "Visa Intelligent Commerce via Airwallex's Airi: no live record on this build.", tab: "visa", css: CSS, body, real: [], source: "Source: no Airi run record on this build." });
  }
  // The top: the heading, beside it the Airi run's own label; the story in one line; the basis for calling it Visa
  // Intelligent Commerce and the exact state of Intelligent Commerce Connect; then the drawing: purchase B's seven steps
  // from the record. Under it, outside any fold: what the sandbox could not show (five lines) and purchase B side by
  // side (signed, sent, charged). Then the one summary of the paid run, the run in full (its ids folded) and the control
  // test. Folded, one line each: the attempts that failed first, what Airwallex's own record reports for the two
  // payments, the CFO's policy next to Visa's published VIC rules, and how the card data is handled. Last: TAP, folded.
  const asker = airiAsker(rec);
  // The latest live run leads (12 Nov, vic-3): the record's own numbers and ids; the first run (7 Nov) follows.
  const vic3 = vic3Run();
  // Every block names its records (data-rec, withRec): the run records it reads, and for the policy's numbers the code
  // that sets them (the CFO's Airi limits, the card data's handling), as docs/claims.md cites code for a rule.
  const net = vicNetworkRecord()?.file, tapFile = tapRun()?.file;
  const more = [withRec(vicAttemptsHtml(rec), [AIRI_RUN_FILE, AIRI_RUN_LOG]), withRec(vicNetworkBlock(rec), [net, AIRI_RUN_FILE]),
    withRec(vicRulesBlock(rec, vic2Run()), [...VIC_RULES_CODE, AIRI_RUN_FILE, VIC2_RUN_FILE]), withRec(cardDataHtml(), CARD_DATA_CODE)].join("");
  // Jury pass, 13 Nov: the latest run as it ended for each purchase ("1 paid after Face ID, 3 refused by Purser, 1 not
  // tapped: nothing charged"), four cards, the two lines that say what the entry is, then every detail in one fold; the
  // TAP work, outside the entry, last inside it (its own closed fold), so it is never on the first screen at any width.
  // 21 Nov (the owner, Max: "It must be clear it is about cards, not all those walls of text. So again: visuals,
  // animations, architecture. Show it."): the card scene of vic-5 on top (src/redesign/visaCardHero.ts), the two
  // refusals as chips, the card flow, the entry line; the three facts, the evidence strip, the live credential check and
  // every detail folded below; TAP's section keeps its heading and status in sight, its content folded.
  const hero = visaCardHeroHtml(visaCardScene());
  const top = vic3 ? `<p class="vlead" data-rec="${VIC3_RUN_FILE}">${esc(`${vic3Lead(vic3)}.`)}</p>
  <p class="vlimits" data-rec="${VIC3_RUN_FILE}">${esc(visaLimitsLine(vic3 as never))}</p>
  ${withRec(proofFirstHtml(visaFirstFacts(vic3 as never, VIC3_RUN_FILE, `#${VISA_REUSE_ID}`)), [VIC3_RUN_FILE])}
  ${evidenceStripHtml("visa", { note: "Visa is named in text only; no endorsement." })}` : `<p class="vintro">${esc(VISA_LEAD)}</p>`;
  const scene = withRec(visaCardSceneHtml(), [VIC3_RUN_FILE, AIRI_RUN_FILE, GUARD_FILE, GUARD_TEST]);
  const body = `<main class="pp"><div class="wrap">
  <div class="phd">${LOGO.visa}<span class="pill run" data-rec="${esc([AIRI_RUN_FILE, ...(vic3 ? [VIC3_RUN_FILE] : [])].join(" "))}">${icon("database", 14)}${esc(vic3 ? visaLatestLabel(rec, vic3.started_at) : visaRunLabel(rec))}</span><h1>${esc(VISA_H1)}</h1></div>
  ${hero ? `${hero}
  ${visaArchHtml()}
  <p class="vbasis">${esc(VISA_ENTRY_LINE)}${iccLine ? `<br>${iccLine}` : ""}</p>${icc}
  <div class="folds card vfolds"><details class="fold" id="visa-facts"><summary>${esc("The run's three facts, and the evidence tiles")}</summary>${top}</details>
  <details class="fold" id="visa-try"><summary>${esc("Try Purser's check on this credential")}</summary>${scene}</details>
  <details class="fold" id="visa-not-yet-fold"><summary>${esc("What is not proven yet")}</summary>${visaNotYetHtml()}</details>` : `${top}
  ${scene}
  <p class="vbasis">${esc(VISA_ENTRY_LINE)}${iccLine ? `<br>${iccLine}` : ""}</p>${icc}`}
  <details class="sumd" id="visa-asks-fold"><summary>${esc("What Visa Intelligent Commerce asks for, and how Purser meets it")}</summary>
  ${withRec(visaAsksHtml(), [VISA_PLAN_FILE])}
  ${withRec(visaMeetsHtml(), [VIC3_RUN_FILE, VIC3_RUN_LOG, ...VIC_RULES_CODE])}
  ${withRec(visaReuseHtml(), [...VIC_LATER_FILES])}
  ${vic3 ? withRec(visaFlowHtml(vic3), [VIC3_RUN_FILE]) : ""}
  ${withRec(visaThreeRunsHtml(), [AIRI_RUN_FILE, ...VIC_LATER_FILES])}
  </details>
  <details class="sumd" id="visa-details"><summary>${esc("All the details: the runs, the flow, every id")}</summary>
  ${vic3 ? `<p class="vintro">${esc(VISA_LEAD)}</p>
  ${withRec(visaOutcomesHtml(vic3, visaRunsLine()), [VIC3_RUN_FILE, AIRI_RUN_FILE, ...VIC_LATER_FILES])}
  ${withRec(visaHashHtml(vic3), [VIC3_RUN_FILE])}` : ""}
  ${vic3 ? `<div class="awrb">${vic3RunHtml(vic3, { first: dayShort(rec.started_at), summarised: true })}</div>` : ""}
  ${withRec(vicFlowBlock(rec, { h: "h2" }), [AIRI_RUN_FILE, AIRI_RUN_LOG])}
  ${withRec(vicFactsHtml(vicFacts(rec)), [AIRI_RUN_FILE, AIRI_RUN_LOG])}
  ${withRec(vicCompareHtml(vicCompare(rec, vicNetworkRecord())), [AIRI_RUN_FILE, net])}
  ${vic3 ? `<details class="fold" id="${VISA_FIRST_RUN_ID}" data-rec="${esc([AIRI_RUN_FILE, AIRI_RUN_LOG].join(" "))}"><summary>${esc(`The first live run (${dayShort(rec.started_at)}): every purchase, check and id`)}</summary>
  ${withRec(visaOverviewBlock(rec), [AIRI_RUN_FILE, AIRI_RUN_LOG])}
  <div class="awrb">${airiRunBlock(rec, { h: "h2" })}</div></details>` : `${withRec(visaOverviewBlock(rec), [AIRI_RUN_FILE, AIRI_RUN_LOG])}
  <div class="awrb">${airiRunBlock(rec, { h: "h2" })}</div>`}
  <div class="awrb">${vic2RunBlock(undefined, { fold: false })}</div>
  ${more ? `<div class="awrb"><div class="card" id="${VISA_MORE_ID}">${more}</div></div>` : ""}
  <a class="open" href="proof#${AIRI_RUN_ID}">All the proof ${icon("arrow-right", 15)}</a>
  </details>
  ${hero ? "</div>" : ""}
  ${withRec(visaTapSectionHtml(VISA_TAP_ID, `${evidenceStripHtml("tap")}<div class="folds card">${visaTapFold(run)}</div>`, { folded: !!hero }), [tapFile, run.file])}
  ${hero ? "" : visaNotYetHtml()}
</div></main>`;
  // The card scene's buttons run Purser's credential check in the browser on the recorded purchase (its data block).
  const sceneData = cardSceneData();
  const html = page({
    ...(sceneData ? { data: sceneData } : {}),
    // /visa says the ICC status once, in its body; its footer leaves that item out (assertVicFirst).
    builtOn: builtOnHtml(run, false),
    title: VISA_TITLE, tab: "visa", css: `${CSS}\n${EVIDENCE_WALL_CSS}\n${PROOF_FIRST_CSS}\n.pp .vlimits { margin: 6px 0 0; font-size: 14.5px; color: var(--muted); }\n${STATS_CSS}\n${VISA_HERO_CSS}\n${VISA_STORY_CSS}\n${ARCH_CSS}\n${VISA_CARD_HERO_CSS}\n.vfolds { padding: 6px 20px 12px; } .vfolds ol.pfirst p, .vfolds ol.pfirst a { overflow-wrap: anywhere; }\n.vfolds details.sumd { border-top: 1px solid var(--border); padding-top: 6px; } .vfolds details.sumd > summary { cursor: pointer; font-weight: 650; font-size: 16px; color: var(--accent); list-style: none; display: flex; align-items: center; gap: 6px; min-height: 44px; }\n.vfolds details.sumd > summary::-webkit-details-marker { display: none; } .vfolds details.sumd > summary::after { content: "▾"; font-size: 14px; } .vfolds details.sumd[open] > summary::after { content: "▴"; }\n.airi-finding { margin: 12px 0 0; font-size: 14.5px; color: var(--muted); }\n.pp .vlead { margin: 8px 0 0; font-size: 18px; font-weight: 650; }`, body, js: `${COUNT_JS}\n${OPEN_TARGET_JS}${sceneData ? `\n${VISA_CARD_SCENE_JS}` : ""}`, stage: false,
    // Who asked, in the description and "What's real?", from the same function as the run's summary line (airiAsker).
    description: `Visa Intelligent Commerce via Airwallex's Airi, run live in the Airwallex sandbox with a test card: above the limit, an ${AIRI_CREDENTIAL} for one purchase is asked for only after the CFO's Face ID. ${asker.sentence}.`,
    // "What's real?": the Airi run's own line (its label and merchant, from the record) and nothing of the main run.
    real: [`Visa Intelligent Commerce via Airwallex's Airi (${dayShort(rec.started_at)}), ${asker.short}: ${rec.label}. The merchant is our own Airwallex sandbox account, ${rec.checkout.merchant}.`],
    source: `Source: ${AIRI_RUN_FILE} (the Airi run), ${vic3 ? `${VIC3_RUN_FILE} (the latest live run), ` : ""}and ${VIC2_RUN_FILE} (the control test).`,
  });
  assertVicFirst(html);
  return html;
}

/** The hostile-model eval's record (jury panel, 12 Nov): a script in Claude's place, run in CI (npm run ap-hostile-eval). */
export const HOSTILE_RECORD_FILE = "docs/evals/ap-hostile.json";

/** The eval's split, from its record: refused by a tool's own check, made stricter when code enforced, stood as made. */
export interface HostileSplit { calls: number; tool: number; enforce: number; refused: number; stood: number; unsafe: number; cases: number }
/** The record's split, or null when there is no record; parts that do not add up to its totals are an error. */
export function hostileSplit(file = HOSTILE_RECORD_FILE): HostileSplit | null {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return null;
  const j = JSON.parse(readFileSync(url, "utf8")) as { calls: number; refused: number; blocked_by_tool: number; overridden_at_enforce: number; stood: number; unsafe: number; cases?: unknown[] };
  if (j.blocked_by_tool + j.overridden_at_enforce !== j.refused || j.blocked_by_tool + j.overridden_at_enforce + j.stood !== j.calls) throw new Error(`${file}: its parts do not add up to its totals`);
  return { calls: j.calls, tool: j.blocked_by_tool, enforce: j.overridden_at_enforce, refused: j.refused, stood: j.stood, unsafe: j.unsafe, cases: j.cases?.length ?? 0 };
}
/**
 * The one wording of the split, on every page (the final review, 13 Nov: /security and /claude
 * said it three ways; Max, 14 Nov: every one of the calls accounted for): "318 refused, 52 made stricter, 10 allowed as
 * they were (within the rules): 0 unsafe". The three parts are every call (hostileSplit checks they add up); "allowed as
 * they were" is the record's `stood`, each a payment the policy lets the agent make alone; "unsafe" is the ledger's
 * verdict.
 */
export const hostileWords = (h: HostileSplit) => `${h.tool} refused, ${h.enforce} made stricter, ${h.stood} allowed as they were (within the rules): ${h.unsafe} unsafe`;

/**
 * The eval's line, as a visitor reads it; "" when there is no record. It names its scope (review round 1, 12 Nov: the
 * eval is of the payables agents): the agents and the number of test invoices, counted from the record's cases.
 */
export function hostileClaimText(file = HOSTILE_RECORD_FILE): string {
  const h = hostileSplit(file);
  return h ? `In CI, a script in place of the payables agents, on ${h.cases} test invoices: ${h.calls} hostile tool calls; ${hostileWords(h)}.` : "";
}

export function claudePage(run: AgentRun = agentRun()): string {
  const sp = split(run.record), s = run.record.snapshot;
  const calls = s.agent_stats.reduce((n, a) => n + a.claude_calls, 0);
  const requests = s.flows.filter((f) => f.request && f.model);
  // Since 13 Nov (Max: "people need to know where to look", more visuals and data; src/redesign/claudePage.ts): the split
  // as one drawing under the title, the agents as cards, measured-not-asserted as proof tiles, each agent on each model
  // as a bar chart; the folds below as details.
  const ev = claudeEvidence(), used = Object.fromEntries(run.agents.map((a) => [a.id, a.family]));
  const body = claudeMain({
    logo: LOGO.claude + ENDORSE_NOTE, label: run.label, runIcon: icon("database", 14), evidence: ev, used,
    split: { ...sp, calls, faceId: faceIdDecisions(run.record), onChain: metalStory(run.record).payments },
    agents: run.agents.map((a) => { const st = s.agent_stats.find((x) => x.agent === a.id); return { id: a.id, short: a.short, family: a.family, model: a.model, decisions: st?.decisions ?? 0, calls: st?.claude_calls ?? 0 }; }),
    heldOut: newestHeldOut(),
    folds: sweepFold(ev, used) + failureFold(ev)
      // All the decisions the headline counts (final review, 4 Nov: the chat's 21 of 24), cut at a word, never inside a number.
      + fold("Every decision, with its Claude call", decisionsOf(run.record).map((d) => `<li class="ok">${esc(`${d.agent[0]!.toUpperCase()}${d.agent.slice(1)}, ${d.at.slice(11, 16)} UTC: ${d.text.length > 140 ? `${d.text.slice(0, 140).replace(/\s+\S*$/, "")}…` : d.text}${quotedNote(d.text, d.at)}`)}${d.call ? `<br><span class="call" title="${esc(d.call.requestIds.join(", "))}">${esc(callBadge(d.call))}</span>` : ""}</li>`))
      + fold("Payments decided by Claude, with their request ids", requests.map((f) => `<li>${esc(`${f.what}: ${f.amount} ${f.unit === "EUR" ? "EUR" : "test USD"} · ${f.decided} · ${f.request}`)}</li>`))
      + mcpFold(ev),
  });
  return page({ title: "Claude", description: "How Purser uses Claude: three agents decide the exceptions, each decision a recorded Claude call; routine payments per query are code.", tab: "claude", css: `${CSS}\n${EVIDENCE_CSS}\n${CLAUDE_CSS}\n${HELD_OUT_CSS}\n${IN_PRODUCT_CSS}`, body, source: SOURCE(run), builtOn: builtOnHtml(run) });
}

/**
 * The "Built on" strip (owner, 12 Nov): one line in the footer of the partner pages (/metal, /airwallex, /claude, /t0;
 * not Home, not /visa), each partner a text link with one proof number read from a record. Text only, no logos; ICC
 * only as access requested, not used in this entry.
 */
const dayShortOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/**
 * The Visa runs in one phrase, the same in the footer, on /visa and in the README (the owner, 13 Nov: it read two ways).
 * The live Visa runs are those that paid with an Airi credential: 7 Nov (docs/demo/airi-run.json), vic-3, vic-4 and vic-5; the
 * 7 Nov control test (vic-2) made no Airi or Airwallex call and is not counted. Every number from those records.
 */
export function visaRunsLine(): string | null {
  const airi = airiRun(), v3 = vic3Run();
  const later = VIC_LATER_FILES.map((f) => vic3Run(f)).filter((x): x is NonNullable<typeof x> => !!x);
  const settled = (airi?.purchases.filter((p) => (p as { status?: string }).status === "SETTLED").length ?? 0) + later.reduce((n, r) => n + vic3Summary(r).paid, 0);
  const runsN = (airi ? 1 : 0) + later.length;
  if (!settled) return null;
  // One phrase everywhere (jury review, 13 Nov): no "live", which the plain footer strips; the control test is headed
  // "not a Visa run", so the count is not mistaken for it.
  const all = `${settled} paid across ${runsN} Visa run${runsN === 1 ? "" : "s"}`;
  return v3 ? `${vic3Summary(v3).paid} paid in the ${dayShortOf(v3.started_at)} run (${all})` : all;
}
export function builtOnItems(run: AgentRun = agentRun()): { name: string; href: string; proof: string }[] {
  const st = metalStory(run.record), tiles = productTiles(run), t0 = t0Data().journal;
  const decisions = run.record.snapshot.agent_stats.reduce((n, a) => n + a.decisions, 0);
  return [
    ...(tiles.length ? [{ name: "Airwallex", href: "airwallex", proof: `${tilesCountWords(tiles, true)}, each run dated` }] : []),
    // Jury panel, 15 Nov: "Alta" here, as on every later mention; "(formerly Metal)" is said once per page, at its first mention in <main>.
    { name: "Alta", href: "alta", proof: `${st.payments.total} payments on testnet (main run)` },
    // Jury, 13 Nov: the latest run's own count first, as /visa leads with it, then all the runs' (they read as a clash).
    ...(visaRunsLine() ? [{ name: "Visa (VIC through Airwallex's Airi)", href: "visa", proof: visaRunsLine()! }] : []),
    { name: "Claude", href: "claude", proof: `${decisions} decisions (main run)` },
    ...(t0 ? [{ name: "T:0", href: "books#t0", proof: `${t0.posted} journal entries (main run)` }] : []),
    // Jury, 17 Nov: "41 paid requests" beside /alta's 41 sales and 41 purchases read as a clash; both sides are x402.
    { name: "x402", href: `${REPO_BLOB}${METAL_TX_LIST}`, proof: `${st.payments.sales} requests sold, ${st.payments.purchases} bought (main run)` },
  ];
}
export const ICC_LINE = "Visa Intelligent Commerce Connect (access requested)";
// Jury pass, 13 Nov: Visa Intelligent Commerce Connect is not used, so it is not in "Built on" (/visa says its status in
// its body: VISA_ICC_LINE). The second argument stays for callers; it changes nothing now.
export function builtOnHtml(run: AgentRun = agentRun(), _icc = false): string {
  return `<ul class="builton"><li><b>Built on</b></li>${builtOnItems(run).map((i) => `<li><a class="flink" href="${esc(i.href)}"${/^https?:/.test(i.href) ? ' target="_blank" rel="noopener"' : ""}>${esc(`${i.name}: ${i.proof}`)}</a></li>`).join("")}</ul>`;
}
// Every page's footer carries it (review, 12 Nov), computed once per process from the same records.
/**
 * The same list as plain text, for every other page's footer: no links (the jury's rules keep /visa's link off Home and
 * /proof, and /trace links no other host) and no "live" (a recorded run or a replay is never called live there).
 */
export function builtOnPlainHtml(run: AgentRun = agentRun()): string {
  return `<ul class="builton"><li><b>Built on</b></li>${builtOnItems(run).map((i) => `<li>${esc(`${i.name}: ${i.proof.replace(/\blive /g, "")}`)}</li>`).join("")}</ul>`;
}
let builtOnCache = "";
setBuiltOn(() => (builtOnCache ||= builtOnPlainHtml()));

/** What is real on /books (since 21 Nov with T:0 in it; /t0 answers 301 here). */
export const BOOKS_REAL = [
  "Studio Noorderlicht B.V. and its suppliers are fictional, and the money is test money on a simulated bank: its opening equity is that bank's opening balance.",
  "Claude (Haiku) read and coded every invoice live in the run, under the demo's spend caps; the approvals were signed by a software passkey.",
  "\"Change one cent\" is a demo: it runs in your browser on the balance sheet as recorded, and changes nothing.",
  "T:0 is its shared sandbox entity (US, USD), with test data: other hackathon teams post to it too. The 20 Nov payments are Airwallex sandbox and Alta testnet payments, test money.",
  "Moneybird is a sandbox with test data, from an earlier run.",
];
/** /books (owner, 12 Nov; merged with /t0 on 21 Nov): the books, the one-cent demo, how a payment reaches T:0, and T:0 (src/redesign/booksPage.ts). */
export function booksPage(run: AgentRun = agentRun()): string {
  const body = booksBody(booksData(), { rails: railsHtml(), t0: t0SectionHtml(t0Data(), { endorse: ENDORSE_NOTE }) });
  return page({ title: "Books", description: "A test company's books, sorted by Claude into a balance sheet and P&L, with the PDF; every payment booked in T:0 at payment time and reconciled against its rail; a demo of one changed cent.", tab: "books", css: `${CSS}\n${BOOKS_CSS}\n${T0_CSS}`, body,
    // The close check's button (src/redesign/t0CloseTile.ts): Purser's books as recorded, and the script that fetches the read-back.
    data: t0RunData(), js: `${BOOKS_JS}\n${T0_CLOSE_JS}`, stage: false,
    source: `Source: ${RUN_FILE} (npm run books:month), ${RAILS_FILE}, ${T0_READBACK_RECORD}, ${T0_JOURNAL_RECORD}, ${PLATFORM_RUN_FILE} and ${MONEYBIRD_RECORD}.`, real: BOOKS_REAL, builtOn: builtOnHtml(run) });
}

/** The clean 404: what happened, and the four tabs. No script. */
export function notFoundPage(run: AgentRun = agentRun()): string {
  const body = `<main class="nf"><div class="wrap"><p class="pill">404</p><h1>This page does not exist.</h1><p class="line">Every page of the demo is one of these ${WATCH_IN_MENU ? "four" : "three"}.</p>
<div class="tabs2"><a class="btn primary" href="home">${icon("feather", 18)}Home</a>${WATCH_IN_MENU ? `<a class="btn" href="watch">${icon("play", 18)}Watch</a>` : ""}<a class="btn" href="${TRY_URL}">${icon("sparkles", 18)}Try</a><a class="btn" href="proof">${icon("shield-check", 18)}Proof</a></div></div></main>`;
  return page({ title: "Not found", description: "This page does not exist.", tab: null, css: CSS, body, source: SOURCE(run) });
}
