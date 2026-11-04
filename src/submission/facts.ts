// The figures the submission pack uses (awards item 6), read from the same recorded files the pages use, so the deck,
// the form text and the pages cannot drift apart. test/submission.test.ts checks the form text against these.

import { readFileSync } from "node:fs";
import { AGENT_DISPLAY } from "../config/brand.js";
import { INITIAL_MANDATES } from "../config/policy.js";
import { faceIdDecisions, fxOf, letThroughOf, loadRecord, ownTap, split, stoppedAtLimit, stops, tapLimitLine, timings } from "../redesign/run.js";

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as T;

interface Recorded {
  run: string;
  proof: { alone: number; blocked: number; face_id: number; fake_invoices: number; ai_tricks: number; card_declines: number; chain_refusals: number };
  snapshot: { money: { blocked_eur: string }; claude: { calls: number; per_1000_eur_usd_micros: number }; audit: { rows: number; intact: boolean } };
}
interface RedTeam { attempts: number; blocked: number; caught_after?: number; inconclusive?: number; not_blocked?: number; results: { id: string }[] }
interface Lab { results: { passed: boolean }[] }
interface Metal { features: unknown[]; mandates: { agent: string; role: string; budget: string; history: { budget: string }[] }[]; dispute: { packs: { seq: number; refunded_cents: number }[]; refunds: unknown[] } | null }

export interface PackFacts {
  run: string;
  alone: number;
  stopped: number;
  kept_out_eur: string;
  face_id: number;
  card_declines: number;
  chain_refusals: number;
  fake_invoices: number;
  ai_tricks: number;
  audit_rows: number;
  claude_calls: number;
  /** US dollars of Claude per €1,000 the agents paid, to three decimals. */
  claude_per_1000_eur_usd: string;
  redteam: { attempts: number; failed: number; before: number; after: number; inconclusive: number; documents: number };
  lab: { passed: number; total: number };
  /** dispute_refunded: refunds this claim made; refunded_before: the disputed orders refunded in an earlier case. */
  /** Kit 11's three roles as Purser's agents, with each budget when bound and after the CFO's replace (recorded). */
  kit11: { agent: string; role: string; bound: string; now: string }[];
  metal: { features: number; mandates: number; dispute_orders: number; dispute_refunded: number; refunded_before: number[] };
  /** The main run (3 November), from its record docs/demo/main-run.json (the run the pages play). */
  main: MainRunFacts;
}

export interface MainRunFacts {
  decisions: number; by_claude: number; fallbacks: number; claude_calls: number; claude_usd: string; per_decision_usd: string;
  alone: number; sales: number; face_id: number; metal_refused: number; cfo_rejected: number; audit_rows: number;
  /** "stopped at a limit": the main run's own stops only; the separate TAP run's decline is its own line (tap_limit_line). */
  stopped: number; tap_limit_line: string;
  to_options_s: number; face_to_paid_s: number;
  let_through_tx: string; fx_buy: string; fx_sell: string; licence_transfer: string; licence_fee: string; sweep: string;
  refunded: string[]; disputed: number; tap_amount: string; tap_last4: string;
  /** Kit 11's three agents: budget when bound (code) and after the CFO's replace in the main run. */
  kit11: { agent: string; role: string; bound: string; now: string }[];
}

/** The main run's figures, counted by the same functions the pages use (src/redesign/run.ts). */
export function mainRunFacts(): MainRunFacts {
  const { record: r } = loadRecord();
  const s = r.snapshot, ev = r.ledger?.events ?? [];
  const sp = split(r), st = stops(r), t = timings(r), fx = fxOf(r), tap = ownTap(r), lt = letThroughOf(r);
  const cost = s.agent_stats.reduce((n, a) => n + a.cost_usd_micros, 0);
  const paid = ev.find((e) => e.event === "transfer.status" && e.payload.status === "PAID");
  const fee = ev.find((e) => e.event === "transfer.fee" && e.subject === paid?.subject);
  const dispute = s.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
  const money = (c: number) => (c / 100).toFixed(2);
  return {
    decisions: sp.decisions, by_claude: sp.byClaude, fallbacks: sp.fallbacks, claude_calls: s.agent_stats.reduce((n, a) => n + a.claude_calls, 0),
    claude_usd: (cost / 1e6).toFixed(4), per_decision_usd: (cost / sp.decisions / 1e6).toFixed(4),
    alone: s.counts.alone, sales: s.flows.filter((f) => f.kind === "sale").reduce((n, f) => n + (f.count ?? 1), 0), face_id: faceIdDecisions(r),
    metal_refused: st.metal, cfo_rejected: st.cfo, stopped: stoppedAtLimit(st), tap_limit_line: tapLimitLine(), audit_rows: s.audit.rows, to_options_s: t.toOptions ?? 0, face_to_paid_s: t.faceToPaid ?? 0,
    let_through_tx: lt?.tx ?? "", fx_buy: fx?.buy ?? "", fx_sell: fx?.sell ?? "", licence_transfer: paid?.subject ?? "", licence_fee: String(fee?.payload.fee ?? ""),
    sweep: s.flows.find((f) => f.kind === "sweep" && !f.refused)?.amount ?? "",
    refunded: s.flows.filter((f) => f.kind === "refund" && !f.refused).map((f) => /#(\d+)/.exec(f.what)?.[1] ?? ""),
    disputed: dispute ? new Set(dispute.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size : 0,
    tap_amount: tap?.amount ?? "", tap_last4: tap?.last4 ?? "",
    kit11: (["sourcing", "support", "treasury"] as const).map((role) => ({ agent: AGENT_DISPLAY[role].name, role, bound: money(INITIAL_MANDATES[role].budgetCents), now: s.tower.agents.find((a) => a.agent === role)?.mandate?.budget ?? money(INITIAL_MANDATES[role].budgetCents) })),
  };
}

export function packFacts(): PackFacts {
  const rec = read<Recorded>("docs/demo/snapshot.json");
  const rt = read<RedTeam>("docs/redteam/report.json");
  const lab = read<Lab>("docs/lab/results.json");
  const metal = read<Metal>("docs/demo/metal.json");
  const after = rt.caught_after ?? 0;
  return {
    run: rec.run,
    alone: rec.proof.alone,
    stopped: rec.proof.blocked,
    kept_out_eur: rec.snapshot.money.blocked_eur,
    face_id: rec.proof.face_id,
    card_declines: rec.proof.card_declines,
    chain_refusals: rec.proof.chain_refusals,
    fake_invoices: rec.proof.fake_invoices,
    ai_tricks: rec.proof.ai_tricks,
    audit_rows: rec.snapshot.audit.rows,
    claude_calls: rec.snapshot.claude.calls,
    claude_per_1000_eur_usd: (rec.snapshot.claude.per_1000_eur_usd_micros / 1e6).toFixed(3),
    redteam: { attempts: rt.attempts, failed: rt.blocked, before: rt.blocked - after, after, inconclusive: rt.inconclusive ?? 0, documents: rt.results.filter((r) => r.id === "document").length },
    lab: { passed: lab.results.filter((r) => r.passed).length, total: lab.results.length },
    kit11: metal.mandates.filter((m) => ["sourcing", "support", "treasury"].includes(m.role)).map((m) => ({ agent: m.agent, role: m.role, bound: m.history[0]?.budget ?? m.budget, now: m.budget })),
    main: mainRunFacts(),
    metal: { features: metal.features.length, mandates: metal.mandates.length, dispute_orders: metal.dispute?.packs.length ?? 0, dispute_refunded: metal.dispute?.refunds.length ?? 0, refunded_before: (metal.dispute?.packs ?? []).filter((x) => x.refunded_cents > 0).map((x) => x.seq) },
  };
}
