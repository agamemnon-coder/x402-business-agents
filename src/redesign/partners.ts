// The partner pages in the redesign's style (mega-prompt v4, C1): /metal, /airwallex, /visa, /claude. Each is short
// (about 150 visible words at most): a picture of the flow first, three or four numbers, one sentence, and everything
// else folded (<details>): the live proof from the main run (the same list as Proof's card), the docs we built on, what
// is simulated. Every figure from the record (src/redesign/run.ts) or the TAP run's record; logos only as "built on",
// never a Visa logo. No script. Also the clean 404 page.

import { readFileSync } from "node:fs";
import { SPLIT_LINE, VISA_AWARD_STATUS, VISA_CLAIM } from "../config/brand.js";
import { airwallexData } from "../partners/data.js";
import { agentRun, callBadge, faceIdDecisions, family, fxOf, ownTap, split, stops, tapRun, timings, type AgentRun, type Ev } from "./run.js";
import { LOGO, earlierLine, fold, partnerProof } from "./proof.js";
import { esc, icon, page } from "./ui.js";

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
details.fold { border-top: 1px solid var(--border); padding-top: 6px; } details.fold:first-child { border-top: 0; }
details.fold > summary { cursor: pointer; font-weight: 650; font-size: 16px; color: var(--accent); list-style: none; display: flex; align-items: center; gap: 6px; min-height: 44px; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::after { content: "▾"; font-size: 14px; } details.fold[open] > summary::after { content: "▴"; }
ul.pl { list-style: none; margin: 6px 0 10px; padding: 0; display: grid; gap: 8px; }
ul.pl li { font-size: 15.5px; line-height: 1.45; border-left: 3px solid var(--border); padding-left: 11px; overflow-wrap: anywhere; }
ul.pl li.no { border-left-color: var(--bad); } ul.pl li.ok { border-left-color: var(--ok); } ul.pl li.face { border-left-color: var(--accent); }
ul.pl small { display: block; color: var(--faint); font-size: 14px; }
ul.pl .call { margin-top: 4px; }
abbr[title] { text-decoration: underline dotted; text-underline-offset: 3px; }
a.pf { color: var(--accent); font-weight: 600; text-decoration: none; font-size: 15px; }
.open { font-size: 16px; font-weight: 650; color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.nf { padding: 64px 0; } .nf .wrap { display: grid; gap: 16px; justify-items: start; } .nf h1 { font-size: clamp(34px, 5vw, 56px); font-weight: 800; }
.nf .tabs2 { display: flex; flex-wrap: wrap; gap: 10px; }`;

const SOURCE = (run: AgentRun) => `Source: ${run.file} (${run.name}); the card run from ${tapRun()?.file ?? "docs/runs"}.`;
const node = (ic: string, title: string, sub: string, tone = "") => `<div class="node ${tone}"><span class="ic">${icon(ic, 22)}</span><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
const arrow = `<span class="arrow" aria-hidden="true">${icon("arrow-right", 22)}</span>`;
const nums = (items: [string, string][]) => `<div class="nums">${items.map(([v, l]) => `<div class="num card"><span class="v">${esc(v)}</span><span class="l">${esc(l)}</span></div>`).join("")}</div>`;
const docsLi = (title: string, docs: { label: string; href: string }[]) => `<li>${esc(title)}: ${docs.map((d) => `<a class="pf" href="${esc(d.href)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join(" · ")}</li>`;
const plainLi = (t: string) => `<li>${esc(t)}</li>`;

function shell(run: AgentRun, o: { label?: string; title: string; description: string; logo: string; h1: string; picture: string; nums: string; line: string; extra?: string; folds: string; proofHash: string }): string {
  const body = `<main class="pp"><div class="wrap">
  <div class="phd">${o.logo}<span class="pill run">${icon("database", 14)}${esc(o.label ?? run.label)}</span><h1>${esc(o.h1)}</h1></div>
  <div class="flow card" role="img" aria-label="${esc(`How ${o.title} fits in, step by step`)}">${o.picture}</div>
  ${o.nums}
  <p class="line">${esc(o.line)}</p>
  ${o.extra ?? ""}
  <div class="folds card">${o.folds}</div>
  <a class="open" href="proof#${o.proofHash}">All the proof ${icon("arrow-right", 15)}</a>
</div></main>`;
  return page({ title: o.title, description: o.description, tab: "proof", css: CSS, body, source: SOURCE(run) });
}

const moneyOf = (run: AgentRun) => run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");

export function metalPage(run: AgentRun = agentRun()): string {
  const p = partnerProof(run), st = stops(run.record), money = moneyOf(run);
  const s1 = run.scenes.find((s) => s.n === 1)?.mini;
  const price = s1?.kind === "price" ? s1 : null;
  const onChain = money.filter((e) => e.rail === "metal" && !e.refused).reduce((n, e) => n + e.count, 0);
  const mandates = run.events.filter((e): e is Extract<Ev, { k: "mandate" }> => e.k === "mandate");
  const sweep = money.find((e) => e.rail === "metal" && /sweep/i.test(e.what) && !e.refused);
  const refusal = money.find((e) => e.refused?.by === "recorded" && e.proof.href);
  const metal = JSON.parse(readFileSync(new URL("../../docs/demo/metal.json", import.meta.url), "utf8")) as { features: { title: string; docs: { label: string; href: string }[] }[] };
  const used = metal.features.filter((f) => /mandate per agent|Replace and revoke|x402|facilitator|Refunds as mandate|Sweep after finality|Four eyes/i.test(f.title));
  const sourcing = run.agents.find((a) => a.id === "sourcing")!;
  return shell(run, {
    title: "Metal", description: "How Purser uses Metal: each agent's limit is a mandate on chain; payments per query over x402; a payment over the cap is refused on chain.",
    logo: LOGO.metal, h1: "A limit the agent cannot talk past", proofHash: "metal",
    picture: [node("package", `${sourcing.short} agent`, `Claude ${sourcing.family} sets the buy policy`), arrow,
      node("shield-check", price ? `Mandate cap ${price.cap}` : "Mandate", "per payment, on chain", "metal"), arrow,
      node("ban", price ? `${price.price} refused` : "Over the cap: refused", refusal ? `recorded on chain · ${refusal.proof.label}` : "nothing settles", "bad"), arrow,
      node("scan-face", price?.newCap ? `New cap ${price.newCap}` : "New mandate", "after Face ID 1 of 2 → 2 of 2", "ok")].join(""),
    nums: nums([[String(onChain), "payments on chain"], [String(st.metal), "refused by Metal at the cap"], [String(mandates.length), "mandates replaced"], [sweep ? sweep.amount : "0", "test USD swept after finality"]]),
    line: "Each agent pays from the company's Metal account under its own mandate; a payment over the cap does not settle.",
    folds: fold("The live proof, with every tx", p.metal) + fold("The Metal features we use, and their docs", used.map((f) => docsLi(f.title, f.docs)))
      + fold("What is simulated", [plainLi("Test money on Metal testnet only."), plainLi("Stockline, the supplier, and Summit, the customer whose agent buys from us, are simulated; their payments are real testnet transactions.")])
      + fold("Archive", [`<li><a class="pf" href="metal/report">The Dispute desk's evidence report (30 October)</a></li>`]),
  });
}

export function airwallexPage(run: AgentRun = agentRun()): string {
  const p = partnerProof(run), st = stops(run.record), money = moneyOf(run);
  const booked = money.find((e) => e.via === "deposit" && e.dir === "in");
  const licence = money.find((e) => e.via === "SWIFT" && !e.refused);
  const earlier = money.filter((e) => e.earlier).length;
  const fx = fxOf(run.record), t = timings(run.record);
  const used = airwallexData().features.filter((f) => /^(cards|controls|transactions|swift|deposit)$/.test(f.id));
  const eur = licence ? `€${licence.amount.replace(/\.00$/, "")}` : "";
  return shell(run, {
    title: "Airwallex", description: "How Purser uses Airwallex: earnings booked once final, the euro licence paid by SWIFT after the CFO's Face ID, card limits the bank enforces.",
    logo: LOGO.airwallex, h1: "The bank side of the agents", proofHash: "airwallex",
    picture: [node("zap", "Metal earnings", "final on chain", "metal"), arrow, node("landmark", booked ? `${booked.amount} USD booked` : "Booked at Airwallex", "after finality", "awx"), arrow,
      node("scan-face", "CFO · Face ID", "approves the invoice"), arrow, ...(fx ? [node("arrow-left-right", `${fx.buy} by FX`, "only the shortfall", "awx"), arrow] : []),
      node("circle-check", licence ? `${eur} PAID by SWIFT` : "Paid by SWIFT", licence ? `${t.faceToPaid !== null ? `${t.faceToPaid} s after Face ID · ` : ""}Airwallex ${licence.proof.label.replace(/^Airwallex /, "")}` : "", "ok")].join(""),
    nums: nums([[booked?.amount ?? "0", "USD booked after finality"], [eur || "0", "licence paid by SWIFT"], ...(fx ? [[fx.buy.replace(/^EUR /, "€").replace(/\.00$/, ""), "bought by FX for the shortfall"] as [string, string]] : []), [String(st.airwallex), "card decline at the limit (TAP run)"], ...(earlier ? [[String(earlier), "earlier attempt, nothing paid"] as [string, string]] : [])]),
    line: "Airwallex enforces each card's limit itself, and pays an invoice only after the CFO's Face ID.",
    folds: fold("The live proof, with every Airwallex id", p.airwallex) + fold("The Airwallex features we use, and their docs", used.map((f) => docsLi(f.title, f.docs)))
      + fold("What is simulated", [plainLi("The Airwallex sandbox, with test money only."), ...money.filter((e) => e.earlier).map((e) => plainLi(earlierLine(e)))]),
  });
}

export function visaPage(run: AgentRun = agentRun()): string {
  const tap = tapRun(), p = partnerProof(run), own = ownTap(run.record);
  const buy = own ?? tap?.steps.find((x) => x.approved && x.model), decline = tap?.steps.find((x) => !x.approved);
  return shell(run, {
    title: "Visa TAP", description: "The Sourcing agent signs its card checkout with Visa's Trusted Agent Protocol before its Airwallex card pays.",
    logo: LOGO.visa, h1: "The agent signs before it pays", proofHash: "visa",
    picture: [node("package", "Agent signs", buy?.model ? `Sourcing · Claude ${family(buy.model)}` : "TAP signature"), arrow,
      node("shield-check", own ? "Both signatures verified" : "Reference verifier", own ? "by our layer, in this run" : `Visa's, commit ${tap?.commit ?? "16d59bd"}`), arrow,
      node("credit-card", buy ? `€${buy.amount} paid` : "Card pays", own ? `Airwallex card ····${own.last4}` : "Airwallex card", "ok"), arrow,
      node("ban", decline ? `€${decline.amount} declined` : "Over the limit", tap && own ? `by Airwallex · ${tap.label.replace(/ · test money$/, "")}` : "by Airwallex, at the limit", "bad")].join(""),
    label: own ? undefined : tap?.label, nums: "", line: "The card's limit still holds: over it, Airwallex declines.",
    extra: `<p class="claim">${esc(VISA_CLAIM)}</p><p class="claim">${esc(VISA_AWARD_STATUS)}</p>`,
    folds: fold(own ? "The live proof" : "The live TAP run", p.visa) + fold("What this is, and is not", (tap?.labels ?? []).map((l) => plainLi(l.replace(/not a Visa-approved agent/g, "no approval by Visa of this agent")))),
  });
}

export function claudePage(run: AgentRun = agentRun()): string {
  const p = partnerProof(run), sp = split(run.record), s = run.record.snapshot;
  const says = run.events.filter((e): e is Extract<Ev, { k: "say" }> => e.k === "say");
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
    line: SPLIT_LINE,
    folds: fold("Each agent: decisions, calls, cost", p.claude)
      + fold("Every decision, with its Claude call", says.map((e) => `<li class="ok">${esc(`${e.agent[0]!.toUpperCase()}${e.agent.slice(1)}, ${e.at.slice(11, 16)} UTC: ${e.text.length > 140 ? `${e.text.slice(0, 140)}…` : e.text}`)}${e.call ? `<br><span class="call" title="${esc(e.call.requestIds.join(", "))}">${esc(callBadge(e.call))}</span>` : ""}</li>`))
      + fold("Payments decided by Claude, with their request ids", requests.map((f) => `<li>${esc(`${f.what}: ${f.amount} ${f.unit === "EUR" ? "EUR" : "test USD"} · ${f.decided} · ${f.request}`)}</li>`))
      + fold("The Claude docs we built on", docs.map((d) => docsLi(d.title, d.docs))),
  });
}

/** The clean 404: what happened, and the four tabs. No script. */
export function notFoundPage(run: AgentRun = agentRun()): string {
  const body = `<main class="nf"><div class="wrap"><p class="pill">404</p><h1>This page does not exist.</h1><p class="line">Every page of the demo is one of these four.</p>
<div class="tabs2"><a class="btn primary" href="home">${icon("feather", 18)}Home</a><a class="btn" href="watch">${icon("play", 18)}Watch</a><a class="btn" href="try">${icon("sparkles", 18)}Try</a><a class="btn" href="proof">${icon("shield-check", 18)}Proof</a></div></div></main>`;
  return page({ title: "Not found", description: "This page does not exist.", tab: null, css: CSS, body, source: SOURCE(run) });
}
