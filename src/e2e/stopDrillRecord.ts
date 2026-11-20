// What the stop drill's record says beyond its tables (docs/runs/<date>-stop-drill.md): the simulated parts, what it does
// not show, and a summary computed from the steps (never typed in).

import type { DrillRecord } from "./drillRecord.js";

export const STOP_DRILL_SIMULATED = [
  "The approver is a labelled virtual test passkey (\"stop-drill virtual test passkey (no person's Face ID)\", src/redteam/authenticator.ts), enrolled as the only passkey of the drill's own ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.",
  "The CFO's phone is played by the drill: the stop is pulled with the phone's own path (a signed policy change, processPolicyRequest), and the runner's steps after an approval (executePolicyChange, then syncCardsAfterPolicy) are called by the drill, not by a running `npm run relay`.",
  "Every merchant charge is the sandbox's simulation endpoint (`POST /simulation/issuing/create`); the approve or decline is Airwallex's own.",
  "The supplier payout is planned against the sandbox (balance, beneficiary) and signed, but never created: the emergency stop refuses it, which is what the drill checks.",
];

export const STOP_DRILL_NOT_SHOWN = [
  "Alta (on chain): an agent payment on Alta is refused by Purser's own check before signing (purserRefusal); nothing was sent to Alta in this drill, and the on-chain mandate is not revoked by the emergency stop (that is the pause, `npm run pause`).",
  "A person's Face ID on a real phone, and the relay between the phone and the runner.",
  "The runner's every-few-seconds sync and the autonomous agents' processes: the drill calls the same code once, in order.",
  "One run: the times are single measurements.",
];

/** Notes per pass, for passes that re-ran a part after a fix. */
export const STOP_DRILL_PASS_NOTES: Record<number, string> = {
  1: "The card code as on origin/main (f667d16), with the drill beside it. **Stopped at `velocity.card`:** the sandbox's simulation answered HTTP 400 bad_request to a charge on the stopped agent's frozen card (its message was not kept by this pass's log; the card drill met a 400 on the same endpoint at 10:00 UTC with the message \"failed to process transaction\"). The drill halts on any unexpected 4xx.",
  2: "The rest of the velocity stop (after the burst), on the same ledger, with the card fixes in place. The first pass's virtual passkey lived only in that process, so a new labelled virtual passkey replaced it (the replace window the ledger offers for a lost passkey).",
  3: "After the fix to `lift.passkey` (src/policy/cards.ts closeBlockedWindow: a stop closes the purchase windows it overrules): the cards thawed mid-purchase, the stop, the checks on the cards and agents, and the lift again, on the same ledger with a new virtual passkey. The pending payout was not planned again (pass 1 shows it refused).",
};

type Step = DrillRecord["passes"][number]["steps"][number];

export function stopDrillSummary(r: DrillRecord): string[] {
  const all: Step[] = r.passes.flatMap((p) => p.steps);
  const t = Object.assign({}, ...r.passes.map((p) => p.timings ?? {})) as Record<string, number | null>;
  const out: string[] = [];
  const pull = all.find((s) => s.id === "stop.pull");
  if (pull) out.push(`Emergency stop: ${pull.outcome}.`);
  const blocked = all.filter((s) => s.phase === ("blocked" as Step["phase"]));
  if (blocked.length) out.push(`After the stop: ${blocked.filter((s) => s.pass).length} of ${blocked.length} checks blocked${blocked.some((s) => !s.pass) ? `; not blocked: ${blocked.filter((s) => !s.pass).map((s) => `${s.id} ${s.agent ?? ""}`.trim()).join(", ")}` : ""}.`);
  const lift = all.filter((s) => s.id.startsWith("lift."));
  if (lift.length) out.push(`Lifting it: ${lift.map((s) => `${s.id.slice(5)} ${s.pass ? "as expected" : "NOT as expected"}`).join(", ")}.`);
  const burst = all.find((s) => s.id === "velocity.burst");
  if (burst) out.push(`Velocity stop: ${burst.outcome}; stopped ${t.velocity_stop_after_authorisation_ms ?? "–"} ms after Airwallex answered the authorisation that broke the limit.`);
  const vel = all.filter((s) => s.id.startsWith("velocity.") && s.id !== "velocity.burst");
  if (vel.length) out.push(`After the velocity stop: ${vel.map((s) => `${s.id.slice(9)} ${s.pass ? "as expected" : "NOT as expected"}`).join(", ")}.`);
  return out;
}
