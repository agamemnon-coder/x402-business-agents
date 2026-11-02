// Proof (mega-prompt v4, C5 and D3): everything from agent run 1, compact. Who decides what (decisions by Claude next
// to routine payments by code), the run's numbers, four partner cards (Metal, Airwallex, Visa TAP as text, Claude) with
// their live proof folded, who stopped what, the Face ID decisions (one number, from the run's ledger), the earlier
// licence attempt that paid nothing, the checks, and a folded, labelled Archive. Nothing typed in by hand.

import { readFileSync } from "node:fs";
import { SECOND_APPROVER, SPLIT_LINE, VISA_CLAIM } from "../config/brand.js";
import { agentRun, faceIdDecisions, family, runName, split, stops, tapRun, type AgentRun, type Ev, type Tile } from "./run.js";
import { esc, icon, page } from "./ui.js";

const readJson = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as T;

const CSS = `.proofp { padding: 26px 0 24px; }
.phead { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 10px; }
.phead h1 { font-size: clamp(32px, 3.4vw, 44px); font-weight: 780; margin-right: auto; }
.split { margin: 0 0 18px; font-size: clamp(18px, 1.8vw, 21px); font-weight: 650; max-width: 46em; }
.nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 900px) { .nums { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
.num { padding: 16px 18px; text-decoration: none; display: flex; flex-direction: column; gap: 2px; transition: border-color .2s; }
.num:hover { border-color: var(--accent); }
.num .v { font-size: clamp(30px, 3vw, 40px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.num .l { font-size: 15px; font-weight: 650; color: var(--muted); line-height: 1.3; }
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
abbr[title] { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
a.pf { color: var(--accent); font-weight: 600; text-decoration: none; font-size: 15px; }
.claim { margin: 0; font-size: 15.5px; line-height: 1.5; border-left: 4px solid var(--accent); padding: 4px 0 4px 12px; }
.open { font-size: 15px; font-weight: 650; color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.more { display: grid; gap: 12px; }
@media (min-width: 900px) { .more { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.more .card { padding: 16px 20px; scroll-margin-top: 80px; display: grid; gap: 6px; align-content: start; }
.more h3 { font-size: 18px; margin: 0; display: flex; align-items: center; gap: 8px; }
.more h3 .n { font-variant-numeric: tabular-nums; color: var(--accent); }
.more p { margin: 0; color: var(--muted); font-size: 15.5px; }`;

const JS = `(function () { var h = location.hash.slice(1); if (!h) return; var t = document.getElementById(h); if (!t) return; t.querySelectorAll("details").forEach(function (d) { d.open = true; }); })();`;

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
const money2 = (e: { amount: string; unit: string }) => e.unit === "EUR" ? `EUR ${e.amount}` : `${e.amount} test USD`;
export const fold = (summary: string, items: string[], open = false) => items.length ? `<details class="fold"${open ? " open" : ""}><summary>${esc(summary)}</summary><ul class="pl">${items.join("")}</ul></details>` : "";
const fact = (v: string, l: string) => `<span class="fact"><b>${esc(v)}</b> ${esc(l)}</span>`;
export const LOGO = {
  metal: '<span class="logo"><img src="assets/logo-metal.svg" alt="Metal" width="48" height="15"></span>',
  airwallex: '<span class="logo"><img src="assets/logo-airwallex.png" alt="Airwallex" width="109" height="15"></span>',
  claude: '<span class="logo dark"><img src="assets/logo-claude.png" alt="Claude" width="69" height="15"></span>',
  visa: '<span class="logo txt">Visa TAP</span>',
};

/** The live proof of each partner, as list items: shared by Proof's cards and the partner pages. */
export function partnerProof(run: AgentRun): Record<"metal" | "airwallex" | "visa" | "claude", string[]> {
  const s = run.record.snapshot;
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const tap = tapRun();
  const mandates = run.events.filter((e): e is Extract<Ev, { k: "mandate" }> => e.k === "mandate");
  const tapDecline = tap?.steps.find((x) => !x.approved);
  return {
    metal: [
      ...money.filter((e) => e.refused?.by === "recorded").map((e) => li(`Refused · recorded on chain: ${e.amount} test USD to ${e.what}, ${e.refused!.code ?? ""}. Purser refused it before signing; Metal recorded the same refusal on chain`, "no", e.proof)),
      ...money.filter((e) => e.refused?.by === "metal").map((e) => li(`Refused by Metal: ${e.what}, ${e.refused!.reason}; nothing moved`, "no", e.proof.href ? e.proof : null)),
      ...mandates.map((m) => li(`New mandate on chain after two signatures: ${m.agent[0]!.toUpperCase()}${m.agent.slice(1)} agent, cap ${m.cap}, budget ${m.budget}`, "ok", m.proof)),
      ...s.rails.metal.filter((r) => !/^Refused|^Mandate replaced/.test(r.what)).map((r) => li(`${r.what}: ${r.detail}`, "", r.proof)),
    ],
    airwallex: [
      ...s.rails.airwallex.map((r) => li(`${r.what}: ${r.detail}`, "", r.proof)),
      ...(tapDecline ? [li(`The limit, enforced by Airwallex (${tap!.label}): EUR ${tapDecline.amount} declined, ${tapDecline.reason ?? ""}`, "no", { label: `Airwallex ${tapDecline.txId.slice(0, 8)}… · read back with GET: ${tapDecline.getStatus}`, href: null })] : []),
      ...money.filter((e) => e.rail === "airwallex" && e.refused?.by === "airwallex-sandbox").map((e) => li(`Earlier attempt, nothing paid: ${money2(e)} ${e.what} was approved with Face ID, but ${e.refused!.reason} (${e.refused!.code ?? ""}). The licence was paid later by SWIFT`, "no", null)),
    ],
    visa: tap ? tap.steps.map((x) => li(
      `${x.model ? `The Sourcing agent (${family(x.model)}) picked the card rail` : "Code tried one purchase over the card's limit"}: Visa's reference proxy answered ${x.proxyStatus}, our layer verified both signatures (${x.sig1}, ${x.sig2}); the Airwallex card (brand as Airwallex returns it: ${x.brand}) was ${x.approved ? "approved" : `declined by Airwallex (${x.reason})`}, EUR ${x.amount}`,
      x.approved ? "ok" : "no", { label: `Airwallex ${x.txId.slice(0, 8)}… · read back with GET: ${x.getStatus}`, href: null })) : [],
    claude: s.agent_stats.map((a) => li(`${a.agent[0]!.toUpperCase()}${a.agent.slice(1)} agent on ${family(a.models[0])}: ${a.by_claude} of ${a.decisions} decisions by Claude, ${a.fallback} fallback, ${a.claude_calls} calls, USD ${(a.cost_usd_micros / 1e6).toFixed(4)}`, "ok")),
  };
}

/** The four partner cards: logo, one line, two or three numbers, the live proof folded, a link to the partner's page. */
function partnerCards(run: AgentRun): string {
  const s = run.record.snapshot, p = partnerProof(run), st = stops(run.record), tap = tapRun(), sp = split(run.record);
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const onChain = money.filter((e) => e.rail === "metal" && !e.refused).reduce((n, e) => n + e.count, 0);
  const mandates = run.events.filter((e) => e.k === "mandate").length;
  const awx = money.filter((e) => e.rail === "airwallex" && !e.refused).length;
  const card = (id: string, logo: string, name: string, what: string, facts: string, items: string[], extra = "") =>
    `<article class="pcard card" id="${id}"><div class="ph">${logo}<h3>${esc(name)}</h3><a class="open" href="${id}">More ${icon("arrow-right", 14)}</a></div><p class="what">${esc(what)}</p><div class="facts">${facts}</div>${extra}${fold("Show the live proof", items)}</article>`;
  return `<div class="partners">
${card("metal", LOGO.metal, "Metal", "Each agent's limit is a mandate on chain; payments per query over x402.", fact(String(onChain), "payments on chain") + fact(String(st.metal), "refused by Metal") + fact(String(mandates), "mandates replaced"), p.metal)}
${card("airwallex", LOGO.airwallex, "Airwallex", "Earnings booked once final, the euro licence by SWIFT, cards with limits the bank enforces.", fact(String(awx), "movements at Airwallex") + fact(String(st.airwallex), "card decline at the limit (TAP run)"), p.airwallex)}
${tap ? card("visa", LOGO.visa, "Visa Trusted Agent Protocol", "The agent signs its card checkout at a TAP merchant before its Airwallex card pays.", fact(String(tap.steps.length), "signed checkouts (TAP run)") + fact(tap.commit, "reference commit"), p.visa, `<p class="claim">${esc(VISA_CLAIM)}</p>`) : ""}
${card("claude", LOGO.claude, "Claude", `The agents decide with Claude: ${run.agents.map((a) => `${a.short} on ${a.family}`).join(", ")}.`, fact(`${sp.byClaude}/${sp.decisions}`, "decisions by Claude") + fact(String(s.agent_stats.reduce((n, a) => n + a.claude_calls, 0)), "calls, each with a request id"), p.claude)}
</div>`;
}

function moreCards(run: AgentRun): string {
  const r = run.record, s = r.snapshot;
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const faces = run.events.filter((e): e is Extract<Ev, { k: "face" }> => e.k === "face");
  const tap = tapRun();
  const st = stops(r);
  const stopItems = [
    ...money.filter((e) => e.refused?.by === "recorded").map((e) => li(`By Metal: ${e.amount} test USD over the mandate's cap; Purser refused it before signing and Metal recorded the same refusal on chain`, "no", e.proof)),
    ...money.filter((e) => e.refused?.by === "metal").map((e) => li(`By Metal: ${e.what}, ${e.refused!.reason} (${e.refused!.code ?? ""})`, "no", e.proof.href ? e.proof : null)),
    ...faces.filter((f) => f.status === "REJECTED").map((f) => li(`By the CFO with Face ID: ${f.id} · ${f.title} rejected`, "no")),
    ...(tap?.steps.filter((x) => !x.approved).map((x) => li(`By Airwallex, ${tap.label}: EUR ${x.amount} over the card's limit (${x.reason ?? ""})`, "no")) ?? []),
  ];
  // One Face ID number from one source (faceIdDecisions): the proposals the CFO decided with his passkey, from the run's ledger.
  const faceItems = faces.map((f) => li(`${f.id} · ${f.title}: ${f.status === "COSIGNED" ? `1 of 2 signatures, by ${f.signers[0]}` : `${f.status === "REJECTED" ? "rejected" : "approved"} by ${f.signers.join(" and ")}${f.signers.length > 1 ? ` (${f.signers.length} of ${f.signers.length} signatures)` : ""}`}`, "face", null, f.signers.length > 1 ? SECOND_APPROVER : undefined));
  const earlier = money.filter((e) => e.earlier);
  const v = readJson<{ ran_at: string; summary: { runs: number; by_claude: number; unsafe: number; distinct_choices_same_world: number } }>("docs/evals/autonomy-variation.json");
  const rt = readJson<{ ran_at: string; summary: { runs: number; held: number } }>("docs/evals/autonomy-redteam.json");
  const red = readJson<{ ran_at: string; attempts: number; blocked: number; caught_after?: number }>("docs/redteam/report.json");
  const t = s.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
  const checked = t ? new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size : 0;
  const refunded = money.filter((e) => e.agent === "support" && /refund/i.test(e.what) && !e.refused).length;
  const d = (iso: string) => iso.slice(0, 10);
  const box = (id: string, ic: string, h: string, n: string, p: string, inner: string, link?: [string, string]) => `<div class="card" id="${id}"><h3>${icon(ic, 18)}${n ? `<span class="n">${esc(n)}</span>` : ""}${esc(h)}</h3><p>${plain(p)}</p>${inner}${link ? `<a class="open" href="${esc(link[1])}">${esc(link[0])} ${icon("arrow-right", 14)}</a>` : ""}</div>`;
  const archive = [
    `<li><a class="pf" href="./?recorded">The CFO dashboard of the earlier recorded run (30 October)</a></li>`,
    `<li><a class="pf" href="metal/report">The Dispute desk's evidence report (30 October)</a></li>`,
    `<li><a class="pf" href="film">The film</a></li>`, `<li><a class="pf" href="month">A month in 90 seconds (simulated)</a></li>`, `<li><a class="pf" href="lab">The Scenario Lab</a></li>`,
  ];
  return `<div class="more">
${box("stops", "ban", "stopped at a limit", String(st.metal + st.airwallex + st.cfo), `Metal and the CFO in ${runName(r)}; Airwallex at the card's limit in the TAP run.`, fold("Show each one", stopItems))}
${box("faceid", "scan-face", "Face ID decisions", String(faceIdDecisions(r)), `Proposals the CFO decided on his phone${faces.some((f) => f.status === "COSIGNED") ? "; the mandate change needed a second signature too" : ""}. ${SECOND_APPROVER}`, fold("Show each signature", faceItems))}
${earlier.length ? box("earlier", "rotate-ccw", "earlier attempt, nothing paid", String(earlier.length), `The licence's first SWIFT attempt: the Airwallex sandbox could not price the fee (fee_unknown). Not a limit. Paid later by SWIFT after a new Face ID.`, fold("Show it", earlier.map((e) => li(`${money2(e)} · ${e.what}: ${e.refused?.reason ?? ""}`, "no", { label: e.proof.label, href: null })))) : ""}
${box("dispute", "users", "orders disputed", String(checked), `${checked - refunded} proven valid · ${refunded} wrong data, refunded.`, "", ["Watch the dispute", "watch?scene=3"])}
${box("variation", "sparkles", "variation runs by Claude", `${v.summary.by_claude}/${v.summary.runs}`, `${v.summary.unsafe} unsafe, ${v.summary.distinct_choices_same_world} different choices in the same world (simulated rails, real Claude Haiku, ${d(v.ran_at)}).`, "")}
${box("redteam", "shield-check", "attacks failed", `${red.blocked}/${red.attempts}`, `${d(red.ran_at)}, test world${red.caught_after ? `; ${red.caught_after} found afterwards, not prevented` : ""}. Against the agent loop: ${rt.summary.held} of ${rt.summary.runs} held (${d(rt.ran_at)}).`, "")}
${box("health", "database", "audit rows", String(s.audit.rows), `Hash chain ${s.audit.intact ? "intact" : "broken"} (${runName(r)}).`, "", ["Open the CFO dashboard", "./?autonomy"])}
${box("archive", "clock", "Archive", "", "Earlier runs and tools, kept as they were.", fold("Show the archive", archive))}
</div>`;
}

export function proofPage(run: AgentRun = agentRun()): string {
  const r = run.record, sp = split(r), st = stops(r);
  const nums: (Tile & { cls: string })[] = [
    { cls: "claude", value: String(sp.byClaude), label: `decisions by Claude (${sp.fallbacks} fallbacks)`, explain: "", href: "#claude" },
    { cls: "code", value: String(sp.routine), label: "routine payments by code", explain: "", href: "#metal" },
    { cls: "face", value: String(faceIdDecisions(r)), label: "Face ID decisions", explain: "", href: "#faceid" },
    { cls: "stop", value: String(st.metal + st.airwallex + st.cfo), label: "stopped at a limit", explain: "", href: "#stops" },
    { cls: "", value: `$${run.derived.perDecision}`, label: "Claude cost per decision", explain: "", href: "#claude" },
  ];
  const body = `<main class="proofp"><div class="wrap">
  <div class="phead"><h1>Proof</h1><span class="pill run">${icon("database", 14)}${esc(run.label)}</span></div>
  <p class="split">${esc(SPLIT_LINE)}</p>
  <div class="nums">${nums.map((n) => `<a class="num card ${n.cls}" href="${n.href}"><span class="v">${esc(n.value)}</span><span class="l">${esc(n.label)}</span></a>`).join("")}</div>
  <h2 class="sec">The partners</h2>
  ${partnerCards(run)}
  <h2 class="sec">Checks</h2>
  ${moreCards(run)}
</div></main>`;
  return page({
    title: "Proof", description: "Every proof of agent run 1 in one place: who decided, who paid, who stopped what, each partner's live proof.", tab: "proof", css: CSS, body, js: JS, stage: false,
    source: `Source: ${run.file} (${run.name}) and the run records in docs/runs and docs/evals.`,
  });
}
