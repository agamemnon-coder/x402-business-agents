// The submission deck (awards item 6; pitch round, 5 Nov; Max's review round, 5 Nov; section D, 6 Nov): twelve 16:9 slides as one HTML
// page, printed to PDF by npm run submission. Dark, calm, one message per slide, in the pitch's order
// (docs/submission/pitch.md): the line, the problem, how it works, the run in three beats, the jury's own signature
// (QR to /try/sign), the proof, what is real and what is not, Claude, the road to production, the links. Every figure
// comes from packFacts() and the main run's record through src/redesign/run.ts, the same functions the pages use;
// test/pitch.test.ts checks the deck against the record. The font, the screenshots and the QR code are embedded, so the
// PDF needs no network. No logos: "Built on Airwallex and Metal" as text (Max, 5 Nov).

import { readFileSync } from "node:fs";
import type { PackFacts } from "./facts.js";
import { DIFFERENTIATORS, HERO, KIT11_RUN_LINE, NORTHWIND_LINE, PROOF_SENTENCES, TRY_IT, VISA_TAP_STATUS, WHAT_IT_IS, WHY_COMPANY, WHY_COMPANY_NOTE } from "../config/brand.js";
import { cardControlRows, hashTravel } from "../redesign/airwallexProof.js";
import { AIRI_RUN_LABEL, AIRI_SUMMARY, airiRun, airiRunSummary } from "../redesign/airiRun.js";
import { agentRun, homeFilm, stopsLine } from "../redesign/run.js";
import { INPUTS, USAGE_LABEL, invoiceLine, opusLine, unitEconomics } from "../business/unitEconomics.js";
import { PRICING, PRICING_LABEL } from "../config/pricing.js";

const asset = (p: string) => readFileSync(new URL(`../ui/${p}`, import.meta.url));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The public page an agent task is typed into. */
export const TRY_URL = "https://kit11.max-31b.workers.dev/try";
/** The page the QR slide (and docs/media/try-sign-qr.png) opens: the jury signs a test proposal with its own passkey. */
export const QR_URL = `${TRY_URL}/sign`;
/** The repository a juror reads. */
export const REPO_URL = "https://github.com/agamemnon-coder/x402-business-agents";
/**
 * The core line, word for word on every surface of the pitch (Max, 5 Nov). Never "code decides"
 * (test/core-line.test.ts).
 */
export const CORE_LINE = "Claude explains and proposes, the rules in code hold every limit, and a person signs before money moves beyond them.";
/** What Purser does, in Max's words (review round, 5 Nov): on slide 2 and in the pitch at about 0:25. */
export const RULE_LINE = "Inside its limits an agent pays alone; beyond them, the CFO signs.";
/** The main run's stops in one sentence (Max, 5 Nov), the site's own (run.ts stopsLine). */
export { stopsLine };
/** Metal's refusal of #24, said one way everywhere (review round, 5 Nov). */
export const REFUSAL_LINE = "Metal refused it; the refusal is recorded on chain.";
/**
 * T:0, one sentence everywhere (README, form, claims, docs/t0.md, the run log): posted on 10 Nov
 * (docs/runs/2026-11-10-t0-journal-sandbox.md). Earlier keys were refused: 403 CAPI71 on 3 Nov, 401 CAPI11 on 5 Nov.
 */
export const T0_STATUS = "T:0: 95 journal entries posted to T:0's shared sandbox entity on 10 Nov (first je_prod_z7kTCuZ1iiwad01q); debits equal credits, and T:0 matches our books line by line.";
/** The T:0 sentence without its error codes, for a slide (the codes are in docs/submission/qa.md). */
export const T0_SHORT = "T:0: 95 journal entries posted to its shared sandbox, 0 differences with our books; a second push posted none; its own balance sheet balances.";
/** The two-locks run (10 and 12 Nov, docs/runs/2026-11-12-airwallex-two-locks-paid.md), as honest as its record. */
export const TWO_LOCKS_LINE = "Two locks on one payout (10 and 12 Nov): a labelled test passkey signed the terms, Airwallex held the transfer IN_APPROVAL until the owner approved it in Airwallex's web app; then PAID (sandbox, settlement simulated).";
/** What of the main run is on Metal testnet (README, checked against the chain on 5 Nov), in one sentence for a slide. */
export const METAL_LINE = "Metal testnet: 86 payments and 6 mandate transactions, on chain, checkable; no clearing in this run.";

/** Screenshots by name (data URIs), as npm run submission takes them. */
export type DeckShots = Record<"landing" | "dashboard" | "metal" | "live" | "disputes" | "books" | "phoneOptions" | "phoneConfirm" | "rails" | "inspector" | "fourEyes" | "compliance" | "try" | "overview" | "claude" | "result" | "dispute" | "refuse" | "decline" | "max" | "watch" | "proof" | "visa", string>;

interface Slide { kicker: string; title: string; points?: string[]; extra?: string; pic?: string; /** No picture: the text takes the whole slide. */ wide?: boolean }

const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const shot = (src: string, caption: string) => `<figure class="shot">${src ? `<img src="${src}" alt="">` : ""}<figcaption>${esc(caption)}</figcaption></figure>`;
const stat = (value: string, label: string) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const shortId = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const shortHash = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;
/** The suite's size as the README states it (test/readme-badges.test.ts keeps it the real `npx vitest run` count). */
export function testCount(): { n: number; files: number } {
  const m = /\*\*(\d+) tests in (\d+) files, all passing\*\*/.exec(readFileSync(new URL("../../README.md", import.meta.url), "utf8"));
  return { n: Number(m?.[1] ?? 0), files: Number(m?.[2] ?? 0) };
}

export function deckHtml(f: PackFacts, s: DeckShots, qrSvg: string): string {
  const rt = f.redteam, m = f.main;
  const film = homeFilm(agentRun());
  const record = agentRun().record;
  const ev = record.ledger?.events ?? [];
  const replaced = ev.filter((e) => e.event === "mandate.replaced").map((e) => String(e.payload.tx ?? ""));
  const sweepTx = String(ev.find((e) => e.event === "sweep.paid")?.payload.tx ?? "");
  const deposit = String(ev.find((e) => e.event === "credit.deposited")?.payload.deposit_id ?? "");
  const conversion = String(ev.find((e) => e.event === "fx.converted")?.subject ?? "");
  const rest = m.disputed - m.refunded.length;
  // Treasury's two options after the price rise, from their proposals' own terms (P-0002 option A, P-0003 option B).
  const option = (o: string) => record.ledger?.proposals.find((p) => p.kind === "mandate_replace" && p.terms?.option === o)?.terms as { query_price?: string; total_budget?: string; steps?: { agent: string; cap: string }[] } | undefined;
  const optA = option("A"), optB = option("B");
  const capOf = (o: typeof optA) => o?.steps?.find((x) => x.agent === "sourcing")?.cap ?? "";
  const sentence = (partner: string) => PROOF_SENTENCES.find((x) => x.partner === partner)!.text;
  const hash = hashTravel(record);
  const cards = cardControlRows(record);
  const tests = testCount();
  // The Airi run (7 Nov), Visa Intelligent Commerce via Airwallex's Airi, on the Airwallex slide in the owner's copy: its
  // heading, label, summary sentence, outcome badges and checks, from its record (docs/demo/airi-run.json).
  const airiRec = airiRun(), airi = airiRec ? airiRunSummary(airiRec) : null;
  const ue = unitEconomics();
  const slides: Slide[] = [
    {
      kicker: "Purser · Starter Kit 11 · x402 Business Agents",
      // The one tagline (jury QA, 6 Nov, Q8): Home's heading and the film's line; then what Purser is (section D).
      title: HERO,
      wide: true,
      extra: `<p class="lead what">${esc(WHAT_IT_IS)}</p>
        <p class="kitrun">${esc(KIT11_RUN_LINE)}</p>
        <div class="stats four">${stat(`${m.by_claude}/${m.decisions}`, `decisions by Claude, ${m.fallbacks} fallbacks`)}${stat(m.stop_figure, m.stop_sub)}${stat(String(m.face_id), "decisions signed with Face ID (+1 co-signature)")}${stat(`${m.face_to_paid_s} s`, "from Face ID to PAID; the settlement is simulated in the sandbox")}</div>
        <p class="src">One live run, 3 November 2026: Metal testnet and the Airwallex sandbox, test money only.</p>
        <p class="built">Built on Airwallex and Metal, with Claude.</p>`,
    },
    {
      kicker: "The problem",
      title: "AI agents are starting to spend money. So who signs off?",
      wide: true,
      points: [
        "An agent pays as fast as it is told to, also by a fake invoice.",
        "A limit written in a prompt can be talked out of.",
        `<b>Purser: ${esc(RULE_LINE)}</b>`,
      ],
    },
    {
      kicker: "What only Purser has",
      title: "Each agent its own card and its own mandate",
      wide: true,
      // What only Purser has (jury review, 6 Nov, #1): the three sentences word for word, then "Try it in a minute."
      extra: `<ul class="why">${DIFFERENTIATORS.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
        <p class="tryline">${esc(TRY_IT)} <span>${esc(QR_URL.replace(/^https:\/\//, ""))}</span></p>
        <div class="flow">
          <div class="box"><b>Agent</b><small>a Claude agent explains and proposes</small></div><span class="arrow">→</span>
          <div class="box"><b>Rules</b><small>Purser's code checks each proposal</small></div><span class="arrow">→</span>
          <div class="box accent"><b>Person</b><small>Face ID on the exact terms, beyond the limits</small></div><span class="arrow">→</span>
          <div class="box"><b>Airwallex · Metal</b><small>card controls · mandates on chain</small></div><span class="arrow">→</span>
          <div class="box"><b>Books</b><small>hash-chained audit log; <!-- T0-STATUS -->T:0: 95 entries posted (sandbox)<!-- /T0-STATUS --></small></div>
        </div>
        <p class="kit">Northwind Outdoor, ${esc(NORTHWIND_LINE)}. Three agents (${m.kit11.map((k) => esc(k.agent.replace(/ agent$/, ""))).join(", ")}), 20.00 test USD between them.</p>`,
    },
    {
      kicker: "The demo · try it yourself",
      title: "Sign one yourself",
      wide: true,
      extra: `<div class="qrslide"><div class="qr">${qrSvg}</div><div><p class="url">${esc(QR_URL.replace(/^https:\/\//, ""))}</p>
        <p class="big">A test world of your own. A rule blocks one payment; you sign the other with your passkey.</p>
        <p class="big">Change one cent, and the same signature is refused.</p>
        <p class="small">Test world · test passkey · nothing real moves.</p></div></div>`,
    },
    {
      kicker: "The main run, 3 November 2026 · replay on /watch",
      title: "One live run, three beats",
      wide: true,
      extra: `<div class="beats">
        <div><em>1 · The price rise</em><b>${esc(film?.supplier ?? "The supplier")} ${esc(film?.old ?? "")} → ${esc(film?.price ?? "")}, over the ${esc(film?.cap ?? "")} cap</b><p>${esc(REFUSAL_LINE)}</p></div>
        <div><em>2 · The dispute</em><b>Only the ${m.refunded.length} bad ones refunded</b><p>${m.disputed} orders disputed; "refund the other ${rest}" rejected by the CFO with Face ID.</p></div>
        <div><em>3 · The euro bill</em><b>Accepted by Airwallex with the signed hash</b><p>${esc(m.fx_buy)} bought by FX for only the shortfall; settlement simulated in the sandbox.</p></div>
      </div>
      <p class="options"><b>Treasury's options, within the same ${esc(optA?.total_budget ?? "")}:</b> A: Sourcing's cap ${esc(capOf(optA))}, our price stays ${esc(optA?.query_price ?? "")} · B: the same cap, our price ${esc(optB?.query_price ?? "")}. The CFO signed A.</p>`,
    },
    {
      kicker: "Airwallex proof · sandbox, read back with GET only",
      title: "The hash the CFO signed is in Airwallex's record",
      wide: true,
      extra: `<p class="sentence">${esc(sentence("Airwallex"))}</p>
        <div class="cols">
          <div><h2>The SWIFT payment (${esc(hash?.proposalId ?? "")})</h2><dl class="pairs">
            <dt>Signed with Face ID</dt><dd><code>${esc(shortHash(hash?.signed ?? ""))}</code></dd>
            <dt>In Airwallex's record</dt><dd><code>${esc(shortHash(hash?.carried ?? ""))}</code> ${hash?.match ? "<b class='ok'>match</b>" : "<b class='bad'>no match</b>"}</dd>
            <dt>Transfer</dt><dd><code>${esc(shortId(hash?.transferId ?? ""))}</code>, ${esc(hash?.transferMethod ?? "")}, ${esc(hash?.currency ?? "")} ${esc(hash?.amount ?? "")}, ${esc(hash?.transferStatus ?? "")}</dd>
          </dl></div>
          <div><h2>Each agent's card: the CFO policy as Airwallex's own controls</h2><ul class="cards">${cards.map((r) => `<li><b>${esc(r.name)}</b> ····${esc(r.last4)}: ${r.checks.filter((c) => c.ok).length} of ${r.checks.length} controls match${r.match ? "" : " (not all)"}</li>`).join("")}</ul>
          <p class="small">Limit per purchase and per month, merchant category, currency, end date.</p></div>
        </div>
        ${airi ? `<div class="vic"><b>${esc(airi.heading)}</b> <span>${esc(AIRI_RUN_LABEL)}</span><p>${esc(AIRI_SUMMARY)}</p><p class="badges">${airi.outcomes.map((o) => `<em class="${o.ok ? "ok" : "bad"}">${esc(o.badge)}</em>`).join("")}<em class="${airi.checksOk === airi.checksAll ? "ok" : "bad"}">${esc(`${airi.checksOk} of ${airi.checksAll} checks pass`)}</em></p></div>` : ""}
        <p class="src">Read on ${esc(hash?.readAt.slice(0, 10) ?? "")} from the sandbox: <code>${esc(hash?.file ?? "")}</code> and the cards' record beside it. Also on /proof and /airwallex; the Airi run on /airwallex, /visa and /proof (<code>docs/demo/airi-run.json</code>).</p>`,
    },
    {
      kicker: "Metal proof · testnet",
      title: "Every id is published",
      points: [
        `<b>${esc(sentence("Metal"))}</b>`,
        `${esc(m.stop_line)}${m.metal_detail ? ` Metal's ${m.stops.metal}: ${esc(m.metal_detail)}.` : ""}`,
        `On chain, checkable: Metal's refusal <code>${esc(short(m.let_through_tx))}</code>; the mandate replacements ${replaced.map((t) => `<code>${esc(short(t))}</code>`).join(", ")}; the sweep <code>${esc(short(sweepTx))}</code>`,
        `Published: FX <code>${esc(shortId(conversion))}</code>, SWIFT <code>${esc(shortId(m.licence_transfer))}</code>, deposit <code>${esc(shortId(deposit))}</code>; card raise ${esc(m.card_raise.proposal)}, EUR ${esc(m.card_raise.from)} → ${esc(m.card_raise.to)}, then Airwallex authorization <code>${esc(shortId(m.card_raise.auth))}</code>`,
      ],
      pic: shot(s.dispute, `The main run, 3 November (/watch): #${m.refunded.join(", #")} refunded, each on chain; "refund the other ${rest}" rejected by Max with Face ID`),
    },
    {
      kicker: "The agents · Claude, measured",
      title: "Claude explains and proposes",
      points: [
        `<b>${esc(sentence("Claude"))}</b>`,
        `${m.claude_calls} calls, USD ${m.claude_usd} at list prices. Sourcing on Haiku, Support on Sonnet, Treasury on Opus.`,
        "Our benchmark: Haiku alone is as good on everyday cases, and misread one harder dispute.",
        "No key reaches Claude, and Claude approves nothing; code checks each proposal first.",
      ],
      pic: shot(s.proof, "/proof, the main run: 24/24 decisions by Claude; 86 Metal payments + 1 card charge; $0.0132 = Claude's cost per decision"),
    },
    {
      kicker: "Security and tests",
      title: "Checked in code, on every push",
      wide: true,
      extra: `<div class="stats four">${stat(tests.n.toLocaleString("en-GB"), `tests in ${tests.files} files, all passing (npx vitest run)`)}${stat(String(m.audit_rows), "audit rows in the main run, hash-chained: npm run verify")}${stat(`${rt.before}/${rt.attempts}`, "red-team attacks stopped, on stand-ins")}${stat(`${f.lab.passed}/${f.lab.total}`, "Scenario Lab stories as expected, on stand-ins")}</div>
        <ul class="sec">
          <li>Red team on stand-ins: ${rt.before} of ${rt.attempts} attacks stopped, ${rt.after} more detected afterwards, not prevented.</li>
          <li>No key reaches Claude: tested, no key, token or credential ever reaches a model.</li>
          <li>A signature fits one set of terms: the server refuses it once one cent, the IBAN or the currency changes.</li>
          <li>CI on every push: typecheck, lint, the suite, the browser checks in Chromium and WebKit, CodeQL, Semgrep, and gitleaks over the whole history.</li>
        </ul>`,
    },
    {
      kicker: "Said plainly",
      title: "What is real, and what is not",
      wide: true,
      extra: `<div class="cols">
        <div><h2>Real, with test money</h2><ul>
          <li>The Airwallex sandbox: cards, FX, SWIFT and the deposit.</li>
          <li><!-- METAL-ONCHAIN -->${esc(METAL_LINE)}<!-- /METAL-ONCHAIN --></li>
          <li>Claude: ${m.by_claude} of ${m.decisions} decisions, each with its request id.</li>
          <li>Max's passkey (Face ID on his phone); Max plays the CFO.</li>
          <li>${esc(TWO_LOCKS_LINE)}</li></ul></div>
        <div><h2>Ours, simulated or not yet live</h2><ul>
          <li>The supplier, the customer and the TAP merchant are run by us.</li>
          <li>SWIFT SENT and PAID are moved by Purser through the sandbox's simulation API.</li>
          <li>The second approver was a labelled test passkey, pressed by Claude Code on Max's go.</li>
          <li>Built, not yet live: the Cardputer hub. <!-- T0-STATUS -->${esc(T0_SHORT)}<!-- /T0-STATUS --></li>
          <li>The reliability runs were signed by labelled virtual test passkeys, no person.</li></ul></div>
      </div>`,
    },
    {
      // Max's last round, item 5.2: "Why this is a company" and "Unit economics (hypothesis)" merged into one slide, so
      // the deck stays at twelve. The problem and why Purser are on slides 2 and 3; who buys, the price and why now stay
      // here, then the cost per company and the gross margin src/business/unitEconomics.ts computes (docs/business/model.md).
      kicker: "The business · a hypothesis",
      title: "Unit economics (hypothesis)",
      wide: true,
      extra: `<p class="small note">${esc(WHY_COMPANY_NOTE)}</p>
        <ul class="biz">${WHY_COMPANY.filter((l) => ["Who buys", PRICING_LABEL, "Why now"].includes(l.label)).map((l) => `<li><b>${esc(l.label)}:</b> ${esc(l.text)}</li>`).join("")}</ul>
        <table class="ue"><thead><tr><th>Usage (hypothesis): supplier invoices a month, one company on ${esc(PRICING.starter.name)}</th><th>Price per company</th><th>Cost per company</th><th>Gross margin, before platform costs</th></tr></thead><tbody>
        ${ue.scenarios.map((x) => `<tr><td>${esc(`${USAGE_LABEL[x.usage]}: ${x.invoices.toLocaleString("en-GB")}`)}</td><td>${esc(x.priceEurText)}</td><td>${esc(x.costEurText)}</td><td><b class="${x.margin < 0 ? "bad" : "ok"}">${esc(x.marginText)}</b></td></tr>`).join("")}
        </tbody></table>
        <p class="uefoot">${esc(opusLine(ue))}<br>${esc(invoiceLine(ue))}</p>
        <p class="src">Assumptions: usage; Claude per invoice (an estimate); hosting on Cloudflare at USD ${INPUTS.workersPlanUsd.value} a company a month; EUR 1 = USD ${INPUTS.usdPerEur.value} (ECB, 6 November 2026). Not counted: Airwallex's platform fees, people, the fee per payout. Each with its source: docs/business/model.md, "Unit economics (hypothesis)".</p>`,
    },
    {
      kicker: "Roadmap · a plan, not a promise",
      title: "From test rails to production",
      wide: true,
      extra: `<div class="timeline row3">
        <div><b>Now</b><span>Airwallex sandbox · Metal testnet · test money · one company per ledger</span></div>
        <div><b>Next</b><span>test the demand with finance teams · production Airwallex · a real second approver · keys in a KMS, Postgres, a pager on /health</span></div>
        <div><b>Then</b><span>Metal mainnet · four eyes by default · an outside SOC 2 audit</span></div>
      </div>
      <p class="lead small-lead">${esc(CORE_LINE)}</p>
      <div class="end"><div class="qr small-qr">${qrSvg}</div><dl class="links">
          <dt>Try it</dt><dd>${esc(QR_URL.replace(/^https:\/\//, ""))}</dd>
          <dt>Every id</dt><dd>kit11.max-31b.workers.dev/proof</dd>
          <dt>Code</dt><dd>${esc(REPO_URL.replace(/^https:\/\//, ""))}</dd>
          <dt>Offline, no keys</dt><dd><code>npm ci &amp;&amp; npm run judge</code></dd>
        </dl></div>
      <p class="oneline">${esc(VISA_TAP_STATUS)}</p>`,
    },
  ];
  const font = asset("inter.woff2").toString("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Purser</title><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
html, body { background: #0b1020; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #e8ecf6; }
section { width: 1280px; height: 720px; padding: 56px 64px 44px 72px; display: grid; grid-template-columns: 520px 1fr; gap: 44px; page-break-after: always; break-after: page; position: relative; overflow: hidden; background: #0b1020; }
section:last-child { page-break-after: auto; break-after: auto; }
section::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: #8b93ff; }
section.wide { grid-template-columns: 1fr; } section.wide .pic { display: none; }
.text { display: flex; flex-direction: column; min-height: 0; }
.kicker { font-size: 17px; font-weight: 600; color: #a5abff; letter-spacing: .02em; margin: 0 0 14px; }
h1 { font-size: 50px; line-height: 1.1; margin: 0 0 28px; letter-spacing: -.02em; color: #ffffff; }
h2 { font-size: 22px; margin: 0 0 14px; color: #ffffff; }
li { font-size: 24px; line-height: 1.4; margin: 0 0 14px; }
ul { margin: 0; padding-left: 24px; }
p { margin: 0 0 14px; }
code { font-size: .8em; background: #1b2240; color: #d7dbff; padding: 1px 6px; border-radius: 4px; }
.lead { font-size: 34px; font-weight: 600; line-height: 1.3; color: #ffffff; max-width: 1080px; }
.src { margin-top: auto; font-size: 15px; color: #9aa4bf; line-height: 1.45; }
.small { font-size: 18px; color: #9aa4bf; }
.big { font-size: 26px; line-height: 1.35; }
.stats { display: grid; gap: 14px; margin: 18px 0 20px; }
.stats.four { grid-template-columns: repeat(4, 1fr); }
.stat { background: #141a2e; border: 1px solid #232b45; border-radius: 14px; padding: 16px 18px; }
.stat b { display: block; font-size: 44px; letter-spacing: -.02em; color: #ffffff; }
.stat span { font-size: 15px; color: #b6bdd3; line-height: 1.35; display: block; margin-top: 6px; }
.flow { display: flex; align-items: stretch; gap: 10px; margin: 10px 0 30px; }
.box { flex: 1; background: #141a2e; border: 1px solid #232b45; border-radius: 14px; padding: 22px 16px; text-align: center; }
.box b { display: block; font-size: 25px; color: #ffffff; } .box small { display: block; font-size: 16px; color: #b6bdd3; margin-top: 8px; line-height: 1.35; }
.box.accent { background: #3b3fb8; border-color: #6366f1; } .box.accent small { color: #e0e7ff; }
.arrow { align-self: center; font-size: 28px; color: #6b7393; }
.kit { font-size: 24px; line-height: 1.4; }
.beats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.beats > div { background: #141a2e; border: 1px solid #232b45; border-top: 6px solid #8b93ff; border-radius: 14px; padding: 20px 20px 16px; }
.beats em { font-style: normal; font-size: 16px; color: #a5abff; font-weight: 600; display: block; }
.beats b { display: block; font-size: 28px; line-height: 1.2; margin: 8px 0 14px; color: #ffffff; }
.beats p { font-size: 20px; line-height: 1.4; color: #c9cfe2; margin: 0; }
.qrslide { display: flex; gap: 56px; align-items: center; }
.qr { background: #ffffff; border-radius: 22px; padding: 22px; flex: none; }
.qr svg { width: 400px; height: 400px; display: block; }
.url { font-size: 34px; font-weight: 700; color: #ffffff; letter-spacing: -.01em; margin-bottom: 26px; white-space: nowrap; }
.pic { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; }
figure { margin: 0; width: 100%; }
figcaption { font-size: 13px; color: #9aa4bf; margin-top: 10px; text-align: center; }
.shot img { width: 100%; max-height: 540px; object-fit: cover; object-position: top; border-radius: 14px; border: 1px solid #232b45; display: block; }
section:not(.wide) li { font-size: 19px; margin-bottom: 10px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.cols > div { background: #141a2e; border: 1px solid #232b45; border-radius: 14px; padding: 22px 24px; }
.cols li { font-size: 18.5px; line-height: 1.38; margin-bottom: 10px; }
.timeline { display: grid; gap: 16px; width: 100%; }
.timeline > div { border-left: 8px solid #8b93ff; background: #141a2e; border-radius: 0 12px 12px 0; padding: 22px 26px; }
.timeline > div:nth-child(2) { border-color: #6366f1; } .timeline > div:nth-child(3) { border-color: #3b3fb8; }
.timeline b { display: block; font-size: 26px; color: #ffffff; } .timeline span { display: block; font-size: 18px; color: #b6bdd3; margin-top: 6px; }
.end { display: flex; gap: 40px; align-items: center; } .small-qr { padding: 12px; border-radius: 14px; } .small-qr svg { width: 170px; height: 170px; }
ul.why { list-style: none; padding: 0; margin: 0 0 6px; max-width: 1120px; }
ul.why li { font-size: 25px; line-height: 1.32; font-weight: 600; color: #ffffff; border-left: 5px solid #8b93ff; padding-left: 16px; margin: 0 0 12px; }
.kitrun { font-size: 21px; font-weight: 650; color: #a5abff; margin: 2px 0 0; }
.built { margin-top: 14px; font-size: 22px; font-weight: 600; color: #b6bdd3; }
.options { margin-top: 22px; font-size: 21px; line-height: 1.4; color: #e8ecf6; background: #141a2e; border: 1px solid #232b45; border-radius: 14px; padding: 16px 20px; }
.oneline { font-size: 12.5px; color: #9aa4bf; white-space: nowrap; margin: 4px 0 0; }
.timeline.row3 { grid-template-columns: repeat(3, 1fr); } .timeline.row3 > div { border-radius: 0 12px 12px 0; padding: 26px 26px; } .timeline.row3 span { font-size: 22px; line-height: 1.4; }
.links { display: grid; grid-template-columns: 240px 1fr; gap: 10px 20px; font-size: 24px; margin: 10px 0 0; }
.links dt { color: #9aa4bf; } .links dd { margin: 0; font-weight: 600; color: #ffffff; }
.what { font-size: 30px; margin: 0 0 18px; }
.tryline { font-size: 24px; font-weight: 700; color: #a5abff; margin: 4px 0 18px; } .tryline span { color: #ffffff; margin-left: 10px; }
.sentence { font-size: 22px; line-height: 1.4; color: #ffffff; font-weight: 600; margin: 0 0 22px; max-width: 1120px; }
.vic { margin-top: 12px; background: #141a2e; border: 1px solid #232b45; border-radius: 14px; padding: 10px 18px; font-size: 15.5px; line-height: 1.35; }
.vic b { color: #ffffff; font-size: 17px; } .vic span { color: #9aa4bf; font-size: 14px; margin-left: 8px; } .vic p { margin: 4px 0 0; }
.vic .badges { display: flex; flex-wrap: wrap; gap: 8px; } .vic em { font-style: normal; font-weight: 700; font-size: 14px; padding: 1px 12px; border-radius: 999px; }
/* The Airwallex slide with the Airi run under it: the same parts, tighter, so all of it fits. */
section:has(.vic) h1 { font-size: 44px; margin-bottom: 14px; } section:has(.vic) .sentence { font-size: 19px; margin-bottom: 14px; }
section:has(.vic) .cols > div { padding: 14px 20px; } section:has(.vic) .cols h2 { margin-bottom: 8px; font-size: 20px; }
section:has(.vic) .cols li { margin-bottom: 4px; font-size: 17px; } section:has(.vic) .pairs { gap: 6px 14px; font-size: 17px; }
section:has(.vic) .src { font-size: 14px; margin-top: 10px; }
.vic em.ok { background: #12351f; color: #7ee2a0; } .vic em.bad { background: #3a1820; color: #ff9aa8; }
.pairs { display: grid; grid-template-columns: 200px 1fr; gap: 10px 14px; font-size: 18px; margin: 0; } .pairs dt { color: #9aa4bf; } .pairs dd { margin: 0; }
.ok { color: #3ccf82; } .bad { color: #ff6b6b; }
ul.cards li, ul.sec li, ul.biz li { font-size: 19px; line-height: 1.4; margin-bottom: 10px; }
ul.biz { margin-top: 8px; } ul.biz li { margin-bottom: 6px; } .note { margin: 0 0 10px; }
.timeline.row3 span { font-size: 18px !important; }
.small-lead { font-size: 24px; margin: 22px 0 14px; }
table.ue { border-collapse: collapse; width: 100%; margin: 6px 0 12px; font-size: 19px; }
table.ue th { text-align: left; font-size: 15px; font-weight: 600; color: #9aa4bf; padding: 0 14px 8px 0; }
table.ue td { padding: 5px 14px 5px 0; border-top: 1px solid #232b45; } table.ue td b { font-size: 21px; }
.uefoot { font-size: 17px; line-height: 1.4; color: #c9cfe2; margin: 0 0 8px; }
.flow { margin: 14px 0 18px; } .flow .box { padding: 14px 12px; } .flow .box b { font-size: 21px; } .flow .box small { font-size: 14.5px; }
</style></head><body>
${slides.map((x) => `<section${x.wide ? ' class="wide"' : ""}><div class="text"><p class="kicker">${esc(x.kicker)}</p><h1>${esc(x.title)}</h1>${list(x.points ?? [])}${x.extra ?? ""}</div>${x.wide ? "" : `<div class="pic">${x.pic ?? ""}</div>`}</section>`).join("\n")}
</body></html>`;
}
