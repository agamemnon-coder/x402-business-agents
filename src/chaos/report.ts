// The money chaos report: docs/evidence/chaos-money.md and .json (npm run chaos:money).
import type { ScenarioResult } from "./money.js";

export interface ChaosReport {
  format: "purser.chaos-money/v1";
  checked: string;
  seed: number;
  how: string;
  totals: {
    scenarios: number; randomized: number; hand_written: number; passed: number; failed: number;
    calls: number; faults: number; crashes: number; webhooks: number; forged_webhooks: number;
    faults_by_kind: Record<string, number>; end_states: Record<string, number>; to_a_person: number; silent_approvals: number;
  };
  invariants: Record<string, { held: number; broken: number; what: string }>;
  canaries: { id: string; title: string; caught: boolean; by: string[] }[];
  scenarios: { id: string; title: string; seed: number; params: Record<string, unknown>; ok: boolean; calls: number; faults: number; crashes: number; end: string; broken: { id: string; detail: string }[]; outcome?: string[]; silent_approvals?: string[] }[];
}

export const INVARIANT_WORDS: Record<string, string> = {
  I1: "never paid twice: at most one live transfer and one conversion per approval at Airwallex, no request_id twice",
  I2: "never paid without a valid signature: every transfer is to passkey-approved terms, for the approved amount, and the stored signatures re-verify offline",
  I3: "the ledger balances: the audit chain and the general ledger verify, Airwallex's EUR is conserved, every executed payment's payout row says what Airwallex says",
  I4: "every payment ends in a known state, or goes to a person (an alarm row or a /health alert)",
  I5: "webhooks move nothing: duplicated, out-of-order and forged events change no proposal, payout row or approval; forged ones are ignored",
};

export function chaosReport(seed: number, random: ScenarioResult[], hand: ScenarioResult[], canaries: ScenarioResult[], checked: string): ChaosReport {
  const all = [...hand, ...random];
  const end = (r: ScenarioResult) => (r.invariants.find((i) => i.id === "I4")?.detail ?? "").split("; ").map((x) => x.split(",")[0]!.replace(/^P-\d+ /, "")).filter((x) => /^[A-Z_]+$/.test(x)).join("+") || "no proposal";
  const states: Record<string, number> = {};
  for (const r of all) for (const s of end(r).split("+")) states[s] = (states[s] ?? 0) + 1;
  const byKind: Record<string, number> = {};
  for (const r of all) for (const [k, n] of Object.entries(r.faultKinds)) byKind[k] = (byKind[k] ?? 0) + n;
  const invariants: ChaosReport["invariants"] = {};
  for (const id of ["I1", "I2", "I3", "I4", "I5"]) {
    const xs = all.map((r) => r.invariants.find((i) => i.id === id)!);
    invariants[id] = { held: xs.filter((x) => x.ok).length, broken: xs.filter((x) => !x.ok).length, what: INVARIANT_WORDS[id]! };
  }
  return {
    format: "purser.chaos-money/v1", checked, seed,
    how: "npm run chaos:money: the real executor (src/executors/invoicePayment.ts), saga (src/policy/saga.ts), Airwallex client and adapter, against a stand-in Airwallex REST API with faults (src/chaos/standInAirwallex.ts); passkey approvals through the real assertion path with a software authenticator; webhooks through the runner's handler (src/policy/cardHooks.ts). In process, test money, no network.",
    totals: {
      scenarios: all.length, randomized: random.length, hand_written: hand.length, passed: all.filter((r) => r.ok).length, failed: all.filter((r) => !r.ok).length,
      calls: all.reduce((s, r) => s + r.calls, 0), faults: all.reduce((s, r) => s + r.faults, 0), crashes: all.reduce((s, r) => s + r.crashes, 0),
      webhooks: all.reduce((s, r) => s + r.hooks.delivered, 0), forged_webhooks: all.reduce((s, r) => s + r.hooks.forged, 0),
      faults_by_kind: byKind, end_states: states,
      to_a_person: all.filter((r) => /→ a person/.test(r.invariants.find((i) => i.id === "I4")?.detail ?? "")).length,
      silent_approvals: all.filter((r) => r.silentApprovals.length).length,
    },
    invariants,
    canaries: canaries.map((c) => ({ id: c.id, title: c.title, caught: !c.ok, by: c.invariants.filter((i) => !i.ok).map((i) => i.id) })),
    scenarios: all.map((r) => ({
      id: r.id, title: r.title, seed: r.seed, params: (({ id: _i, title: _t, seed: _s, ...rest }) => rest)(r.scenario) as Record<string, unknown>, ok: r.ok, calls: r.calls, faults: r.faults, crashes: r.crashes, end: end(r),
      broken: r.invariants.filter((i) => !i.ok).map((i) => ({ id: i.id, detail: i.detail })),
      ...(r.id.startsWith("H") || !r.ok || r.silentApprovals.length ? { outcome: r.outcome } : {}),
      ...(r.silentApprovals.length ? { silent_approvals: r.silentApprovals } : {}),
    })),
  };
}

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function chaosMarkdown(r: ChaosReport, hand: ScenarioResult[]): string {
  const t = r.totals;
  const lines = [
    "# Chaos for money movement",
    "",
    `Run on ${r.checked} with \`npm run chaos:money\` (src/cli/chaosMoney.ts), seed ${r.seed}: **${t.scenarios} scenarios (${t.randomized} randomized, ${t.hand_written} hand-written), ${t.passed} passed, ${t.failed} failed**.`,
    "",
    "What runs: the real invoice payment executor, its saga and outbox (money_steps), the real Airwallex client and adapter, and the runner's recovery (recoverHolds, resumeInterrupted). Airwallex is a stand-in REST API in this process (src/chaos/standInAirwallex.ts) that, call by call, loses the request, loses the answer after doing the work (a dropped connection or a timeout), answers 500, 502 after doing the work, 503 or 429. The runner's process dies at saga checkpoints or with a call sent; a death is emulated faithfully: the ledger restarts from its SQLite image at that instant (whatever catch blocks did after it is thrown away) and Airwallex refuses the dead process's calls. Clocks are skewed (the runner against Airwallex) and approvals arrive late. The CFO approves with a passkey (a software authenticator, through the real assertion path). After the faulty lives: one calm life, a person's retry of each failed payment (the retry route's semantics), Airwallex paying out what it holds, the payout follow-up, a restart the next day, then a webhook storm (every Airwallex event several times, shuffled, with forged ones) and the checks. Test money, no network, no key.",
    "",
    "## Invariants",
    "",
    "| Invariant | Held | Broken |",
    "|---|---|---|",
    ...Object.entries(r.invariants).map(([id, v]) => `| ${id}: ${v.what} | ${v.held} | ${v.broken} |`),
    "",
    "## Totals",
    "",
    `- Airwallex calls: ${t.calls}; faults injected: ${t.faults} (${Object.entries(t.faults_by_kind).map(([k, n]) => `${k} ${n}`).join(", ")}); process deaths: ${t.crashes}.`,
    `- Webhooks delivered: ${t.webhooks}, of which forged: ${t.forged_webhooks}.`,
    `- How the payments ended: ${Object.entries(t.end_states).map(([k, n]) => `${k} ${n}`).join(", ")}.`,
    `- Scenarios where a payment went to a person (an alarm row or a /health alert) instead of a final state: ${t.to_a_person}.`,
    `- Scenarios where an approved payment was refused before it began and sat APPROVED with no alarm until its expiry: ${t.silent_approvals} (see the findings).`,
    "",
    "## The invariants have teeth (canaries)",
    "",
    "Each canary runs a calm payment and plants one break before the checks; each must be caught.",
    "",
    "| Canary | Caught | By |",
    "|---|---|---|",
    ...r.canaries.map((c) => `| ${cell(c.title)} (\`${c.id}\`) | ${c.caught ? "yes" : "**NO**"} | ${c.by.join(", ") || "-"} |`),
    "",
    "## Findings",
    "",
  ];
  const failed = r.scenarios.filter((s) => !s.ok);
  if (!failed.length) lines.push("No invariant was broken in any scenario.", "");
  for (const s of failed) {
    lines.push(`### ${s.id}: ${s.title} (seed ${s.seed})`, "", ...s.broken.map((b) => `- ${b.id} broken: ${b.detail}`), `- Repro: \`npm run chaos:money -- --only ${s.id}\` (seed ${r.seed})`, "", ...(s.outcome ?? []).map((o) => `    ${o}`), "");
  }
  const silent = r.scenarios.filter((s) => s.silent_approvals?.length);
  const why = (s: (typeof silent)[number]) => {
    const said = (s.outcome ?? []).filter((o) => /\(calm\)/.test(o)).join(" ");
    return /floor/.test(said) ? "the EUR floor" : /do not match the approved hash/.test(said) ? "terms changed after the approval" : "another refusal";
  };
  const reasons: Record<string, number> = {};
  for (const s of silent) reasons[why(s)] = (reasons[why(s)] ?? 0) + 1;
  if (silent.length) {
    lines.push("### Observation: an approved payment refused before it begins raises no alarm until it expires", "",
      `In ${silent.length} scenario(s) an approved proposal was refused by the executor before anything was sent (the terms in the ledger no longer hash to the approved hash, or the EUR floor would be broken once another payment went out) and stayed APPROVED, with no alarm row and nothing on /health, retried and refused at each start until its expiry made it EXPIRED. Nothing was paid (I1, I2 held). A person is not told while it lasts: \`resumeInterrupted\` (src/policy/saga.ts) keeps the refusal in its return value only. The same EUR floor refusal, met after execution began, fails the proposal instead (FAILED, on the dashboard). Why they were refused: ${Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(", ")}. Seen in: ${silent.map((s) => s.id).join(", ")}.`,
      "", "Repro: `npm run chaos:money -- --only H11` (terms edited after the approval) and `--only H17` (two approvals, the second refused at the EUR floor).", "");
  }
  lines.push("## Hand-written scenarios", "", "| Scenario | Result | How it ended |", "|---|---|---|");
  for (const h of hand) lines.push(`| \`${h.id}\` ${cell(h.title)} | ${h.ok ? "held" : "**broken**"} | ${cell(h.invariants.find((i) => i.id === "I4")!.detail)} |`);
  lines.push("", `## Randomized scenarios (seed ${r.seed})`, "", "| Scenario | Faults | Deaths | Result | How it ended |", "|---|---|---|---|---|");
  for (const s of r.scenarios.filter((x) => x.id.startsWith("R"))) lines.push(`| \`${s.id}\` | ${s.faults} | ${s.crashes} | ${s.ok ? "held" : "**broken**"} | ${s.end} |`);
  lines.push("", "The JSON beside this file (`chaos-money.json`) holds every scenario's parameters and, for the hand-written ones, what happened life by life.", "");
  return lines.join("\n");
}
