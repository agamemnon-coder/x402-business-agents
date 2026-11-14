// Does precedent help? (14 Nov) The Checker on the payables eval set (src/evals/apAgentCases.ts) twice with the same real
// model: once as it runs today, once with precedent: the CFO's outcomes on the most similar other cases of the same set
// (leave one out: a case never sees its own label). A case's label becomes a CFO outcome: pay or ask_cfo → signed,
// hold or reject → rejected, with the case's own one-line description as the CFO's reason. Scored on whether the
// agent's own decision (before code enforces anything) is one the case accepts, and on the outcome after enforcement.
// Needs KIT11_ANTHROPIC_API_KEY; never in CI. Published only from a run (docs/evals/precedent.json).

import type Anthropic from "@anthropic-ai/sdk";
import { runChecker } from "../ap/checkerAgent.js";
import { codeFindings } from "../ap/checkerCore.js";
import { openDb } from "../db/open.js";
import { centsOf, precedentsFor, type LabelledCase } from "../learning/precedent.js";
import type { ApAgentCase } from "./apAgentCases.js";

/** Each eval case as a labelled past decision of the CFO's. */
export function labelledFromEval(cases: readonly ApAgentCase[]): LabelledCase[] {
  return cases.map((k, i) => {
    const r = k.case.invoice.reading;
    return {
      ref: k.id, agent: "checker", category: "supplier_payment", counterparty: r.vendor || null, currency: r.currency || null, amountCents: centsOf(r.total),
      outcome: k.expected === "pay" || k.expected === "ask_cfo" ? "signed" : "rejected", reason: k.expected === "pay" || k.expected === "ask_cfo" ? null : k.what,
      // An order for "most recent first" among equals; the eval's cases have no dates of their own.
      at: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}Z`, invoice: null,
    };
  });
}

/** The case with the precedent it is given: the most similar other cases (leave one out). */
export function withPrecedent(k: ApAgentCase, labelled: readonly LabelledCase[], n = 5): ApAgentCase {
  const r = k.case.invoice.reading;
  const ps = precedentsFor(labelled, { category: "supplier_payment", counterparty: r.vendor || null, currency: r.currency || null, amountCents: centsOf(r.total), ref: k.id }, n);
  return { ...k, case: { ...k.case, precedents: ps } };
}

export interface PrecedentRow {
  case: string; arm: "without" | "with"; expected: string; accept: readonly string[]; precedents: number;
  raw: string | null; raw_right: boolean | null; outcome: string; right: boolean; source: "claude" | "fallback"; cost_usd_micros: number; ms: number;
}

export async function precedentRow(k: ApAgentCase, arm: PrecedentRow["arm"], model: string, client: Anthropic | null): Promise<PrecedentRow> {
  const db = openDb(":memory:");
  const t0 = Date.now();
  const out = await runChecker(db, k.case, codeFindings(k.case), { task: `ap.check.precedent-${arm}-${k.id}`, claude: client, model });
  const raw = out.source === "claude" ? out.decision.action : null;
  return {
    case: k.id, arm, expected: k.expected, accept: k.accept, precedents: k.case.precedents?.length ?? 0,
    raw, raw_right: raw === null ? null : k.accept.includes(raw as never), outcome: out.enforced.outcome, right: k.accept.includes(out.enforced.outcome),
    source: out.source, cost_usd_micros: out.run.costMicros, ms: Date.now() - t0,
  };
}

export interface ArmSummary { cases: number; by_claude: number; raw_right: number; raw_agreement: number | null; right_after: number; agreement_after: number }

/** Agreement with the recorded outcome, per arm: of Claude's own decisions, and after code enforced them. */
export function summariseArms(rows: readonly PrecedentRow[]): Record<PrecedentRow["arm"], ArmSummary> {
  const one = (arm: PrecedentRow["arm"]): ArmSummary => {
    const rs = rows.filter((r) => r.arm === arm), mine = rs.filter((r) => r.source === "claude");
    const rawRight = mine.filter((r) => r.raw_right).length, after = rs.filter((r) => r.right).length;
    return { cases: rs.length, by_claude: mine.length, raw_right: rawRight, raw_agreement: mine.length ? rawRight / mine.length : null, right_after: after, agreement_after: rs.length ? after / rs.length : 0 };
  };
  return { without: one("without"), with: one("with") };
}
