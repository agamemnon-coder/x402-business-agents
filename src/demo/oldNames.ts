// Names from before Purser's rename (rehearsals 1 to 3, the earlier example company). A guest must never see them once
// the recordings come from the Northwind runs: demo:record refuses such a recording, and test/guest-names.test.ts
// checks everything a guest can open.
export const OLD_NAMES = [
  "Tidemark", "Kestrel", "Feedstock", "Lizenzhaus", "Contoso", "Tailspin", "Northwind Market Data",
  "Sourcing agent", "Support agent", "Treasury agent",
];

/** The old names that occur in a text, if any. */
export function oldNamesIn(text: string): string[] {
  return OLD_NAMES.filter((n) => text.includes(n));
}
