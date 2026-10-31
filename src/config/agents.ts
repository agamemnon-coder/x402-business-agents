/**
 * The agents decide only when KIT11_AGENTS=on. Off (the default), every flow runs code's fixed decisions exactly as in
 * the recorded runs and the dry runs; the switch stays off until the agents pass their evals, the red team and a full
 * dry run (the kill rule of 4 November). Everything built for Thursday's run (the per-agent pause among it) sits behind
 * it too. Its own module, so policy code can ask without loading the Claude SDK.
 */
export function agentsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KIT11_AGENTS === "on";
}
