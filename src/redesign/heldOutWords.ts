// The newest held-out eval in words (22 Nov, the owner: "14 vs 88" read as Purser against no rules; it is the blind
// run, and the gaps it found are fixed): the blind run's figure, then the rerun after the fixes that followed, which is
// no longer blind. Every number is passed in from the two records (docs/evals/adversarial-vN.json and
// docs/evals/adversarial-vN-after.json); none is typed here. Used by /claude's tile and the evidence wall's tile.

export interface HeldOutFigures { version: number; cases: number; blind: number; blindPastCfo: number; noRules: number; after: number; afterFalseHolds: number }

const payments = (n: number) => `${n} payment${n === 1 ? "" : "s"}`;

/** "Held-out eval v17: 146 adversarial invoices". */
export const heldOutTitle = (f: Pick<HeldOutFigures, "version" | "cases">) => `Held-out eval v${f.version}: ${f.cases} adversarial invoices`;

/** The tile's line: what the blind run found, what the rerun after the fixes gives, and why the rerun is not the test. */
export function heldOutLine(f: HeldOutFigures): string {
  const past = f.blindPastCfo === 0 ? "none past the CFO" : `${f.blindPastCfo} past the CFO`;
  const fixed = f.after === 0
    ? `Those ${f.blind} gaps are fixed: the same ${f.cases} cases now give 0 wrong payments and ${f.afterFalseHolds} false holds.`
    : `After the fixes, the same ${f.cases} cases give ${f.after} wrong payments and ${f.afterFalseHolds} false holds.`;
  return `The blind run, with a model that always says pay, found ${payments(f.blind)} Purser's rules let through (${past}; ${f.noRules} with no rules). ${fixed} That rerun is no longer blind; the next held-out set (v${f.version + 1}) is the real test. Offline, test data.`;
}
