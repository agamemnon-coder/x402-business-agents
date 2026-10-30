// The submission deck (awards item 6): nine 16:9 slides as one HTML page, printed to PDF by npm run submission.
// Every figure comes from packFacts(), the same recorded files the pages use; the font and the sponsors' logos are
// embedded, so the PDF needs no network.

import { readFileSync } from "node:fs";
import type { PackFacts } from "./facts.js";

const asset = (p: string) => readFileSync(new URL(`../ui/${p}`, import.meta.url));
const dataUri = (p: string, type: string) => `data:${type};base64,${asset(p).toString("base64")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const eur = (v: string) => `€${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Slide { kicker: string; title: string; body: string }

const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const stat = (value: string, label: string) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

export function deckHtml(f: PackFacts): string {
  const rt = f.redteam;
  const slides: Slide[] = [
    {
      kicker: "Airwallex Agentic Banking Hackathon · Starter Kit 11",
      title: "Purser",
      body: `<p class="lead">Your AI agents spend through Airwallex and Metal.<br>The CFO stays in control.</p>
        <p>Each agent gets an Airwallex company card and a Metal on-chain mandate, within limits the CFO sets.
        When an agent needs more, it stops and asks, and the CFO approves on a phone with Face ID.</p>
        <div class="logos"><img src="${dataUri("logos/airwallex.png", "image/png")}" alt="Airwallex" height="22"><img src="${dataUri("logos/metal.svg", "image/svg+xml")}" alt="Metal" height="22"><span class="with">with Claude</span></div>`,
    },
    {
      kicker: "The problem",
      title: "Agents can pay now. Who holds the limit?",
      body: `${list([
        "An agent with a card or a wallet spends as fast as it is told to, including by a fake invoice or a planted instruction.",
        "A limit written in a prompt can be talked out of. It has to live in the rails and in code.",
        "The CFO needs to approve the exact terms, not a summary, and to prove later what was approved.",
      ])}
      <p class="quote">$3,046,598,558 in business email compromise losses were reported by victims to the FBI in 2025.<small>FBI IC3, 2025 Internet Crime Report</small></p>`,
    },
    {
      kicker: "How it works",
      title: "Alone inside the limits. Face ID for the rest.",
      body: `<div class="cols3">
        <div><h3>The agent may, alone</h3><p>Pay inside its card limits and its on-chain mandate.</p></div>
        <div><h3>The CFO approves</h3><p>Anything above a limit, a new payee, a bank-detail change, a looser policy: the exact terms, signed with Face ID on the phone. The runner checks the signature and the terms' hash before money moves.</p></div>
        <div><h3>Exceptions</h3><p>A price rise is refused on chain and becomes options. A suspected fake invoice or a planted instruction waits for a person. An agent that pays too often is stopped.</p></div>
      </div>`,
    },
    {
      kicker: "How we use Airwallex",
      title: "Cards, FX and payouts, with Airwallex enforcing the limits",
      body: list([
        "<b>A virtual Visa card per agent</b> (Issuing): limits from the CFO policy, merchant categories, currency and end date fixed per agent; all written to the card and read back.",
        "<b>Declined by Airwallex itself</b> in the recorded run: €45.00 over the limit (<code>LIMIT_EXCEEDED</code>), €19.99 at the wrong kind of shop (<code>MERCHANT_CATEGORY_NOT_ALLOWED</code>). After the CFO's Face ID raise, the same charge went through.",
        "<b>Single-use task cards</b> for a flight, a hotel or a train, from one sentence (separate live run).",
        "<b>A €1,850.00 invoice by SWIFT</b>: only the EUR shortfall (after the reserve and the demo plan's set-aside) bought on a locked quote; one Face ID covers rate, payee and fee ceiling; the approval's hash rides in the transfer's metadata.",
        "<b>Global Accounts</b> (separate live run): retailers' payments matched to invoices; anything off goes to the CFO.",
      ]),
    },
    {
      kicker: "How we use Metal",
      title: "Mandates on chain: Metal holds the limit, not only Purser",
      body: list([
        "<b>A mandate per agent</b>: a cap per payment, a total budget, one payee, an end date.",
        "<b>Metal's facilitator refused a price rise</b> against the mandate on chain (<code>mandate_cap_exceeded</code>): nothing moved. The CFO signed new terms with Face ID; the mandates were replaced and the old one is refused.",
        "<b>x402 with signed orders</b> for per-request sales, <b>mandate pulls</b> for refunds and the sweep, <b>pay-per-call clearing</b> for a prepaying customer (separate live run).",
        "<b>Earnings are booked at Airwallex only when final</b>, exactly once (a simulated sandbox deposit that names the testnet transaction).",
        `<b>The Dispute desk</b> (after the run): the simulated customer disputed ${f.metal.dispute_orders} orders; each was checked against the chain with the signed order Northwind keeps; the claim refunded ${f.metal.dispute_refunded === 0 ? "nothing" : f.metal.dispute_refunded} ${f.metal.refunded_before.length ? ` (orders ${f.metal.refunded_before.join(", ")} had been refunded earlier for wrong data)` : ""}.`,
      ]),
    },
    {
      kicker: "For a bigger company",
      title: "More control moves on chain",
      body: list([
        "<b>Four eyes on chain</b>: a 2-of-2 Metal account (CFO + controller). One signature, or the CFO with a stranger's key, reverted on chain; both owners together passed.",
        "<b>Compliance before a payout</b>: a send-policy contract pays only with Purser's signed screening decision. Eleven attacks reverted on chain. Mandate payments do not pass through it.",
        "<b>Finality certificates</b> kept as evidence for each payment seen within about 2 hours (the validators' signature is not verified: their testnet keys are not published).",
        "<b>Clearing under load</b>: 2,000 of 2,000 payments at 4.24 a second, about $0.0007 of RPC per payment (an estimate).",
        "<b>ISO 20022</b>: the paid invoice as one pacs.008 message linking the SWIFT transfer and the Metal transaction.",
        "All in separate test worlds on Metal testnet, 30 October; not in the recorded run.",
      ]),
    },
    {
      kicker: "Where Claude is used",
      title: "Claude reads and advises. Code and the CFO decide.",
      body: `<div class="cols3">
        <div><h3>Haiku</h3><p>Sorts each incoming document.</p></div>
        <div><h3>Sonnet</h3><p>Reads invoices and notices into fields that code then checks.</p></div>
        <div><h3>Opus</h3><p>Reviews a proposal's risk for the CFO; played the attacker in the red team.</p></div>
      </div>
      <p>Claude holds no key and approves nothing. In the recorded run: ${f.claude_calls} calls, $${f.claude_per_1000_eur_usd} per €1,000 the agents paid.</p>`,
    },
    {
      kicker: "Proof",
      title: "Every payment has a proof",
      body: `<p class="note">${esc(f.run)}</p><div class="stats">${stat(String(f.alone), "payments inside the limits, no approval at the time (about half the simulated customer's)")}${stat(String(f.stopped), "stops by the card, the chain, the fraud checks or the CFO")}${stat(eur(f.kept_out_eur), "kept out for good")}${stat(String(f.face_id), "decisions signed with Face ID")}</div>
        ${list([
          `Red team (scripted attacks plus ${rt.documents} documents by Claude as the attacker, against in-memory stand-ins): ${rt.failed} of ${rt.attempts} failed, ${rt.inconclusive} inconclusive; ${rt.before} stopped before succeeding, ${rt.after} found afterwards, not prevented.`,
          `Scenario Lab: ${f.lab.passed} of ${f.lab.total} stories as expected. Audit log: ${f.audit_rows} rows, hash-chained.`,
          "All test money: the Airwallex sandbox and Metal testnet. Simulated: merchants' charges, deposits, a transfer's last steps; the customer Summit and the warehouse API Stockline are run by us.",
        ])}`,
    },
    {
      kicker: "Try it",
      title: "npm ci && npm run judge",
      body: `<p class="lead">No keys, no network after install.</p>
        ${list([
          "<b>/</b> what each rail did, with its proof",
          "<b>/?recorded</b> the CFO dashboard at the end of the run",
          "<b>/metal</b> every Metal feature with its proof",
          "<b>/live</b> the working day as an animation on the two rails",
          `<b>/lab</b> ${f.lab.total} stories, from a normal purchase to the emergency stop`,
        ])}
        <p class="small">Built with Claude Code. Sources: docs/claims.md.</p>`,
    },
  ];
  const font = asset("inter.woff2").toString("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Purser</title><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #0b1220; background: #ffffff; }
section { width: 1280px; height: 720px; padding: 64px 80px; display: flex; flex-direction: column; page-break-after: always; break-after: page; position: relative; overflow: hidden; }
section:last-child { page-break-after: auto; break-after: auto; }
section::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: #4f46e5; }
.kicker { font-size: 18px; font-weight: 600; color: #4f46e5; letter-spacing: .02em; margin: 0 0 14px; }
h1 { font-size: 46px; line-height: 1.12; margin: 0 0 28px; letter-spacing: -.02em; }
h3 { font-size: 21px; margin: 0 0 8px; }
p, li { font-size: 22px; line-height: 1.45; }
p { margin: 0 0 16px; }
.lead { font-size: 30px; font-weight: 600; line-height: 1.3; }
ul { margin: 0; padding-left: 26px; }
li { margin: 0 0 12px; }
code { font-size: 18px; background: #eef0ff; padding: 1px 6px; border-radius: 4px; }
.cols3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-bottom: 20px; }
.cols3 > div { background: #f6f7f9; border-radius: 12px; padding: 22px; }
.cols3 p { font-size: 19px; margin: 0; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 26px; }
.stat { background: #f6f7f9; border-radius: 12px; padding: 20px; }
.stat b { display: block; font-size: 40px; letter-spacing: -.02em; }
.stat span { font-size: 16px; color: #4b5563; line-height: 1.35; display: block; margin-top: 6px; }
.quote { margin-top: auto; font-size: 26px; font-weight: 600; border-left: 4px solid #4f46e5; padding-left: 20px; }
.quote small { display: block; font-size: 16px; font-weight: 400; color: #4b5563; margin-top: 6px; }
.logos { margin-top: auto; display: flex; gap: 36px; align-items: center; }
.small { font-size: 16px; color: #4b5563; margin-top: auto; }
.note { font-size: 17px; color: #4b5563; margin: -16px 0 18px; }
.with { font-size: 20px; font-weight: 600; color: #4b5563; }
</style></head><body>
${slides.map((s) => `<section><p class="kicker">${esc(s.kicker)}</p><h1>${esc(s.title)}</h1>${s.body}</section>`).join("\n")}
</body></html>`;
}
