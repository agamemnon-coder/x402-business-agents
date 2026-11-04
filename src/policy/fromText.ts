// The CFO's policy in plain words (P2). Opus drafts rules from the words; code checks every rule; the survivors
// become one policy_change proposal that the CFO approves with Face ID like any other. Model output is never applied
// directly: it is shown, and only a signature makes it policy.
//
// A drafted rule is used only when:
//   - its key is a setting that exists;
//   - its quote is copied from the CFO's own text;
//   - an amount appears in that quote (the model may not invent, split, add up or round amounts);
//   - the value passes the setting's own limits (validateChange);
//   - no earlier rule already set that key.
// Everything else is listed as refused, with the reason, next to what the model could not map.

import type { Tools } from "../claude/tools.js";
import type { DB } from "../db/open.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { fromCents, toCents } from "../lib/money.js";
import { centsWritten } from "../lib/numbers.js";
import type { ProposalRow } from "./approvals.js";
import { currentPolicy, loosens, policyValue, rules, validateChange } from "./rules.js";

const MAX_TEXT = 2000;

export interface DraftedRule {
  key: string;
  label: string;
  from: string;
  to: string;
  quote: string;
  why: string;
}

export interface PolicyDraftResult {
  proposal: (ProposalRow & { explanation: string }) | null;
  accepted: DraftedRule[];
  refused: { key: string; to: string; quote: string; why: string }[];
  not_mapped: { quote: string; why: string }[];
  questions: string[];
  source: "claude" | "fallback";
  model: string | null;
}

/**
 * Every amount written in `s`, in cents, read the way people write money: "40", "€0,08", "1.250,50", "1,250.50",
 * "2.000". Read by the one reader for typed numbers (src/lib/numbers.ts, its rules in its header): a separator
 * followed by exactly two digits at the end is the decimal mark; one followed by three is a thousands separator,
 * unless the words also use that mark as a decimal point and no currency is written next to it (then it is ambiguous
 * and is no amount the CFO wrote).
 */
export function amountsIn(s: string): number[] {
  return centsWritten(s);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * `tightenOnly`: the words came from the phone (through the relay), where the policy may only be tightened (review
 * N2); a rule that would loosen it is refused there and can be drafted on the runner instead.
 */
export async function draftPolicyFromText(db: DB, tools: Tools, text: string, now = new Date(), opts: { tightenOnly?: boolean } = {}): Promise<PolicyDraftResult> {
  if (text.trim() === "") throw new Error("write the policy in your own words first");
  if (text.length > MAX_TEXT) throw new Error(`the policy text may be at most ${MAX_TEXT} characters`);
  const settings = currentPolicy(db).map((r) => `${r.key} | ${r.label} | ${r.unit || (r.choices ?? []).join("/")} | ${r.value || "not set"}`).join("\n");
  const read = await tools.policyDraft(text, settings);
  const draft = read.value;

  const accepted: DraftedRule[] = [];
  const refused: PolicyDraftResult["refused"] = [];
  const said = norm(text);
  for (const c of draft.changes) {
    const refuse = (why: string) => refused.push({ key: c.key, to: c.to, quote: c.quote, why });
    const rule = rules(db).find((r) => r.key === c.key);
    if (!rule) { refuse(`unknown policy setting ${c.key}`); continue; }
    if (c.quote.trim() === "" || !said.includes(norm(c.quote))) { refuse(`the quote is not in your words: "${c.quote}"`); continue; }
    if (rule.kind !== "choice" && c.to !== "") {
      let cents: number;
      try {
        cents = toCents(c.to);
      } catch {
        refuse(`${c.to} is not an amount with two decimals`);
        continue;
      }
      // The amount must be in the quote AND be one the CFO wrote whole: a quote may not cut "1500" down to "500" or
      // "0" (HF7), so the amounts of the whole text are the ones that count.
      if (!amountsIn(c.quote).includes(cents) || !amountsIn(text).includes(cents)) { refuse(`${fromCents(cents)} is not an amount in "${c.quote}"`); continue; }
    }
    if (accepted.some((a) => a.key === c.key)) { refuse(`${rule.label} is changed twice; the first reading is kept`); continue; }
    const from = policyValue(db, c.key);
    const problem = validateChange(db, { key: c.key, from, to: c.to });
    if (problem) { refuse(problem); continue; }
    if (opts.tightenOnly && loosens({ key: c.key, from, to: c.to })) {
      refuse(`${rule.label} ${from || "not set"} → ${c.to || "none"} would loosen the policy; from the phone your words can only tighten it (ask Claude to draft it on the runner)`);
      continue;
    }
    accepted.push({ key: c.key, label: rule.label, from, to: c.to, quote: c.quote, why: c.why });
  }

  let proposal: PolicyDraftResult["proposal"] = null;
  if (accepted.length > 0) {
    const p = proposePolicyChange(db, { changes: accepted.map((a) => ({ key: a.key, to: a.to })), reason: `The CFO's policy in plain words, drafted into rules by Opus: "${text.trim()}"` }, "claude", now);
    const unit = (key: string) => rules(db).find((r) => r.key === key)?.unit ?? "";
    const lines = [
      ...accepted.map((a) => `"${a.quote}" → ${a.label}: ${a.from || "not set"} → ${a.to}${unit(a.key) ? ` ${unit(a.key)}` : ""}.`),
      ...(draft.not_mapped.length || refused.length ? [`Not turned into a rule: ${[...draft.not_mapped.map((n) => `"${n.quote}" (${n.why})`), ...refused.map((r) => `"${r.quote}" (${r.why})`)].join("; ")}.`] : []),
      ...(draft.questions.length ? [`Questions: ${draft.questions.join(" ")}`] : []),
    ];
    const explanation = `[${read.model ?? "no model"}] DRAFTED: ${lines.join(" ")}`;
    db.prepare("UPDATE proposals SET explanation = ? WHERE proposal_id = ?").run(explanation, p.proposal_id);
    proposal = { ...p, explanation };
  }
  return { proposal, accepted, refused, not_mapped: draft.not_mapped, questions: draft.questions, source: read.source, model: read.model };
}

/** One line for the phone and the log: what became of the CFO's words. */
export function draftSummary(r: PolicyDraftResult): string {
  const rules = r.accepted.map((a) => `${a.label}: ${a.from || "not set"} → ${a.to || "none"}`).join("; ");
  const left = [...r.not_mapped.map((n) => `"${n.quote}": ${n.why}`), ...r.refused.map((x) => `"${x.quote}": ${x.why}`)];
  return [
    r.proposal ? `${r.proposal.proposal_id} waits for your Face ID: ${rules}.` : "No rule came out of this text, so nothing waits for approval.",
    left.length ? `Not a rule: ${left.join("; ")}.` : "",
    r.questions.length ? `Questions: ${r.questions.join(" ")}` : "",
    r.source === "fallback" ? "(No model was available.)" : "",
  ].filter(Boolean).join(" ").slice(0, 490);
}
