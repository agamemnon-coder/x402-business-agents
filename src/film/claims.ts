// The claims the film makes (the video plan's section G, 12 Nov), each with the record it comes from and the strings
// that must be found there. Every number the film says or shows belongs to one of these claims, and the tests read
// each source file and look the strings up (test/film-cuts.test.ts). A claim whose record is still on another branch
// names that file under `file`: the cut lists use their fallback words until the file is in this repository
// (src/film/cuts.ts `when`), so nothing is said before its record is here.

export interface Claim {
  id: string;
  /** What is said or shown, in short. */
  text: string;
  /** Repository paths (from the root). The first is the record; the rest back it (a page's source, a test). */
  sources: string[];
  /** Strings that must each be found in at least one source: amounts, ids, hashes, dates, labels. */
  keys: string[];
  /** Honesty notes for the cut (the wording rules of G.2 this claim carries). */
  note?: string;
}

const AWX1 = "docs/runs/2026-11-07-awx-1.md";
const MAIN = "docs/runs/2026-11-03-main-run.md";
const RECEIPT = "docs/runs/2026-11-07-awx-1/receipt-P-0002.json";

export const CLAIMS: readonly Claim[] = [
  { id: "C01", text: "Purser lets AI agents pay company bills only within limits the CFO signs with Face ID; a limit in a prompt is only a request; code checks the limit and the rails check again.", sources: ["docs/claims.md", "src/config/brand.ts"], keys: ["only within limits the CFO signs with Face ID", "A prompt is not a control"] },
  { id: "C02", text: "Claude agents propose payments; past a limit, the CFO signs the exact terms with a passkey.", sources: [MAIN, AWX1, "src/policy/approvals.ts"], keys: ["P-0005", "P-0001"] },
  { id: "C03", text: "/try/sign is a live page in a test world: no money moves; Claude Sonnet reads the invoice, Claude Opus advises on timing.", sources: ["src/try/sign.ts", "docs/claims.md"], keys: ["Test world", "nothing real moves"], note: "Use only a phone take whose labels say live." },
  { id: "C04", text: "The invoice is for EUR 1,850; no model sets the amount or the payee; code builds the terms.", sources: ["src/try/sign.ts", "worker/src/trySign.ts", "docs/claims.md"], keys: ["1,850", "no model sets an amount"] },
  { id: "C05", text: "The CFO signs the exact terms: amount, payee, IBAN, expiry.", sources: ["worker/src/trySign.ts", RECEIPT], keys: ["payee_iban", "expires_at", "iban_last4"] },
  { id: "C06", text: "The server checks the passkey signature, not the face.", sources: ["src/try/sign.ts", RECEIPT], keys: ["the server checks no attestation"] },
  { id: "C07", text: "One cent changed after signing: refused by Purser.", sources: ["src/try/sign.ts"], keys: ["Refused by Purser"] },
  { id: "C08", text: "A fake invoice with new bank details: blocked, a new IBAN needs a person's Face ID.", sources: ["worker/src/trick.ts"], keys: ["Pre-approved by the CFO", "a new IBAN needs a person"] },
  { id: "C09", text: "awx-1, 7 Nov: the owner approved P-0002 (EUR 240.00, SLL-2026-11) with Face ID at 12:12:20.250; SWIFT transfer 738a4263… PAID 6.3 s after Face ID.", sources: [AWX1], keys: ["P-0002", "240.00", "SLL-2026-11", "12:12:20.250", "738a4263", "6.3 s"] },
  { id: "C10", text: "Settlement is simulated by the sandbox.", sources: [AWX1, "docs/runs/2026-11-10-platform-e2e.md"], keys: ["/simulation/transfers/"], note: "Said or captioned wherever PAID is." },
  { id: "C11", text: "The hash the CFO signed is in Airwallex's own transfer record.", sources: [AWX1], keys: ["approval_sha256"] },
  { id: "C12", text: "Airwallex declined a simulated EUR 45.00 charge on the Sourcing card ····2441 (limit 30.00), LIMIT_EXCEEDED; the agent asked for a raise (P-0001) instead of retrying.", sources: [AWX1], keys: ["45.00", "2441", "30.00", "LIMIT_EXCEEDED", "P-0001", "/simulation/issuing/create"] },
  { id: "C13", text: "On Metal a price rise (0.02 → 0.04) went past the Sourcing mandate's 0.03 cap; our check was off once, on purpose; Metal refused purchase #24 on chain, tx 0x2e92…1871.", sources: [MAIN, "docs/claims.md"], keys: ["#24", "0.04", "0.03", "mandate_cap_exceeded", "0x2e92"], note: "Always with \"on purpose\"." },
  { id: "C14", text: "86 Metal payments in the main run, all inside the limits.", sources: ["docs/runs/2026-11-03-main-run-metal-transactions.md"], keys: ["86 Metal transactions", "3 November 2026"] },
  { id: "C15", text: "VIC via Airi, 7 Nov: EUR 12.00 paid without the CFO; EUR 45.00 over the EUR 20.00 limit paid only after Face ID; a disallowed shop refused with 0 Airi calls.", sources: ["docs/runs/2026-11-07-vic-1.md", "docs/demo/airi-run.json"], keys: ["12.00", "45.00", "20.00"] },
  { id: "C16", text: "95 of 95 main-run journal entries posted to T:0's sandbox on 10 Nov; T:0 matches line by line; a second push posted 0.", sources: ["docs/runs/2026-11-10-t0-journal-sandbox.md"], keys: ["95 of 95", "line by line"] },
  { id: "C17", text: "Moneybird sandbox (12 Nov): a test company's purchase invoices read back with 0 differences; the payment ran on a stand-in rail.", sources: ["docs/runs/2026-11-12-moneybird-sandbox.md"], keys: ["0 differences"] },
  { id: "C18", text: "The owner's real signature on P-0002 (terms hash b0f075d9…, ES256) checks in the browser; one cent changed and the check fails.", sources: [RECEIPT, "src/try/verify.ts"], keys: ["P-0002", "b0f075d9", "ES256"] },
  { id: "C19", text: "Card limits, payouts and mandates are checked by code and again by the rail.", sources: [AWX1, MAIN, "docs/runs/2026-11-10-airwallex-two-locks.md"], keys: ["LIMIT_EXCEEDED", "mandate_cap_exceeded", "IN_APPROVAL"], note: "Not \"every limit\"." },
  { id: "C20", text: "Purser Cloud demo world: three seeded test companies; inbox; one held as possible fraud; one waiting for the CFO; one paid in a foreign currency, booked, its PDF in the vault under its hash.", sources: ["docs/cloud.md"], keys: ["three seeded test companies"] },
  { id: "C20b", text: "Screenshots of a test company: the inbox, several approved at once, an Airwallex account opened through Purser.", sources: ["docs/after-the-kit.md"], keys: ["Screenshots (test company, stand-ins, test money)"] },
  { id: "C21", text: "Everything in the demo world is a stand-in: no rail and no model called, no real account.", sources: ["docs/cloud.md"], keys: ["No rail and no model is called"] },
  { id: "C22", text: "Main run, 3 Nov: 24 Claude decisions (Sourcing 11, Support 4, Treasury 9), 0 fallbacks, USD 0.3170.", sources: [MAIN], keys: ["24 decisions, 0 fallbacks", "Sourcing 11, Support 4, Treasury 9", "0.3170"] },
  { id: "C23", text: "The agent read the decline and asked for a raise.", sources: [AWX1], keys: ["read_decline", "propose_raise"] },
  { id: "C25", text: "For the EUR 1,850.00 invoice Purser bought only the missing EUR 623.50 (USD 704.45) on quote 1605354b…", sources: [AWX1], keys: ["1,850.00", "623.50", "704.45", "1605354b"] },
  { id: "C26", text: "Two locks, 10 Nov: Purser's lock a labelled test passkey; Airwallex's approval workflow held the payout 4074d684… IN_APPROVAL.", sources: ["docs/runs/2026-11-10-airwallex-two-locks.md"], keys: ["IN_APPROVAL", "4074d684"] },
  { id: "C26p", text: "Two locks, 12 Nov: the owner approved it in Airwallex's web app; then PAID, settlement simulated.", sources: ["docs/runs/2026-11-12-airwallex-two-locks-paid.md"], keys: ["PAID"] },
  { id: "C28", text: "Three mandates on chain, one per agent.", sources: [MAIN], keys: ["mandate"] },
  { id: "C29", text: "The Airi run passed on the fourth attempt that day.", sources: ["docs/runs/2026-11-07-vic-1.md"], keys: ["fourth"] },
  { id: "C30", text: "48 attacks in the test harness, each with part of the system in hostile hands; money moved in 0.", sources: ["docs/zero-trust.md", "test/zero-trust.test.ts"], keys: ["48 attacks"] },
  { id: "C32", text: "Platform run, 10 Nov: Airwallex refused 3 payouts from two new test companies (registration number); 1 payout PAID with Purser's fee, settlement simulated.", sources: ["docs/runs/2026-11-10-platform-e2e.md"], keys: ["3 payouts", "registration number", "1 payout PAID"] },
  { id: "C33", text: "Routine payments ran as plain code.", sources: ["src/redesign/partners.ts"], keys: ["routine payments by code"] },
  { id: "C34", text: "The entry: Kit 11.", sources: ["docs/claims.md"], keys: ["Kit 11"] },
];

export const claim = (id: string): Claim => {
  const c = CLAIMS.find((x) => x.id === id);
  if (!c) throw new Error(`film: no claim ${id}`);
  return c;
};
