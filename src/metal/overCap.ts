// The over-the-cap step of `npm run passkey-owners` (Metal Award, 15 Nov): the agent asks to pay one cent more than
// its mandate's cap, under the mandate both passkeys bound. Alta must refuse it on chain; a payment that went through,
// or a refusal with no transaction, is UNEXPECTED (the record says so; it never reads as a refusal on chain).

import type { PullResult } from "./pull.js";

/** The amount the step asks for: the mandate's cap plus one cent. */
export const overCapCents = (capCents: number) => capCents + 1;

const money = (cents: number) => (cents / 100).toFixed(2);

/** The step's row for the run record: [step, outcome, tx, detail]. */
export function overCapRow(capCents: number, r: PullResult): { step: string; outcome: "refused on chain" | "refused" | "done" | "pending"; tx: string | null; detail: string } {
  const step = `the agent asks to pay ${money(overCapCents(capCents))}, over the mandate's ${money(capCents)} cap`;
  if (r.outcome === "REFUSED" && r.tx) return { step, outcome: "refused on chain", tx: r.tx, detail: `Alta refused it on chain${r.reason ? `: ${r.reason}` : ""}; nothing moved` };
  if (r.outcome === "REFUSED") return { step, outcome: "refused", tx: null, detail: `UNEXPECTED: refused with no transaction${r.reason ? ` (${r.reason})` : ""}, so not a refusal on chain` };
  if (r.outcome === "PAID") return { step, outcome: "done", tx: r.tx, detail: "UNEXPECTED: paid over the cap" };
  return { step, outcome: "pending", tx: r.tx, detail: `UNEXPECTED: ${r.outcome.toLowerCase()}` };
}
