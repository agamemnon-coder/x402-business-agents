// What the card drill's record says beyond its tables (docs/runs/<date>-card-drill.md): the simulated parts, what it does
// not show, and a summary computed from the steps (never typed in).

import type { DrillRecord } from "./drillRecord.js";
import type { DrillLine } from "./drillHttp.js";

export const CARD_DRILL_SIMULATED = [
  "Every merchant charge is the sandbox's simulation endpoint (`POST /simulation/issuing/create`): no merchant charged anything. The approve or decline is Airwallex's own, on the card's status, limits and merchant categories.",
  "The crash is a SIGKILL the child process sends itself at the point the drill chose (after the thaw was recorded; or the moment Airwallex answered the thaw, before the ledger heard of it). The restart is the runner's own card code run by the drill, not a restarted runner process.",
  "Duplicate and late webhooks are replayed locally: built from this run's own simulation answers (whitelisted fields only) and signed with a local test secret. Airwallex sent none of them; the sandbox has no endpoint that replays an event.",
  "No passkey signs anything in this drill, and no money other than the agents' cards' test balance moves.",
];

export const CARD_DRILL_NOT_SHOWN = [
  "Real merchants and card networks: the sandbox's simulated authorisation is decided by Airwallex, but its timing is not a card network's.",
  "A webhook delivered by Airwallex: this run has no public receiver; the replay checks Purser's handling of the same payloads.",
  "One run per card: latencies are single measurements, not a distribution.",
  "The restart is the runner's card code called by the drill (src/policy/cards.ts), not a restarted `npm run relay` process.",
];

/** Notes per pass, for passes that re-ran a part after a fix. */
export const CARD_DRILL_PASS_NOTES: Record<number, string> = {
  1: "The card code as on origin/main (f667d16), with the drill beside it: no card recovery at the runner's start, the thaw written to the ledger only after Airwallex answered it, and a purchase window taken by any authorisation of its amount. **This pass's webhook replay is void:** the drill's log kept each simulation answer without its date (`transacted_at`), so the 30 replayed events under a new id were refused by the hook handler as malformed (no row, no alarm) and only the 15 repeats of an id were answered \"already recorded\". The log was fixed and the replay re-run in pass 3.",
  2: "After the three fixes (src/policy/cards.ts: recoverCardWindows at the runner's start, the thaw written to the ledger before it is sent, a window expects one authorisation): a re-run of the support card's cycle, the crash, the poll and the webhooks. **Stopped at its second step:** the sandbox's simulation answered HTTP 400 bad_request \"failed to process transaction\" after 9.6 s to a charge on the frozen card (the stop drill had met an HTTP 400 on the same endpoint at 09:54 UTC). The drill halts on any unexpected 4xx, so nothing else was sent.",
  3: "The same re-run, two minutes later. From this pass the drill records up to 4 such refusals of the sandbox's simulation in the run's log as \"nothing to judge\" instead of halting; none occurred. The freeze latencies of passes 2 and 3 are taken from the request log when this record was written: the drill had measured them from the process's login, which that step needed first.",
};

type Step = DrillRecord["passes"][number]["steps"][number];

/** Steps whose result says nothing about Purser: the drill itself was wrong there. Shown as void, not judged. */
export const CARD_DRILL_VOID: { pass_no: number; id: string; why: string }[] = [
  { pass_no: 1, id: "webhooks.local_replay", why: "the drill's log kept the simulation answers without their date, so the replayed events were malformed (see the pass's note); re-run in pass 3" },
];

/**
 * A status step's latency, from the request log: the status update's start to the answer of the first read showing the
 * wanted status. Computed again when the record is written (passes 2 and 3 measured from the process's login, which
 * that step happened to need first; fixed in the drill the same day).
 */
export function statusLatencies<T extends Step>(steps: T[], lines: readonly DrillLine[]): T[] {
  const want: Record<string, string> = { "cycle.freeze": "INACTIVE", "cycle.thaw": "ACTIVE", "cycle.refreeze": "INACTIVE" };
  return steps.map((s) => {
    if (!want[s.id]) return s;
    const mine = lines.filter((l) => s.lines.includes(l.n));
    const post = mine.find((l) => l.method === "POST" && l.endpoint === "/issuing/cards/{id}/update");
    const first = post && mine.find((l) => l.n > post.n && l.card_status === want[s.id]);
    const ms = post && first ? Date.parse(first.answered_at) - Date.parse(post.at) : null;
    return { ...s, facts: { ...s.facts, update_to_readback_ms: ms, update_ms: post?.ms ?? null }, outcome: s.outcome.replace(/update to read-back (\d+|-) ms/, `update to read-back ${ms ?? "-"} ms`) };
  });
}

/** The steps with the void ones marked: not judged, the reason first, what was seen kept after it. */
export function voidSteps<T extends Step>(passNo: number, steps: T[]): T[] {
  return steps.map((s) => {
    const v = CARD_DRILL_VOID.find((x) => x.pass_no === passNo && x.id === s.id);
    return v ? { ...s, pass: null, outcome: `VOID (${v.why}). Seen: ${s.outcome}` } : s;
  });
}
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** The record's "in short", computed from its steps, pass by pass. */
export function cardDrillSummary(r: DrillRecord): string[] {
  const out: string[] = [];
  const many = r.passes.length > 1;
  const tag = (p: DrillRecord["passes"][number]) => (many ? `pass ${p.pass_no} ` : "");
  const each = (id: string, f: (s: Step, p: DrillRecord["passes"][number]) => string) => r.passes.flatMap((p) => p.steps.filter((s) => s.id === id).map((s) => f(s, p)));
  const lat = (id: string) => each(id, (s, p) => `${tag(p)}${s.agent} ${num(s.facts.update_to_readback_ms) ?? "–"} ms`).join(", ");
  if (each("cycle.freeze", () => "x").length) {
    out.push(`Update sent to Airwallex until the new status read back: freeze ${lat("cycle.freeze")}; thaw ${lat("cycle.thaw")}; refreeze ${lat("cycle.refreeze")}.`);
    const frozen = r.passes.flatMap((p) => p.steps.filter((s) => s.id === "cycle.charge_frozen" || s.id === "cycle.charge_after_refreeze"));
    const judged = frozen.filter((s) => s.pass !== null);
    out.push(`Charges on a frozen card (before the thaw, and right after the refreeze was read back): ${judged.filter((s) => s.pass).length} of ${judged.length} declined CARD_INACTIVE${frozen.length > judged.length ? `; ${frozen.length - judged.length} not judged (the sandbox refused to simulate)` : ""}.`);
    out.push(`A second authorisation inside the purchase window, while the card was thawed for the purchase: ${each("cycle.auth_in_window", (s, p) => `${tag(p)}${s.agent} ${s.facts.approved ? "APPROVED" : `declined ${String(s.facts.failure_reason ?? "")}`}${s.facts.same_amount_as_purchase ? " (same amount as the purchase)" : ""}`).join(", ")}. Airwallex judges a thawed card on its limits and merchant categories only; Purser can only find such a charge afterwards (detection below).`);
  }
  const w = each("purchase.window", (s) => `${num(s.facts.window_ms) ?? "–"} ms`);
  if (w.length) out.push(`Purser's own purchase path (chargeInWindow) kept the card thawed for ${w.join(", ")} (thaw sent until the refreeze read back).`);
  for (const [k, what] of [["k1", "killed after the thaw was recorded"], ["k2", "killed the moment Airwallex answered the thaw, before the ledger heard"]] as const) {
    const parts = r.passes.map((p) => ({ p, steps: p.steps.filter((s) => s.id.startsWith(`crash.${k}.`)) })).filter((x) => x.steps.length);
    if (parts.length) out.push(`Crash ${k} (${what}): ${parts.map(({ p, steps }) => `${tag(p)}${steps.map((s) => `${s.id.split(".")[2]} ${s.pass === true ? "pass" : s.pass === false ? "FAIL" : "measured"}`).join(", ")}`).join("; ")}.`);
  }
  for (const d of each("detect.poll", (s, p) => `${tag(p)}${s.pass ? "pass" : "FAIL"}: ${s.outcome}`)) out.push(`Detection by the poll, ${d}.`);
  for (const h of each("webhooks.local_replay", (s, p) => `${tag(p)}${s.pass === true ? "pass" : s.pass === false ? "FAIL" : "not judged"}: ${s.outcome}`)) out.push(`Webhook replay (local), ${h}.`);
  return out;
}
