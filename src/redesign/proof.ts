// Proof (mega-prompt v4, C5 and D3): everything from the played run (the main run, 3 Nov), compact. Who decides what (decisions by Claude next
// to routine payments by code), the run's numbers, four partner cards (Metal, Airwallex, Visa TAP as text, Claude) with
// their live proof folded, who stopped what, the Face ID decisions (one number, from the run's ledger), the earlier
// licence attempt that paid nothing, the checks, and a folded, labelled Archive. Nothing typed in by hand.

import { whyCompanyHtml } from "./home.js";
import { readFileSync } from "node:fs";
import { CFO_VIEW_LINK, CFO_VIEW_URL, CHAIN_TEST, FILM_LINK, FILM_URL, SECOND_APPROVER, SPLIT_LINE, VISA_EXTRA_LINK } from "../config/brand.js";
import { agentRun, faceIdDecisions, faceIdLine, family, letThroughOf, ownTap, payments, sandboxRails, runName, split, metalDetail, stopFigure, stopStory, stopSub, stops, stopsLine, tapRun, type AgentRun, type Ev, type RunRecord, type Tile } from "./run.js";
import { READBACK_CSS, cardControlRows, cardsReadback, controlsShortHtml, hashBlockHtml, hashTravel } from "./airwallexProof.js";
import { airiRunBlock } from "./airiRun.js";
import { awxRunBlock } from "./awxRun.js";
import { esc, icon, page } from "./ui.js";
import { LEAD_CSS, leadHtml, proofLeads } from "./proofLead.js";
import { TRACE_LINK, TRACE_URL } from "./trace.js";
import { PACK_LINK, PACK_NAME } from "../accounting/monthPack.js";

const readJson = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as T;

const CSS = `/* The deep proof, one closed line each (Max, 7 Nov: less text in sight). */
details.deep { margin-top: 14px; border-top: 1px solid var(--border); }
details.deep > summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; min-height: 56px; font-size: 20px; font-weight: 750; letter-spacing: -.01em; }
details.deep > summary::-webkit-details-marker { display: none; }
details.deep > summary::after { content: "▾"; font-size: 16px; color: var(--accent); } details.deep[open] > summary::after { content: "▴"; }
details.deep h2.sec { display: none; }
.cnote { margin: 12px 0 0; font-size: 13.5px; color: var(--muted); max-width: 60em; }
.clink { margin: 14px 0 0; } .clink a { color: var(--accent); font-weight: 650; text-decoration: none; }
.company { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; max-width: 60em; }
.company li { font-size: 17px; line-height: 1.45; border-left: 3px solid var(--accent); padding-left: 12px; }
.company a { color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap; }
details.deep section.band { padding: 8px 0 20px; border-top: 0; } details.deep section.band .wrap { padding: 0; } details.deep .sechead { display: none; }
.proofp { padding: 26px 0 24px; }
.phead { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 10px; }
.phead h1 { font-size: clamp(32px, 3.4vw, 44px); font-weight: 780; margin-right: auto; }
.split { margin: 0 0 18px; font-size: clamp(18px, 1.8vw, 21px); font-weight: 650; max-width: 46em; }
.nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 900px) { .nums { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
.num { padding: 16px 18px; text-decoration: none; display: flex; flex-direction: column; gap: 2px; transition: border-color .2s; }
.num:hover { border-color: var(--accent); }
.num .v { font-size: clamp(30px, 3vw, 40px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.num .l { font-size: 15px; font-weight: 650; color: var(--muted); line-height: 1.3; }
.num .note, .more p.note, .pcard p.note { font-size: 14px; font-weight: 500; color: var(--muted); line-height: 1.35; margin-top: 4px; }
.num.claude .v { color: var(--claude); } .num.code .v { color: var(--metal); } .num.face .v { color: var(--accent); } .num.stop .v { color: var(--bad); }
h2.sec { font-size: clamp(22px, 2.2vw, 28px); font-weight: 750; margin: 36px 0 14px; }
.partners { display: grid; gap: 12px; }
@media (min-width: 900px) { .partners { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pcard { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; scroll-margin-top: 80px; }
.pcard .ph { display: flex; align-items: center; gap: 12px; }
.pcard .ph h3 { font-size: 20px; margin-right: auto; }
.pcard .what { margin: 0; font-size: 17px; }
.facts { display: flex; flex-wrap: wrap; gap: 6px; }
.fact { font: 650 14px/1.35 Inter, system-ui, sans-serif; padding: 4px 10px; border-radius: 999px; background: var(--sunken); color: var(--text); }
.fact b { font-variant-numeric: tabular-nums; }
.logo { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid var(--border); flex: none; }
.logo.dark { background: #191919; border-color: #191919; } .logo img { display: block; height: 15px; width: auto; }
.logo.txt { background: var(--surface); color: var(--text); font-weight: 750; font-size: 14px; white-space: nowrap; }
details.fold { border-top: 1px solid var(--border); padding-top: 6px; }
details.fold > summary { cursor: pointer; font-weight: 650; font-size: 15.5px; color: var(--accent); list-style: none; display: flex; align-items: center; gap: 6px; min-height: 40px; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::after { content: "▾"; font-size: 14px; }
details.fold[open] > summary::after { content: "▴"; }
ul.pl { list-style: none; margin: 6px 0 4px; padding: 0; display: grid; gap: 8px; }
ul.pl li { font-size: 15.5px; line-height: 1.45; border-left: 3px solid var(--border); padding-left: 11px; overflow-wrap: anywhere; }
ul.pl li.no { border-left-color: var(--bad); } ul.pl li.ok { border-left-color: var(--ok); } ul.pl li.face { border-left-color: var(--accent); }
ul.pl small { display: block; color: var(--faint); font-size: 14px; }
ul.pl code { font: 600 14.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
abbr[title] { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
a.pf { color: var(--accent); font-weight: 600; text-decoration: none; font-size: 15px; }
.claim { margin: 0; font-size: 15.5px; line-height: 1.5; border-left: 4px solid var(--accent); padding: 4px 0 4px 12px; }
.open { font-size: 15px; font-weight: 650; color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.more { display: grid; gap: 12px; }
@media (min-width: 900px) { .more { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.more .card { padding: 16px 20px; scroll-margin-top: 80px; display: grid; gap: 6px; align-content: start; }
.more h3 { font-size: 18px; margin: 0; display: flex; align-items: center; gap: 8px; }
.more h3 .n { font-variant-numeric: tabular-nums; color: var(--accent); white-space: nowrap; flex: none; }
.more p { margin: 0; color: var(--muted); font-size: 15.5px; }
${READBACK_CSS}
${LEAD_CSS}`;

const JS = `
// A link to a part behind a closed line (#airwallex-readback, say) opens that line.
(function () { var open = function () { var t = location.hash && document.getElementById(location.hash.slice(1)); var d = t && t.closest("details.deep"); if (d) { d.open = true; t.scrollIntoView(); } }; open(); window.addEventListener("hashchange", open); })();(function () { var h = location.hash.slice(1); if (!h) return; var t = document.getElementById(h); if (!t) return; t.querySelectorAll("details").forEach(function (d) { d.open = true; }); })();`;

/** Plain words, with the raw code (a refusal code, a proposal id) kept in a tooltip. */
const CODES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/\bmandate_cap_exceeded\b:?/, () => "over the mandate's cap"], [/\bmandate_revoked\b/, () => "old mandate revoked"], [/\bfee_unknown\b/, () => "fee could not be priced"],
  [/\bLIMIT_EXCEEDED\b/, () => "over the card's limit"], [/\bMERCHANT_CATEGORY_NOT_ALLOWED\b/, () => "wrong kind of shop"], [/\bP-0*(\d+)\b/, (m) => `proposal ${m[1]}`],
];
export function plain(text: string): string {
  let out = "", rest = text;
  for (;;) {
    let best: { i: number; m: RegExpExecArray; f: (m: RegExpExecArray) => string } | null = null;
    for (const [re, f] of CODES) { const m = re.exec(rest); if (m && (!best || m.index < best.i)) best = { i: m.index, m, f }; }
    if (!best) return out + esc(rest);
    out += `${esc(rest.slice(0, best.i))}<abbr title="${esc(best.m[0].replace(/:$/, ""))}">${esc(best.f(best.m))}</abbr>`;
    rest = rest.slice(best.i + best.m[0].length);
  }
}
const li = (text: string, tone = "", link?: { label: string; href: string | null } | null, sub?: string) =>
  `<li class="${tone}">${plain(text)}${link ? ` ${link.href ? `<a class="pf" href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)} ↗</a>` : `<small>${plain(link.label)}</small>`}` : ""}${sub ? `<small>${plain(sub)}</small>` : ""}</li>`;
/**
 * The purchase let through to Metal (main run), in one clean line: who refused what, at what price, over which cap,
 * with the code as written; both layers in one line (CHAIN_TEST: Purser refuses first; with that check off once, Metal
 * refused anyway; jury review, 6 Nov, #8), and the run's Defense-in-depth label on its own line below it.
 */
export function letThroughLi(r: RunRecord, e: Extract<Ev, { k: "money" }>, prefix = "Refused by Metal: "): string {
  const cap = letThroughOf(r)?.cap ?? "";
  const link = e.proof.href ? ` <a class="pf" href="${esc(e.proof.href)}" target="_blank" rel="noopener">${esc(e.proof.label)} ↗</a>` : "";
  return `<li class="no">${esc(`${prefix}${e.what} at ${e.amount}${cap ? `, over the ${cap} cap` : ""} `)}(<code>${esc(e.refused?.code ?? "mandate_cap_exceeded")}</code>); nothing moved.${link}<small>${esc(CHAIN_TEST)}</small><small>${esc(e.refused?.reason ?? "")}</small></li>`;
}
/** A failed licence attempt and what followed, from the run's ledger: "The first licence transfer (P-0005) was refused …". */
export function earlierLine(e: Extract<Ev, { k: "money" }>): string {
  const id = /\((P-\d+)\)/.exec(e.what)?.[1] ?? "";
  return `The first licence transfer${id ? ` (${id})` : ""} was refused by the sandbox (${e.refused?.code ?? ""}; nothing paid); it is not a limit.${e.retried ? ` It was proposed again as ${e.retried.id}, approved with Face ID and ${e.retried.status || "paid"} at ${e.retried.at.slice(11, 16)} UTC.` : ""}`;
}
/** A separate labelled line below a figure, in its own words (codes kept as written). */
const noteHtml = (note: string | undefined, tag = "p") => (note ? `<${tag} class="note">${esc(note)}</${tag}>` : "");
export const fold = (summary: string, items: string[], open = false) => items.length ? `<details class="fold"${open ? " open" : ""}><summary>${esc(summary)}</summary><ul class="pl">${items.join("")}</ul></details>` : "";
const fact = (v: string, l: string) => `<span class="fact"><b>${esc(v)}</b> ${esc(l)}</span>`;
/** Partner names as text, never a brand logo (Max, 7 Nov: "overal alleen tekst"). */
export const LOGO = {
  metal: '<span class="logo txt">Metal</span>',
  airwallex: '<span class="logo txt">Airwallex</span>',
  claude: '<span class="logo txt">Claude</span>',
  visa: '<span class="logo txt">Visa TAP</span>',
};

/**
 * The live proof of each partner, as list items: shared by Proof's cards and the partner pages. Without `tap`, the
 * separate TAP run's decline is left out of Airwallex's (Max's last round, item 2: on /proof TAP is the footer link only).
 */
export function partnerProof(run: AgentRun, o: { tap?: boolean } = {}): Record<"metal" | "airwallex" | "visa" | "claude", string[]> {
  const s = run.record.snapshot;
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const tap = tapRun(), own = ownTap(run.record);
  const mandates = run.events.filter((e): e is Extract<Ev, { k: "mandate" }> => e.k === "mandate");
  const tapDecline = o.tap === false ? undefined : tap?.steps.find((x) => !x.approved);
  return {
    metal: [
      ...money.filter((e) => e.refused?.by === "recorded").map((e) => li(`Refused · recorded on chain: ${e.amount} test USD to ${e.what}, ${e.refused!.code ?? ""}. Purser refused it before signing; Metal recorded the same refusal on chain`, "no", e.proof)),
      ...money.filter((e) => e.refused?.by === "metal").map((e) => (e.letThrough ? letThroughLi(run.record, e) : li(`Refused by Metal: ${e.what}, ${e.refused!.reason}; nothing moved`, "no", e.proof.href ? e.proof : null))),
      ...mandates.map((m) => li(`New mandate on chain after two signatures: ${m.agent[0]!.toUpperCase()}${m.agent.slice(1)} agent, cap ${m.cap}, budget ${m.budget}`, "ok", m.proof)),
      ...s.rails.metal.filter((r) => !/^Refused|^Mandate replaced/.test(r.what)).map((r) => li(`${r.what}: ${r.detail}`, "", r.proof)),
    ],
    airwallex: [
      ...sandboxRails(s.rails.airwallex).map((r) => li(`${r.what}: ${r.detail}`, "", r.proof)),
      ...(tapDecline ? [li(`The limit, enforced by Airwallex (${tap!.label}): EUR ${tapDecline.amount} declined, ${tapDecline.reason ?? ""}`, "no", { label: `Airwallex ${tapDecline.txId.slice(0, 8)}… · read back with GET: ${tapDecline.getStatus}`, href: null })] : []),
      ...money.filter((e) => e.rail === "airwallex" && e.refused?.by === "airwallex-sandbox").map((e) => li(`${earlierLine(e)}`, "no", null)),
    ],
    visa: [
      // The played run's own TAP-signed buy (main run), then the separate TAP run of 2 November, labelled as that run.
      ...(own ? [li(`In this run: the Sourcing agent (${family(own.model)}) bought the ${own.plan} plan at ${own.merchant}, EUR ${own.amount}; our layer verified both TAP signatures (${own.sig1}, ${own.sig2}); the agent's Airwallex card ····${own.last4} was approved by Airwallex`, "ok", { label: `Airwallex ${own.txId.slice(0, 8)}…`, href: null })] : []),
      ...(tap ? tap.steps.map((x) => li(
        `${tap.label}: ${x.model ? `the Sourcing agent (${family(x.model)}) picked the card rail` : "code tried one purchase over the card's limit"}: Visa's reference proxy answered ${x.proxyStatus}, our layer verified both signatures (${x.sig1}, ${x.sig2}); the Airwallex card (brand as Airwallex returns it: ${x.brand}) was ${x.approved ? "approved" : `declined by Airwallex (${x.reason})`}, EUR ${x.amount}`,
        x.approved ? "ok" : "no", { label: `Airwallex ${x.txId.slice(0, 8)}… · read back with GET: ${x.getStatus}`, href: null })) : []),
    ],
    claude: s.agent_stats.map((a) => li(`${a.agent[0]!.toUpperCase()}${a.agent.slice(1)} agent on ${family(a.models[0])}: ${a.by_claude} of ${a.decisions} decisions by Claude, ${a.fallback} fallback, ${a.claude_calls} calls, USD ${(a.cost_usd_micros / 1e6).toFixed(4)}`, "ok")),
  };
}

/**
 * The partner cards: logo, the strongest proof first (proofLeads: each claim a link, its numbers from its record), one
 * line, two or three numbers, the live proof folded, a link to the partner's page.
 */
function partnerCards(run: AgentRun): string {
  const s = run.record.snapshot, p = partnerProof(run, { tap: false }), st = stops(run.record), sp = split(run.record), pay = payments(run.record), lead = proofLeads(run.record);
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const onChain = money.filter((e) => e.rail === "metal" && !e.refused).reduce((n, e) => n + e.count, 0);
  const mandates = run.events.filter((e) => e.k === "mandate").length;
  const awx = money.filter((e) => e.rail === "airwallex" && !e.refused).length;
  // Max, 7 Nov: the name above, 2–3 short facts each with its number in bold, no brackets or jargon; the claims, the
  // sentence and the live proof behind one fold. Names as text, never a brand logo.
  const card = (id: "metal" | "airwallex" | "claude", name: string, what: string, facts: string, items: string[], extra = "") =>
    `<article class="pcard card" id="${id}"><div class="ph"><h3>${esc(name)}</h3><a class="open" href="${id}">More<span class="vh"> about ${esc(name)}</span> ${icon("arrow-right", 14)}</a></div><div class="facts">${facts}</div><details class="fold"><summary>Show the live proof</summary>${leadHtml(lead[id])}<p class="what">${esc(what)}</p>${extra}${items.length ? `<ul class="pl">${items.join("")}</ul>` : ""}</details></article>`;
  const cardsMatch = /^(\d+ of \d+) cards carry the CFO's policy$/.exec(lead.airwallex.find((l) => / cards carry the CFO's policy$/.test(l.text))?.text ?? "");
  return `<div class="partners">
${card("metal", "Metal", "Each agent's limit is a mandate on chain; payments per query over x402.", fact(String(onChain), "payments on chain") + fact(String(st.metal), "refused by Metal at the limit") + fact(String(mandates), "limits replaced on chain"), p.metal, (st.revoked ? `<p class="note">${esc(`${st.revoked} refused by Metal because its mandate had just been replaced.`)}</p>` : "") + (pay.sums && pay.onChain === onChain ? `<p class="note">${esc(`${pay.onChainLine}.`)}</p>` : ""))}
${card("airwallex", "Airwallex", "Earnings booked once final, the euro licence by SWIFT, cards with limits the bank enforces.", fact(String(awx), "movements at Airwallex") + (cardsMatch ? fact(cardsMatch[1]!, "cards carry the CFO's limits") : "") + (st.airwallex ? fact(String(st.airwallex), "declined by Airwallex") : ""), p.airwallex)}
${card("claude", "Claude", `The agents decide with Claude: ${run.agents.map((a) => `${a.short} on ${a.family}`).join(", ")}.`, fact(`${sp.byClaude}/${sp.decisions}`, "decisions by Claude") + fact(String(s.agent_stats.reduce((n, a) => n + a.claude_calls, 0)), "calls to Claude, each logged"), p.claude)}
</div>`;
}

function moreCards(run: AgentRun): string {
  const r = run.record, s = r.snapshot;
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const faces = run.events.filter((e): e is Extract<Ev, { k: "face" }> => e.k === "face");
  const story = stopStory(r);
  // Every stop the figure counts, by who stopped it (stopStory), each with its proof where there is one.
  const skipped = s.refusals.filter((x) => x.agent === "sourcing" && /own buy policy/.test(x.reason)).map((x) => /#(\d+)/.exec(x.reason)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  const range = skipped.length > 1 && skipped[skipped.length - 1]! - skipped[0]! === skipped.length - 1 ? `#${skipped[0]}–#${skipped[skipped.length - 1]}` : skipped.map((n) => `#${n}`).join(", ");
  const stopItems = [
    ...(story.claude ? [li(`By a buy rule Claude set: the Sourcing agent (Claude) set a buy rule; code applied it to ${story.claude} overpriced stock check${story.claude === 1 ? "" : "s"}${range ? ` (${range})` : ""}; nothing signed, the customer not charged`, "no")] : []),
    ...money.filter((e) => e.refused?.by === "recorded").map((e) => li(`By Metal: ${e.amount} test USD over the mandate's cap; Purser refused it before signing and Metal recorded the same refusal on chain`, "no", e.proof)),
    ...money.filter((e) => e.refused?.by === "metal" && e.refused.code !== "mandate_revoked").map((e) => (e.letThrough ? letThroughLi(r, e, "By Metal: ") : li(`By Metal: ${e.what}, ${e.refused!.reason} (${e.refused!.code ?? ""})`, "no", e.proof.href ? e.proof : null))),
    ...money.filter((e) => e.refused?.code === "mandate_revoked").map((e) => li(`By Metal: ${e.what}, refused on chain because its mandate had just been replaced`, "no", e.proof.href ? e.proof : null)),
    ...faces.filter((f) => f.status === "REJECTED").map((f) => li(`By the CFO with Face ID: ${f.id} · ${f.title} rejected`, "no")),
    ...s.refusals.filter((x) => /planted instruction/i.test(x.what)).map((x) => li(`${x.what}: ${x.reason.replace(/: "[\s\S]*$/, "")}`, "no")),
  ];
  // One Face ID number from one source (faceIdDecisions): the proposals the CFO decided with his passkey, from the run's ledger.
  const faceItems = faces.map((f) => li(`${f.id} · ${f.title}: ${f.status === "COSIGNED" ? `1 of 2 signatures, by ${f.signers[0]}` : `${f.status === "REJECTED" ? "rejected" : "approved"} by ${f.signers.join(" and ")}${f.signers.length > 1 ? ` (${f.signers.length} of ${f.signers.length} signatures)` : ""}`}`, "face", null, f.signers.length > 1 ? SECOND_APPROVER : undefined));
  const earlier = money.filter((e) => e.earlier);
  // The red team (final review, 4 Nov: "39/39 attacks failed" read as all prevented): those stopped before anything
  // moved, apart from those found only afterwards; the later run Proof summarises with its scope, the latest linked.
  const rt = readJson<{ ran_at: string; model: string; runs_per_case: number; summary: { runs: number; held: number }; results: { id: string }[] }>("docs/evals/autonomy-redteam.json");
  const red = readJson<{ ran_at: string; attempts: number; results: { caught?: string; title: string }[] }>("docs/redteam/report.json");
  const night = readJson<{ ran_at: string; model: string }>("docs/redteam/night-2026-11-02.json");
  const stoppedBefore = red.results.filter((x) => x.caught === "before").length;
  const after = red.results.filter((x) => x.caught === "after").map((x) => x.title.replace(/^./, (c) => c.toLowerCase()));
  const dayLong = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
  const t = s.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
  const checked = t ? new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size : 0;
  const refunded = money.filter((e) => e.agent === "support" && /refund/i.test(e.what) && !e.refused).length;
  const box = (id: string, ic: string, h: string, n: string, p: string, inner: string, link?: [string, string]) => `<div class="card" id="${id}"><h3>${icon(ic, 18)}${n ? `<span class="n">${esc(n)}</span>` : ""}${esc(h)}</h3><p>${plain(p)}</p>${inner}${link ? `<a class="open" href="${esc(link[1])}">${esc(link[0])} ${icon("arrow-right", 14)}</a>` : ""}</div>`;
  const archive = [
    `<li><a class="pf" href="./?recorded">The CFO dashboard of the earlier recorded run (30 October)</a></li>`,
    `<li><a class="pf" href="metal/report">The Dispute desk's evidence report (30 October)</a></li>`,
    `<li><a class="pf" href="film">The earlier animation (30 October)</a></li>`, `<li><a class="pf" href="month">A month in 90 seconds (simulated)</a></li>`, `<li><a class="pf" href="lab">The Scenario Lab</a></li>`,
  ];
  return `<div class="more">
${box("stops", "ban", stopSub(story), stopFigure(story), `${stopsLine(story)}${story.metal && metalDetail(story) ? ` Metal's ${story.metal}: ${metalDetail(story)}.` : ""}`, fold("Show each one", stopItems))}
${box("faceid", "scan-face", faceIdLine(faceIdDecisions(r), faces.length).label, String(faceIdDecisions(r)), `Proposals the CFO decided on his phone${faces.some((f) => f.status === "COSIGNED") ? "; the mandate change needed a second signature too" : ""}. ${SECOND_APPROVER}`, fold(`Show the ${faces.length} signatures: ${faceIdDecisions(r)} decisions + ${faces.length - faceIdDecisions(r)} co-signature${faces.length - faceIdDecisions(r) === 1 ? "" : "s"}`, faceItems))}
${earlier.length ? box("earlier", "rotate-ccw", "earlier attempt, nothing paid", String(earlier.length), "The sandbox could not price the fee: nothing paid, not a limit.", fold("Show what followed", earlier.map((e) => li(earlierLine(e), "no", { label: e.proof.label, href: null })))) : ""}
${box("dispute", "users", "orders disputed", String(checked), `${checked - refunded} proven valid · ${refunded} wrong data, refunded.`, "", ["Watch the dispute", "watch?scene=2"])}
${box("redteam", "shield-check", "attacks stopped", `${stoppedBefore}/${red.attempts}`, `${after.length ? `${after.length} more detected afterwards, not prevented (${after.join("; ")}). ` : ""}${dayLong(red.ran_at)}, a test world on simulated rails.`, fold("Later runs", [
  li(`${dayLong(rt.ran_at)}, against the agent loop: ${rt.summary.held} of ${rt.summary.runs} runs held (${new Set(rt.results.map((x) => x.id)).size} attacks, ${rt.runs_per_case} runs each; the Sourcing agent on ${family(rt.model)}, simulated rails).`, rt.summary.held === rt.summary.runs ? "ok" : "no"),
  `<li>${esc(`${dayLong(night.ran_at)}, Claude ${family(night.model)} as the attacker:`)} <a class="pf" href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-02-night-batch.md#5-red-team-opus-as-the-attacker" target="_blank" rel="noopener">the night batch's report, with what got through ↗</a></li>`,
]))}
${box("health", "database", "audit rows", String(s.audit.rows), `Hash chain ${s.audit.intact ? "intact" : "broken"} (${runName(r)}).`, "", ["Open the CFO dashboard", "./?autonomy"])}
${box("archive", "clock", "Archive", "", "Earlier runs and tools, kept as they were.", fold("Show the archive", archive))}
</div>`;
}

/**
 * Airwallex, read back (section B): the hash the CFO signed beside the one Airwallex returns with the transfer, and each
 * agent's card controls as Airwallex returns them beside the CFO policy, from the dated GET-only records in docs/runs.
 */
export function readBack(run: AgentRun): string {
  const h = hashTravel(run.record), cards = cardsReadback(), rows = cards ? cardControlRows(run.record, cards) : [];
  // awx-1 (7 Nov): the separate Airwallex-only run, dated and labelled, under the main run's read-backs.
  const awx1 = awxRunBlock(undefined, { short: true });
  // The Airi run (7 Nov): one short line, dated and labelled, linking to every step on /airwallex.
  const airi = airiRunBlock(undefined, { short: true });
  if (!h && !rows.length && !awx1 && !airi) return "";
  return `<h2 class="sec" id="airwallex-readback">Airwallex, read back</h2>
  <div class="awrb two">${hashBlockHtml(h)}${cards ? controlsShortHtml(rows, cards.rec.read_at, cards.file) : ""}</div>${awx1 || airi ? `
  <div class="awrb">${awx1}${airi}</div>` : ""}`;
}

export function proofPage(run: AgentRun = agentRun()): string {
  const r = run.record, sp = split(r), story = stopStory(r), pay = payments(r);
  const nums: (Tile & { cls: string })[] = [
    { cls: "claude", value: String(sp.byClaude), label: `decisions by Claude (${sp.fallbacks} fallbacks)`, explain: "", href: "#claude" },
    // One canonical set (jury review, 6 Nov, #5): "86 Metal payments + 1 card charge", never 82 or 87 beside it.
    { cls: "code", value: String(pay.onChain), label: pay.canonical.replace(/^\d+ /, ""), explain: "", href: "#metal", ...(pay.sums ? { note: `${pay.metalParts} on Metal, all inside the limits.` } : {}) },
    { cls: "face", value: String(faceIdDecisions(r)), label: faceIdLine(faceIdDecisions(r), run.events.filter((e) => e.k === "face").length).label, explain: "", href: "#faceid" },
    // No TAP remark under the figures (Max's last round, item 2): TAP is on /visa, linked from the footer.
    { cls: "stop", value: stopFigure(story), label: stopSub(story), explain: "", href: "#stops" },
    { cls: "", value: `$${run.derived.perDecision}`, label: "Claude cost per decision", explain: "", href: "#claude" },
  ];
  const body = `<main class="proofp"><div class="wrap">
  <div class="phead"><h1>Proof</h1><span class="pill run">${icon("database", 14)}${esc(run.label)}</span><a class="open" href="${FILM_URL}" target="_blank" rel="noopener">${icon("play", 14)}${esc(FILM_LINK)} ↗</a><a class="open" href="${CFO_VIEW_URL}">${icon("layout-dashboard", 14)}${esc(CFO_VIEW_LINK)}</a><a class="open" href="${TRACE_URL}">${icon("receipt", 14)}${esc(TRACE_LINK)}</a><a class="open" href="assets/${PACK_NAME}" download>${icon("file-check", 14)}${esc(PACK_LINK)}</a></div>
  <p class="split">${esc(SPLIT_LINE)}</p>
  <div class="nums">${nums.map((n) => `<a class="num card ${n.cls}" href="${n.href}"><span class="v">${esc(n.value)}</span><span class="l">${esc(n.label)}</span>${noteHtml(n.note, "span")}</a>`).join("")}</div>
  <h2 class="sec">The partners</h2>
  ${partnerCards(run)}
  <details class="deep"><summary>Airwallex, read back</summary>${readBack(run)}</details>
  <details class="deep"><summary>Every check</summary>${moreCards(run)}</details>
  <details class="deep"><summary>Why this is a company</summary>${whyCompanyHtml()}</details>
</div></main>`;
  return page({
    title: "Proof", description: "Every proof of the main run in one place: who decided, who paid, who stopped what, each partner's live proof.", tab: "proof", css: CSS, body, js: JS, stage: false,
    // Visa TAP as a footer link (jury review, 6 Nov, #7): an extra, not an award entry.
    links: [["visa", VISA_EXTRA_LINK]],
    source: `Source: ${run.file} (${run.name}) and the run records in docs/runs and docs/evals.`,
  });
}
