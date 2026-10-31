// Names from before Purser's rename (rehearsals 1 to 3, the earlier example company). A guest must never see them once
// the recordings come from the Northwind runs: demo:record refuses such a recording, and test/guest-names.test.ts
// checks everything a guest can open.

import { readFileSync } from "node:fs";

export const OLD_NAMES = [
  "Tidemark", "Kestrel", "Feedstock", "Lizenzhaus", "Contoso", "Tailspin", "Northwind Market Data",
];

/** The old names that occur in a text, if any. */
export function oldNamesIn(text: string): string[] {
  return OLD_NAMES.filter((n) => text.includes(n));
}

/** The agents' names before they took Kit 11's (Sourcing, Support, Treasury agent), with their cards. */
export const PRE_KIT11_NAMES = ["Operations agent", "Sales agent", "Finance agent", "Operations card", "Sales card", "Finance card"];

/** The pre-Kit 11 names that occur in a text, in any case. */
export function preKit11NamesIn(text: string): string[] {
  const lower = text.toLowerCase();
  return PRE_KIT11_NAMES.filter((n) => lower.includes(n.toLowerCase()));
}

/** True once the recording (docs/demo/story.json) comes from a run with the Kit 11 names. */
export function kit11NamesRecorded(): boolean {
  const story = JSON.parse(readFileSync(new URL("../../docs/demo/story.json", import.meta.url), "utf8")) as { agent_names?: string };
  return story.agent_names === "kit11";
}
