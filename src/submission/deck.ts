// The submission deck (awards item 6): fifteen 16:9 slides as one HTML page, printed to PDF by npm run submission.
// One picture per slide and at most three short points: the screenshots are the recorded pages (npm run judge),
// the phone screens come from the browser check's dev-test world. Every figure comes from packFacts(), the same
// recorded files the pages use; the font, the logos, the screenshots and the QR code are embedded, so the PDF needs
// no network. Market facts carry their source on the slide and in docs/claims.md.

import { readFileSync } from "node:fs";
import type { PackFacts } from "./facts.js";

const asset = (p: string) => readFileSync(new URL(`../ui/${p}`, import.meta.url));
const dataUri = (p: string, type: string) => `data:${type};base64,${asset(p).toString("base64")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const eur = (v: string) => `€${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The public page the last slide's QR code opens. */
export const TRY_URL = "https://kit11.max-31b.workers.dev/try";

/** Screenshots by name (data URIs), as npm run submission takes them. */
export type DeckShots = Record<"landing" | "dashboard" | "metal" | "live" | "disputes" | "books" | "phoneOptions" | "phoneConfirm" | "rails" | "inspector" | "fourEyes" | "compliance" | "try" | "overview" | "claude" | "result" | "dispute" | "refuse" | "decline" | "max", string>;

interface Slide { kicker: string; title: string; points?: string[]; extra?: string; pic: string }

const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const shot = (src: string, caption: string) => `<figure class="shot"><img src="${src}" alt=""><figcaption>${esc(caption)}</figcaption></figure>`;
const pair = (a: string, b: string, caption: string) =>
  `<figure class="pair"><div><img src="${a}" alt=""><img src="${b}" alt=""></div><figcaption>${esc(caption)}</figcaption></figure>`;
const phones = (a: string, b: string, caption: string) =>
  `<figure class="phones"><div><img src="${a}" alt=""><img src="${b}" alt=""></div><figcaption>${esc(caption)}</figcaption></figure>`;
const stat = (value: string, label: string) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

export function deckHtml(f: PackFacts, s: DeckShots, qrSvg: string): string {
  const rt = f.redteam;
  const slides: Slide[] = [
    {
      kicker: "Airwallex Agentic Banking Hackathon · Metal Award",
      title: "Purser",
      extra: `<p class="lead">Your AI agents spend through Airwallex and Metal. The CFO stays in control.</p>
        <div class="logos"><img src="${dataUri("logos/airwallex.png", "image/png")}" alt="Airwallex" height="22"><img src="${dataUri("logos/metal.svg", "image/svg+xml")}" alt="Metal" height="22"><span class="with">with Claude</span></div>`,
      pic: shot(s.landing, "The landing page, from the recorded live run"),
    },
    {
      kicker: "The problem",
      title: "Agents can pay now. Who holds the limit?",
      points: [
        "An agent spends as fast as it is told to, also by a fake invoice or a planted instruction.",
        "A limit in a prompt can be talked out of. It has to live in the rails and in code.",
      ],
      extra: `<p class="quote">$3,046,598,558 in business email compromise losses, reported by victims to the FBI in 2025.<small>FBI IC3, 2025 Internet Crime Report</small></p>`,
      pic: shot(s.refuse, "Purser live: Metal's facilitator refuses a payment over the on-chain mandate; nothing moved"),
    },
    {
      kicker: "Why now",
      title: "The networks are building rails for agents to pay",
      points: [
        "<b>Mastercard Agent Pay</b> (April 2025), <b>Visa Intelligent Commerce</b> and <b>Google's AP2</b> (16 September 2025).",
        "Agents will be able to pay everywhere. Someone still has to set and enforce the limits.",
      ],
      extra: `<p class="quote">AI agents could mediate $3 trillion to $5 trillion of global consumer commerce by 2030.<small>McKinsey, "The agentic commerce opportunity", 17 October 2025</small></p>
        <p class="src">Sources: mastercard.com press release, April 2025 (Agent Pay) · visa.com/en-us/solutions/intelligent-commerce · cloud.google.com/blog, 16 Sep 2025 (AP2) · mckinsey.com/capabilities/quantumblack</p>`,
      pic: `<div class="rails3"><div class="net">Mastercard<small>Agent Pay · April 2025</small></div><div class="net">Visa<small>Intelligent Commerce</small></div><div class="net">Google<small>Agent Payments Protocol · Sep 2025</small></div><div class="arrow">↓ agents can pay</div><div class="box accent">Who sets and enforces the limits?<small>Purser, on Airwallex and Metal</small></div></div>`,
    },
    {
      kicker: "Why Airwallex customers need this",
      title: "Cross-border businesses are handing work to agents",
      points: [
        "A company like Northwind Outdoor buys software, pays suppliers abroad and sells data, across currencies.",
        "With agents doing that work, each needs its own card and limits, and the CFO one place for exceptions.",
        "Purser adds that control layer on top of the Airwallex account the company already uses.",
      ],
      pic: shot(s.overview, "The CFO dashboard of the recorded run: what the agents did, and each agent's card"),
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
      kicker: "Airwallex enforces the limits",
      title: "A company card per agent, FX and payouts",
      points: [
        `<b>Declined by Airwallex itself</b>: €45.00 over the limit, €19.99 at the wrong kind of shop.`,
        "<b>One Face ID</b> raised the limit; the same charge then went through.",
        "<b>€1,850.00 by SWIFT</b>: only the EUR shortfall converted; the approval's hash rides in the transfer.",
      ],
      pic: shot(s.decline, "Purser live: Airwallex declines €45.00 over the limit; the CFO raises it with Face ID"),
    },
    {
      kicker: "Metal enforces the limits",
      title: "Mandates on chain: Metal holds the limit",
      points: [
        "<b>A mandate per agent</b>: cap per payment, budget, one payee, end date.",
        "<b>A price rise was refused against the on-chain mandate</b>: <code>mandate_cap_exceeded</code>; nothing moved.",
        "<b>x402 with signed orders</b>, refunds as mandate pulls, earnings swept once final.",
      ],
      pic: shot(s.inspector, "The mandate inspector on /metal"),
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
      kicker: "The Dispute desk",
      title: "The seller proves each payment from the chain",
      points: [
        `A simulated customer (we filed for it) disputed ${f.metal.dispute_orders} orders; each was checked against its signed order and mandate.`,
        `All ${f.metal.dispute_orders} were signed and inside the mandate: ${f.metal.dispute_refunded === 0 ? "nothing new refunded" : `${f.metal.dispute_refunded} refunded`} (${f.metal.refunded_before.length} had been refunded earlier for wrong data).`,
        "Open source for any seller on Metal: <code>examples/metal-dispute-desk</code>.",
      ],
      pic: shot(s.dispute, "The Disputes tab; the case ran after the recorded run, on a copy of its ledger"),
    },
    {
      kicker: "Claude reads, code decides",
      title: "No model can raise a limit or move money outside it",
      points: [
        "Haiku sorts, Sonnet reads into checked fields, Opus advises the CFO and played the attacker.",
        `Claude holds no key and approves nothing. ${f.claude_calls} calls, $${f.claude_per_1000_eur_usd} per €1,000 paid.`,
        `Red team, in a throwaway test world: ${rt.failed} of ${rt.attempts} attacks failed (${rt.after} found afterwards, not prevented).`,
      ],
      pic: shot(s.claude, "The Claude panel of the recorded run: each model, its calls and its cost"),
    },
    {
      kicker: "Proof",
      title: "Every payment has a proof",
      extra: `<div class="stats">${stat(String(f.alone), "payments inside the limits, no approval at the time (about half by the simulated customer's agent)")}${stat(String(f.stopped), "stops by card, chain, fraud checks or CFO")}${stat(eur(f.kept_out_eur), "kept out for good")}</div>
        <p class="src">${esc(f.run)}. Audit log: ${f.audit_rows} rows, hash-chained, checkable offline. Test money only.</p>`,
      pic: shot(s.result, "The Books: the result of the run, double entry for every payment"),
    },
    {
      kicker: "Business model (plan)",
      title: "A monthly fee per active agent",
      points: [
        "Priced per company and per active agent; no cut of payments.",
        "Airwallex and Metal keep their own fees; Purser adds the control layer.",
        "First customers: small cross-border companies on Airwallex that run AI agents.",
      ],
      pic: `<div class="diagram"><div class="box">Company on Airwallex<small>cards · FX · payouts</small></div><div class="arrow">↓</div><div class="box accent">Purser<small>limits · approvals · proof</small></div><div class="arrow">↓</div><div class="row"><div class="box">AI agents<small>pay alone inside limits</small></div><div class="box">CFO<small>Face ID for the rest</small></div></div></div>`,
    },
    {
      kicker: "Roadmap",
      title: "From testnet to production",
      points: ["Live end to end on the Airwallex sandbox and Metal testnet today; three steps to production."],
      pic: `<div class="timeline">
        <div><b>Now</b><span>Airwallex sandbox · Metal testnet</span><ul><li>live runs end to end, every approval with Face ID</li><li>one company per ledger</li><li>tests and checks in CI on every push</li></ul></div>
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
      extra: `<div class="qr">${qrSvg}</div><p class="url">${esc(TRY_URL.replace(/^https:\/\//, ""))}</p><p class="small">Or offline, no keys: <code>npm ci &amp;&amp; npm run judge</code></p>`,
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
.url { font-size: 26px; font-weight: 700; margin: 18px 0 8px; white-space: nowrap; letter-spacing: -.01em; }
.small code { white-space: nowrap; }
.photo { width: 100%; display: flex; justify-content: center; }
.photo img { width: 420px; height: 520px; object-fit: cover; border-radius: 20px; box-shadow: 0 18px 40px rgba(15, 23, 42, .14); }
.photo.empty { width: 420px; height: 520px; border: 2px dashed #c7d2fe; border-radius: 20px; align-items: center; color: #6b7280; font-size: 20px; background: #f6f7f9; }
</style></head><body>
${slides.map((x) => `<section><div class="text"><p class="kicker">${esc(x.kicker)}</p><h1>${esc(x.title)}</h1>${list(x.points ?? [])}${x.extra ?? ""}</div><div class="pic">${x.pic}</div></section>`).join("\n")}
</body></html>`;
}
