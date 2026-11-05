// The submission deck (awards item 6; pitch round, 5 Nov): ten 16:9 slides as one HTML page, printed to PDF by
// npm run submission. Dark, calm, one message per slide, in the pitch's order (docs/submission/pitch.md): the line,
// the problem, how it works, the run in three beats, the jury's own signature (QR to /try/sign), the proof, what is
// real and what is not, Claude, what comes next, the links. Every figure comes from packFacts() and the main run's
// record through src/redesign/run.ts, the same functions the pages use; test/pitch.test.ts checks the deck against the
// record. The font, the logos, the screenshots and the QR code are embedded, so the PDF needs no network.

import { readFileSync } from "node:fs";
import type { PackFacts } from "./facts.js";
import { KIT_LINE, NORTHWIND_LINE, VISA_AWARD_STATUS } from "../config/brand.js";
import { agentRun, homeFilm } from "../redesign/run.js";

const asset = (p: string) => readFileSync(new URL(`../ui/${p}`, import.meta.url));
const dataUri = (p: string, type: string) => `data:${type};base64,${asset(p).toString("base64")}`;
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
/** T:0, in the README's words since 5 November (docs/runs/2026-11-05-t0-live.md): built, not yet live. */
export const T0_STATUS = "Built, not yet live: the T:0 books sink (nothing posted: the shared sandbox key could not post, 403 CAPI71; on 5 November T:0 refused its new read-write key, 401 CAPI11).";
/** What of the main run is on Metal testnet, in the README's words (checked against the chain on 5 November). */
export const METAL_ONCHAIN = "On Metal testnet, checked against the chain on 5 November: the 4 mandates bound at setup that morning and the 2 replacements; 86 test-USD payments, each its own transaction (41 sales, 41 supplier purchases, 3 refunds, 1 sweep); 1 refusal recorded on chain (#24). No emulator and no clearing in this run. Not on Metal: the EUR licence (FX, SWIFT) and the card buy, on the Airwallex sandbox; the other 13 refusals (12 by the Sourcing agent's buy policy, #37 by Metal during the replace) are in the ledger, not on chain.";

/** Screenshots by name (data URIs), as npm run submission takes them. */
export type DeckShots = Record<"landing" | "dashboard" | "metal" | "live" | "disputes" | "books" | "phoneOptions" | "phoneConfirm" | "rails" | "inspector" | "fourEyes" | "compliance" | "try" | "overview" | "claude" | "result" | "dispute" | "refuse" | "decline" | "max" | "watch" | "proof" | "visa", string>;

interface Slide { kicker: string; title: string; points?: string[]; extra?: string; pic?: string; /** No picture: the text takes the whole slide. */ wide?: boolean }

const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const shot = (src: string, caption: string) => `<figure class="shot">${src ? `<img src="${src}" alt="">` : ""}<figcaption>${esc(caption)}</figcaption></figure>`;
const stat = (value: string, label: string) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const shortId = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

export function deckHtml(f: PackFacts, s: DeckShots, qrSvg: string): string {
  const rt = f.redteam, m = f.main;
  const film = homeFilm(agentRun());
  const ev = agentRun().record.ledger?.events ?? [];
  const replaced = ev.filter((e) => e.event === "mandate.replaced").map((e) => String(e.payload.tx ?? ""));
  const sweepTx = String(ev.find((e) => e.event === "sweep.paid")?.payload.tx ?? "");
  const deposit = String(ev.find((e) => e.event === "credit.deposited")?.payload.deposit_id ?? "");
  const conversion = String(ev.find((e) => e.event === "fx.converted")?.subject ?? "");
  const rest = m.disputed - m.refunded.length;
  const slides: Slide[] = [
    {
      kicker: KIT_LINE,
      title: "Purser",
      wide: true,
      extra: `<p class="lead">${esc(CORE_LINE)}</p>
        <div class="stats four">${stat(`${m.by_claude}/${m.decisions}`, `decisions by Claude, ${m.fallbacks} fallbacks`)}${stat(String(m.stopped), `stopped at a limit (${m.metal_refused} by Metal, ${m.cfo_rejected} by the CFO)`)}${stat(String(m.face_id), "Face ID decisions by the CFO")}${stat(`${m.face_to_paid_s} s`, "from Face ID to PAID; the settlement is simulated in the sandbox")}</div>
        <p class="src">One live run, 3 November 2026: Metal testnet and the Airwallex sandbox, test money only.</p>
        <div class="logos"><span class="ground"><img src="${dataUri("logos/airwallex.png", "image/png")}" alt="Airwallex" height="22"></span><span class="ground"><img src="${dataUri("logos/metal.svg", "image/svg+xml")}" alt="Metal" height="22"></span><span class="with">with Claude</span></div>`,
    },
    {
      kicker: "The problem",
      title: "AI agents can now spend money. So who holds the pen?",
      wide: true,
      points: [
        "An agent pays as fast as it is told to, also by a fake invoice.",
        "A limit written in a prompt can be talked out of.",
        "The limit has to live in the rails and in code, with a person above it.",
      ],
    },
    {
      kicker: "How it works",
      title: "Each agent its own card and its own mandate",
      wide: true,
      extra: `<div class="flow">
          <div class="box"><b>Agent</b><small>a Claude agent explains and proposes</small></div><span class="arrow">→</span>
          <div class="box"><b>Rules</b><small>code holds every limit</small></div><span class="arrow">→</span>
          <div class="box accent"><b>Person</b><small>Face ID on the exact terms, beyond the limits</small></div><span class="arrow">→</span>
          <div class="box"><b>Airwallex · Metal</b><small>cards, FX, SWIFT · mandates, x402</small></div><span class="arrow">→</span>
          <div class="box"><b>Books</b><small>double-entry, hash-chained audit log; <!-- T0-STATUS -->T:0: built, not yet live<!-- /T0-STATUS --></small></div>
        </div>
        <p class="kit">Northwind Outdoor, ${esc(NORTHWIND_LINE)}. Three agents (${m.kit11.map((k) => esc(k.agent.replace(/ agent$/, ""))).join(", ")}), 20.00 test USD between them.</p>`,
    },
    {
      kicker: "The main run, 3 November 2026 · replay on /watch",
      title: "One live run, three beats",
      wide: true,
      extra: `<div class="beats">
        <div><em>1 · The price rise</em><b>Metal refused it.</b><p>${esc(film?.supplier ?? "The supplier")} went from ${esc(film?.old ?? "")} to ${esc(film?.price ?? "")} a stock check, over the ${esc(film?.cap ?? "")} cap. One purchase was let through on purpose; Metal refused it on chain (tx <code>${esc(short(m.let_through_tx))}</code>). Treasury's options came ${m.to_options_s} s later; the CFO signed with Face ID (1 of 2), a labelled test passkey signed 2 of 2.</p></div>
        <div><em>2 · The dispute</em><b>${rest} refunds rejected.</b><p>${esc(m.dispute_story)}</p></div>
        <div><em>3 · The euro bill</em><b>PAID ${m.face_to_paid_s} s after Face ID.</b><p>The Treasury agent planned the EUR 240.00 licence itself. After the CFO's Face ID: ${esc(m.fx_buy)} bought by FX for only the shortfall, then SWIFT, fee ${esc(m.licence_fee)}. PAID ${esc("in the sandbox, where the settlement is simulated")}.</p></div>
      </div>`,
    },
    {
      kicker: "Try it yourself",
      title: "Sign one yourself",
      wide: true,
      extra: `<div class="qrslide"><div class="qr">${qrSvg}</div><div><p class="url">${esc(QR_URL.replace(/^https:\/\//, ""))}</p>
        <p class="big">A test world of your own. A rule blocks one payment; you sign the other with your passkey.</p>
        <p class="big">Change one cent, and the same signature is refused.</p>
        <p class="small">Test world · test passkey · nothing real moves.</p></div></div>`,
    },
    {
      kicker: "Proof",
      title: "Every id is public",
      points: [
        `<b>${m.stopped} stopped at a limit</b> (${m.metal_refused} by Metal, ${m.cfo_rejected} by the CFO). Metal's refusal: <code>${esc(short(m.let_through_tx))}</code>`,
        `Mandates replaced on chain: ${replaced.map((t) => `<code>${esc(short(t))}</code>`).join(", ")}`,
        `Refunds #${m.refunded.join(", #")} on chain; sweep <code>${esc(short(sweepTx))}</code>, deposit <code>${esc(shortId(deposit))}</code>`,
        `FX <code>${esc(shortId(conversion))}</code>; SWIFT transfer <code>${esc(shortId(m.licence_transfer))}</code>`,
        `Card raise ${esc(m.card_raise.proposal)}, EUR ${esc(m.card_raise.from)} → ${esc(m.card_raise.to)}; Airwallex authorization <code>${esc(shortId(m.card_raise.auth))}</code>`,
        `${m.audit_rows} audit rows, hash-chained: <code>npm run verify</code>`,
      ],
      extra: `<p class="sep">${esc(m.tap_limit_line)}; <b>not counted above</b>.</p>`,
      pic: shot(s.dispute, `The main run, 3 November (/watch): #${m.refunded.join(", #")} refunded, each on chain; "refund the other ${rest}" rejected by Max with Face ID`),
    },
    {
      kicker: "Said plainly",
      title: "What is real, and what is not",
      wide: true,
      extra: `<div class="cols">
        <div><h2>Real, with test money</h2><ul>
          <li>The Airwallex sandbox: cards, FX, SWIFT, the deposit.</li>
          <li class="fine"><!-- METAL-ONCHAIN -->${esc(METAL_ONCHAIN)}<!-- /METAL-ONCHAIN --></li>
          <li>Claude: ${m.by_claude} of ${m.decisions} decisions, each with its request id.</li>
          <li>The CFO's Face ID, on his own phone.</li></ul></div>
        <div><h2>Ours, simulated or not yet live</h2><ul>
          <li>The supplier, the customer and the TAP merchant are run by us.</li>
          <li>SWIFT SENT and PAID: moved by Purser through Airwallex's sandbox simulation API.</li>
          <li>The second approver: a labelled virtual test passkey, pressed by our build tool (Claude Code) on Max's go.</li>
          <li>Built, not yet live: the Cardputer hub.</li>
          <li><!-- T0-STATUS -->${esc(T0_STATUS)}<!-- /T0-STATUS --></li>
          <li>Red team on stand-ins: ${rt.before} of ${rt.attempts} attacks stopped, ${rt.after} more detected afterwards, not prevented.</li></ul></div>
      </div>`,
    },
    {
      kicker: "Claude, measured",
      title: "Claude explains and proposes",
      points: [
        `${m.by_claude} of ${m.decisions} decisions by Claude, ${m.fallbacks} fallbacks, ${m.claude_calls} calls, USD ${m.claude_usd} at list prices.`,
        "Sourcing on Haiku, Support on Sonnet, Treasury on Opus.",
        "Our benchmark: Haiku alone is as good on everyday cases, and misread one harder dispute.",
        "Claude holds no key and approves nothing; code checks each proposal first.",
      ],
      pic: shot(s.proof, "Proof: who decided what in the main run, each with its proof"),
    },
    {
      kicker: "Business model (plan) and roadmap",
      title: "A monthly fee per active agent",
      points: [
        "Priced per company and per active agent; no cut of payments.",
        "First customers: small cross-border companies on Airwallex that run AI agents.",
      ],
      pic: `<div class="timeline">
        <div><b>Now</b><span>Airwallex sandbox · Metal testnet · one company per ledger</span></div>
        <div><b>Next</b><span>keys in a KMS · Postgres · a pager on /health · many companies</span></div>
        <div><b>Then</b><span>Metal mainnet · four eyes by default · more Airwallex rails</span></div>
      </div>`,
    },
    {
      kicker: "Purser · Starter Kit 11",
      title: "Purser",
      wide: true,
      extra: `<p class="lead">${esc(CORE_LINE)}</p>
        <dl class="links">
          <dt>Sign one yourself</dt><dd>${esc(QR_URL.replace(/^https:\/\//, ""))}</dd>
          <dt>Watch the run</dt><dd>kit11.max-31b.workers.dev/watch</dd>
          <dt>Every id</dt><dd>kit11.max-31b.workers.dev/proof</dd>
          <dt>Code</dt><dd>${esc(REPO_URL.replace(/^https:\/\//, ""))}</dd>
          <dt>Offline, no keys</dt><dd><code>npm ci &amp;&amp; npm run judge</code></dd>
        </dl>
        <p class="src">Max Geurtsen · built with Claude Code · built on Airwallex and Metal, with Claude.<br>${esc(VISA_AWARD_STATUS)}</p>`,
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
.logos { display: flex; gap: 18px; align-items: center; margin-top: 14px; }
.ground { background: #ffffff; border-radius: 8px; padding: 8px 14px; display: inline-flex; }
.with { font-size: 19px; font-weight: 600; color: #b6bdd3; }
.flow { display: flex; align-items: stretch; gap: 10px; margin: 10px 0 30px; }
.box { flex: 1; background: #141a2e; border: 1px solid #232b45; border-radius: 14px; padding: 22px 16px; text-align: center; }
.box b { display: block; font-size: 25px; color: #ffffff; } .box small { display: block; font-size: 16px; color: #b6bdd3; margin-top: 8px; line-height: 1.35; }
.box.accent { background: #3b3fb8; border-color: #6366f1; } .box.accent small { color: #e0e7ff; }
.arrow { align-self: center; font-size: 28px; color: #6b7393; }
.kit { font-size: 24px; line-height: 1.4; }
.beats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.beats > div { background: #141a2e; border: 1px solid #232b45; border-top: 6px solid #8b93ff; border-radius: 14px; padding: 20px 20px 16px; }
.beats em { font-style: normal; font-size: 16px; color: #a5abff; font-weight: 600; display: block; }
.beats b { display: block; font-size: 30px; line-height: 1.15; margin: 8px 0 12px; color: #ffffff; }
.beats p { font-size: 15.5px; line-height: 1.45; color: #c9cfe2; margin: 0; }
.qrslide { display: flex; gap: 56px; align-items: center; }
.qr { background: #ffffff; border-radius: 22px; padding: 22px; flex: none; }
.qr svg { width: 400px; height: 400px; display: block; }
.url { font-size: 34px; font-weight: 700; color: #ffffff; letter-spacing: -.01em; margin-bottom: 26px; white-space: nowrap; }
.pic { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; }
figure { margin: 0; width: 100%; }
figcaption { font-size: 13px; color: #9aa4bf; margin-top: 10px; text-align: center; }
.shot img { width: 100%; max-height: 540px; object-fit: cover; object-position: top; border-radius: 14px; border: 1px solid #232b45; display: block; }
section:not(.wide) li { font-size: 19px; margin-bottom: 10px; }
.sep { font-size: 14px; color: #9aa4bf; margin: auto 0 0; border-left: 3px solid #3a4366; padding-left: 10px; line-height: 1.4; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.cols > div { background: #141a2e; border: 1px solid #232b45; border-radius: 14px; padding: 22px 24px; }
.cols li { font-size: 17px; line-height: 1.4; margin-bottom: 9px; } .cols li.fine { font-size: 14.5px; color: #c9cfe2; }
.timeline { display: grid; gap: 16px; width: 100%; }
.timeline > div { border-left: 8px solid #8b93ff; background: #141a2e; border-radius: 0 12px 12px 0; padding: 22px 26px; }
.timeline > div:nth-child(2) { border-color: #6366f1; } .timeline > div:nth-child(3) { border-color: #3b3fb8; }
.timeline b { display: block; font-size: 26px; color: #ffffff; } .timeline span { display: block; font-size: 18px; color: #b6bdd3; margin-top: 6px; }
.links { display: grid; grid-template-columns: 240px 1fr; gap: 10px 20px; font-size: 24px; margin: 10px 0 0; }
.links dt { color: #9aa4bf; } .links dd { margin: 0; font-weight: 600; color: #ffffff; }
</style></head><body>
${slides.map((x) => `<section${x.wide ? ' class="wide"' : ""}><div class="text"><p class="kicker">${esc(x.kicker)}</p><h1>${esc(x.title)}</h1>${list(x.points ?? [])}${x.extra ?? ""}</div>${x.wide ? "" : `<div class="pic">${x.pic ?? ""}</div>`}</section>`).join("\n")}
</body></html>`;
}
