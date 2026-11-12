// The refusals of `npm run awx-depth` live commands, without side effects, so they are tested without running the CLI.

/** The hard ceiling of this stream's live calls (the owner's brief, 12 November): every request counts, logins too. */
export const AWX_DEPTH_MAX_BUDGET = 40;

export function awxDepthRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.AWX_DEPTH_GO !== "yes") why.push("AWX_DEPTH_GO=yes (the owner's go for this stream's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) > AWX_DEPTH_MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET at most ${AWX_DEPTH_MAX_BUDGET}`);
  if (!/awx-depth[^/]*\.sqlite$/.test(env.KIT11_DB ?? "")) why.push("KIT11_DB=…/awx-depth*.sqlite (this run's own ledger)");
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (the company's own sandbox account only)");
  return why;
}
