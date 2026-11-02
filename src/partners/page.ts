// /airwallex and /claude: one page per partner, the same five parts on each, in /metal's style (its stylesheet is
// taken as is, so the pages read as one product): (a) what the partner's product does in our story, in one sentence;
// (b) which of its features we use, each linked to its docs; (c) the live proof from this week's recorded runs;
// (d) why an agent needs it; (e) what we do not do, or only simulate. No script: a style-only policy, as on /visa.
// Built from src/partners/data.ts (recorded files and code only); every sentence has its row in docs/claims.md.

import { readFileSync } from "node:fs";
import { CORE_SENTENCE, SECOND_APPROVER } from "../config/brand.js";
import { airwallexData, claudeData, type ClaudeAgentRow, type Feature, type Proof } from "./data.js";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const EXTRA_CSS = `.runs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
.runtag { font-size: 12.5px; font-weight: 600; color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; }
.runtag.dry { color: var(--wait); border-color: var(--wait); background: var(--wait-soft); }
.built.dark { background: #191919; border-color: #191919; color: #e9e9e9; }
.card .runl { font-size: 12px; font-weight: 700; color: var(--faint); text-transform: uppercase; letter-spacing: .05em; margin-top: 6px; }
.card .runl.dry { color: var(--wait); }
.card ul.pl { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.card ul.pl li { font-size: 14px; line-height: 1.45; border-left: 3px solid var(--border); padding-left: 10px; }
.card ul.pl li.no { border-left-color: var(--bad); }
.part { font-size: 12.5px; font-weight: 700; color: var(--accent); letter-spacing: .02em; margin: 0 0 4px; }
ul.points { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; max-width: 880px; }
ul.points li { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px 16px; font-size: 15px; line-height: 1.5; }
ul.points li b { display: block; margin-bottom: 2px; }
ul.points.honest li { border-left: 4px solid var(--wait); }
.agents { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.agent { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 10px; min-width: 0; overflow-wrap: anywhere; }
.agent h3 { margin: 0; font-size: 19px; }
.agent .model { font-weight: 800; color: var(--accent); font-size: 15px; }
.agent .model small { display: block; font-weight: 500; color: var(--faint); font-size: 12px; margin-top: 2px; }
.agent .job { color: var(--muted); font-size: 13.5px; line-height: 1.45; margin: 0; }
.agent .nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.agent .nums div { background: var(--sunken); border-radius: 12px; padding: 9px 11px; }
.agent .nums b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.agent .nums span { font-size: 12px; color: var(--muted); }
.by { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 9px; }
.by.claude { color: var(--accent); background: var(--accent-soft); }
.by.code { color: var(--wait); background: var(--wait-soft); }
.agent blockquote { margin: 0; font-size: 14px; line-height: 1.5; background: var(--sunken); border-radius: 12px; padding: 10px 12px; }
.agent .req { font-size: 13.5px; line-height: 1.45; }
details.all { margin-top: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px 16px; }
details.all > summary { cursor: pointer; font-weight: 700; }
ol.dec { margin: 10px 0 0; padding-left: 22px; display: grid; gap: 8px; font-size: 14px; line-height: 1.45; }
ol.dec small { color: var(--muted); }
@media (max-width: 960px) { .agents { grid-template-columns: 1fr; } }`;

function proofHtml(p: Proof): string {
  const title = p.title ? ` title="${esc(p.title)}"` : "";
  return p.href ? `<a class="pf" href="${esc(p.href)}" target="_blank" rel="noopener"${title}>${esc(p.label)} ↗</a>` : `<span class="pf"${title}>${esc(p.label)}</span>`;
}

function featureCard(f: Feature, docsName: string): string {
  const runs = f.runs.map((r) => {
    const dry = /^Archive/.test(r.run);
    return `<div class="runl${dry ? " dry" : ""}">${esc(r.run)}</div><ul class="pl">${r.lines.map((l) => `<li${/declined|escalated|refused/i.test(l.text) ? ' class="no"' : ""}>${esc(l.text)}${l.proofs.length ? `<br>${l.proofs.map(proofHtml).join("")}` : ""}</li>`).join("")}</ul>`;
  }).join("");
  return `<article class="card" id="card-${esc(f.id)}"><div class="hd"><h3>${esc(f.title)}</h3></div>
<p>${esc(f.plain)}</p>${runs}${f.other ? `<div class="src other">${esc(f.other)}</div>` : ""}
<div class="docs"><span>${esc(docsName)} docs:</span>${f.docs.map((d) => `<a href="${esc(d.href)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join("")}</div></article>`;
}

interface Shell { title: string; chip: string; kicker: string; h1: string; lead: string; built: string; runs: string[]; stats: [string, string][]; body: string; footer: string }

function shell(s: Shell): string {
  const metal = readFileSync(new URL("../metal/metal.html", import.meta.url), "utf8");
  const style = metal.slice(metal.indexOf("<style>"), metal.indexOf("</style>") + 8).replace("</style>", `${EXTRA_CSS}\n</style>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)}</title>
${style}
</head>
<body>
<header class="top"><a class="brand" href="./"><i></i>Purser</a><span class="chip">${esc(s.chip)}</span>
  <nav aria-label="Pages"><a href="./">Overview</a></nav></header>
<main>
  <div class="kicker">${esc(s.kicker)}</div>
  <h1>${esc(s.h1)}</h1>
  <p class="part">In our story</p>
  <p class="lead">${esc(s.lead)}</p>
  <div class="runs">${s.runs.map((r) => `<span class="runtag${/^Archive/.test(r) ? " dry" : ""}">${esc(r)}</span>`).join("")}</div>
  ${s.built}
  <div class="stats">${s.stats.map(([v, l]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>
${s.body}
</main>
<footer>${esc(s.footer)}</footer>
</body>
</html>`;
}

const section = (id: string, part: string, h2: string, sub: string, inner: string) =>
  `  <section id="${id}" aria-labelledby="${id}-h"><p class="part">${esc(part)}</p><h2 id="${id}-h">${esc(h2)}</h2><p class="sub">${esc(sub)}</p>${inner}</section>`;
const points = (cls: string, items: [string, string][]) => `<ul class="points ${cls}">${items.map(([b, t]) => `<li><b>${esc(b)}</b>${esc(t)}</li>`).join("")}</ul>`;

export function airwallexPage(): string {
  const d = airwallexData();
  return shell({
    title: "Purser on Airwallex",
    chip: "How Purser uses Airwallex",
    kicker: "Your AI agents spend through Airwallex and Metal. The CFO stays in control.",
    h1: "How Purser uses Airwallex",
    lead: "Airwallex is Northwind's bank: each agent pays with its own company card, under limits Airwallex enforces on the card, and the Treasury agent's euro bills are paid by SWIFT, with euros bought at a locked rate when they are short, only after the CFO's Face ID.",
    built: '<span class="built">Built on <img src="assets/logo-airwallex.png" alt="Airwallex" width="131" height="18"></span>',
    runs: [d.labels.recorded, d.labels.autonomy],
    stats: d.stats,
    body: [
      section("features", "What we use, and the proof", "Every Airwallex feature Purser uses", "What it does for an agent, its live proof from this week's runs in the Airwallex sandbox, and Airwallex's docs. Airwallex ids have no public page; each one with a status was read back from the sandbox with GET only.", `<div class="cards">${d.features.map((f) => featureCard(f, "Airwallex")).join("")}</div>`),
      section("why", "Why an agent needs it", "Why an agent needs Airwallex", "An agent can be wrong, or be talked into something. The limits must hold anyway.", points("", [
        ["A limit the agent cannot talk past.", "The card's limits sit at Airwallex. Over them, Airwallex declines, whatever the agent does; the agent can only ask the CFO for a raise."],
        ["No card number in the agent's hands.", "Agents never see the card number or CVV, and no call asks for them."],
        ["Exactly what the CFO approved.", "One Face ID covers the quote, the rate, the payee and the most the fee may be; the transfer carries the approval hash, so an auditor can check that Airwallex booked what the CFO approved."],
        ["Never paid twice.", "A request that gets no answer is never resent blindly: it is looked up by its request_id, and a quote is booked once."],
      ])),
      section("honest", "What we do not do, or only simulate", "What is simulated, and what is not done yet", "Said here so nobody has to find it.", points("honest", [
        ["Sandbox only.", "Every call goes to the Airwallex sandbox, with test money; the client refuses any other address."],
        ["The merchants are simulated.", "A sandbox has no real merchants: the merchant's charge on an agent's card is simulated (Airwallex's simulation API). The approve or decline is Airwallex's own."],
        ["No stablecoin reaches Airwallex.", "Metal earnings are booked as a simulated sandbox deposit that names the testnet transaction; no test USD moves to Airwallex."],
        ["PAID is the sandbox's.", "A SWIFT transfer's PAID status is set by the sandbox's simulation."],
        ["Placeholder cardholders.", "The agents' cardholders carry placeholder details in the sandbox. Airwallex's KYC and screening are its own and are not shown here."],
        ["Not yet run live.", "The emergency stop that freezes every card is tested against stand-ins only. Payout, conversion and card status webhooks are subscribed but were not yet caused live. In the autonomous dry runs a decline reaches the agent by poll; the webhook path is the hosted relay's."],
        ["The licence transfer in agent run 1: refused.", "After the CFO's Face ID, Airwallex refused the EUR 240.00 SWIFT transfer (400 fee_unknown): nothing was paid, and a read-only lookup by request_id finds no transfer. It is to be retried in that world."],
        ["The task card, not chosen.", "In 19 autonomous dry runs the Sourcing agent never chose the single-use task card (0 of 19); that path is proven by tests and the 29 October card runs, not by an autonomous run."],
      ])),
    ].join("\n"),
    footer: `Test money only: the Airwallex sandbox and Metal testnet. The Airwallex logo is its owner's; shown as "built on", not as an endorsement. Sources: docs/demo/agent-run.json (agent run 1), docs/demo/snapshot.json (the 30 October run, archive), docs/runs/airwallex-readback.json (read back ${d.readBackAt.slice(0, 10)}), docs/airwallex.md.`,
  });
}

function agentCard(a: ClaudeAgentRow): string {
  const reqs = a.requests.length
    ? a.requests.map((r) => `<div class="req">${esc(r.what)}<br><span class="pf" title="Anthropic API request id">request ${esc(r.id)}</span>${proofHtml(r.proof)}</div>`).join("")
    : `<div class="req">Its ${a.calls} Claude calls each have a request id in the ledger (${a.callsWithoutRequestId} without one). It moved money only through the buy policy it set, which code follows, so no money movement carries its request id.</div>`;
  const d = a.shown;
  const latest = d
    ? `<div><span class="by ${d.by === "claude" ? "claude" : "code"}">${d.by === "claude" ? `Decided by Claude${d.model ? ` · ${esc(modelShort(d.model))}` : ""} · Powered by Claude` : "Fallback (code)"}</span> <small class="job">${esc(d.why)},${esc(d.at.slice(11, 16))} UTC</small></div><blockquote>“${esc(sentences(d.text, 2))}”</blockquote>`
    : "";
  return `<article class="agent" id="agent-${a.id}"><h3>${esc(a.name)}</h3>
<div class="model">${esc(a.modelWord)}<small>${esc(a.model)}, from code</small></div>
<p class="job">${esc(a.job)}</p>
<div class="nums"><div><b>${a.byClaude} of ${a.decisions}</b><span>decided by Claude</span></div><div><b>${a.fallbackPct}%</b><span>fallback (code): ${a.fallback}</span></div><div><b>${a.calls}</b><span>Claude calls</span></div><div><b>USD ${esc(a.costUsd)}</b><span>measured cost, list price${a.medianLatencyS ? ` · ${esc(a.medianLatencyS)} s a run (median)` : ""}</span></div></div>
${reqs}
${latest}</article>`;
}

/** The first n sentences, as said; "…" marks that the rest is in the list below. */
const sentences = (t: string, n: number) => {
  const all = t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  return all.length > n ? `${all.slice(0, n).join(" ")} …` : all.join(" ");
};
const modelShort =(m: string) => (/claude-(haiku|sonnet|opus)/i.exec(m)?.[1] ?? m).replace(/^./, (c) => c.toUpperCase());

export function claudePage(): string {
  const d = claudeData();
  const decisions = d.agents.reduce((n, a) => n + a.decisions, 0);
  const byClaude = d.agents.reduce((n, a) => n + a.byClaude, 0);
  const calls = d.agents.reduce((n, a) => n + a.calls, 0);
  const without = d.agents.reduce((n, a) => n + a.callsWithoutRequestId, 0);
  const cost = d.agents.reduce((n, a) => n + Number(a.costUsd), 0);
  const name = (id: string) => d.agents.find((a) => a.id === id)?.name ?? id;
  const list = d.decisions.map((c) => `<li><span class="by ${c.by === "claude" ? "claude" : "code"}">${c.by === "claude" ? `Decided by Claude${c.model ? ` · ${esc(modelShort(c.model))}` : ""}` : "Fallback (code)"}</span> <b>${esc(name(c.agent))}</b> <small>${esc(c.at.slice(11, 16))} UTC</small><br>${esc(c.text)}</li>`).join("");
  const rec = d.recorded;
  const features: Feature[] = [
    {
      id: "tools", title: "Tool use: an agent loop with checked tools",
      plain: "Each agent runs its own loop with a goal and a few tools (read the market, set the buy policy, refund, sweep, message another agent). Every tool call passes code's checks and the rail's own limits before any money moves.",
      docs: [{ label: "Define tools", href: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools" }],
      runs: [{ run: d.label, lines: d.agents.flatMap((a) => a.requests.map((r) => ({ text: `${a.name} (${a.modelWord}): ${r.what}`, proofs: [{ label: `request ${r.id}`, href: null, title: "Anthropic API request id" }, r.proof] }))) }].filter((r) => r.lines.length),
    },
    {
      id: "models", title: "The right model per job",
      plain: "Haiku for the frequent, cheap decisions, Sonnet where numbers and names need care, Opus for the rare decisions a person reads before approving.",
      docs: [{ label: "Models overview", href: "https://platform.claude.com/docs/en/models/overview" }, { label: "Pricing", href: "https://platform.claude.com/docs/en/about-claude/pricing" }],
      runs: [{ run: rec.label, lines: rec.models.map((m) => ({ text: `${m.model}: ${m.role}; ${m.calls} calls, USD ${m.costUsd}`, proofs: [] })) }],
    },
    {
      id: "structured", title: "Structured outputs, checked by code",
      plain: "A schema shapes each reading of a document, so there is no retry for a reply that does not parse; code checks every answer, and a wrong shape, a refusal or a failed call falls back to a plain parser.",
      docs: [{ label: "Structured outputs", href: "https://platform.claude.com/docs/en/build-with-claude/structured-outputs" }],
      runs: [{ run: rec.label, lines: rec.models.filter((m) => /fields/.test(m.role)).map((m) => ({ text: `${m.model} read the run's documents into checked fields: ${m.calls} calls`, proofs: [] })) }].filter((r) => r.lines.length),
    },
    {
      id: "cache", title: "Prompt caching and low effort",
      plain: "The same instructions open every call and are marked for the prompt cache; readings run at effort low, only Opus's reviews and drafts at medium.",
      docs: [{ label: "Prompt caching", href: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching" }, { label: "Effort", href: "https://platform.claude.com/docs/en/build-with-claude/effort" }],
      runs: [{ run: rec.label, lines: [{ text: `${rec.calls} Claude calls cost USD ${rec.costUsd} in all at list prices: USD ${rec.per1000Eur} of AI per EUR 1,000 the agents paid (EUR ${rec.eurPaid})`, proofs: [] }] }],
    },
  ];
  return shell({
    title: "Purser on Claude",
    chip: "How Purser uses Claude",
    kicker: CORE_SENTENCE,
    h1: "How Purser uses Claude",
    lead: "Claude is how Purser's agents read the world and decide what to do inside their limits: the Sourcing agent runs on Haiku, the Support agent on Sonnet, the Treasury agent on Opus, and code checks every decision before money moves.",
    built: '<span class="built dark">Powered by <img src="assets/logo-claude.png" alt="Claude" width="73" height="16"></span>',
    runs: [d.label, rec.label],
    stats: [
      [String(decisions), `agent decisions in ${d.label.replace(/^Replay of /, "").split(" · ")[0]}`],
      [`${byClaude} of ${decisions}`, `decided by Claude; ${decisions - byClaude} fallback (code)`],
      [String(calls), `agents' Claude calls, ${without} without a request id`],
      [`USD ${cost.toFixed(2)}`, "the agents' measured Claude cost in that run, at list prices"],
    ],
    body: [
      section("agents", "The three agents", "Each agent, its model and what it cost", `${d.label}. The model of each agent is read from code; the decisions, costs and request ids from the run's recording.`,
        `<div class="agents">${d.agents.map(agentCard).join("")}</div><details class="all"><summary>Every decision in the run (${d.decisions.length}), with who decided</summary><ol class="dec">${list}</ol></details>`),
      section("features", "What we use, and the proof", "The Claude features Purser uses", "Each with its proof from this week's runs and Anthropic's docs.", `<div class="cards">${features.map((f) => featureCard(f, "Claude")).join("")}</div>`),
      section("why", "Why an agent needs it", "Why an agent needs Claude", "The world changes in words; the limits do not.", points("", [
        ["The world arrives in words.", "A supplier's price notice, a customer's dispute email, an invoice: Claude reads them, and code checks what it read against the ledger and the chain."],
        ["Every decision explains itself.", "Each agent says in plain words why it did what it did, so the CFO can read it beside the proof."],
        ["No keys, no card numbers.", "No agent holds a key or sees a card number; every tool call passes code's checks and the rail's own limits (the Metal mandate or the Airwallex card), and anything beyond them waits for the CFO's Face ID."],
      ])),
      section("honest", "What we do not do, or only simulate", "What is not shown here", "Said here so nobody has to find it.", points("honest", [
        ["A rehearsal, with test money.", "The agents deciding is shown from agent run 1 (rehearsal, 2 November): real Claude decisions and Max's Face ID, on Metal testnet and the Airwallex sandbox. " + SECOND_APPROVER],
        ["In the archived run, code decided.", "In the 30 October recorded run, code made the decisions; Claude read the documents and explained. The agents' own decisions come from agent run 1."],
        ["Narrow tests.", "The variation test and the red team against the agent loop used stand-in rails and the Sourcing agent (Haiku) only."],
        ["List prices, not a bill.", "Costs are computed from each call's token usage at Anthropic's published list prices."],
        [`Request ids: ${d.tryRun.requests.length ? "where recorded" : "in the ledger"}.`, `The recording keeps an Anthropic request id on each money movement Claude decided; every agent call in the run has one in the ledger. The /try dev run's ids are in its run log (${d.tryRun.file}${d.tryRun.requests[0] ? `, for example ${d.tryRun.requests[0]}` : ""}).`],
      ])),
    ].join("\n"),
    footer: "Test money only: Metal testnet *USDZ and the Airwallex sandbox. The Claude logo is Anthropic's; shown as \"Powered by Claude\", not as an endorsement. Sources: docs/demo/agent-run.json (agent run 1), docs/demo/snapshot.json (the recorded run), src/claude/reader.ts and src/autonomy/ (the models), src/claude/pricing.ts (list prices).",
  });
}
