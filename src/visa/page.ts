// The /visa page: agent recognition (the agent-recognition profile of Visa's Trusted Agent Protocol spec), then the
// agent's own Airwallex Visa card. Rendered from the newest run record in docs/runs (visa-tap*.json), with the honest
// label in full. No script; the style is /metal's, so the two pages read as one product.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Step { step: string; expect: string; status: number; result: { recognised?: boolean; approved?: boolean; reason?: string | null } }
interface Run { ran_at: string; merchant: string; steps: Step[] }
interface LiveStep { step: string; tap?: { proxy_status?: number; sig1?: string; sig2?: string }; airwallex?: { approved?: boolean; failure_reason?: string | null } }

export const VISA_LABEL = "Agent requests are signed with RFC 9421 HTTP Message Signatures following the agent-recognition profile of Visa's Trusted Agent Protocol specification (tags agent-browser-auth and agent-payer-auth, an 8-minute window, a nonce that is never accepted twice). Keys come from our self-hosted registry, with test keys: these are not Visa-approved agents, and there is no Visa key store, ID token or payment container. Card payments are Airwallex sandbox simulated authorisations.";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const runsDir = resolve(import.meta.dirname, "../../docs/runs");

/** The newest visa-tap run record; a live run (visa-tap.json or visa-tap-live*.json) wins over the dev test. */
export function visaRun(): (Run & { file: string }) | null {
  if (!existsSync(runsDir)) return null;
  const files = readdirSync(runsDir).filter((f) => /^visa-tap.*\.json$/.test(f));
  const pick = files.find((f) => f === "visa-tap.json") ?? files.find((f) => f.startsWith("visa-tap-live")) ?? files.find((f) => f === "visa-tap-dev.json");
  if (!pick) return null;
  const raw = JSON.parse(readFileSync(resolve(runsDir, pick), "utf8")) as Omit<Run, "steps" | "merchant"> & { merchant: unknown; steps: (Step | LiveStep)[] };
  // The live TAP run (2 November) records its steps in another shape: TAP verdicts plus Airwallex's own answer.
  const steps = raw.steps.map((x): Step => ("result" in x ? x : {
    step: x.step, expect: "", status: x.tap?.proxy_status ?? 0,
    result: { recognised: x.tap?.proxy_status === 200 && x.tap?.sig1 === "verified" && x.tap?.sig2 === "verified", approved: x.airwallex?.approved === true, reason: x.airwallex?.failure_reason ?? null },
  }));
  const merchant = typeof raw.merchant === "string" ? raw.merchant : String((raw.merchant as { name?: string } | undefined)?.name ?? "Packwise");
  return { ...raw, merchant, steps, file: pick };
}

export function visaPage(): string {
  const metal = readFileSync(new URL("../metal/metal.html", import.meta.url), "utf8");
  const style = metal.slice(metal.indexOf("<style>"), metal.indexOf("</style>") + 8);
  const run = visaRun();
  const rows = (run?.steps ?? []).map((s) => {
    const r = s.result;
    const merchant = r.recognised ? "recognised" : `refused: ${esc(String(r.reason ?? ""))}`;
    const awx = !r.recognised ? "not called" : r.approved ? "approved" : esc(String(r.reason ?? "declined"));
    return `<tr><td data-l="Request">${esc(s.step)}</td><td data-l="Merchant">${merchant}</td><td data-l="Airwallex">${awx}</td></tr>`;
  }).join("");
  const dev = run?.file === "visa-tap-dev.json";
  const declines = (run?.steps ?? []).filter((s) => s.result.recognised && !s.result.approved).length;
  const declineNote = declines === 0 ? "" : declines === 1 ? "; the one decline is Airwallex's own" : `; the ${declines} declines are Airwallex's own`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Purser: agent recognition and Visa cards</title>
${style.replace("</style>", `.flow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 18px 0 28px; }
.flow div { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
.flow b { display: block; font-size: 16px; margin-bottom: 6px; } .flow span { color: var(--muted); font-size: 14px; line-height: 1.5; }
.label { border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; padding: 14px 18px; font-size: 14px; line-height: 1.55; max-width: 880px; background: var(--surface); }
table.orders { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; font-size: 14px; }
table.orders th, table.orders td { text-align: left; padding: 10px 14px; border-top: 1px solid var(--border); vertical-align: top; }
table.orders th { color: var(--muted); font-size: 12.5px; border-top: 0; }
h2.gap { margin-top: 28px; }
@media (max-width: 760px) { .flow { grid-template-columns: 1fr; } }
</style>`)}
</head>
<body>
<header class="top"><a class="brand" href="./"><i></i>Purser</a><span class="chip">Agent recognition · Visa cards</span>
  <nav aria-label="Pages"><a href="./">Overview</a><a href="try">Try it</a><a href="metal">Metal</a><a href="live">Live</a><a href="film">Film</a><a href="demo">Recorded run</a><a href="month">Month</a><a href="lab">Lab</a><a href="./?recorded">CFO dashboard</a></nav></header>
<main>
  <div class="kicker">${dev ? "Dev test, following Visa's Trusted Agent Protocol spec · our own registry, test keys" : "Live TAP run · Visa's public reference verifier at 16d59bd, unmodified · the TAP merchant is run by us"}</div>
  <h1>${dev ? "Dev test: an agent signs before it pays" : "An agent signs before it pays"}</h1>
  ${dev ? "" : `<p class="sub">Our agents sign their card checkouts at TAP merchants with Visa's Trusted Agent Protocol. Their signatures are accepted by Visa's public TAP reference verifier (pinned commit 16d59bd). The TAP merchant in this demo is run by us. Body integrity, tag and payment checks are our own layer on top.</p>`}
  <p class="lead">Before an agent pays a merchant, it signs its request. The merchant checks the signature against the registry of Northwind's agents and refuses anything it does not recognise. Only then does the agent pay, with its own Airwallex Visa card, inside the limit the CFO set.</p>
  <div class="flow">
    <div><b>1. The agent signs</b><span>RFC 9421 signature over the merchant's host and path, a fresh nonce, an 8-minute window, and a tag: agent-payer-auth to pay.</span></div>
    <div><b>2. The merchant recognises it</b><span>The key must be in the registry, not revoked or expired, and registered for this merchant; the nonce is never accepted twice.</span></div>
    <div><b>3. Its own card pays</b><span>The agent's Airwallex Visa card, inside the CFO's limit; over it, Airwallex declines.</span></div>
  </div>
  <h2>${dev ? "A dev test, live in the Airwallex sandbox" : "Live in the Airwallex sandbox"}</h2>
  <p class="sub">${run ? `${esc(run.merchant)} (the merchant we run), ${esc(run.ran_at.slice(0, 10))}${dev ? ", on a copy of the Friday run 2 ledger" : ""}. Every merchant refusal happened before Airwallex was called${declineNote}.` : "No run recorded yet."}</p>
  ${rows ? `<table class="orders"><thead><tr><th>Request</th><th>Merchant</th><th>Airwallex</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
  <h2 class="gap">What this is, and is not</h2>
  <p class="label">${esc(VISA_LABEL)}</p>
</main>
<footer>Code: ${dev ? "src/visa/tap.ts (our own, against RFC 9421) and src/visa/merchant.ts" : "src/visa/tapSig.ts, src/visa/tapMerchant.ts and src/visa/tapRail.ts (ours); Visa's reference is run unmodified outside this repository and not included in it (.github/workflows/tap-interop.yml)"}. Tests: test/visa-tap.test.ts, test/visa-merchant.test.ts. Run record: docs/runs/${esc(run?.file ?? "")}.</footer>
</body>
</html>`;
}
