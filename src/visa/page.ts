// The /visa page: the Sourcing agent signs its card checkout with Visa's Trusted Agent Protocol, Visa's public TAP
// reference verifier (pinned commit) accepts the signature, our own layer checks the body, tag and payment, and only
// then the agent's own Airwallex Visa card pays. Rendered from the live TAP run's record (docs/runs/visa-tap-live-*.json,
// src/redesign/run.ts tapRun); the claim is Max's text word for word (VISA_CLAIM). No script; no Visa logo.

import { readFileSync } from "node:fs";
import { VISA_CLAIM } from "../config/brand.js";
import { family, tapRun } from "../redesign/run.js";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function visaPage(): string {
  const metal = readFileSync(new URL("../metal/metal.html", import.meta.url), "utf8");
  const style = metal.slice(metal.indexOf("<style>"), metal.indexOf("</style>") + 8);
  const run = tapRun();
  const rows = (run?.steps ?? []).map((s) => `<tr><td data-l="Who">${s.model ? `The Sourcing agent (${esc(family(s.model))}) picked the card rail` : "Code: one attempt over the card's limit"}</td>
<td data-l="Visa's reference proxy">answered ${s.proxyStatus}</td><td data-l="Our layer">signature 1 ${esc(s.sig1)}, signature 2 ${esc(s.sig2)}</td>
<td data-l="Airwallex">${esc(s.brand)} card: ${s.approved ? "approved" : `declined (${esc(s.reason ?? "")})`}, EUR ${esc(s.amount)}</td>
<td data-l="Read back with GET">${esc(s.getStatus)} · <span title="${esc(s.txId)}">${esc(s.txId.slice(0, 8))}…</span></td></tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Purser: Visa Trusted Agent Protocol</title>
${style.replace("</style>", `.flow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 18px 0 28px; }
.flow div { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
.flow b { display: block; font-size: 17px; margin-bottom: 6px; } .flow span { color: var(--muted); font-size: 15px; line-height: 1.5; }
.label { border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; padding: 14px 18px; font-size: 16px; line-height: 1.55; max-width: 880px; background: var(--surface); }
ul.notes { max-width: 880px; padding-left: 20px; display: grid; gap: 6px; font-size: 15px; color: var(--muted); }
table.orders { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; font-size: 15px; }
table.orders th, table.orders td { text-align: left; padding: 10px 14px; border-top: 1px solid var(--border); vertical-align: top; }
table.orders th { color: var(--muted); font-size: 14px; border-top: 0; }
h2.gap { margin-top: 28px; }
@media (max-width: 760px) { .flow { grid-template-columns: 1fr; } table.orders thead { display: none; } table.orders tr { display: block; border-top: 1px solid var(--border); padding: 6px 0; } table.orders td { display: block; border: 0; padding: 4px 14px; } table.orders td::before { content: attr(data-l) ": "; color: var(--muted); font-weight: 600; } }
</style>`)}
</head>
<body>
<header class="top"><a class="brand" href="home"><i></i>Purser</a><span class="chip">Visa TAP · Airwallex Visa cards</span>
  <nav aria-label="Pages"><a href="home">Home</a></nav></header>
<main>
  <div class="kicker">Visa Trusted Agent Protocol${run ? ` · ${esc(run.label)}` : ""}</div>
  <h1>An agent signs before it pays</h1>
  <p class="lead">Before the Sourcing agent pays a merchant by card, it signs its checkout with Visa's Trusted Agent Protocol. Visa's public TAP reference verifier checks that signature; our own layer checks the body, the tag and the payment. Only then does the agent's own Airwallex Visa card pay, inside the limit the CFO set.</p>
  <p class="label">${esc(VISA_CLAIM)}</p>
  <div class="flow">
    <div><b>1. The agent signs</b><span>A TAP signature over the checkout request, with a fresh nonce and a short window; our second signature covers the body.</span></div>
    <div><b>2. The verifier accepts it</b><span>Visa's reference proxy, unchanged at commit ${esc(run?.commit ?? "16d59bd")}, verifies the TAP signature; our layer checks the rest.</span></div>
    <div><b>3. Its own card pays</b><span>The agent's Airwallex Visa card, inside the CFO's limit; over it, Airwallex declines.</span></div>
  </div>
  <h2>The live TAP run</h2>
  <p class="sub">${run ? `${esc(run.merchant)}, ${esc(run.ranAt.slice(0, 10))}. Both card results were read back from Airwallex with GET only.` : "No run recorded yet."}</p>
  ${rows ? `<table class="orders"><thead><tr><th>Who</th><th>Visa's reference proxy</th><th>Our layer</th><th>Airwallex</th><th>Read back with GET</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
  <h2 class="gap">What this is, and is not</h2>
  <ul class="notes">${(run?.labels ?? []).map((l) => `<li>${esc(l.replace(/not a Visa-approved agent/g, "no approval by Visa of this agent"))}</li>`).join("")}</ul>
</main>
<footer>Code: src/visa/tapSig.ts, src/visa/tapLiveRun.ts, src/visa/tapMerchant.ts and src/visa/tapRail.ts. Run record: ${esc(run?.file ?? "")}.</footer>
</body>
</html>`;
}
