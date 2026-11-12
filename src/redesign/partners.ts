// The partner pages in the redesign's style (mega-prompt v4, C1): /metal, /airwallex, /visa, /claude. Each is short
// (about 150 visible words at most): a picture of the flow first, three or four numbers, one sentence, and everything
// else folded (<details>): the live proof from the main run (the same list as Proof's card), the docs we built on, what
// is simulated. /airwallex also carries Airwallex read back (section B, 6 Nov; src/redesign/airwallexProof.ts): the hash
// the CFO signed beside the one Airwallex returns with the payment, and each card's controls beside the CFO policy; and
// below them awx-1 (7 Nov, src/redesign/awxRun.ts), the separate Airwallex-only run, dated, every step folded.
// Every figure from the record (src/redesign/run.ts), the TAP run's record or the read-back records; logos only as "built on",
// never a Visa logo. No script. Also the clean 404 page.

import { WATCH_IN_MENU } from "../config/film.js";
import { existsSync, readFileSync } from "node:fs";
import { SANDBOX_SETTLED, SPLIT_LINE, VISA_CLAIM, VISA_TAP_STATUS } from "../config/brand.js";
import { airwallexData } from "../partners/data.js";
import { agentRun, callBadge, cardRaiseOf, decisionsOf, faceIdDecisions, family, fxOf, ownTap, payments, split, tapRun, timings, type AgentRun, type Ev } from "./run.js";
import { LOGO, earlierLine, fold, partnerProof } from "./proof.js";
import { EXPLORER, REPO_BLOB, metalStory } from "./metalStory.js";
import { READBACK_CSS, cardControlRows, cardsReadback, controlsSideBySideHtml, hashBlockHtml, hashTravel } from "./airwallexProof.js";
import { AIRI_CSS, airiRun, airiRunBlock } from "./airiRun.js";
import { awxRunBlock } from "./awxRun.js";
import { PLATFORM_RUN_FILE, PRODUCTS_CSS, airwallexBody, airwallexDescription, productTiles } from "./airwallexProducts.js";
import { vic2RunBlock } from "./vic2Run.js";
import { VIC_FLOW_CSS, vicFlowBlock } from "./vicFlow.js";
import { VISA_OVERVIEW_CSS, VISA_TAP_ID, visaOverviewBlock } from "./visaOverview.js";
import { tokenizeRun, tokenizeRunBlock, type TokenizeRun } from "./tokenizeRun.js";
import { HOLD_NOT_FINISHED, METAL_CSS, METAL_HOLD_RECORD, METAL_INSPECT_JS, holdState, metalBody } from "./metalMandates.js";
import { EVIDENCE_CSS, claudeEvidence, failureFold, mcpFold, measuredBlock, sweepFold } from "./claudeEvidence.js";
import { T0_CSS, T0_FIRST_RECORD, T0_JOURNAL_RECORD, T0_LABEL, T0_SECOND_RECORD, t0Body, t0Data } from "./t0Page.js";
import { OPEN_TARGET_JS, esc, icon, page } from "./ui.js";

const CSS = `.pp { padding: 26px 0 24px; }
.pp .wrap { max-width: 1040px; display: grid; gap: 18px; }
.phd { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.phd h1 { font-size: clamp(30px, 4vw, 48px); font-weight: 780; letter-spacing: -.03em; flex: 1 1 100%; }
.logo { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid var(--border); flex: none; }
.logo.dark { background: #191919; border-color: #191919; } .logo img { display: block; height: 15px; width: auto; }
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
.vintro { margin: 4px 0 14px; font-size: clamp(17px, 1.7vw, 19px); font-weight: 620; line-height: 1.45; max-width: 46em; }
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
.nf { padding: 64px 0; } .nf .wrap { display: grid; gap: 16px; justify-items: start; } .nf h1 { font-size: clamp(34px, 5vw, 56px); font-weight: 800; }
.nf .tabs2 { display: flex; flex-wrap: wrap; gap: 10px; }
${READBACK_CSS}
${AIRI_CSS}
${VIC_FLOW_CSS}
${VISA_OVERVIEW_CSS}`;

const SOURCE = (run: AgentRun) => `Source: ${run.file} (${run.name}); the card run from ${tapRun()?.file ?? "docs/runs"}.`;
const node = (ic: string, title: string, sub: string, tone = "") => `<div class="node ${tone}"><span class="ic">${icon(ic, 22)}</span><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
const arrow = `<span class="arrow" aria-hidden="true">${icon("arrow-right", 22)}</span>`;
const nums = (items: [string, string][]) => `<div class="nums">${items.map(([v, l]) => `<div class="num card"><span class="v">${esc(v)}</span><span class="l">${esc(l)}</span></div>`).join("")}</div>`;
const docsLi = (title: string, docs: { label: string; href: string }[]) => `<li>${esc(title)}: ${docs.map((d) => `<a class="pf" href="${esc(d.href)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join(" · ")}</li>`;
const plainLi = (t: string) => `<li>${esc(t)}</li>`;

function shell(run: AgentRun, o: { builtOn?: string; /** Under the h1, before the picture (/claude's measured block, 12 Nov). */ head?: string; css?: string; intro?: string; lead?: string; top?: string; underTop?: string; label?: string; title: string; description: string; logo: string; h1: string; picture: string; nums: string; line: string; extra?: string; folds: string; after?: string; proofHash: string; js?: string }): string {
  const body = `<main class="pp"><div class="wrap">
  ${o.intro ? `<p class="vintro">${esc(o.intro)}</p>` : ""}${o.lead ?? ""}${o.top ? `<div class="awrb">${o.top}</div>` : ""}${o.underTop ?? ""}
  <div class="phd">${o.logo}<span class="pill run">${icon("database", 14)}${esc(o.label ?? run.label)}</span><h1>${esc(o.h1)}</h1></div>${o.head ?? ""}
  <div class="flow card" role="img" aria-label="${esc(`How ${o.title} fits in, step by step`)}">${o.picture}</div>
  ${o.nums}
  <p class="line">${esc(o.line)}</p>
  ${o.extra ?? ""}
  <div class="folds card">${o.folds}</div>${o.after ?? ""}
  <a class="open" href="proof#${o.proofHash}">All the proof ${icon("arrow-right", 15)}</a>
</div></main>`;
  return page({ title: o.title, description: o.description, tab: "proof", css: o.css ? `${CSS}\n${o.css}` : CSS, body, source: SOURCE(run), ...(o.js ? { js: o.js, stage: false } : {}), ...(o.builtOn ? { builtOn: o.builtOn } : {}) });
}

const moneyOf = (run: AgentRun) => run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");

const ext = (p: { label: string; href: string | null }, label = p.label) => p.href ? `<a class="pf" href="${esc(p.href)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : "";

/**
 * Every Metal transaction of the main run, one line each (review 9 Nov: "86 payments, each its own transaction" could not
 * be clicked one by one). From the trace derived from the main run's ledger (docs/demo/main-run-trace.json), which the
 * tests hold to the record; no chain call.
 */
/** The main run's Metal transactions as a list on GitHub (made by metalTxList(), held to the trace by its test). */
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
  const used = metal.features.filter((f) => /mandate per agent|Replace and revoke|x402|facilitator|Refunds as mandate|Sweep after finality|Four eyes/i.test(f.title));
  // One honest story (jury panel, 12 Nov; src/redesign/metalMandates.ts): the four mandates with their spend, read live
  // by the read-only inspector or labelled as recorded; the payments; the refusal as it ran; who signed on chain; what
  // else ran on Metal, each dated, the unfinished hold said as such. The live proof's fold keeps every line but one:
  // "A mandate per agent, on chain" states the end terms beside the first bind's link; the table links each term's own
  // transaction instead.
  const p = partnerProof(run), pay = payments(run.record), story = metalStory(run.record);
  const folds = fold("The live proof, with every tx", [...(pay.sums && pay.onChain === story.payments.total ? [plainLi(`${pay.line}.`)] : []), ...p.metal.filter((li) => !li.includes("A mandate per agent, on chain"))])
    + fold(`All ${metalTxs().length} transactions`, [`<li>${ext({ label: "Each with its link to the explorer", href: `${REPO_BLOB}${METAL_TX_LIST}` })}</li>`])
    + fold("The Metal features we use, and their docs", used.map((f) => docsLi(f.title, f.docs)))
    + fold("What is simulated", [plainLi("Test money on Metal testnet only (*USDZ)."), plainLi("Stockline, the supplier, and Summit, the customer whose agent buys from us, are simulated; their payments are real testnet transactions."),
      plainLi("The second approver on the mandate change is a labelled test passkey; in production it is a second person."), plainLi("Passkeys as the account's owners ran on 1 November with software passkeys, not a phone."), ...(holdState(readFileSync(new URL(`../../${METAL_HOLD_RECORD}`, import.meta.url), "utf8"))?.finished === false ? [plainLi(`${HOLD_NOT_FINISHED}.`)] : [])])
    + fold("Archive", [`<li><a class="pf" href="metal/report">The Dispute desk's evidence report (30 October)</a></li>`]);
  const body = metalBody(run.record, { logo: LOGO.metal, label: run.label, folds, proofHash: "metal", after: tokenize ? `\n  ${tokenizeRunBlock(tokenize)}` : "" });
  return page({ title: "Metal", description: "How Purser uses Metal: each agent's limit is a mandate on chain, read live; payments per query over x402; a payment over the cap is refused on chain.", tab: "proof", css: `${CSS}\n${METAL_CSS}`, body, source: SOURCE(run), js: METAL_INSPECT_JS, stage: false, builtOn: builtOnHtml(run) });
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
  // (Metal earnings booked, the licence paid) is one of the folds, as are awx-1 and the Airi runs, in the blocks /proof
  // and /visa show. Proof's "Policy and card side by side" opens the cards' fold (#controls, or #card-<agent>).
  const body = airwallexBody(run, {
    logo: LOGO.airwallex, proofHash: "airwallex", hash: hashBlockHtml(hash), controls: cards ? controlsSideBySideHtml(rows, cards.rec.read_at, cards.file) : "",
    awx1: awxRunBlock(), airi: airiRunBlock() + vic2RunBlock(undefined, { short: true }),
    picture: [node("zap", "Metal earnings", "final on chain", "metal"), arrow, node("landmark", booked ? `${booked.amount} USD booked` : "Booked at Airwallex", "simulated deposit", "awx"), arrow,
      node("scan-face", "CFO · Face ID", "approves the invoice"), arrow, ...(fx ? [node("arrow-left-right", `${fx.buy} by FX`, "only the shortfall", "awx"), arrow] : []),
      node("circle-check", licence ? `${eur} by SWIFT, accepted` : "SWIFT, accepted", licence ? `Airwallex accepted it with the signed hash; ${SANDBOX_SETTLED}` : "", "ok")].join(""),
    mainProof: p.airwallex, deposit: booked?.amount ?? null, depositDocs: airwallexData().features.find((f) => f.id === "deposit")?.docs ?? [],
    simulated: [...(licence ? [`The SWIFT payout's settlement: Purser moves the sandbox transfer to SENT, then PAID, through Airwallex's simulation API${t.faceToPaid !== null ? `; the ${t.faceToPaid} s are measured from the CFO's Face ID to PAID` : ""}.`] : []),
      ...money.filter((e) => e.earlier).map((e) => earlierLine(e))],
  });
  return page({ title: "Airwallex", description: airwallexDescription(run), tab: "proof", css: `${CSS}\n${PRODUCTS_CSS}`, body, source: SOURCE(run), js: OPEN_TARGET_JS, stage: false, builtOn: builtOnHtml(run) });
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

/** /visa's first line: the Visa Award entry in plain words, only what ran live (the Airi run, 7 Nov). */
export const VISA_ENTRY_LINE = "Purser is entered for the Metal Award and the Visa Award. The Visa entry is this live run of Visa Intelligent Commerce through Airwallex's Airi, with a test card in Airwallex's sandbox.";

export function visaPage(run: AgentRun = agentRun()): string {
  const tap = tapRun(), p = partnerProof(run), own = ownTap(run.record);
  const buy = own ?? tap?.steps.find((x) => x.approved && x.model), decline = tap?.steps.find((x) => !x.approved);
  // The Airi run (7 Nov), Visa Intelligent Commerce via Airwallex's Airi, at the top, above the TAP run (owner, 7 Nov):
  // the same block as /airwallex, its heading an h2 here, since it comes before the page's h1.
  const airi = airiRunBlock(undefined, { h: "h2" });
  return shell(run, {
    // One plain sentence first (Max, 10 Nov): what the Visa Award entry is, in words a juror reads at a glance.
    ...(airi ? { intro: VISA_ENTRY_LINE } : {}),
    // First the overview (Max, 10 Nov: more Visa, fewer words): the flow in four nodes and the three Visa runs as cards.
    lead: visaOverviewBlock(),
    top: airi,
    // Under it, how a VIC purchase runs (7 Nov): seven steps, purchase B's ids, C's branch (src/redesign/vicFlow.ts);
    // the second Airi run in the same padded column as the first (its card touched the page edge outside it), then the
    // TAP run's anchor, which the overview's TAP card links to.
    underTop: airi ? `${vicFlowBlock()}<div class="awrb">${vic2RunBlock(undefined, { fold: false })}</div><span id="${VISA_TAP_ID}"></span>` : "",
    title: "Visa", description: "Visa Intelligent Commerce through Airwallex's Airi, run live in the Airwallex sandbox: above the limit, the agent gets a single-use Visa credential only after the CFO's Face ID. Visa TAP below, as an extra.",
    logo: LOGO.visa, h1: "The agent signs before it pays", proofHash: "airi-run",
    picture: [node("package", "Agent signs", buy?.model ? `Sourcing · Claude ${family(buy.model)}` : "TAP signature"), arrow,
      node("shield-check", own ? "Both signatures verified" : "Reference verifier", own ? "by our layer, in this run" : `Visa's, commit ${tap?.commit ?? "16d59bd"}`), arrow,
      node("credit-card", buy ? `€${buy.amount} paid` : "Card pays", own ? `Airwallex card ····${own.last4}` : "Airwallex card", "ok"), arrow,
      node("ban", decline ? `€${decline.amount} declined` : "Over the limit", tap && own ? `by Airwallex · ${tap.label.replace(/ · test money$/, "")}` : "by Airwallex, at the limit", "bad")].join(""),
    label: own ? undefined : tap?.label, nums: "", line: "The card's limit still holds: over it, Airwallex declines.",
    extra: `<p class="claim">${esc(VISA_CLAIM)}</p><p class="claim">${esc(VISA_TAP_STATUS)}</p>`,
    folds: fold(own ? "The live proof" : "The live TAP run", p.visa) + fold("What this is, and is not", (tap ? visaLabels(run, tap) : []).map(plainLi)),
  });
}

/** The hostile-model eval's record (jury panel, 12 Nov): a script in Claude's place, run in CI (npm run ap-hostile-eval). */
export const HOSTILE_RECORD_FILE = "docs/evals/ap-hostile.json";

/**
 * /claude's line from that record, as a visitor reads it; "" when there is no record. It names its scope (review round
 * 1, 12 Nov: the page shows the three Kit 11 agents, and the eval is of the payables agents): the agents and the number
 * of test invoices, counted from the record's cases.
 */
export function hostileClaimText(file = HOSTILE_RECORD_FILE): string {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return "";
  const { line, cases } = JSON.parse(readFileSync(url, "utf8")) as { line?: string; cases?: unknown[] };
  return line ? `In CI, a script in place of the payables agents, on ${cases?.length ?? 0} test invoices: ${line}.` : "";
}

/** That line with its link to the record; "" when there is no record. */
export function hostileClaimHtml(file = HOSTILE_RECORD_FILE): string {
  const text = hostileClaimText(file);
  return text ? `<p class="claim">${esc(text)} <a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc("record")} ↗</a></p>` : "";
}

export function claudePage(run: AgentRun = agentRun()): string {
  const sp = split(run.record), s = run.record.snapshot;
  const calls = s.agent_stats.reduce((n, a) => n + a.claude_calls, 0);
  const requests = s.flows.filter((f) => f.request && f.model);
  // Measured, not asserted (jury panel, 12 Nov; src/redesign/claudeEvidence.ts): four figures on top, each with its
  // record; each agent on each model as measured in place of the per-agent fold; the failure story; the MCP interface.
  const ev = claudeEvidence(), used = Object.fromEntries(run.agents.map((a) => [a.id, a.family]));
  return shell(run, {
    builtOn: builtOnHtml(run), css: EVIDENCE_CSS, head: measuredBlock(ev),
    title: "Claude", description: "How Purser uses Claude: three agents decide the exceptions, each decision a recorded Claude call; routine payments per query are code.",
    logo: LOGO.claude, h1: "Claude decides the exceptions", proofHash: "claude",
    picture: run.agents.map((a) => node(a.id === "sourcing" ? "package" : a.id === "support" ? "headphones" : "landmark", `${a.short} · ${a.family}`, `${s.agent_stats.find((x) => x.agent === a.id)?.decisions ?? 0} decisions`, "claude")).join(arrow),
    nums: nums([[`${sp.byClaude}/${sp.decisions}`, `decisions by Claude (${sp.fallbacks} fallbacks)`], [String(sp.routine), "routine payments by code"], [String(calls), "Claude calls, each with a request id"], [String(faceIdDecisions(run.record)), "Face ID decisions by the CFO"]]),
    // What a decision is here (jury review, 7 Nov, #19): holding and doing nothing count, as the record's own rows show.
    line: `${SPLIT_LINE} ${sp.decisions} decisions, including the ones to hold or do nothing.`,
    extra: hostileClaimHtml(),
    folds: sweepFold(ev, used) + failureFold(ev)
      // All the decisions the headline counts (final review, 4 Nov: the chat's 21 of 24), cut at a word, never inside a number.
      + fold("Every decision, with its Claude call", decisionsOf(run.record).map((d) => `<li class="ok">${esc(`${d.agent[0]!.toUpperCase()}${d.agent.slice(1)}, ${d.at.slice(11, 16)} UTC: ${d.text.length > 140 ? `${d.text.slice(0, 140).replace(/\s+\S*$/, "")}…` : d.text}`)}${d.call ? `<br><span class="call" title="${esc(d.call.requestIds.join(", "))}">${esc(callBadge(d.call))}</span>` : ""}</li>`))
      + fold("Payments decided by Claude, with their request ids", requests.map((f) => `<li>${esc(`${f.what}: ${f.amount} ${f.unit === "EUR" ? "EUR" : "test USD"} · ${f.decided} · ${f.request}`)}</li>`))
      + mcpFold(ev),
  });
}

/**
 * The "Built on" strip (owner, 12 Nov): one line in the footer of the partner pages (/metal, /airwallex, /claude, /t0;
 * not Home, not /visa), each partner a text link with one proof number read from a record. Text only, no logos; ICC
 * only as access requested, not used in this entry.
 */
export function builtOnItems(run: AgentRun = agentRun()): { name: string; href: string; proof: string }[] {
  const st = metalStory(run.record), tiles = productTiles(run).length, airi = airiRun(), t0 = t0Data().journal;
  const settled = airi?.purchases.filter((p) => (p as { status?: string }).status === "SETTLED").length ?? 0;
  const decisions = run.record.snapshot.agent_stats.reduce((n, a) => n + a.decisions, 0);
  return [
    ...(tiles ? [{ name: "Airwallex", href: "airwallex", proof: `${tiles} products, each run dated` }] : []),
    { name: "Metal", href: "metal", proof: `${st.payments.total} payments on testnet` },
    ...(settled ? [{ name: "Visa (VIC through Airwallex's Airi)", href: "visa", proof: `${settled} purchases settled` }] : []),
    { name: "Claude", href: "claude", proof: `${decisions} decisions` },
    ...(t0 ? [{ name: "T:0", href: "t0", proof: `${t0.posted} journal entries` }] : []),
    { name: "x402", href: `${REPO_BLOB}${METAL_TX_LIST}`, proof: `${st.payments.sales} paid requests` },
  ];
}
export const ICC_LINE = "ICC: access requested, not used in this entry";
export function builtOnHtml(run: AgentRun = agentRun()): string {
  return `<p class="builton"><b>Built on</b> ${builtOnItems(run).map((i) => `<a class="flink" href="${esc(i.href)}"${/^https?:/.test(i.href) ? ' target="_blank" rel="noopener"' : ""}>${esc(`${i.name}: ${i.proof}`)}</a>`).join(" · ")} · ${esc(ICC_LINE)}</p>`;
}

const T0_LOGO = '<span class="logo txt">T:0</span>';
/** What is real on /t0: its own lines (the main run's would name rails the page does not show). */
export const T0_REAL = [
  "T:0's shared sandbox entity (US, USD): other hackathon teams post to it too.",
  "The books posted are the main run's of 3 November, test money; *USDZ is posted as USD, labelled in each memo.",
  "The platform run's company (SANDBOXTEST, 10 November) is an Airwallex sandbox company.",
];
/** /t0 (owner, 12 Nov): Purser's books in T:0's ledger, from the run records alone (src/redesign/t0Page.ts). */
export function t0Page(run: AgentRun = agentRun()): string {
  const body = t0Body(t0Data(), { logo: T0_LOGO, pill: T0_LABEL });
  return page({ title: "T:0", description: "How Purser uses T:0: its double-entry books posted to T:0's general ledger as journal entries, then read back line by line.", tab: "proof", css: `${CSS}\n${T0_CSS}`, body,
    source: `Source: ${T0_JOURNAL_RECORD}, ${PLATFORM_RUN_FILE}, ${T0_FIRST_RECORD} and ${T0_SECOND_RECORD}.`, real: T0_REAL, builtOn: builtOnHtml(run) });
}

/** The clean 404: what happened, and the four tabs. No script. */
export function notFoundPage(run: AgentRun = agentRun()): string {
  const body = `<main class="nf"><div class="wrap"><p class="pill">404</p><h1>This page does not exist.</h1><p class="line">Every page of the demo is one of these ${WATCH_IN_MENU ? "four" : "three"}.</p>
<div class="tabs2"><a class="btn primary" href="home">${icon("feather", 18)}Home</a>${WATCH_IN_MENU ? `<a class="btn" href="watch">${icon("play", 18)}Watch</a>` : ""}<a class="btn" href="try">${icon("sparkles", 18)}Try</a><a class="btn" href="proof">${icon("shield-check", 18)}Proof</a></div></div></main>`;
  return page({ title: "Not found", description: "This page does not exist.", tab: null, css: CSS, body, source: SOURCE(run) });
}
