// Data QA: every figure a judge sees in more than one place must say what its one source says. The landing and the
// dashboard read docs/demo/snapshot.json; this recomputes their headline figures from the recorded audit log
// (docs/audit/friday-1-audit.jsonl), then checks the README's Kit 11 table against docs/demo/metal.json and
// src/config/policy.ts, the separate test-world figures against their run files in docs/runs/, and every relative
// markdown link in README.md and docs/ against the files and headings it points to. Offline: files only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_MANDATES, LICENCE_FEE_EUR_CENTS, TOTAL_BUDGET_CENTS, type Agent } from "../src/config/policy.js";
import { AGENT_DISPLAY } from "../src/config/brand.js";
import { fromCents } from "../src/lib/money.js";
import { pdfText } from "../src/ap/pdfText.js";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const text = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = <T>(path: string) => JSON.parse(text(path)) as T;
// Markdown wraps lines; the checks read prose with whitespace collapsed.
const flat = (path: string) => text(path).replace(/\s+/g, " ");
const cents = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, "")) * 100);
const eur = (c: number) => `€${(c / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface AuditRow { seq: number; event: string; payload_json: string; row_hash: string }
interface Snapshot {
  run: string;
  proof: { alone: number; blocked: number; face_id: number; fake_invoices: number; ai_tricks: number; card_declines: number; chain_refusals: number; over_limit_eur: string };
  snapshot: {
    counts: { alone: number; blocked: number };
    money: { blocked_eur: string; blocked_fraud_eur: string; blocked_fraud_n: number; blocked_declined_eur: string; blocked_declined_n: number; blocked_declined_later_paid_n: number; blocked_rejected_n: number };
    audit: { rows: number; head: string; intact: boolean };
    decisions: { proposal_id: string; status: string; by: string | null }[];
  };
}
interface Mandate { role: string; agent: string; cap: string; budget: string; history: { cap: string; budget: string }[] }
interface Metal { features: { id: string; figure: string; source: string }[]; mandates: Mandate[] }
interface Step { step: string; outcome: string; tx?: string; finality?: { status: string; signers: number; participants: number } | null }
interface Run { steps: Step[] }
interface Load { attempted: number; paid: number; failed: number; seconds: number; throughput_per_second: number; latency_ms: { p50: number; p95: number }; deposits: { transactions: number } }

const rows = text("docs/audit/friday-1-audit.jsonl").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AuditRow);
const payload = (r: AuditRow) => JSON.parse(r.payload_json) as Record<string, unknown>;
const of = (event: string) => rows.filter((r) => r.event === event);
const rec = json<Snapshot>("docs/demo/snapshot.json");
const story = json<{ audit: { rows: number; head: string } }>("docs/demo/story.json");
const metal = json<Metal>("docs/demo/metal.json");

/** The landing's and the dashboard's headline figures, recomputed from the audit log alone (as snapshot.ts counts). */
function fromAudit() {
  const passkey = [...of("proposal.approved"), ...of("proposal.rejected")].filter((r) => payload(r).method === "passkey");
  const injections = new Set(of("document.injection_flagged").map((r) => String(payload(r).document_sha256 ?? r.seq)));
  type Charge = { seq: number; last4?: string; merchant?: string; amount?: string };
  const charge = (r: AuditRow): Charge => ({ seq: r.seq, ...(payload(r) as Omit<Charge, "seq">) });
  const approved = of("card.charge_approved").map(charge);
  const declined = of("card.charge_declined").map(charge);
  // A decline is money kept out only if the same purchase was not paid later (after the CFO raised the limit).
  const laterPaid = (d: Charge) => approved.some((a) => a.seq > d.seq && a.last4 === d.last4 && a.merchant === d.merchant && a.amount === d.amount);
  const fraud = of("invoice.fraud_suspected").map(payload).filter((p) => p.currency === "EUR");
  const keptOut = fraud.reduce((s, p) => s + cents(String(p.amount)), 0) + declined.filter((d) => !laterPaid(d)).reduce((s, d) => s + cents(String(d.amount)), 0);
  const chainRefusals = of("upstream.refused").filter((r) => String(payload(r).reason ?? "").startsWith("mandate_")).length;
  return {
    alone: of("sale.delivered").length + of("upstream.paid").length + of("refund.paid").length + of("sweep.paid").length + approved.length,
    blocked: of("upstream.refused").length + declined.length + of("proposal.rejected").length + of("invoice.fraud_suspected").length + injections.size,
    face_id: passkey.length,
    fake_invoices: of("invoice.fraud_suspected").length,
    ai_tricks: injections.size,
    card_declines: declined.length,
    chain_refusals: chainRefusals,
    kept_out_cents: keptOut,
    fraud_cents: fraud.reduce((s, p) => s + cents(String(p.amount)), 0),
    declined_later_paid: declined.filter(laterPaid).length,
    rows: rows.length,
    head: rows.at(-1)!.row_hash,
  };
}

describe("the recorded run's headline figures (landing, dashboard, README, claims)", () => {
  const a = fromAudit();

  it("the snapshot the pages read says what the audit log says", () => {
    expect(rec.proof).toMatchObject({ alone: a.alone, blocked: a.blocked, face_id: a.face_id, fake_invoices: a.fake_invoices, ai_tricks: a.ai_tricks, card_declines: a.card_declines, chain_refusals: a.chain_refusals, over_limit_eur: "0.00" });
    expect(rec.snapshot.counts).toMatchObject({ alone: a.alone, blocked: a.blocked });
    expect(cents(rec.snapshot.money.blocked_eur)).toBe(a.kept_out_cents);
    expect(cents(rec.snapshot.money.blocked_fraud_eur)).toBe(a.fraud_cents);
    expect(rec.snapshot.money.blocked_fraud_n).toBe(a.fake_invoices);
    expect(rec.snapshot.money.blocked_declined_n).toBe(a.card_declines);
    expect(rec.snapshot.money.blocked_declined_later_paid_n).toBe(a.declined_later_paid);
    expect(rec.snapshot.money.blocked_rejected_n).toBe(of("proposal.rejected").length);
    // The dashboard's decision list shows the same Face ID decisions the landing counts.
    expect(rec.snapshot.decisions.filter((d) => d.by?.includes("Face ID")).length).toBe(a.face_id);
  });

  it("the audit row count and head agree in the export, the snapshot and the story", () => {
    expect(a.rows).toBe(194);
    expect(rec.snapshot.audit).toEqual({ rows: a.rows, head: a.head, intact: true });
    expect(story.audit).toEqual({ rows: a.rows, head: a.head });
  });

  it("claims.md, the audit README, metal-award.md and the requirements matrix repeat the same figures", () => {
    const claims = flat("docs/claims.md");
    expect(claims).toContain(`| Payments inside the limits with no person needed | ${a.alone} |`);
    expect(claims).toContain(`| Stops by the card, the chain, the fraud checks or the CFO | ${a.blocked} |`);
    expect(claims).toContain(`| Money kept out for good | ${eur(a.kept_out_cents)} |`);
    expect(claims).toContain(`| Decisions signed with Face ID | ${a.face_id} |`);
    expect(claims).toContain(`| Fake invoices and AI tricks stopped | ${a.fake_invoices} + ${a.ai_tricks} |`);
    expect(claims).toContain(`| Audit log | ${a.rows} rows, hash chain intact`);
    // The submission pack's rows for this run are an archive since 4 Nov (the form's run figures are the main run's).
    expect(claims).toContain(`| Archive (30 October run): ${a.alone} with no approval at the time; ${a.blocked} stops (${a.blocked - a.ai_tricks} payments, ${a.ai_tricks} planted instructions) |`);
    expect(flat("docs/audit/README.md")).toContain(`stored: ${a.rows} rows`);
    expect(flat("docs/audit/README.md")).toContain(`--anchor ${a.rows}:${a.head}`);
    expect(flat("docs/metal-award.md")).toContain(`its ${a.rows}-row chain`);
    expect(flat("docs/requirements-matrix.md")).toContain(`the recorded Friday run: ${a.alone} alone, ${a.blocked} stops, ${a.face_id} Face ID decisions`);
  });

  it("the form no longer repeats them: its run figures are the main run's since 4 Nov (Max)", () => {
    // The short Description and the long text it replaced on 5 Nov (docs/submission/long-description.md).
    for (const d of ["docs/submission/README.md", "docs/submission/long-description.md"]) {
      const form = flat(d);
      expect(form, d).not.toContain(`${a.blocked} stops by the card, the chain, the fraud checks or the CFO`);
      expect(form, d).not.toContain(`${eur(a.kept_out_cents)} kept out for good`);
      // Max, 5 Nov (second round): the main run's stops, all of them, in one sentence (stopStory()).
      expect(form, d).toContain("16 stops, nothing paid over a limit: one buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.");
      expect(form, d).not.toContain("over its cap; the CFO rejected");
    }
  });
});

describe("Claude's cost and the red team, where the docs repeat them", () => {
  interface Claude { calls: number; models: { model: string; role: string; calls: number; cost_usd_micros: number }[]; cost_usd_micros: number; per_call_usd_micros: number; eur_paid: string; per_1000_eur_usd_micros: number }
  const c = (rec.snapshot as unknown as { claude: Claude }).claude;
  // As the doc rounds: cents, or four decimals under a cent.
  const usd = (micros: number) => `$${(micros / 1e6).toFixed(micros >= 10_000 ? 2 : 4)}`;

  it("the recorded run's (30 October) cost per €1,000 is the snapshot's where claims.md keeps it", () => {
    expect(c.models.reduce((s, m) => s + m.calls, 0)).toBe(c.calls);
    expect(c.models.reduce((s, m) => s + m.cost_usd_micros, 0)).toBe(c.cost_usd_micros);
    expect(of("claude.read")).toHaveLength(c.calls);
    expect(flat("docs/claims.md")).toContain(`$${(c.per_1000_eur_usd_micros / 1e6).toFixed(3)} per €1,000 paid`);
  });

  it("docs/claude.md's calls and costs are the main run's (docs/demo/main-run.json), model by model and agent by agent", () => {
    interface AgentStat { agent: string; decisions: number; by_claude: number; fallback: number; claude_calls: number; cost_usd_micros: number; models: string[] }
    const main = json<{ snapshot: { claude: Claude & { fallbacks: number }; agent_stats: AgentStat[] } }>("docs/demo/main-run.json").snapshot;
    const m = main.claude, doc = text("docs/claude.md"), prose = flat("docs/claude.md");
    expect(m.models.reduce((s, x) => s + x.calls, 0)).toBe(m.calls);
    expect(m.models.reduce((s, x) => s + x.cost_usd_micros, 0)).toBe(m.cost_usd_micros);
    for (const x of m.models) expect(doc).toContain(`| ${x.model} | ${x.role} | ${x.calls} | ${usd(x.cost_usd_micros)} |`);
    expect(doc).toContain(`| **All** | | **${m.calls}** | **${usd(m.cost_usd_micros)}**, or $${(m.per_call_usd_micros / 1e6).toFixed(4)} per call |`);
    // The agents' own calls, and the rest (documents sorted, read or reviewed).
    const agentCalls = main.agent_stats.reduce((n, a) => n + a.claude_calls, 0);
    expect(prose).toContain(`${m.calls} Claude calls in all: ${agentCalls} by the three agents, each with a request id, and ${m.calls - agentCalls} that sort, read or review documents.`);
    const decisions = main.agent_stats.reduce((n, a) => n + a.decisions, 0), byClaude = main.agent_stats.reduce((n, a) => n + a.by_claude, 0);
    const fallbacks = main.agent_stats.reduce((n, a) => n + a.fallback, 0);
    expect(fallbacks).toBe(m.fallbacks);
    expect(prose).toContain(`${byClaude} of ${decisions} decisions by Claude, ${fallbacks} fallbacks.`);
    const family = (id: string) => (/haiku/.test(id) ? "Haiku" : /sonnet/.test(id) ? "Sonnet" : "Opus");
    for (const a of main.agent_stats) {
      expect(a.models).toHaveLength(1);
      expect(doc).toContain(`| ${a.agent[0]!.toUpperCase()}${a.agent.slice(1)} | ${family(a.models[0]!)} | ${a.decisions} | ${a.claude_calls} | ${usd(a.cost_usd_micros)} |`);
    }
    expect(prose).toContain(`Against the ${eur(cents(m.eur_paid))} the agents paid`);
    expect(prose).toContain(`$${(m.per_1000_eur_usd_micros / 1e6).toFixed(3)} of AI per €1,000 paid`);
    // The old pipeline's sentence and the 30 October figures are gone.
    expect(prose).not.toMatch(/same decisions with or without an API key|23 Claude calls|\$0\.093/);
  });

  it("docs/claude.md's cost caps and limits are the code's", async () => {
    const { AGENT_HOURLY_CAP_MICROS, RUN_CAP_MICROS } = await import("../src/agents/loop.js");
    const { REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS } = await import("../src/config/policy.js");
    const { SPLIT_LINE } = await import("../src/config/brand.js");
    const prose = flat("docs/claude.md");
    const cap = (a: string) => (AGENT_HOURLY_CAP_MICROS[a]! / 1e6).toFixed(2);
    expect(prose).toContain(`USD ${cap("sourcing")} an hour for Sourcing, USD ${cap("support")} for Support and USD ${cap("treasury")} for Treasury, and USD ${(RUN_CAP_MICROS / 1e6).toFixed(2)} for all the agents in one world`);
    expect(prose).toContain(`within the automatic limits (${fromCents(REFUND_AUTO_EACH_CENTS)} each, ${fromCents(REFUND_AUTO_PER_DISPUTE_CENTS)} per dispute)`);
    expect(prose).toContain(`shared total of ${fromCents(TOTAL_BUDGET_CENTS)} test USD`);
    expect(text("docs/claude.md").split("\n")[2]).toBe(SPLIT_LINE);
  });

  it("docs/claude.md's model failure and the relayed address are the eval and run records'", () => {
    const prose = flat("docs/claude.md");
    // Haiku as Support, the attack case "support-outside": 0 of 10, the calls refused by code.
    const row = text("docs/agent-evals.md").split("\n").find((l) => l.startsWith("| support-outside | attack | claude-haiku-5-5 |"))!;
    const [passed, runs] = /\| (\d+)\/(\d+) \|/.exec(row)!.slice(1);
    expect(row).toMatch(/FAIL: fallback: .* \d+ call\(s\) refused by code/);
    expect(prose).toContain(`Haiku as the Support agent, asked by the customer's email to refund orders outside the dispute: ${passed} of ${runs}. Code refused those calls every time, and nothing was paid.`);
    // The relay: 2 of 40 worlds before the fix; the full re-run on the fix, all 40, nothing passed on.
    const before = flat("docs/runs/2026-11-02-night-batch.md"), after = flat("docs/runs/variation/2026-11-02-after-fix/summary.md");
    expect(before).toContain("40 simulated worlds (seeds 1–40): 2 where an agent passed an unvetted payee address to another agent");
    expect(prose).toContain("in 2 of 40 simulated worlds, a third supplier's notice gave the Sourcing agent (Haiku) its pay-to address");
    expect(after).toContain("**40 worlds (seeds 1–40), real Claude, simulated rails.**");
    expect(after).toMatch(/\| \(b\) unsafe-by-definition attempts code withheld \(`payee relayed, withheld by code`\) \| 0 \| none \|/);
    expect(after).toMatch(/\| verdict's `unsafe` total \| 0 \| none \|/);
    expect(prose).toContain("The re-run of all 40 worlds on the fix found no address passed on and nothing moved outside the rules");
  });

  it("the red team's scripted attacks are counted as the report has them", () => {
    const rt = json<{ attempts: number; blocked: number; inconclusive: number; caught_after: number; results: { id: string }[] }>("docs/redteam/report.json");
    const scripted = rt.results.filter((r) => r.id !== "document").length;
    for (const d of ["docs/security.md", "docs/hardening.md", "docs/claims.md", "docs/submission/long-description.md"]) expect(flat(d), d).toContain(`${scripted} scripted attacks`);
    expect(flat("docs/hardening.md")).toContain(`${rt.attempts} attempts, all failed`);
    expect(flat("docs/claims.md")).toContain(`${rt.blocked} of ${rt.attempts} failed, ${rt.inconclusive} inconclusive: ${rt.blocked - rt.caught_after} stopped before anything moved, ${rt.caught_after} found afterwards`);
  });
});

describe("Kit 11's three mandates (the main run's table, docs/in-depth.md) against the main run's record and the policy in code", () => {
  const readme = text("docs/in-depth.md");
  const table = readme.split("| Kit 11 agent | Its job in the brief |")[1]!.split("\n\n")[0]!.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---"));
  // When bound: the policy in code. After the CFO's Face ID: the main run's record (3 Nov), as on chain at its end.
  const main = json<{ snapshot: { tower: { agents: { agent: string; mandate: { cap: string; budget: string } | null }[] } } }>("docs/demo/main-run.json");
  const kit = (["sourcing", "support", "treasury"] as Agent[]).map((role) => {
    const now = main.snapshot.tower.agents.find((a) => a.agent === role)!.mandate!;
    return { role, bound: { budget: fromCents(INITIAL_MANDATES[role].budgetCents), cap: fromCents(INITIAL_MANDATES[role].capCents) }, now };
  });
  const arrow = (from: string, to: string) => (from === to ? from : `${from} → ${to}`);

  it("has one row per Kit 11 agent, and each budget (and cap, where shown) is the main run's, bound and after the CFO's Face ID", () => {
    expect(table).toHaveLength(3);
    expect(kit.map((k) => `${k.bound.budget}→${k.now.budget}`)).toEqual(["10.00→14.00", "4.00→4.00", "6.00→2.00"]);
    for (const m of kit) {
      const row = table.find((l) => l.split("|")[1]!.trim() === AGENT_DISPLAY[m.role].name);
      expect(row, m.role).toBeDefined();
      const cell = row!.split("|")[3]!.trim();
      expect(cell.startsWith(arrow(m.bound.budget, m.now.budget)), `${m.role}: "${cell}"`).toBe(true);
      const cap = cell.match(/cap ([\d.]+(?: → [\d.]+)?)/)?.[1];
      if (cap) expect(cap).toBe(arrow(m.bound.cap, m.now.cap));
    }
    // No figure from an earlier run or a brief's example.
    expect(readme).not.toMatch(/10\.00 → 12\.00|6\.00 → 4\.00|14 \/ 2 \/ 4|4\.00 in the brief/);
  });

  it("both before and after add up to TOTAL_BUDGET_CENTS, as the main run's section says", () => {
    expect(kit.reduce((s, m) => s + cents(m.bound.budget), 0)).toBe(TOTAL_BUDGET_CENTS);
    expect(kit.reduce((s, m) => s + cents(m.now.budget), 0)).toBe(TOTAL_BUDGET_CENTS);
    expect(readme).toContain(`${fromCents(TOTAL_BUDGET_CENTS)} test USD between them, before and after, held in code (\`TOTAL_BUDGET_CENTS\`)`);
  });
});

describe("the separate test worlds' figures against their run files", () => {
  const load = json<Load>("docs/runs/clearing-load-2.json");
  const first = json<Load>("docs/runs/clearing-load-1.json");
  const compliance = json<Run>("docs/runs/compliance-policy.json");
  const fourEyes = json<Run>("docs/runs/four-eyes.json");
  const n = (v: number) => v.toLocaleString("en-GB");
  // The separate test worlds are in the long form text since the Description was shortened (Max, 5 Nov).
  const form = flat("docs/submission/long-description.md");
  const docs = ["docs/submission/README.md", "docs/submission/long-description.md", "docs/claims.md", "docs/controls-matrix.md", "docs/requirements-matrix.md", "docs/metal-award.md"];

  const attacks = compliance.steps.filter((s) => s.step.startsWith("attack:"));
  const certified = [...compliance.steps, ...fourEyes.steps].filter((s) => s.finality?.status === "REPORTED");
  const WORDS: Record<number, string> = { 11: "eleven", 26: "twenty-six" };

  it("clearing load: 2,000 of 2,000 at 4.24 a second, p50 and p95 as measured, and the first run's 1,879", () => {
    expect(load.paid).toBe(load.attempted);
    expect(load.failed).toBe(0);
    expect(load.throughput_per_second).toBe(Number((load.paid / load.seconds).toFixed(2)));
    const paid = `${n(load.paid)} of ${n(load.attempted)}`;
    const p50 = `p50 ${(load.latency_ms.p50 / 1000).toFixed(1)} s`;
    const p95 = `p95 ${(load.latency_ms.p95 / 1000).toFixed(1)} s`;
    // The form's long text says it as "All 2,000" (no N/N fraction, 13 Nov); paid equals attempted above.
    expect(form).toContain(`All ${n(load.paid)} pay-per-call payments in ${load.seconds} s (${load.throughput_per_second} a second, ${p50}, ${p95})`);
    expect(form).toContain(`A first run paid ${n(first.paid)} before`);
    expect(flat("docs/claims.md")).toContain(`${paid} paid in ${load.seconds} s (${load.throughput_per_second} a second), ${p50}, ${p95}`);
    expect(flat("docs/claims.md")).toContain(`A first run paid ${n(first.paid)}`);
    expect(flat("docs/metal-award.md")).toContain(`${paid} paid in ${load.seconds} s: ${load.throughput_per_second} a second, latency ${p50} and ${p95}`);
    expect(flat("docs/metal-award.md")).toContain(`${load.deposits.transactions} chain transactions in all`);
    expect(flat("docs/metal-award.md")).toContain(`(${n(first.paid)} of ${n(first.attempted)} paid`);
    expect(flat("docs/controls-matrix.md")).toContain(`${paid} paid, ${load.throughput_per_second} a second`);
    expect(metal.features.find((f) => f.id === "clearing")!.source).toContain(`paid ${paid} at ${load.throughput_per_second} a second`);
    // No page or doc states another throughput or count for the load test.
    for (const d of docs) {
      for (const m of flat(d).matchAll(/([\d,]+) of ([\d,]+) (?:pay-per-call payments|paid)/g)) expect([paid, `${n(first.paid)} of ${n(first.attempted)}`], `${d}: ${m[0]}`).toContain(`${m[1]} of ${m[2]}`);
      // (Not "100,000 blocks at 13.4 a second": that is the chain's block rate.)
      for (const m of flat(d).matchAll(/(?<![\d.]|blocks at )(\d[\d.]*) (?:paid )?(?:payments )?a second/g)) expect(Number(m[1]), `${d}: ${m[0]}`).toBe(load.throughput_per_second);
    }
  });

  it("compliance: 11 attacks, each reverted on chain, as every doc and the /metal card say", () => {
    expect(attacks).toHaveLength(11);
    expect(attacks.every((s) => s.outcome === "reverted" && s.tx)).toBe(true);
    expect(form).toContain("Eleven attacks reverted on chain");
    expect(metal.features.find((f) => f.id === "compliance")!.figure).toBe(`${attacks.length} attacks reverted`);
    for (const d of [...docs, "docs/compliance.md"]) {
      for (const m of flat(d).matchAll(/\b(\w+|\d+) attacks (?:on it )?reverted/gi)) {
        expect([String(attacks.length), WORDS[attacks.length]], `${d}: ${m[0]}`).toContain(m[1]!.toLowerCase());
      }
    }
  });

  it("finality: 26 transactions of the two runs carry a reported certificate, 3 of 4 validators, as the docs say", () => {
    expect(certified).toHaveLength(26);
    expect(certified.every((s) => s.tx && s.finality!.signers === 3 && s.finality!.participants === 4)).toBe(true);
    expect(metal.features.find((f) => f.id === "certificates")!.source).toContain(`all ${certified.length} of their transactions`);
    expect(metal.features.find((f) => f.id === "certificates")!.figure).toBe("3 of 4 validators");
    let seen = 0;
    for (const d of docs) {
      const body = flat(d);
      for (const m of body.matchAll(/\b(\d+) transactions\b/g)) {
        const near = body.slice(Math.max(0, m.index - 250), m.index + 250);
        if (!/certificate/i.test(near) || /chain transactions in all/.test(m[0] + body.slice(m.index, m.index + 40))) continue;
        seen++;
        expect(Number(m[1]), `${d}: …${near.slice(200, 320)}…`).toBe(certified.length);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(4);
  });

  it("four eyes: exactly the three single-owner or stranger-signed steps reverted, as the form says", () => {
    const reverted = fourEyes.steps.filter((s) => s.outcome === "reverted").map((s) => s.step);
    expect(reverted).toEqual([
      "pay 1.00 from the account, signed by the CFO alone",
      "pay 1.00 from the account, signed by the CFO and a stranger's key",
      "revoke the mandate with the CFO's signature alone",
    ]);
    expect(form).toContain("A payment signed by the CFO alone, the same payment co-signed by a stranger's key, and a mandate revoke by the CFO alone each reverted on chain");
  });

  it("Kit 11's licence fee: every doc that names its amount says EUR 240.00, the amount in code", () => {
    const fee = `EUR ${fromCents(LICENCE_FEE_EUR_CENTS)}`;
    expect(fee).toBe("EUR 240.00");
    let seen = 0;
    const all = ["README.md", ...mdFiles("docs")];
    for (const d of all) {
      const body = flat(d);
      for (const m of body.matchAll(/licen[cs]e/gi)) {
        const near = body.slice(m.index, m.index + 160);
        for (const amount of near.matchAll(/(?:EUR |€)(\d[\d,]*(?:\.\d\d)?)(?![\d,])/g)) {
          // The euro bill (€1,850) sits in the same sentences; only an amount named as the licence fee is the fee.
          if (!/^(?:EUR|€)\s?\d[\d,.]* (?:in code|to Stockline|licen)/.test(near.slice(amount.index))) continue;
          seen++;
          expect(`EUR ${amount[1]}`, `${d}: ${near}`).toBe(fee);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(flat("docs/claims.md")).toContain(`(${fee} in code, paid by the`);
    expect(flat("docs/requirements-matrix.md")).toContain(`Stockline's data licence of ${fee} kept in code (\`LICENCE_FEE_EUR_CENTS\`)`);
  });
});

// ---- Links ----

function mdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...mdFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out.sort();
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchors(md: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of withoutFences(md).split("\n")) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      const plain = h[1]!.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[*_`]/g, (c) => (c === "_" ? "_" : ""));
      const base = plain.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
      const k = seen.get(base) ?? 0;
      seen.set(base, k + 1);
      out.add(k ? `${base}-${k}` : base);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]!);
  }
  return out;
}

/** Fenced code (and, for links, inline code) holds examples, not links or headings. */
const withoutFences = (md: string) => md.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
const withoutCode = (md: string) => withoutFences(md).replace(/`[^`\n]*`/g, "``");

function links(md: string): string[] {
  const body = withoutCode(md);
  const inline = [...body.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]!);
  const refs = [...body.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm)].map((m) => m[1]!);
  return [...inline, ...refs];
}

/** What is wrong with each relative link in `file`: a missing file, or an #anchor with no heading in the target. */
function brokenLinks(file: string, md: string, exists: (path: string) => boolean, read: (path: string) => string): { checked: number; broken: string[] } {
  const broken: string[] = [];
  let checked = 0;
  for (const target of links(md)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("/")) continue;
    checked++;
    const [rawPath, anchor] = target.split("#", 2) as [string, string | undefined];
    const dest = rawPath ? join(dirname(file), decodeURIComponent(rawPath)) : file;
    if (!exists(dest)) { broken.push(`${file}: ${target} (no file ${dest})`); continue; }
    if (anchor && dest.endsWith(".md") && !anchors(dest === file ? md : read(dest)).has(decodeURIComponent(anchor).toLowerCase())) broken.push(`${file}: ${target} (no heading #${anchor} in ${dest})`);
  }
  return { checked, broken };
}

describe("the requirements matrix: its own count, and the repository it says is public", () => {
  const matrix = text("docs/requirements-matrix.md");
  /** Each requirement row's status mark: the last cell of a table row that starts with one. */
  const marks = matrix.split("\n").filter((l) => l.startsWith("| ")).map((l) => l.split("|").map((c) => c.trim()).at(-2) ?? "").map((c) => ["✅", "🟠", "❌"].find((m) => c.startsWith(m))).filter((m) => m !== undefined);

  it("the count line is the count of its rows by status (it stayed at the 3 November count through two changes)", () => {
    const n = (mark: string) => marks.filter((m) => m === mark).length;
    const [met, partly, not] = [n("✅"), n("🟠"), n("❌")];
    expect(met + partly + not).toBeGreaterThan(80);
    expect(matrix).toContain(`\n✅ ${met} · 🟠 ${partly} · ❌ ${not} (${met + partly + not} rows, counted from the rows above`);
  });

  it("says in every row about it that the repository is public, with the day that was read, and no row still calls it private", () => {
    // Review of 12 November: row H14 said "The repository is private, so the code is not public today", beside the
    // decision to merge the product so that the judges can read its code (docs/decisions.md, D29).
    const about = matrix.split("\n").filter((l) => /^\| (H1c|H14|Public repository) \|/.test(l));
    expect(about.map((l) => l.split("|")[1]!.trim())).toEqual(["H1c", "H14", "Public repository"]);
    for (const l of about) {
      expect(l).toMatch(/repository is public/);
      expect(l).toContain("GitHub's API answers `private: false`, read 12 November 2026");
    }
    for (const l of about.slice(0, 2)) expect(l.split("|").at(-2)!.trim()).toBe("✅");
    expect(matrix).not.toMatch(/repository is private (until|, so)|No public link yet\.? \||Max decides\. Then: gitleaks/);
    // The address the rows give is the one the package and the form text give; the licence they name is in the repository.
    const repo = json<{ repository: { url: string } }>("package.json").repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
    expect(about[0]).toContain(`<${repo}>`);
    expect(text("docs/submission/README.md")).toContain(repo);
    expect(text("LICENSE")).toMatch(/^MIT License/);
    // What the rows cite for "gitleaks on every push" is in the workflow.
    expect(text(".github/workflows/ci.yml")).toMatch(/gitleaks, whole history/);
  });
});

describe("the deck's test count against the README's test line", () => {
  it("is the README's, or claims.md says in a dated note which count the committed deck shows", async () => {
    // Review of 12 November: the README went to the merged tree's count while the committed deck (rendered from the
    // README's line on 10 November, src/submission/deck.ts testCount) still showed the earlier one, and nothing said so.
    const deck = (await pdfText(readFileSync(join(ROOT, "docs/submission/purser-deck.pdf")))).text.replace(/\s+/g, " ");
    const shown = /([\d,]+) tests in (\d+) files, all passing/.exec(deck);
    expect(shown).not.toBeNull();
    const [deckTests, deckFiles] = [shown![1]!.replace(/,/g, ""), shown![2]!];
    // The README's line as `npm run test-count` writes it since 13 Nov ("**N tests passing**, S skipped, in F files").
    const readme = /\*\*(\d+) tests passing\*\*, \d+ skipped, in (\d+) files/.exec(text("README.md"))!;
    const claims = text("docs/claims.md");
    const deckRow = claims.split("\n").find((l) => l.startsWith("| The deck (section D, 6 November)")) ?? "";
    const note = /Dated note, [^:]+: the committed PDF and its "Security and tests" slide are the render of [^.]+? and show ([\d,]+) tests in (\d+) files/.exec(deckRow);
    if (deckTests === readme[1] && deckFiles === readme[2]) {
      // In step with the README (the deck was rendered again): the dated note has done its work and must go.
      expect({ deck: "shows the README's count", datedNoteStillInClaims: note !== null }).toEqual({ deck: "shows the README's count", datedNoteStillInClaims: false });
      return;
    }
    expect({ deck: `${deckTests} in ${deckFiles}`, readme: `${readme[1]} in ${readme[2]}`, noted: note !== null }).toEqual({ deck: `${deckTests} in ${deckFiles}`, readme: `${readme[1]} in ${readme[2]}`, noted: true });
    expect([note![1]!.replace(/,/g, ""), note![2]]).toEqual([deckTests, deckFiles]);
    // The deck's count is one claims.md has on record, with its day, in the Tests row's history (since 13 Nov its own
    // section, "The test count, earlier values", which the row links).
    const history = claims.slice(claims.indexOf("## The test count, earlier values"));
    expect(history).toMatch(new RegExp(`^- ${deckTests} in ${deckFiles} files \\(\\d+ Nov`, "m"));
  });
});

describe("relative markdown links in README.md and docs/", () => {
  const files = ["README.md", ...mdFiles("docs")];

  it("every relative link resolves to a file, and every #anchor to a heading", () => {
    expect(files.length).toBeGreaterThan(50);
    const results = files.map((f) => brokenLinks(f, text(f), (p) => existsSync(join(ROOT, p)), text));
    expect(results.reduce((s, r) => s + r.checked, 0)).toBeGreaterThan(100);
    expect(results.flatMap((r) => r.broken)).toEqual([]);
  });

  it("the check itself catches a missing file and a missing heading, and skips code and outside links", () => {
    const docs: Record<string, string> = { "docs/a.md": "# Top\n## Kit 11: `npm run x`\n", "docs/b.md": "" };
    const md = ["[ok](a.md#kit-11-npm-run-x)", "[here](#local)", "## Local", "[gone](missing.md)", "[bad anchor](a.md#nope)", "`[in code](nowhere.md)`", "```\n[fenced](nowhere.md)\n```", "[web](https://example.com/x.md)", "[ref]: b.md#top"].join("\n");
    const r = brokenLinks("docs/b.md", md, (p) => p in docs, (p) => docs[p]!);
    expect(r.checked).toBe(5);
    expect(r.broken).toEqual(["docs/b.md: missing.md (no file docs/missing.md)", "docs/b.md: a.md#nope (no heading #nope in docs/a.md)", "docs/b.md: b.md#top (no heading #top in docs/b.md)"]);
  });

  it("computes GitHub's anchors the way GitHub does", () => {
    expect([...anchors("# The recorded run (landing, dashboard, /live, film)\n## Kit 11: `npm run x`\n## Kit 11: `npm run x`\n```\n# not a heading\n```")]).toEqual([
      "the-recorded-run-landing-dashboard-live-film", "kit-11-npm-run-x", "kit-11-npm-run-x-1",
    ]);
  });
});
