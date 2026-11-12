// The words of the hands-on page at /try (cloud/src/tryPage.ts), English only, as plain constants per screen so a test
// counts them (test/try-page.test.ts): at most 45 visible words per screen outside the live panel and the invoice. The
// page's script reads them from here; it has no words of its own. This page does not use the shared catalogue
// (src/ui/i18n.ts). Honest words only: "test company", "test money", "simulated bank"; "Claude" only where Claude ran.

/** The page's frame: the brand mark. */
export const CHROME = { brand: "Purser" };

/** The band on every screen after the start; the second part follows the start answer's mode.claude. */
export const BAND = {
  line: "Your test company · test money · simulated bank",
  claudeLive: "Claude reads live",
  claudeCode: "Purser's code reads today",
};

/** Screen 0. The text describes the product, never this visit: what this visit runs on is in the band, from the answer. */
export const START = {
  heading: "Run a company's payables with Purser.",
  text: "AI agents read and check each invoice. Nothing is paid until a person signs the exact terms. Try a test company on Purser's real engine, with test money, deleted after 24 hours.",
  button: "Start with a test company",
  starting: "Starting…",
  /** In the text's place when the start answer has no sentence of its own. */
  failed: "Purser could not start a test company. Try again soon.",
  /** Under the server's sentence (in the text's place) when it is busy, at its limit or paused (429, 503). */
  runs: "Watch the recorded runs",
};

/** Screen 1. Sample titles, suppliers and the server's sentences are data, not copy. */
export const INVOICE = {
  heading: "An invoice comes in.",
  tabSample: "Pick a sample",
  tabWrite: "Write your own",
  loading: "Loading…",
  failed: "Purser could not load this. Try again.",
  supplier: "Supplier",
  invoiceNo: "Invoice number",
  amount: "Amount",
  issued: "Issued",
  due: "Due",
  iban: "IBAN",
  ibanHint: "Change the IBAN and see what Purser does",
  amountBad: "Use digits, like 120.50.",
  send: "File this invoice",
};

/** Screen 2, outside the live panel. The invoice's status and findings are the engine's own words (data). */
export const WORK = {
  heading: "Purser reads and checks it.",
  working: "Working on it…",
  ready: "Ready to pay.",
  readySub: "Nothing is paid until you sign the exact terms.",
  /** Above the engine's own words when the invoice cannot be paid as it is. */
  notReady: "Not ready to pay:",
  duplicate: "This file was filed before. Nothing was added.",
  noInvoice: "No invoice was found in it.",
  failed: "Purser could not file this invoice.",
  /** The request's round trip, measured in the browser ({s}: seconds). */
  took: "Answered in {s} s, measured in your browser.",
  invoiceFold: "The invoice",
  pay: "Pay this invoice",
  another: "Try another invoice",
};

/** The invoice's fields in its fold (the invoice itself: outside the word budget). */
export const INVOICE_FIELDS = { vendor: "Supplier", number: "Invoice number", total: "Amount", due: "Due", status: "Status" };

/** The session's renewal answered that the company is gone (410). */
export const GONE = {
  heading: "Your test company was deleted after 24 hours.",
  button: "Start again",
};

/** The session could not be renewed for another reason. */
export const ENDED = {
  heading: "This visit has ended.",
  button: "Start again",
};

/**
 * What each screen shows at once, in each of its states: the word budget is counted per state, with the brand and,
 * after the start, the band. The server's own sentences and the invoice's data are not copy.
 */
export const VISIBLE = {
  start: [
    [START.heading, START.text, START.button],
    [START.heading, START.text, START.starting],
    [START.heading, START.failed, START.button],
    [START.heading, START.runs, START.button],
  ],
  invoice: [
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.loading],
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.failed],
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.amountBad, INVOICE.send],
  ],
  work: [
    [WORK.heading, WORK.working],
    [WORK.heading, WORK.ready, WORK.readySub, WORK.took, WORK.invoiceFold, WORK.pay],
    [WORK.heading, WORK.notReady, WORK.took, WORK.invoiceFold, WORK.another],
    [WORK.heading, WORK.duplicate, WORK.notReady, WORK.took, WORK.invoiceFold, WORK.another],
    [WORK.heading, WORK.noInvoice, WORK.took, WORK.another],
    [WORK.heading, WORK.failed, WORK.another],
  ],
  gone: [[GONE.heading, GONE.button]],
  ended: [[ENDED.heading, ENDED.button]],
};

/**
 * The live panel (outside the word budget): who did a step, and one line per engine event (cloud/src/tryEvents.ts).
 * A line's {placeholders} are filled from that event's allowlisted fields only; a line whose placeholder the event
 * cannot fill gives way to the next of `<event>_why`, `<event>`, `<event>_plain`.
 */
export const LIVE = {
  allSteps: "All steps",
  /** A row's time: seconds since the request started, as the browser measured it when the row arrived. */
  at: "+{s} s",
  reader: "Reader",
  step: "Purser recorded a step.",
  /** Added to every line where money moves. */
  money: "simulated bank · test money",
  who: { claude: "Claude", code: "Purser's code", you: "You", purser: "Purser" },
  method: { passkey: "with your passkey" } as Record<string, string>,
  status: {
    blocked: "blocked", needs_review: "needs a person", needs_vendor: "waits for a new supplier", waiting_cfo: "waits for a signature",
    ready: "ready to pay", paid: "paid", rejected: "rejected", received: "received",
  } as Record<string, string>,
  ev: {
    "ap.received_why": "An invoice of {money} came in and was checked: {status}. Found: {why}.",
    "ap.received": "An invoice of {money} came in and was checked: {status}.",
    "ap.received_plain": "A document came in and was read and checked.",
    "ap.status": "The invoice is now: {status}.",
    "ap.status_plain": "The invoice changed status.",
    "ap.duplicate_document": "The same file came in again. It was already filed, so nothing was added.",
    "ap.duplicate_cleared": "You confirmed the invoice is not a duplicate.",
    "ap.credit_accepted": "You accepted a credit note of {money}.",
    "ap.credit_accepted_plain": "You accepted a credit note.",
    "ap.review_note": "A note for a person was added to the invoice.",
    "ap.reading_not_used": "A model's reading did not match the document, so Purser's own reading was used.",
    "ap.scan_read": "A scanned invoice was read ({pages} pages).",
    "ap.scan_read_plain": "A scanned invoice was read.",
    "ap.sink_failed": "The entry could not be sent to the bookkeeping package.",
    "ap.attachment_refused": "An e-mail attachment was refused and not filed.",
    "ap.email_attachments_capped": "An e-mail had too many attachments. The others were not filed.",
    "ap.email_without_pdf": "An e-mail came in with no invoice attached.",
    "payee.add_requested": "A new supplier account was put forward. It is checked first.",
    "payee.add_verified": "You checked the new supplier account.",
    "payee.add_closed": "The request to add a supplier account was closed without approval.",
    "payee.adopted": "The supplier's account was already at the simulated bank. None was added.",
    "payee.added": "The supplier's account was added at the simulated bank.",
    "claude.read": "answered live. Its answer was used.",
    "claude.fallback": "Read by Purser's code. No model answer was used.",
    "claude.rejected": "Its answer did not pass Purser's check and was not used.",
    "claude.asking": "asking…",
    "document.injection_flagged": "The document holds text that tries to give instructions. It was flagged and not followed.",
    "passkey.enrolment_opened": "A short window opened to set up the approval passkey.",
    "passkey.pending": "A new passkey came in. It waits to be confirmed.",
    "passkey.enrolled": "You set up the approval passkey.",
    "passkey.revoked": "An earlier passkey was replaced and no longer works.",
    "passkey.refused": "A passkey signature was refused. Nothing was approved.",
    "passkey.enrol_refused": "Setting up a passkey was refused.",
    "passkey.enrol_conflict": "Two passkeys came in for one setup. Both were dropped.",
    "proposal.created": "The payment was filed for approval. Nothing is paid before a person signs.",
    "proposal.approved": "You approved the exact terms {method}.",
    "proposal.approved_plain": "You approved the exact terms.",
    "proposal.rejected": "You rejected the payment {method}. Nothing is paid.",
    "proposal.rejected_plain": "You rejected the payment. Nothing is paid.",
    "proposal.cosigned": "The first of two signatures is in. A second person must sign too.",
    "proposal.executing": "The approved terms were checked once more. Paying has started.",
    "proposal.executed": "The approved payment was carried out.",
    "proposal.failed": "Carrying out the approved payment failed.",
    "proposal.expired": "The payment ran out of time before it was approved.",
    "proposal.needs_reapproval": "Something changed after the approval. It must be approved again.",
    "proposal.superseded": "A newer payment request took the place of this one.",
    "approval.too_late": "An approval came after the terms ran out. Nothing was approved.",
    "hub.gate_refused": "A last check before paying said no. Nothing was paid.",
    "treasury.seeded": "The test company's account was filled with {money}.",
    "treasury.seeded_plain": "The test company's account was filled.",
    "invoice.escalated": "The payment could not be planned. A person looks at it.",
    "invoice.fraud_suspected": "The invoice looks like fraud. It was blocked before anything was paid.",
    "fx.rate_checked": "The exchange rate was compared with the market rate.",
    "fx.converted": "Currency was exchanged: {money} bought.",
    "fx.converted_plain": "Currency was exchanged.",
    "fx.adopted": "An earlier exchange of {money} was found and used. No second one was made.",
    "fx.adopted_plain": "An earlier exchange was found and used. No second one was made.",
    "transfer.created": "A payment of {money} was sent.",
    "transfer.created_plain": "A payment was sent.",
    "transfer.adopted": "An earlier payment of {money} was found and used. No second one was sent.",
    "transfer.adopted_plain": "An earlier payment was found and used. No second one was sent.",
    "transfer.status": "The payment is now: {status}.",
    "transfer.status_plain": "The bank reported where the payment stands.",
    "transfer.awaiting_airwallex_approval": "The payment waits for an approval at the bank.",
    "transfer.fee": "A bank fee of {money} was charged.",
    "transfer.fee_plain": "A bank fee was charged.",
    "transfer.fee_over_reserve": "The fee of {money} is more than was set aside. A person looks at it.",
    "transfer.fee_over_reserve_plain": "The fee is more than was set aside. A person looks at it.",
    "transfer.fee_over_ceiling": "The fee of {money} is above the approved maximum. A person looks at it.",
    "transfer.fee_over_ceiling_plain": "The fee is above the approved maximum. A person looks at it.",
    "transfer.refused": "The bank refused the payment of {money}. Nothing was sent.",
    "transfer.refused_plain": "The bank refused the payment. Nothing was sent.",
    "transfer.ambiguous": "The bank's answer was unclear. The payment was looked up, so it is never sent twice.",
    "transfer.left_open": "It is not clear yet whether the payment was sent. The next run looks first.",
    "transfer.retry": "Sending the payment did not work. It is tried again while the approved terms allow it.",
    "transfer.retry_stopped": "The payment is not tried again: a check said no.",
    "transfer.payee_unconfirmed": "It was not confirmed who receives the payment. A person checks it.",
    "transfer.row_conflict": "Two records point at one payment. A person checks it.",
    "transfer.follow_failed": "Where the payment stands could not be read. It is read again later.",
    "transfer.found_after_close": "An earlier payment for this invoice was found. It is not paid twice.",
    "platform_fee.taken": "Purser's fee of {money} was taken with the payment.",
    "platform_fee.taken_plain": "Purser's fee was taken with the payment.",
    "platform_fee.not_taken": "Purser's fee is off. The payment carried no fee for Purser.",
    "platform_fee.open": "The payment is paid, but Purser's fee was not reported with it.",
    "platform_fee.mismatch": "Another fee was taken than the approved one. A person checks it.",
    "platform_fee.void": "The payment did not go through, so no fee is owed.",
    "batch.partly_paid": "{paid} of {of} payments in the batch were paid.",
    "batch.partly_paid_plain": "Part of the batch was paid.",
    "batch.line_removed": "You took one payment out of the batch.",
    "vault.filed": "New files in the archive: {files}.",
    "vault.filed_plain": "The archive was brought up to date.",
    "vault.failed": "Filing in the archive failed.",
  } as Record<string, string>,
};
