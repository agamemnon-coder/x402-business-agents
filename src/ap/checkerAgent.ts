// The Checker agent on the runner (KIT11_AP_AGENTS=on): Claude decides what happens to a supplier invoice (pay, ask the
// CFO, hold or reject) with its own tools, and code enforces the boundary. The agent, its tools and the boundary are
// src/ap/checkerCore.ts, which a Worker runs too; this module runs that core through the runner's loop
// (src/agents/loop.ts: its cost caps, the client's timeout, one nudge when the agent stops without deciding) and
// writes the decision row. When Claude is unavailable, over its cost cap or does not decide, code's own checks decide,
// labelled as the fallback. The agent may be wrong: only its action reaches enforce, and a finding of code's checks
// that stops payment holds the invoice whatever the agent said.

import type Anthropic from "@anthropic-ai/sdk";
import type { Json } from "@metalntwx/metal-pay/mandates";
import type { z } from "zod";
import { runAgent, type AgentRun, type AgentTool } from "../agents/loop.js";
import { audit } from "../audit/log.js";
import { claudeClient } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { runProvenance, type RunProvenance } from "./agentRun.js";
import { ALWAYS_PAY } from "../evals/worstCaseWords.js";
import {
  answerTool, CHECKER_EFFORT, CHECKER_MODEL, CHECKER_MAX_TURNS, CHECKER_SYSTEM, CHECKER_UNFINISHED, checkerInputs, checkerPrompt, checkerTools, codeRequires, enforce, fallbackDecision, statusOf,
  type ApStatus, type CheckerDecision, type CheckerToolName, type Enforced, type Finding, type InvoiceCase,
} from "./checkerCore.js";

/** The agent's name in the audit chain, and the row its decision is recorded in. */
export const CHECKER_AGENT = "checker" as const;
export const CHECKER_DECISION = "ap.checker_decided";
/** The model the runner gives the Checker: the core's, chosen by the live eval (src/ap/checkerCore.ts CHECKER_MODEL). */
export const CHECKER_RUNNER_MODEL: string = CHECKER_MODEL;
/** The findings the agent's own stricter word adds to an invoice (a hold or a reject of one code's checks would let through). */
export const CHECKER_HOLD = "checker_hold";
export const CHECKER_REJECT = "checker_reject";

export interface CheckerOutcome {
  /** Who decided: Claude, or code's own checks when Claude was unavailable or did not decide. */
  source: "claude" | "fallback";
  /** The decision as it was handed to enforce: the agent's, or the fallback's. */
  decision: CheckerDecision;
  /** What code made of it: the outcome, and what overrode the decision when something did. */
  enforced: Enforced;
  /** Whether code made the outcome stricter than what Claude decided. Code's own fallback is never overridden. */
  overridden: boolean;
  /** What code alone requires for this invoice, and why, in code's words (codeRequires). */
  required: { action: string; by?: string | null; why: string };
  run: AgentRun;
  task: string;
  provenance: RunProvenance;
  /** The precedents the agent was given (the CFO's past decisions it learned from), by record id. */
  precedents: string[];
  /**
   * The worst-case policy on this same case and these same findings (15 Nov, /try): a script that always says pay in
   * the model's place (ALWAYS_PAY), through the same enforce. Pure code, no Claude call; recorded beside the decision.
   */
  script: { outcome: string; overridden_by: string | null };
}

/** What Purser's code makes of the always-pay script's "pay" on this case (the same enforce Claude's decision goes through). */
export function scriptOn(c: InvoiceCase, findings: Finding[]): CheckerOutcome["script"] {
  const e = enforce(c, { action: ALWAYS_PAY.action, reason: ALWAYS_PAY.reason, findings: [] }, findings);
  return { outcome: e.outcome, overridden_by: e.overridden_by };
}

export interface CheckerOptions {
  /** The run's name in the audit chain ("ap.check.<document>"). */
  task: string;
  /** The Claude client; null: no key, so code's checks decide. Default: the runner's own (KIT11_ANTHROPIC_API_KEY). */
  claude?: Anthropic | null;
  model?: string;
}

/** What the agent is told when it decides a second time: its first decision stands. */
export const ALREADY_DECIDED = "Not recorded: your decision is already recorded, and the first one stands. Nothing more was done.";

/**
 * Runs the Checker on a case. `findings` are code's own for it (codeFindings, and any the inbox adds beside them):
 * enforce judges the agent's action against these, never against the findings the agent names.
 */
export async function runChecker(db: DB, c: InvoiceCase, findings: Finding[], opts: CheckerOptions): Promise<CheckerOutcome> {
  let decided: CheckerDecision | null = null;
  const describe = new Map(checkerTools.map((t) => [t.name, t.description]));
  const tools = (Object.keys(checkerInputs) as CheckerToolName[]).map((name): AgentTool<z.ZodType> => ({
    name, description: describe.get(name)!, input: checkerInputs[name],
    run: async (input) => {
      // The first decision recorded is the agent's answer (review round 1: of two in one turn, the last one counted, so
      // a looser second could replace a stricter first). A later decide is refused and changes nothing.
      if (name === "decide" && decided) return { text: ALREADY_DECIDED, blocked: "already decided" };
      const a = answerTool(c, { name, input });
      if (a.decision) decided = a.decision;
      return { text: a.text, ...(a.blocked ? { blocked: a.blocked } : {}), ...(a.final ? { final: true } : {}) };
    },
  }));
  const run = await runAgent(db, {
    agent: CHECKER_AGENT, task: opts.task, model: opts.model ?? CHECKER_RUNNER_MODEL, system: CHECKER_SYSTEM, prompt: checkerPrompt(c),
    maxTurns: CHECKER_MAX_TURNS, effort: CHECKER_EFFORT, unfinished: () => (decided ? null : CHECKER_UNFINISHED), tools,
  }, opts.claude === undefined ? claudeClient() : opts.claude);
  const own = decided as CheckerDecision | null;
  const source = own ? "claude" : "fallback";
  const fallback = fallbackDecision(c, findings);
  const decision: CheckerDecision = own ?? { action: fallback.action, reason: fallback.reason, findings: fallback.findings };
  const enforced = enforce(c, decision, findings);
  const provenance = runProvenance(db, CHECKER_AGENT, opts.task, run, source === "claude", "the payables checks decide alone (the Checker agent was unavailable or did not decide)");
  const need = codeRequires(c, findings);
  return { source, decision, enforced, overridden: source === "claude" && enforced.overridden_by !== null, required: { action: need.action, by: need.by, why: need.why }, run, task: opts.task, provenance, precedents: (c.precedents ?? []).map((p) => p.case.ref), script: scriptOn(c, findings) };
}

/**
 * The same decision enforced on code's checks as they stand now (the ledger may have changed while the agent worked).
 * Claude's decision is kept as it was; code's own fallback is worked out again from these findings.
 */
export function enforceAgain(out: CheckerOutcome, c: InvoiceCase, findings: Finding[]): CheckerOutcome {
  const fallback = fallbackDecision(c, findings);
  const decision: CheckerDecision = out.source === "claude" ? out.decision : { action: fallback.action, reason: fallback.reason, findings: fallback.findings };
  const enforced = enforce(c, decision, findings);
  const need = codeRequires(c, findings);
  return { ...out, decision, enforced, overridden: out.source === "claude" && enforced.overridden_by !== null, required: { action: need.action, by: need.by, why: need.why }, script: scriptOn(c, findings) };
}

/**
 * The invoice's status and findings after the enforced outcome. pay and ask_cfo leave code's own status (ready: enforce
 * lets neither through while a finding stops payment). A hold keeps code's status when code itself stops the invoice;
 * where code would let it through, the agent's hold makes it wait for a person, with the agent's reason as a finding.
 * A reject stops it as blocked, with the reason: the final "rejected" stays a person's word (the payables page).
 */
export function statusAfter(enforced: Enforced, findings: Finding[]): { status: ApStatus; findings: Finding[] } {
  const kept = findings.filter((f) => f.code !== CHECKER_HOLD && f.code !== CHECKER_REJECT);
  const code = statusOf(kept);
  const reason = enforced.decision.reason.trim().slice(0, 600);
  if (enforced.outcome === "reject" && code !== "blocked") {
    return { status: "blocked", findings: [...kept, { code: CHECKER_REJECT, level: "block", detail: `the Checker agent says this must not be paid as it is: ${reason}` }] };
  }
  if (enforced.outcome === "hold" && code === "ready") {
    return { status: "needs_review", findings: [...kept, { code: CHECKER_HOLD, level: "review", detail: `the Checker agent holds it for a person: ${reason}` }] };
  }
  return { status: code, findings: kept };
}

/** The decision row: who decided, the agent's reason, code's findings, the enforced outcome and what overrode it. */
export function recordChecked(db: DB, invoiceId: string, out: CheckerOutcome, status: ApStatus, now = new Date()): void {
  audit(db, CHECKER_AGENT, CHECKER_DECISION, invoiceId, {
    invoice_id: invoiceId, source: out.source, model: out.source === "claude" ? out.run.model : null,
    action: out.decision.action, reason: out.decision.reason, agent_findings: out.decision.findings,
    code_findings: out.enforced.findings.map((f) => ({ code: f.code, level: f.level })) as unknown as Json,
    outcome: out.enforced.outcome, overridden_by: out.enforced.overridden_by, overridden: out.overridden, code_requires: out.required.action, why: out.required.why.slice(0, 600), status,
    // 16 Nov: the rule or finding code's requirement rests on (a limit's rule such as above_alone_limit, a finding's code), so a page names it.
    ...(out.required.by ? { code_rule: out.required.by } : {}),
    task: out.task, run_id: out.provenance.run_id, request_ids: out.provenance.request_ids, origin: out.provenance.origin as Json | null,
    ...(out.run.note ? { note: out.run.note } : {}),
    // The always-pay script on the same case (scriptOn): what code would have done had the script decided.
    ...(out.script ? { script_outcome: out.script.outcome, script_overridden_by: out.script.overridden_by } : {}),
    // What the agent learned from: the CFO's past decisions it was given as precedent (only when Claude decided).
    ...(out.source === "claude" && out.precedents.length ? { precedents: out.precedents } : {}),
  }, now);
}
