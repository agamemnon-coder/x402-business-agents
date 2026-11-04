// The submission deck (awards item 6): twelve 16:9 slides as one HTML page, printed to PDF by npm run submission.
// One picture per slide and at most three short points: the screenshots are the recorded pages (npm run judge),
// the phone screens come from the browser check's dev-test world. Every figure comes from packFacts(), the same
// recorded files the pages use; the font, the logos, the screenshots and the QR code are embedded, so the PDF needs
// no network. Market facts carry their source on the slide and in docs/claims.md.

import { readFileSync } from "node:fs";
import type { PackFacts } from "./facts.js";
import { KIT11_JOBS, SECOND_APPROVER, VISA_AWARD_STATUS } from "../config/brand.js";

const asset = (p: string) => readFileSync(new URL(`../ui/${p}`, import.meta.url));
const dataUri = (p: string, type: string) => `data:${type};base64,${asset(p).toString("base64")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The public page the last slide's QR code opens. */
export const TRY_URL = "https://kit11.max-31b.workers.dev/try";

/** Screenshots by name (data URIs), as npm run submission takes them. */
export type DeckShots = Record<"landing" | "dashboard" | "metal" | "live" | "disputes" | "books" | "phoneOptions" | "phoneConfirm" | "rails" | "inspector" | "fourEyes" | "compliance" | "try" | "overview" | "claude" | "result" | "dispute" | "refuse" | "decline" | "max" | "watch" | "proof" | "visa", string>;

interface Slide { kicker: string; title: string; points?: string[]; extra?: string; pic: string }

const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const shot = (src: string, caption: string) => `<figure class="shot"><img src="${src}" alt=""><figcaption>${esc(caption)}</figcaption></figure>`;
const pair = (a: string, b: string, caption: string) =>
  `<figure class="pair"><div><img src="${a}" alt=""><img src="${b}" alt=""></div><figcaption>${esc(caption)}</figcaption></figure>`;
const phones = (a: string, b: string, caption: string) =>
  `<figure class="phones"><div><img src="${a}" alt=""><img src="${b}" alt=""></div><figcaption>${esc(caption)}</figcaption></figure>`;
const stat = (value: string, label: string) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

export function deckHtml(f: PackFacts, s: DeckShots, qrSvg: string): string {
  const rt = f.redteam, m = f.main;
  const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
  const slides: Slide[] = [
    {
      kicker: "Airwallex Agentic Banking Hackathon · Metal Award",
      title: "Purser",
      extra: `<p class="lead">Your AI agents spend through Airwallex and Metal. The CFO stays in control.</p>
        <div class="stats two">${stat(`${m.by_claude}/${m.decisions}`, `decisions by Claude agents, ${m.fallbacks} fallbacks`)}${stat(String(m.alone), `payments inside the limits, no approval at the time (${m.sales} by the simulated customer's agent)`)}${stat(String(m.face_id), "decisions by the CFO with Face ID")}<div class="stat"><b>${m.stopped}</b><span>stopped at a limit (${m.metal_refused} by Metal, ${m.cfo_rejected} by the CFO)</span>${m.tap_limit_line ? `<span class="note">${esc(m.tap_limit_line)}</span>` : ""}</div></div>
        <p class="src">The main run, 3 November 2026: Metal testnet and the Airwallex sandbox, test money only. Audit log: ${m.audit_rows} rows, hash-chained, checkable offline.</p>
        <div class="logos"><img src="${dataUri("logos/airwallex.png", "image/png")}" alt="Airwallex" height="22"><img src="${dataUri("logos/metal.svg", "image/svg+xml")}" alt="Metal" height="22"><span class="with">with Claude</span></div>`,
      pic: shot(s.landing, "Home, replaying the main run (3 November)"),
    },
    {
      kicker: "Kit 11 · x402 Business Agents",
      title: "Three agents, one Metal account",
      points: [
        "Northwind Outdoor, an outdoor wholesaler that sells live stock data to retailers per query: Kit 11's data business.",
        "Each agent pays under its own on-chain mandate; 20.00 test USD between them, held in code.",
        "A supplier price rise is refused; the CFO approves new limits within the 20 with Face ID.",
      ],
      pic: `<div class="kitmap">${m.kit11.map((k) => `<div><b>${esc(k.agent)}</b><span>${esc(KIT11_JOBS[k.role as keyof typeof KIT11_JOBS] ?? "")}</span><em>${esc(k.bound === k.now ? k.now : `${k.bound} → ${k.now}`)}</em></div>`).join("")}<p>budgets in test USD, when bound → after the CFO's Face ID (the main run, 3 November)</p></div>`,
    },
    {
      kicker: "The problem",
      title: "Agents can pay now. Who holds the limit?",
      points: [
        "An agent spends as fast as it is told to, also by a fake invoice or a planted instruction.",
        "A limit in a prompt can be talked out of. It has to live in the rails and in code.",
        "<b>Why now:</b> Mastercard Agent Pay (April 2025), Visa Intelligent Commerce and Google's AP2 (16 September 2025) let agents pay.",
      ],
      extra: `<p class="quote">$3,046,598,558 in business email compromise losses, reported by victims to the FBI in 2025.<small>FBI IC3, 2025 Internet Crime Report</small></p>
        <p class="src">McKinsey: AI agents could mediate $3 trillion to $5 trillion of global consumer commerce by 2030 ("The agentic commerce opportunity", 17 October 2025). Sources: mastercard.com (Agent Pay, April 2025) · visa.com/en-us/solutions/intelligent-commerce · cloud.google.com/blog (AP2, 16 Sep 2025) · mckinsey.com/capabilities/quantumblack</p>`,
      pic: shot(s.refuse, "Purser live: Metal's facilitator refuses a payment over the on-chain mandate; nothing moved"),
    },
    {
      kicker: "How it works",
      title: "Alone inside the limits. Face ID for the rest.",
      points: [
        "The agent pays alone inside its card limits and its on-chain mandate.",
        "Above a limit, the CFO sees the exact terms and signs their hash with Face ID.",
        "The runner checks signature and hash before any money moves.",
      ],
      pic: phones(s.phoneOptions, s.phoneConfirm, "The approval screens on a phone (a dev-test world, virtual passkey)"),
    },
    {
      kicker: "Scene 1 · The price rise · Metal enforces the limits",
      title: "Mandates on chain: Metal holds the limit",
      points: [
        `<b>Stockline 0.02 → 0.04, over the 0.03 cap.</b> Purser normally refuses before signing; to prove the rail holds the limit, one purchase was let through to Metal: <b>Metal refused it</b> (<code>mandate_cap_exceeded</code>, tx ${esc(short(m.let_through_tx))}); nothing moved.`,
        `<b>Treasury's options ${m.to_options_s} s later</b>, within the 20. The CFO signed with Face ID (1 of 2), then the second approver (2 of 2); the mandates were replaced on chain.`,
        `<small>${esc(SECOND_APPROVER)}</small>`,
      ],
      pic: shot(s.watch, "Watch: the main run's key moments, each with its proof"),
    },
    {
      kicker: "Scene 2 · The dispute · the Dispute desk",
      title: "The seller checks each payment against the chain",
      points: [
        `In the main run a simulated customer (we run it) disputed ${m.disputed} orders; the Support agent checked each against its signed order and the mandate.`,
        `It refunded only the ${m.refunded.length} with wrong data (orders ${m.refunded.slice(0, -1).join(", ")} and ${m.refunded.at(-1)}); "refund the other ${m.disputed - m.refunded.length}" went to the CFO, who rejected it with Face ID.`,
        "Any seller on Metal can reuse it: <code>examples/metal-dispute-desk</code>.",
      ],
      pic: shot(s.dispute, "The Disputes tab of the earlier recorded run (30 October), order by order"),
    },
    {
      kicker: "Scene 3 · The euro licence · Airwallex pays and enforces",
      title: "The euro bill, and a company card per agent",
      points: [
        `<b>The Treasury agent planned the EUR 240.00 licence itself.</b> After the CFO's Face ID: ${esc(m.fx_buy)} bought by FX for only the shortfall, then SWIFT, <b>PAID ${m.face_to_paid_s} s after Face ID</b> (fee ${esc(m.licence_fee)}).`,
        `<b>The agent asks first:</b> a card raise (${esc(m.card_raise.proposal)}, EUR ${esc(m.card_raise.from)} → ${esc(m.card_raise.to)}), signed by the CFO with Face ID; Airwallex then approved the TAP-signed EUR ${esc(m.card_raise.amount)} buy (<code>${esc(`${m.card_raise.auth.slice(0, 8)}…${m.card_raise.auth.slice(-4)}`)}</code>).`,
        `<small>${esc(m.tap_limit_line)}. ${esc(VISA_AWARD_STATUS)}</small>`,
      ],
      pic: shot(s.visa, "The main run, 3 November (/visa): the TAP-signed €45.00 card buy, approved by Airwallex; the decline beside it is the separate TAP run's, labelled"),
    },
    {
      kicker: "For a bigger company",
      title: "More control moves on chain",
      points: [
        "<b>Four eyes</b>: a 2-of-2 account; one signature reverted on chain, both passed.",
        "<b>Compliance contract</b>: pays only with a signed screening decision; 11 attacks reverted.",
        "<b>Under load</b>: 2,000 of 2,000 clearing payments, 4.24 a second.",
      ],
      extra: `<p class="src">Separate test worlds on Metal testnet, 30 October; not in the recorded run.</p>`,
      pic: pair(s.fourEyes, s.compliance, "The four-eyes and compliance cards on /metal"),
    },
    {
      kicker: "Agents built on Claude (Anthropic API), and measured",
      title: "No model can raise a limit or move money outside it",
      points: [
        `Each decision is a real Claude call with its request id, tokens and cost. In the main run: ${m.by_claude} of ${m.decisions} decisions by Claude, ${m.fallbacks} fallbacks, ${m.claude_calls} calls, USD ${m.claude_usd} at list prices.`,
        "Haiku sorts, Sonnet reads into checked fields, Opus advises the CFO. On harder documents Haiku alone misread 1 of 15; this split read all 15.",
        "Claude holds no key and approves nothing; code checks every decision before money moves.",
        `Red team, in a throwaway test world: ${rt.failed} of ${rt.attempts} attacks failed (${rt.after} found afterwards, not prevented).`,
      ],
      pic: shot(s.proof, "Proof: who decided what in the main run, each partner's live proof"),
    },
    {
      kicker: "Business model (plan) and roadmap",
      title: "A monthly fee per active agent",
      points: [
        "Priced per company and per active agent; no cut of payments. Airwallex and Metal keep their own fees.",
        "First customers: small cross-border companies on Airwallex that run AI agents.",
        "Today the sandbox and testnet; next a KMS, Postgres and a pager; then Metal mainnet.",
      ],
      pic: `<div class="timeline">
        <div><b>Now</b><span>Airwallex sandbox · Metal testnet</span><ul><li>live runs on sandbox and testnet, the licence fee paid in the main run; T:0 and emergency stop not yet live</li><li>one company per ledger</li><li>tests and checks in CI on every push</li></ul></div>
        <div><b>Next</b><span>production basics</span><ul><li>keys in a KMS, not files</li><li>Postgres with point-in-time recovery</li><li>a pager on <code>/health</code>; many companies</li></ul></div>
        <div><b>Then</b><span>scale</span><ul><li>Metal mainnet</li><li>four eyes as the default</li><li>finality proofs verified in full</li></ul></div>
      </div>`,
    },
    {
      kicker: "Team",
      title: "Max Geurtsen",
      points: [
        "International Business student with a background in e-commerce.",
        "Product, decisions, and every Face ID in the live runs.",
        "Built with Claude Code as the developer.",
      ],
      pic: s.max ? `<figure class="photo"><img src="${s.max}" alt="Max"></figure>` : `<div class="photo empty">Photo of Max</div>`,
    },
    {
      kicker: "Try it",
      title: "Type a task for an agent",
      extra: `<div class="qr">${qrSvg}</div><p class="url">${esc(TRY_URL.replace(/^https:\/\//, ""))}</p><p class="small">Or offline, no keys: <code>npm ci &amp;&amp; npm run judge</code></p><p class="built">Built on Airwallex and Metal, with Claude.</p>`,
      pic: shot(s.try, "Type a task; Claude reads it, code picks the rail and checks the CFO policy"),
    },
  ];
  const font = asset("inter.woff2").toString("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Purser</title><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #0b1220; background: #ffffff; }
section { width: 1280px; height: 720px; padding: 56px 56px 48px 72px; display: grid; grid-template-columns: 500px 1fr; gap: 44px; page-break-after: always; break-after: page; position: relative; overflow: hidden; }
section:last-child { page-break-after: auto; break-after: auto; }
section::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: #4f46e5; }
.text { display: flex; flex-direction: column; min-height: 0; }
.kicker { font-size: 17px; font-weight: 600; color: #4f46e5; letter-spacing: .02em; margin: 0 0 12px; }
h1 { font-size: 42px; line-height: 1.12; margin: 0 0 26px; letter-spacing: -.02em; }
li { font-size: 22px; line-height: 1.4; margin: 0 0 14px; }
p { margin: 0 0 14px; }
.built { margin-top: 18px; font-size: 20px; font-weight: 600; }
.lead { font-size: 28px; font-weight: 600; line-height: 1.3; }
ul { margin: 0; padding-left: 24px; }
code { font-size: 17px; background: #eef0ff; padding: 1px 6px; border-radius: 4px; }
.quote { margin-top: auto; font-size: 22px; font-weight: 600; border-left: 4px solid #4f46e5; padding-left: 18px; line-height: 1.35; }
.quote small, .src { display: block; font-size: 14px; font-weight: 400; color: #4b5563; margin-top: 8px; line-height: 1.4; }
.src { margin-top: auto; }
.logos { margin-top: auto; display: flex; gap: 32px; align-items: center; }
.with { font-size: 19px; font-weight: 600; color: #4b5563; }
.small { font-size: 16px; color: #4b5563; }
.pic { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; }
figure { margin: 0; width: 100%; }
figcaption { font-size: 13px; color: #6b7280; margin-top: 10px; text-align: center; }
.shot img { width: 100%; max-height: 560px; object-fit: cover; object-position: top; border-radius: 14px; border: 1px solid #e5e7eb; box-shadow: 0 18px 40px rgba(15, 23, 42, .14); display: block; }
.phones > div { display: flex; gap: 22px; justify-content: center; }
.pair > div { display: flex; gap: 16px; align-items: flex-start; }
.pair img { width: calc(50% - 8px); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 12px 30px rgba(15, 23, 42, .12); }
.rails3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; width: 100%; }
.rails3 .net { background: #f6f7f9; border: 1px solid #e5e7eb; border-radius: 14px; padding: 22px 16px; font-size: 24px; font-weight: 700; text-align: center; }
.rails3 .net small { display: block; font-size: 14px; font-weight: 400; color: #4b5563; margin-top: 6px; }
.rails3 .arrow { grid-column: 1 / -1; text-align: center; font-size: 20px; }
.rails3 .box { grid-column: 1 / -1; }
.phones img { height: 560px; border-radius: 26px; border: 8px solid #0b1220; box-shadow: 0 18px 40px rgba(15, 23, 42, .18); }
.stats { display: grid; grid-template-columns: 1fr; gap: 12px; }
.stat { background: #f6f7f9; border-radius: 12px; padding: 16px 18px; }
.stat b { display: block; font-size: 36px; letter-spacing: -.02em; }
.stat span { font-size: 15px; color: #4b5563; line-height: 1.3; display: block; margin-top: 4px; }
.stats.two { grid-template-columns: 1fr 1fr; }
.stat .note { font-size: 12.5px; color: #6b7280; margin-top: 6px; }
.diagram { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.diagram .row { display: flex; gap: 18px; }
.box { background: #f6f7f9; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px 26px; font-size: 22px; font-weight: 600; text-align: center; min-width: 260px; }
.box small { display: block; font-size: 15px; font-weight: 400; color: #4b5563; margin-top: 4px; }
.box.accent { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.box.accent small { color: #e0e7ff; }
.arrow { font-size: 28px; color: #9ca3af; }
.timeline { display: grid; grid-template-rows: repeat(3, 1fr); gap: 16px; width: 100%; height: 100%; }
.timeline > div { border-left: 8px solid #4f46e5; background: #f6f7f9; border-radius: 0 12px 12px 0; padding: 18px 24px; }
.timeline ul { margin: 8px 0 0; padding-left: 20px; } .timeline li { font-size: 17px; margin: 0 0 4px; }
.timeline > div:nth-child(2) { border-color: #818cf8; } .timeline > div:nth-child(3) { border-color: #c7d2fe; }
.timeline b { display: block; font-size: 24px; } .timeline span { display: block; font-size: 16px; color: #4b5563; margin-top: 6px; }
.qr { display: flex; gap: 28px; align-items: center; margin-top: 8px; }
.qr svg { width: 220px; height: 220px; flex: none; }
.kitmap { width: 100%; display: grid; gap: 14px; }
.kitmap div { display: grid; grid-template-columns: 1fr 1.3fr auto; align-items: center; gap: 16px; background: #f6f7f9; border: 1px solid #e5e7eb; border-left: 6px solid #4f46e5; border-radius: 14px; padding: 22px 24px; }
.kitmap b { font-size: 24px; } .kitmap span { font-size: 18px; color: #4b5563; } .kitmap em { font-style: normal; font-size: 26px; font-weight: 700; }
.kitmap p { font-size: 14px; color: #6b7280; text-align: center; margin: 4px 0 0; }
.url { font-size: 26px; font-weight: 700; margin: 18px 0 8px; white-space: nowrap; letter-spacing: -.01em; }
.small code { white-space: nowrap; }
.photo { width: 100%; display: flex; justify-content: center; }
.photo img { width: 420px; height: 520px; object-fit: cover; border-radius: 20px; box-shadow: 0 18px 40px rgba(15, 23, 42, .14); }
.photo.empty { width: 420px; height: 520px; border: 2px dashed #c7d2fe; border-radius: 20px; align-items: center; color: #6b7280; font-size: 20px; background: #f6f7f9; }
</style></head><body>
${slides.map((x) => `<section><div class="text"><p class="kicker">${esc(x.kicker)}</p><h1>${esc(x.title)}</h1>${list(x.points ?? [])}${x.extra ?? ""}</div><div class="pic">${x.pic}</div></section>`).join("\n")}
</body></html>`;
}
