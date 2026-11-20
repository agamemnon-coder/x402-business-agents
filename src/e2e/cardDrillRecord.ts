// What the card drill's record says beyond its tables (docs/runs/<date>-card-drill.md): the simulated parts, what it does
// not show, and a summary computed from the steps (never typed in).

import type { DrillRecord } from "./drillRecord.js";

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
  3: "The same re-run, two minutes later. From this pass the drill records up to 4 such refusals of the sandbox's simulation in the run's log as \"nothing to judge\" instead of halting; none occurred.",
};

type Step = DrillRecord["passes"][number]["steps"][number];
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** The record's "in short", computed from its steps. */
export function cardDrillSummary(r: DrillRecord): string[] {
  const out: string[] = [];
  const all: Step[] = r.passes.flatMap((p) => p.steps.map((s) => ({ ...s, id: s.id })));
  const lat = (id: string) => all.filter((s) => s.id === id).map((s) => `${s.agent} ${num(s.facts.update_to_readback_ms) ?? "–"} ms`).join(", ");
  if (all.some((s) => s.id === "cycle.freeze")) {
    out.push(`Update sent to Airwallex reading the new status back: freeze ${lat("cycle.freeze")}; thaw ${lat("cycle.thaw")}; refreeze ${lat("cycle.refreeze")}.`);
    const frozen = all.filter((s) => s.id === "cycle.charge_frozen" || s.id === "cycle.charge_after_refreeze");
    out.push(`Charges on a frozen card (before the thaw, and right after the refreeze was read back): ${frozen.filter((s) => s.pass).length} of ${frozen.length} declined CARD_INACTIVE.`);
    const race = all.filter((s) => s.id === "cycle.auth_in_window");
    out.push(`A second authorisation inside the purchase window: ${race.map((s) => `${s.agent} ${s.facts.approved ? "APPROVED" : `declined ${String(s.facts.failure_reason ?? "")}`}${s.facts.same_amount_as_purchase ? " (same amount as the purchase)" : ""}`).join(", ")}.`);
  }
  const w = all.find((s) => s.id === "purchase.window");
  if (w) out.push(`Purser's own purchase path kept the card thawed for ${num(w.facts.window_ms) ?? "–"} ms (thaw sent to refreeze read back).`);
  for (const k of ["k1", "k2"]) {
    const steps = all.filter((s) => s.id.startsWith(`crash.${k}.`));
    if (steps.length) out.push(`Crash ${k}: ${steps.map((s) => `${s.id.split(".")[2]} ${s.pass === true ? "pass" : s.pass === false ? "FAIL" : "–"}`).join(", ")}.`);
  }
  const d = all.filter((s) => s.id === "detect.poll").at(-1);
  if (d) out.push(`Detection by the poll: ${d.outcome}.`);
  const h = all.find((s) => s.id === "webhooks.local_replay");
  if (h) out.push(`Webhook replay (local): ${h.outcome}.`);
  return out;
}
