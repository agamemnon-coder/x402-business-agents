// The figures the submission pack uses (awards item 6), read from the same recorded files the pages use, so the deck,
// the form text and the pages cannot drift apart. test/submission.test.ts checks the form text against these.

import { readFileSync } from "node:fs";

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
    metal: { features: metal.features.length, mandates: metal.mandates.length, dispute_orders: metal.dispute?.packs.length ?? 0, dispute_refunded: metal.dispute?.refunds.length ?? 0, refunded_before: (metal.dispute?.packs ?? []).filter((x) => x.refunded_cents > 0).map((x) => x.seq) },
  };
}
