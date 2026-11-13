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
  { id: "C14", text: "86 Metal payments in the main run, all inside the limits.", sources: ["docs/runs/2026-11-03-main-run-metal-transactions.md", "docs/claims.md"], keys: ["86 Metal transactions", "3 November 2026", "all inside the limits"] },
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
  { id: "C33", text: "Routine payments ran as plain code.", sources: ["src/redesign/claudePage.ts"], keys: ["routine payments by code"] },
  { id: "C34", text: "The entry: Kit 11.", sources: ["docs/claims.md"], keys: ["Kit 11"] },
  // The hand-in film (13 Nov): the runs of 12 November and the product as it is deployed.
  { id: "C40", text: "Metal, 12 Nov: a passkey account (2 owners, threshold 2) checks both signatures on chain: the CFO's passkey on an iPhone with Face ID (as stated by the owner) and a second approver that is a virtual test passkey.", sources: ["docs/runs/2026-11-12-faceid-onchain.md"], keys: ["threshold 2", "iPhone (Face ID) (as stated by the owner)", "virtual test passkey", "the account checks them itself"] },
  { id: "C40r", text: "Metal, 12 Nov: the agent paid 0.05 inside the mandate; 0.06 over the 0.05 cap was refused on chain; both owners signed a cap of 0.10; the same 0.06 was paid.", sources: ["docs/runs/2026-11-12-faceid-onchain.md"], keys: ["refused on chain", "0.05 → 0.10", "the amount Metal refused before"] },
  { id: "C41", text: "Two locks, 12 Nov: the owner approved the held transfer in the Airwallex sandbox web app; then PAID, with simulated settlement.", sources: ["docs/runs/2026-11-12-airwallex-two-locks-paid.md"], keys: ["approved the transfer in the Airwallex sandbox web app", "PAID", "simulated settlement", "4074d684"] },
  { id: "C42", text: "Visa via Airi, 12 Nov (vic-3, live): EUR 45.00 above the CFO's limit, after Face ID; the terms hash in Airi's mandate and in Airwallex's PaymentIntent record, both read back; the rail chosen by Claude.", sources: ["docs/runs/2026-11-12-vic-3.md"], keys: ["45.00 EUR", "above the CFO's limit: Face ID", "Airi's mandate and in Airwallex's PaymentIntent record", "chosen by claude"] },
  { id: "C42n", text: "vic-3's negative tests: the sandbox did not refuse a credential tried on a bigger payment, or used twice; there, only Purser enforces the binding.", sources: ["docs/runs/2026-11-12-vic-3.md"], keys: ["only Purser enforces the binding here", "negative test"] },
  { id: "C43", text: "The books page: a month of a test company's 20 invoices, each read by Claude live, its account, VAT code and cost centre chosen by Claude; code checked every choice before it was booked; the books balance.", sources: ["src/redesign/booksPage.ts", "docs/runs/2026-11-13-books-month.json"], keys: ["chose its account, VAT code and cost centre", "code checked every choice before it was booked", "\"coded_by_claude\": 20", "\"balanced\": true"] },
  { id: "C44", text: "The hands-on demo: a visitor's own test company, wiped after 24 hours; test money on a simulated bank; the sample invoice is EUR 1,850; a changed cent is refused.", sources: ["docs/cloud.md", "docs/runs/2026-11-12-try-sample.json"], keys: ["24 hours", "Test money on a simulated bank", "A changed cent is refused by both", "1850.00"] },
  { id: "C45", text: "Purser Cloud's console: overview, invoices, transactions, books; it reads and manages, it never pays; payments are approved on the CFO's phone with Face ID.", sources: ["docs/cloud.md"], keys: ["The console reads and manages; it never pays", "the CFO's phone with Face ID"] },
  { id: "C46", text: "The proof page lists what Purser guarantees, who enforces each, and its evidence.", sources: ["src/redesign/proof.ts"], keys: ["What Purser guarantees"] },
  // Film v10 (13 Nov): the enterprise hand-in. Security, Purser Cloud, the hands-on demo's approval, the partners' newer runs.
  { id: "C47", text: "Zero trust: 6 layers that do not trust each other; 52 attacks in the test harness, all stopped, money moved in none; at least 2 layers must fail before a hostile payment moves.", sources: ["docs/zero-trust/report.json", "docs/zero-trust.md"], keys: ["\"attacks_run\": 52", "\"attacks_stopped\": 52", "\"attacks_where_money_moved\": 0", "\"layers\": 6", "\"min_depth\": 2", "Nothing here attacked a live rail"] },
  { id: "C48", text: "Hostile-model eval (12 Nov): a script in Claude's place made the worst tool call it could on every turn; 380 calls, 0 unsafe by the ledger's verdict; test data, no network.", sources: ["docs/evals/ap-hostile.json"], keys: ["\"calls\": 380", "\"unsafe\": 0", "makes the worst tool call it can on every turn", "No network, no key, test data only"] },
  { id: "C49", text: "Approval alerts by WhatsApp, e-mail, Slack and Teams: built and tested with a stand-in, not yet sent live (WhatsApp: built, live once Twilio keys are set); an alert never carries anything that approves.", sources: ["docs/cloud.md", "cloud/src/alerts.ts", "scripts/approval-alert-live.ts"], keys: ["built, live once Twilio keys are set", "WhatsApp", "E-mail", "Slack, Teams", "Built and tested with a stand-in; not yet sent live", "No token, code, reply word or signed link"] },
  { id: "C50", text: "Purser Cloud's Agents tab (each agent's job, Claude model, may and may not, card limits, decisions), Invoices & books, and the Tokenisation tab; shown with the demo company (made-up data, test money, read only).", sources: ["docs/cloud.md", "cloud/src/console.ts"], keys: ["GET /v1/agents", "what each may and may not do", "GET /v1/tokenisation", "Invoices & books"] },
  { id: "C51", text: "The hands-on demo's approval shows every signed term: the conversion, the bank fee's cap and the deadline to sign; an invoice already paid, sent again, is caught as a duplicate.", sources: ["cloud/src/tryCopy.ts", "test/browser/try-review.check.ts"], keys: ["Conversion", "feeCap: \"Bank fee\"", "expires: \"Sign before\"", "An invoice you already paid, sent again", "the same file again is caught"] },
  { id: "C52", text: "Airwallex payee check (12 Nov, sandbox): the payee's bank checks the name before the CFO is asked; NOT_MATCHED and PARTIAL_MATCH are refused, FULL_MATCH proceeds.", sources: ["docs/runs/2026-11-12-airwallex-payee-check.md"], keys: ["The payee's bank checks the name before the CFO is asked", "NOT_MATCHED", "FULL_MATCH"] },
  { id: "C53", text: "Airwallex batch transfer (12 Nov, sandbox, test money): one signature, one batch transfer over two invoices; signed by a labelled virtual test passkey.", sources: ["docs/runs/2026-11-12-airwallex-batch-transfer.md"], keys: ["One signature, ONE Airwallex batch transfer", "labelled virtual test passkey"] },
  { id: "C54", text: "Invoice token on Metal testnet (12 Nov, prototype): invoice SLL-2026-11 minted, financed and settled on chain; the financier is simulated; test money.", sources: ["docs/runs/2026-11-12-tokenize.md"], keys: ["Prototype. Metal testnet", "The financier is simulated", "SLL-2026-11"] },
  { id: "C55", text: "Anchor (13 Nov): the head of Purser's audit chain and books, height 701, in one Metal testnet transaction.", sources: ["docs/runs/2026-11-13-anchor.md"], keys: ["One Metal testnet transaction", "Height: 701"] },
];

export const claim = (id: string): Claim => {
  const c = CLAIMS.find((x) => x.id === id);
  if (!c) throw new Error(`film: no claim ${id}`);
  return c;
};
