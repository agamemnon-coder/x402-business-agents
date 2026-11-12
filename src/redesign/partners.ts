// The partner pages in the redesign's style (mega-prompt v4, C1): /metal, /airwallex, /visa, /claude. Each is short
// (about 150 visible words at most): a picture of the flow first, three or four numbers, one sentence, and everything
// else folded (<details>): the live proof from the main run (the same list as Proof's card), the docs we built on, what
// is simulated. /airwallex also carries Airwallex read back (section B, 6 Nov; src/redesign/airwallexProof.ts): the hash
// the CFO signed beside the one Airwallex returns with the payment, and each card's controls beside the CFO policy; and
// below them awx-1 (7 Nov, src/redesign/awxRun.ts), the separate Airwallex-only run, dated, every step folded.
// Every figure from the record (src/redesign/run.ts), the TAP run's record or the read-back records; logos only as "built on",
// never a Visa logo. No script. Also the clean 404 page.

import { WATCH_IN_MENU } from "../config/film.js";
import { readFileSync } from "node:fs";
import { SANDBOX_SETTLED, SPLIT_LINE, VISA_CLAIM, VISA_TAP_STATUS } from "../config/brand.js";
import { airwallexData } from "../partners/data.js";
import { agentRun, callBadge, cardRaiseOf, decisionsOf, faceIdDecisions, family, fxOf, ownTap, payments, split, stops, tapRun, timings, type AgentRun, type Ev } from "./run.js";
import { LOGO, earlierLine, fold, partnerProof } from "./proof.js";
import { EXPLORER, REPO_BLOB, metalStory, refusalNote, separateRuns, type MetalStory } from "./metalStory.js";
import { READBACK_CSS, cardControlRows, cardsReadback, controlsSideBySideHtml, hashBlockHtml, hashTravel } from "./airwallexProof.js";
import { AIRI_CSS, airiRunBlock } from "./airiRun.js";
import { awxRun, awxRunBlock } from "./awxRun.js";
import { vic2RunBlock } from "./vic2Run.js";
import { VIC_FLOW_CSS, vicFlowBlock } from "./vicFlow.js";
import { VISA_OVERVIEW_CSS, VISA_TAP_ID, visaOverviewBlock } from "./visaOverview.js";
import { tokenizeRun, tokenizeRunBlock, type TokenizeRun } from "./tokenizeRun.js";
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
.flow.story { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.st { display: grid; grid-template-columns: 40px minmax(0, 1fr); column-gap: 12px; align-content: start; padding: 14px; border-radius: 16px; background: var(--sunken); min-width: 0; }
.st .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--surface); color: var(--metal); grid-row: span 3; }
.st.bad .ic { color: var(--bad); } .st.ok .ic { color: var(--ok); }
.st .xn { grid-column: -2 / -1; font-size: 14px; line-height: 1.4; color: var(--muted); margin-top: 4px; overflow-wrap: anywhere; }
.st b { font-size: 19px; line-height: 1.25; letter-spacing: -.01em; } .st span { font-size: 15px; color: var(--muted); line-height: 1.4; }
.st .tx { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 4px; } .st .tx a.pf { font-size: 14.5px; display: inline-flex; align-items: center; min-height: 24px; }
.st code { font: 600 13.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
@media (max-width: 700px) { .flow.story { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 8px; }
  .st { grid-template-columns: minmax(0, 1fr); padding: 9px 12px; border-left: 4px solid var(--metal); } .st .ic { display: none; } .st.bad { border-left-color: var(--bad); } .st.ok { border-left-color: var(--ok); }
  .st b { font-size: 16.5px; } .st span { font-size: 14px; line-height: 1.35; } .st .tx { margin-top: 2px; } .st .tx a.pf { font-size: 14px; } .st code { font-size: 12.5px; } }
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

function shell(run: AgentRun, o: { intro?: string; lead?: string; top?: string; underTop?: string; label?: string; title: string; description: string; logo: string; h1: string; picture: string; flowClass?: string; nums: string; line: string; extra?: string; folds: string; after?: string; proofHash: string; js?: string }): string {
  const body = `<main class="pp"><div class="wrap">
  ${o.intro ? `<p class="vintro">${esc(o.intro)}</p>` : ""}${o.lead ?? ""}${o.top ? `<div class="awrb">${o.top}</div>` : ""}${o.underTop ?? ""}
  <div class="phd">${o.logo}<span class="pill run">${icon("database", 14)}${esc(o.label ?? run.label)}</span><h1>${esc(o.h1)}</h1></div>
  ${o.flowClass ? `<div class="flow card ${o.flowClass}">${o.picture}</div>` : `<div class="flow card" role="img" aria-label="${esc(`How ${o.title} fits in, step by step`)}">${o.picture}</div>`}
  ${o.nums}
  <p class="line">${esc(o.line)}</p>
  ${o.extra ?? ""}
  <div class="folds card">${o.folds}</div>${o.after ?? ""}
  <a class="open" href="proof#${o.proofHash}">All the proof ${icon("arrow-right", 15)}</a>
</div></main>`;
  return page({ title: o.title, description: o.description, tab: "proof", css: CSS, body, source: SOURCE(run), ...(o.js ? { js: o.js, stage: false } : {}) });
}

const moneyOf = (run: AgentRun) => run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");

const ext = (p: { label: string; href: string | null }, label = p.label) => p.href ? `<a class="pf" href="${esc(p.href)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : "";
const AGENT_NAME = (a: string) => `${a[0]!.toUpperCase()}${a.slice(1)}`;

/**
 * The top of /metal (C2): the main run's Metal story in four blocks, each claim with its link to Metal's testnet
 * explorer, every figure from the record (src/redesign/metalStory.ts). Nothing here is typed in.
 */
export function metalStoryHtml(st: MetalStory): string {
  const block = (ic: string, tone: string, head: string, sub: string, links: string[], note: string | null = null) =>
    `<div class="st ${tone}"><span class="ic">${icon(ic, 20)}</span><b>${esc(head)}</b><span>${sub}</span><span class="tx">${links.filter(Boolean).join("")}</span>${note ? `<small class="xn">${esc(note)}</small>` : ""}</div>`;
  const p = st.payments, r = st.refusal, x = st.replace;
  return [
    block("shield-check", "", `${st.mandates.length} mandates on chain, one per agent`, esc("cap per payment, on the company's account"),
      st.mandates.map((m) => ext(m.proof, `${AGENT_NAME(m.agent)} ${m.cap}${m.how === "bound" ? ", after Face ID" : ", a payment under it"}`))),
    block("receipt", "", `${p.total} Metal payments, each its own transaction`, esc(`${p.sales} sales · ${p.purchases} supplier purchases · ${p.refunds} refunds · ${p.sweeps} sweep`), [ext(p.account), ext(p.checked)]),
    ...(r ? [block("ban", "bad", `#${r.seq} refused on chain`, `${esc(`${r.amount} over the ${r.cap} cap`)}: <code>${esc(r.code)}</code>; nothing moved`, [ext(r.proof)], refusalNote(r))] : []),
    // Review 9 Nov: who signs on chain, and who the second approver was, said where the card is.
    ...(x ? [block("scan-face", "ok", `Mandates replaced after Face ID`, esc(`${x.proposal}: Face ID in Purser + a build-tool test passkey; the owner key signed on chain${x.revoked ? `. #${x.revoked.seq} on the old mandate: ${x.revoked.code}` : ""}`),
      x.steps.map((s) => ext(s.proof, `${AGENT_NAME(s.agent)} ${s.cap}`)))] : []),
  ].join("");
}

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
  const p = partnerProof(run), st = metalStory(run.record), pay = payments(run.record);
  const metal = JSON.parse(readFileSync(new URL("../../docs/demo/metal.json", import.meta.url), "utf8")) as { features: { title: string; docs: { label: string; href: string }[] }[] };
  const used = metal.features.filter((f) => /mandate per agent|Replace and revoke|x402|facilitator|Refunds as mandate|Sweep after finality|Four eyes/i.test(f.title));
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  const beyond = separateRuns().map((x) => `<li><b>${esc(`${day(x.date)}, a separate run · ${x.title}`)}</b>: ${esc(x.what.replace(/^\d{1,2} \w+: /, ""))}. ${x.proofs.map((q) => ext(q)).join(" · ")}${x.proofs.length ? " · " : ""}${ext(x.record)}</li>`);
  return shell(run, {
    title: "Metal", description: "How Purser uses Metal: each agent's limit is a mandate on chain; payments per query over x402; a payment over the cap is refused on chain.",
    logo: LOGO.metal, h1: "A limit the agent cannot talk past", proofHash: "metal",
    picture: metalStoryHtml(st), flowClass: "story",
    nums: "",
    line: "Figures from the main run's record; links to Metal's testnet explorer.",
    // The one canonical set (jury review, 6 Nov, #5), first in the proof: the top counts the Metal ones.
    folds: fold("The live proof, with every tx", [...(pay.sums && pay.onChain === st.payments.total ? [plainLi(`${pay.line}.`)] : []), ...p.metal])
      + fold(`All ${metalTxs().length} transactions`, [`<li>${ext({ label: "Each with its link to the explorer", href: `${REPO_BLOB}${METAL_TX_LIST}` })}</li>`])
      + fold("Beyond the kit: separate runs, each dated (not the main run)", [...beyond,
        plainLi("In the main run, Face ID approves the change in Purser and the account's owner key, held by Purser's runner, signs the replace on chain; passkeys signing on chain themselves ran separately (1 November, above).")])
      + fold("The Metal features we use, and their docs", used.map((f) => docsLi(f.title, f.docs)))
      + fold("What is simulated", [plainLi("Test money on Metal testnet only."), plainLi("Stockline, the supplier, and Summit, the customer whose agent buys from us, are simulated; their payments are real testnet transactions."), plainLi("The second approver on the mandate change is a labelled test passkey; in production it is a second person.")])
      + fold("Archive", [`<li><a class="pf" href="metal/report">The Dispute desk's evidence report (30 October)</a></li>`]),
    ...(tokenize ? { after: `\n  ${tokenizeRunBlock(tokenize)}` } : {}),
  });
}

/** The payment-acceptance run of 10 November, as it ran (docs/runs/2026-11-10-payment-acceptance-sandbox.md). */
export const CARD_IN_LINE = "Money in by card, a separate sandbox run: a test customer paid a Northwind invoice with Airwallex's sandbox test card, and Purser booked it only after Airwallex reported PaymentIntent int_sgpv9bnppho0sezgl4a SUCCEEDED. Test money.";

/** The connected-accounts runs of 10 November, as they ran (docs/runs/2026-11-10-connected-accounts-sandbox.md). */
export const TWO_LOCKS_LINE = "Two locks on one payout, a separate sandbox run: after the CFO's passkey (a labelled test passkey) signed the exact terms, Airwallex's own approval workflow held transfer 4074d684-4704-406c-a527-2832753baf4f (EUR 240.00, the signed hash in its metadata) IN_APPROVAL; the web-app approval was not completed, so it is not paid. Test money.";
export const CONNECTED_LINE = "Purser as an Airwallex platform, a separate sandbox run: a test company's own connected account acct_SC-QD89fOneAeqaRFgOymw opened through Purser and made ACTIVE (verification simulated), then a EUR 5.00 payout on its behalf (a9460dba-f31b-4111-be58-6d9a9e71adb1) carried Purser's fee as an application fee, accepted by Airwallex at exactly EUR 0.05; PAID by the sandbox's simulation. Test money.";

export function airwallexPage(run: AgentRun = agentRun()): string {
  const p = partnerProof(run), st = stops(run.record), money = moneyOf(run);
  const booked = money.find((e) => e.via === "deposit" && e.dir === "in");
  const licence = money.find((e) => e.via === "SWIFT" && !e.refused);
  const earlier = money.filter((e) => e.earlier).length;
  const fx = fxOf(run.record), t = timings(run.record);
  const used = airwallexData().features.filter((f) => /^(cards|controls|transactions|swift|deposit)$/.test(f.id));
  const eur = licence ? `€${licence.amount.replace(/\.00$/, "")}` : "";
  // Airwallex, read back (section B): the CFO's hash with the payment, and each card's controls beside the CFO policy.
  const hash = hashTravel(run.record), cards = cardsReadback(), rows = cards ? cardControlRows(run.record, cards) : [];
  // awx-1 (7 Nov): the Airwallex-only run, a separate world, dated and labelled, below the main run's read-backs.
  const awx1Rec = awxRun();
  const awx1 = awxRunBlock(awx1Rec);
  // The Airi run (7 Nov): Visa Intelligent Commerce via Airwallex's Airi, a separate world, dated and labelled.
  // vic-2 (7 Nov): what Purser adds around Airi, under the first Airi run.
  const airi = airiRunBlock() + vic2RunBlock(undefined, { short: true });
  const readBack = hash || rows.length || awx1 || airi ? `<h2 class="vh">Airwallex, read back</h2><div class="awrb">${hashBlockHtml(hash)}${cards ? controlsSideBySideHtml(rows, cards.rec.read_at, cards.file) : ""}${awx1}${airi}</div>` : "";
  return shell(run, {
    title: "Airwallex", description: "How Purser uses Airwallex: earnings booked once final, the euro licence paid by SWIFT after the CFO's Face ID, card limits the bank enforces.",
    logo: LOGO.airwallex, h1: "The bank side of the agents", proofHash: "airwallex",
    picture: [node("zap", "Metal earnings", "final on chain", "metal"), arrow, node("landmark", booked ? `${booked.amount} USD booked` : "Booked at Airwallex", "simulated deposit", "awx"), arrow,
      node("scan-face", "CFO · Face ID", "approves the invoice"), arrow, ...(fx ? [node("arrow-left-right", `${fx.buy} by FX`, "only the shortfall", "awx"), arrow] : []),
      node("circle-check", licence ? `${eur} by SWIFT, accepted` : "SWIFT, accepted", licence ? `Airwallex accepted it with the signed hash; ${SANDBOX_SETTLED}` : "", "ok")].join(""),
    nums: nums([[booked?.amount ?? "0", "USD booked after finality"], [eur || "0", "licence paid by SWIFT"], ...(fx ? [[fx.buy.replace(/^EUR /, "€").replace(/\.00$/, ""), "bought by FX for the shortfall"] as [string, string]] : []), [String(st.tapDeclines + (awx1Rec?.declines_met.length ?? 0)), "card declines by Airwallex (TAP run and awx-1)"], ...(earlier ? [[String(earlier), "earlier attempt, nothing paid"] as [string, string]] : [])]),
    line: "Purser pays an invoice only after the CFO's Face ID; Airwallex enforces each card's limit itself.",
    extra: readBack,
    // Proof's "Policy and card side by side" opens the cards' fold here (#controls, or one card's #card-<agent>).
    ...(rows.length || airi ? { js: OPEN_TARGET_JS } : {}),
    // Payment acceptance, enabled on our sandbox 10 Nov (docs/runs/2026-11-10-payment-acceptance-sandbox.md): a separate run.
    folds: fold("The live proof, with every Airwallex id", [...p.airwallex, plainLi(CARD_IN_LINE), plainLi(CONNECTED_LINE), plainLi(TWO_LOCKS_LINE)])
      + fold("The Airwallex features we use, and their docs", used.map((f) => docsLi(f.title, f.docs)))
      + fold("What is simulated", [plainLi("The Airwallex sandbox, with test money only."),
        ...(licence ? [plainLi(`The SWIFT payout's settlement: Purser moves the sandbox transfer to SENT, then PAID, through Airwallex's simulation API${t.faceToPaid !== null ? `; the ${t.faceToPaid} s are measured from the CFO's Face ID to PAID` : ""}.`)] : []),
        ...money.filter((e) => e.earlier).map((e) => plainLi(earlierLine(e)))]),
  });
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

export function claudePage(run: AgentRun = agentRun()): string {
  const p = partnerProof(run), sp = split(run.record), s = run.record.snapshot;
  const calls = s.agent_stats.reduce((n, a) => n + a.claude_calls, 0);
  const requests = s.flows.filter((f) => f.request && f.model);
  const docs = [
    { title: "Tools the agents call", docs: [{ label: "Define tools", href: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools" }] },
    { title: "One model per job", docs: [{ label: "Models overview", href: "https://platform.claude.com/docs/en/models/overview" }, { label: "Pricing", href: "https://platform.claude.com/docs/en/about-claude/pricing" }] },
    { title: "Checked fields", docs: [{ label: "Structured outputs", href: "https://platform.claude.com/docs/en/build-with-claude/structured-outputs" }] },
    { title: "Cost", docs: [{ label: "Prompt caching", href: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching" }] },
  ];
  return shell(run, {
    title: "Claude", description: "How Purser uses Claude: three agents decide the exceptions, each decision a recorded Claude call; routine payments per query are code.",
    logo: LOGO.claude, h1: "Claude decides the exceptions", proofHash: "claude",
    picture: run.agents.map((a) => node(a.id === "sourcing" ? "package" : a.id === "support" ? "headphones" : "landmark", `${a.short} · ${a.family}`, `${s.agent_stats.find((x) => x.agent === a.id)?.decisions ?? 0} decisions`, "claude")).join(arrow),
    nums: nums([[`${sp.byClaude}/${sp.decisions}`, `decisions by Claude (${sp.fallbacks} fallbacks)`], [String(sp.routine), "routine payments by code"], [String(calls), "Claude calls, each with a request id"], [String(faceIdDecisions(run.record)), "Face ID decisions by the CFO"]]),
    // What a decision is here (jury review, 7 Nov, #19): holding and doing nothing count, as the record's own rows show.
    line: `${SPLIT_LINE} ${sp.decisions} decisions, including the ones to hold or do nothing.`,
    folds: fold("Each agent: decisions, calls, cost", p.claude)
      // All the decisions the headline counts (final review, 4 Nov: the chat's 21 of 24), cut at a word, never inside a number.
      + fold("Every decision, with its Claude call", decisionsOf(run.record).map((d) => `<li class="ok">${esc(`${d.agent[0]!.toUpperCase()}${d.agent.slice(1)}, ${d.at.slice(11, 16)} UTC: ${d.text.length > 140 ? `${d.text.slice(0, 140).replace(/\s+\S*$/, "")}…` : d.text}`)}${d.call ? `<br><span class="call" title="${esc(d.call.requestIds.join(", "))}">${esc(callBadge(d.call))}</span>` : ""}</li>`))
      + fold("Payments decided by Claude, with their request ids", requests.map((f) => `<li>${esc(`${f.what}: ${f.amount} ${f.unit === "EUR" ? "EUR" : "test USD"} · ${f.decided} · ${f.request}`)}</li>`))
      + fold("The Claude docs we built on", docs.map((d) => docsLi(d.title, d.docs))),
  });
}

/** The clean 404: what happened, and the four tabs. No script. */
export function notFoundPage(run: AgentRun = agentRun()): string {
  const body = `<main class="nf"><div class="wrap"><p class="pill">404</p><h1>This page does not exist.</h1><p class="line">Every page of the demo is one of these four.</p>
<div class="tabs2"><a class="btn primary" href="home">${icon("feather", 18)}Home</a>${WATCH_IN_MENU ? `<a class="btn" href="watch">${icon("play", 18)}Watch</a>` : ""}<a class="btn" href="try">${icon("sparkles", 18)}Try</a><a class="btn" href="proof">${icon("shield-check", 18)}Proof</a></div></div></main>`;
  return page({ title: "Not found", description: "This page does not exist.", tab: null, css: CSS, body, source: SOURCE(run) });
}
