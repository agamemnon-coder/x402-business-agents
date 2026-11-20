// The red team's record as a page (20 Nov): written by `npm run redteam -- --out FILE.json` beside the JSON, from the
// JSON alone, so no figure on it is typed by hand.

import { redactSecrets } from "../lib/redact.js";
import type { AttackResult } from "./attacks.js";

export interface RedTeamReport {
  ran_at: string;
  rerun_of?: string;
  commit?: string;
  dirty?: boolean;
  command?: string;
  model: string | null;
  reading: string;
  attempts: number;
  blocked: number;
  caught_after: number;
  inconclusive: number;
  not_blocked: number;
  results: AttackResult[];
}

/** A table cell: backslashes first, then pipes, so a cell never ends early or escapes its own escape (CodeQL). */
const cell = (s: string) => redactSecrets(s).replace(/\s+/g, " ").trim().replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

export function redTeamMarkdown(r: RedTeamReport, jsonName: string): string {
  const day = new Date(r.ran_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const before = r.blocked - r.caught_after;
  const rows = r.results.map((x, i) => `| ${i + 1} | \`${x.id}\` ${cell(x.title)} | ${x.outcome ?? (x.blocked ? "blocked" : "not_blocked")} | ${x.caught ?? ""} | ${cell(x.defence).slice(0, 300)} | ${cell(x.evidence).slice(0, 400)} |`);
  return `# Red team${r.rerun_of ? " re-run" : ""}, ${day}${r.rerun_of ? " (not held out)" : ""}, in a throwaway test world

Written from [${jsonName}](${jsonName}) by \`npm run redteam\`; every figure here is read from that file.

- Ran at ${r.ran_at}${r.commit ? `, on commit \`${r.commit}\`${r.dirty ? " with uncommitted changes" : " (clean)"}` : ""}${r.command ? `, by \`${r.command}\`` : ""}.
- Attacker: ${r.model ?? "no model; every attack runs in order, with its own fixed input"}. Documents go through the intake as it runs: classified and read (by Claude where a key is set), and every reading checked by code.
- ${r.rerun_of ? `A re-run of the attacks of \`${r.rerun_of}\` and of every earlier attempt a red-team record holds, after the fixes they led to: not held out, the attacks were known before this run.` : "The first run of these attacks."}
- Each attack in a fresh throwaway world: an in-memory ledger, stand-ins for Airwallex Issuing and Alta, the relay's code on this machine. Test money only; no bank, chain, phone or live service is reached.

**${r.blocked} of ${r.attempts} attempts blocked: ${before} stopped before money moved, ${r.caught_after} found only afterwards; ${r.inconclusive} inconclusive, ${r.not_blocked} not blocked.**

${cell(r.reading)}

| # | Attack | Outcome | Caught | Control | Evidence |
|---|---|---|---|---|---|
${rows.join("\n")}
`;
}
