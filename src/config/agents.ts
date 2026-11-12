/**
 * The agents decide only when KIT11_AGENTS=on. Off (the default), every flow runs code's fixed decisions exactly as in
 * the recorded runs and the dry runs; the switch stays off until the agents pass their evals, the red team and a full
 * dry run (the kill rule of 4 November). Everything built for Thursday's run (the per-agent pause among it) sits behind
 * it too. Its own module, so policy code can ask without loading the Claude SDK.
 */
export function agentsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KIT11_AGENTS === "on";
}

/** Block 1: owners_execute (both passkeys sign the account's Execute digest) only when KIT11_PASSKEY_OWNERS=on. */
export function passkeyOwnersOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KIT11_PASSKEY_OWNERS === "on";
}

/** D19: the autonomous agents (their own loops, woken by the world) only when KIT11_AUTONOMY=on, with the agents on. */
export function autonomyOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KIT11_AUTONOMY === "on" && agentsOn(env);
}

/**
 * The payables chain's own agents (12 Nov): with KIT11_AP_AGENTS=on the Checker agent decides on each invoice and the
 * Payer agent proposes each payment (src/ap/checkerAgent.ts, src/ap/payerAgent.ts), and code enforces the boundaries
 * around both. Off (the default), the chain runs code's checks and code's plan exactly as before.
 */
export function apAgentsOn(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  return env.KIT11_AP_AGENTS === "on";
}
