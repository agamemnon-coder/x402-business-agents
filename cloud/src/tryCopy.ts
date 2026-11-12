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

/**
 * Screen 0. The text describes the product, never this visit: what this visit runs on is in the band, from the answer.
 * Beside it the illustration (cloud/src/scene.ts: its words are aria-hidden, the image has one name; not counted here);
 * under the card the trust line: what the product ran with in recorded sandbox and testnet runs (docs/claims.md).
 */
export const START = {
  heading: "Run a company's payables with Purser.",
  text: "AI agents check each invoice on Purser's real engine. You sign the exact terms.",
  button: "Start with a test company",
  /** Under the button. */
  fine: "Test money · deleted after 24 h",
  /** Under the card, small and grey. */
  trust: "Works with Airwallex · Metal · Visa Intelligent Commerce · Claude (sandbox and testnet runs)",
  starting: "Starting…",
  /** In the text's place when the start answer has no sentence of its own. */
  failed: "Purser could not start a test company. Try again soon.",
  /** Under the server's sentence (in the text's place) when it is busy, at its limit or paused (429, 503). */
  runs: "Watch the recorded runs",
};

/** Screen 1. One main button under both tabs files the sample picked or the invoice written. Sample titles, suppliers
 * and the server's sentences are data, not copy. */
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
  /** A calm hint under the amount when it cannot be read as an amount (nothing is sent). */
  amountBad: "Write an amount such as 1,850.00 or 10k.",
  /** The same hint for an amount past the demo's cap (the simulated bank's USD floor), as the engine says it. */
  amountCap: "Demo invoices go up to EUR 5,000.",
  send: "File this invoice",
};

/** Screen 2, outside the live panel. The invoice's status and findings are the engine's own words (data). */
export const WORK = {
  heading: "Purser reads and checks it.",
  /** While the request is in flight, over the invoice card's skeleton, by the band's mode; the open Claude call's
   * running time follows it ("2.4 s", the browser's count from the moment its asking row arrived). */
  reading: "Claude is reading…",
  readingCode: "Purser's code is reading…",
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
  /** A chip on the invoice card, with the request id, only when the events say Claude read it (claude.read, source claude). */
  claudeChip: "Claude",
  pay: "Pay this invoice",
  another: "Try another invoice",
};

/** The invoice's fields in its fold (the invoice itself: outside the word budget). */
export const INVOICE_FIELDS = { vendor: "Supplier", number: "Invoice number", total: "Amount", due: "Due", status: "Status" };

/**
 * The steps of a visit, shown small under the band on every screen after the start: one segment per step, and only the
 * current step's name in words (the others are segments, named for screen readers only). Counted in each screen's budget.
 */
export const STEPS = {
  names: { invoice: "Invoice", work: "At work", approve: "Approve", pay: "Pay", books: "Paid", company: "Company" } as Record<string, string>,
  order: ["start", "invoice", "work", "approve", "pay", "books", "company"],
  start: "Start",
  /** For screen readers: where the visit stands ({n} of {of}). */
  where: "Step {n} of {of}",
};

/**
 * Screen 3. The proposal's facts are the engine's (its labels and values: the invoice's terms, outside the budget); the
 * account ending and the due date are labelled here. {host}: the passkey's relying party; {amount}: the facts' amount;
 * {method}: the device's own word for its passkey, by a simple guess from the platform (never proven by the server).
 */
export const APPROVE = {
  heading: "Approve the payment.",
  filing: "Filing the payment…",
  terms: "Show the exact terms",
  /** Before the passkey exists, both sentences; once it exists, the first only. */
  signs: "Your passkey signs exactly these terms.",
  saves: "This saves a test passkey for {host} on this device; you can delete it afterwards.",
  create: "Create your approval passkey",
  approve: "Approve {amount} with {method}",
  waiting: "Waiting for your passkey…",
  approved: "Approved. Nothing is paid yet.",
  next: "Pay it with your signature",
  cancelled: "Nothing was signed. Try again when you are ready.",
  noPasskey: "This device cannot make a passkey here. Open this page in Safari or Chrome on your phone.",
  fileAgain: "File it again",
  failed: "Purser could not file this payment.",
};

/**
 * The terms' own labels: screen 3's rows beside the engine's facts, and screen 4's three fields (the terms: outside the
 * word budget, as the invoice's fields are).
 */
export const PROPOSAL_FIELDS = { account: "Account ending", due: "Due", amount: "Amount", payee: "Payee" };

/** The device's word for its passkey ({method} of APPROVE.approve), by a simple guess from the platform. */
export const METHOD = { ios: "Face ID", mac: "Touch ID", android: "fingerprint", windows: "Windows Hello", other: "your passkey" };

/**
 * Screen 4. The fields hold the terms the passkey signed; the visitor may change one and try to pay with the same
 * signature. Everything of the outcome is drawn from the pay route's answer, after it returned.
 */
export const PAY = {
  heading: "Pay it with your signature.",
  loading: "Loading the terms you signed…",
  line: "Your signature covers exactly these terms. Change one and try to pay, or pay them as signed.",
  /** The deadline, from the terms' expires_at ({time}: the browser's local time). */
  until: "Pay before {time}.",
  button: "Pay with my signature",
  sending: "Sending…",
  amountBad: "Digits only: 120.50",
  /** Refused: the stamp, then one row per layer that refused. */
  stamp: "Refused by Purser",
  signature: "Your signature: {reason}",
  /** When the route's reason is a code, not a sentence. */
  signatureOff: "it covers other terms",
  executor: "Purser's payment check: refused (the terms do not match what was approved)",
  executorFold: "Its own words",
  executorNote: "asked with your changed terms; nothing was kept",
  signed: "Signed",
  sent: "Sent",
  /** The verdict, computed from the signed and the sent values. */
  vAmountCent: "You changed the amount by one cent.",
  vAmount: "You changed the amount from {from} to {to}.",
  vPayee: "You changed the payee.",
  vAccount: "You changed the account ending.",
  vOther: "The terms you sent are not the ones you signed.",
  vCover: "Your signature does not cover that.",
  roundTrip: "Round trip {n} ms, measured in your browser",
  transfers: "Transfers made: {n}",
  sandbox: "Airwallex sandbox calls: {n}",
  raw: "Raw answer",
  putBack: "Put back what you signed",
  paidOnce: "These are the terms you signed. They were paid once.",
  fileAgain: "File it again",
  retry: "Try the payment again",
  failed: "Purser could not send this payment. Nothing was paid.",
};

/**
 * Screen 5. Three blocks, each drawn when its own read has returned: the payment (GET /v1/payments and
 * /v1/transactions), this invoice's journal lines (GET /v1/ledger/entries) and its files (GET /v1/engine/vault). The
 * amounts, statuses, accounts and file names are data. When the pay route's settled answer carries an error, the
 * engine's words are shown as they are, with the one button that asks the engine's retry route: nothing retries by itself.
 */
export const BOOKS = {
  heading: "Paid, booked, filed.",
  /** When settled.error is set: what failed is the engine's own words, beneath. */
  headingError: "Not everything went through.",
  paid: "Paid on the simulated bank · test money",
  /** The payment found for this invoice is not PAID (its status is beside it). */
  payment: "Payment on the simulated bank · test money",
  fee: "Fee",
  booked: "Booked in Purser's ledger",
  account: "Account",
  debit: "Debit",
  credit: "Credit",
  even: "Debits equal credits.",
  uneven: "Debits and credits differ.",
  /** The fold with the ledger chain's head (the newest entry's own hash). */
  head: "Chain head",
  filed: "Filed in the archive",
  original: "Invoice",
  receipt: "Receipt",
  /** The engine did not feed the read model (settled.fed is false): nothing of the books is shown. */
  notIn: "The books are not in yet.",
  /** A read came back without this invoice's part in it. */
  noPayment: "No payment for this invoice yet.",
  noLines: "No lines for this invoice yet.",
  noFiles: "Not in the archive yet.",
  failed: "Purser could not read this.",
  retry: "Try the payment again",
  next: "See your company",
};

/**
 * Screen 6. The export is lane C's route (GET /v1/engine/export, a JSON file); the recorded runs are links to the site's
 * /runs, in a fold, each with the date src/redesign/runs.ts gives it (RECORDED, below).
 */
export const COMPANY = {
  heading: "Your company.",
  download: "Download your company (SyncBatch)",
  line: "Purser Cloud's own sync format: your test company's invoices with their documents, payments, ledger and audit log.",
  downloading: "Downloading…",
  /** In the line's place when the export did not come back. */
  failed: "Purser could not export your company.",
  again: "Start again",
  runs: "Recorded real runs",
  recorded: "recorded {date}",
  /** What the visit did: three icons with a word each, named for screen readers by `did` (not shown: the word budget). */
  did: "What you just did",
  didFiled: "Filed",
  didSigned: "Signed",
  didPaid: "Paid",
  /** The site's proof page (PROOF_URL). */
  proof: "Proof",
};

/**
 * The recorded real runs screen 6 links to (kit11 /runs#<key>): each key and its date as src/redesign/runs.ts gives them
 * (test/try-page.test.ts holds both to that file; the Worker does not read the site's run records itself).
 */
export const RECORDED: { key: string; date: string; title: string }[] = [
  { key: "awx-1", date: "7 Nov 2026", title: "An agent's overspend, declined by Airwallex" },
  { key: "connected-1", date: "10 Nov 2026", title: "A connected-account payout" },
  { key: "t0-1", date: "10 Nov 2026", title: "The books posted to T:0" },
];

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
    [START.heading, START.text, START.button, START.fine, START.trust],
    [START.heading, START.text, START.starting, START.fine, START.trust],
    [START.heading, START.failed, START.button, START.fine, START.trust],
    [START.heading, START.runs, START.button, START.fine, START.trust],
  ],
  invoice: [
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.loading, INVOICE.send],
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.failed, INVOICE.send],
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.send],
    // An amount that cannot be read: the calm hint under the field (the owner's words, 8), over budget at its own count.
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.amountBad, INVOICE.send],
    // An amount past the demo's cap: the same hint in the cap's words (the lead's, 7), over budget at its own count.
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.amountCap, INVOICE.send],
  ],
  work: [
    [WORK.heading, WORK.reading, WORK.invoiceFold],
    [WORK.heading, WORK.readingCode, WORK.invoiceFold],
    [WORK.heading, WORK.ready, WORK.readySub, WORK.took, WORK.invoiceFold, WORK.claudeChip, WORK.pay],
    [WORK.heading, WORK.notReady, WORK.took, WORK.invoiceFold, WORK.another],
    [WORK.heading, WORK.duplicate, WORK.notReady, WORK.took, WORK.invoiceFold, WORK.another],
    [WORK.heading, WORK.noInvoice, WORK.took, WORK.another],
    [WORK.heading, WORK.failed, WORK.another],
  ],
  approve: [
    [APPROVE.heading, APPROVE.filing],
    [APPROVE.heading, APPROVE.failed, APPROVE.fileAgain],
    [APPROVE.heading, APPROVE.terms, APPROVE.signs, APPROVE.saves, APPROVE.create],
    [APPROVE.heading, APPROVE.terms, APPROVE.signs, APPROVE.saves, APPROVE.waiting],
    [APPROVE.heading, APPROVE.terms, APPROVE.signs, APPROVE.approve.replace("{method}", METHOD.windows)],
    [APPROVE.heading, APPROVE.terms, APPROVE.cancelled, APPROVE.approve.replace("{method}", METHOD.other)],
    [APPROVE.heading, APPROVE.terms, APPROVE.noPasskey],
    [APPROVE.heading, APPROVE.terms, APPROVE.approved, APPROVE.next],
  ],
  pay: [
    [PAY.heading, PAY.loading],
    [PAY.heading, PAY.line, PAY.until, PAY.button],
    [PAY.heading, PAY.line, PAY.until, PAY.amountBad, PAY.button],
    [PAY.heading, PAY.line, PAY.until, PAY.sending],
    [PAY.heading, PAY.paidOnce, PAY.button],
    [PAY.heading, PAY.fileAgain],
    [PAY.heading, PAY.failed, PAY.retry],
    // Refused: the fields stay (edits can be repeated); the line and the deadline give way to the answer.
    [PAY.heading, PAY.button, PAY.stamp, PAY.signature, PAY.signatureOff, PAY.executor, PAY.executorFold,
      PAY.signed, PAY.sent, PAY.vAmountCent, PAY.vCover, PAY.roundTrip, PAY.transfers, PAY.raw, PAY.putBack],
  ],
  books: [
    // Paid, booked and filed, all three back (the original and the receipt as two downloads).
    [BOOKS.heading, BOOKS.paid, BOOKS.fee, BOOKS.booked, BOOKS.account, BOOKS.debit, BOOKS.credit, BOOKS.even, BOOKS.head, BOOKS.filed, BOOKS.original, BOOKS.receipt, BOOKS.next],
    [BOOKS.heading, BOOKS.payment, BOOKS.fee, BOOKS.booked, BOOKS.account, BOOKS.debit, BOOKS.credit, BOOKS.uneven, BOOKS.head, BOOKS.filed, BOOKS.original, BOOKS.next],
    // A block whose part is not there yet says so in one sentence, without its heading (it claims nothing).
    [BOOKS.heading, BOOKS.noPayment, BOOKS.noLines, BOOKS.noFiles, BOOKS.next],
    [BOOKS.heading, BOOKS.failed, BOOKS.failed, BOOKS.failed, BOOKS.next],
    // The read model was not fed: one sentence for the books, the archive as the engine has it.
    [BOOKS.heading, BOOKS.notIn, BOOKS.filed, BOOKS.original, BOOKS.receipt, BOOKS.next],
    // settled.error: the engine's words (data), the retry as the main button, the next screen beside it; no blocks
    // until a payment that went through is drawn again from the retry's answer.
    [BOOKS.headingError, BOOKS.retry, BOOKS.next],
  ],
  company: [
    [COMPANY.heading, COMPANY.didFiled, COMPANY.didSigned, COMPANY.didPaid, COMPANY.download, COMPANY.line, COMPANY.again, COMPANY.proof, COMPANY.runs],
    [COMPANY.heading, COMPANY.didFiled, COMPANY.didSigned, COMPANY.didPaid, COMPANY.downloading, COMPANY.line, COMPANY.again, COMPANY.proof, COMPANY.runs],
    [COMPANY.heading, COMPANY.didFiled, COMPANY.didSigned, COMPANY.didPaid, COMPANY.download, COMPANY.failed, COMPANY.again, COMPANY.proof, COMPANY.runs],
  ],
  gone: [[GONE.heading, GONE.button]],
  ended: [[ENDED.heading, ENDED.button]],
};

/**
 * States allowed over the 45 words, each with its count and why. 2026-11-12 (B2): the refused answer of screen 4 holds
 * what lanes/page.md B2 lists for it (the stamp, one row per layer, both hashes, the verdict, the round trip, the
 * transfers, the raw answer and "Put back what you signed") beside the three fields the visitor edits; it cannot fit in
 * 45 words. Raised for that one state only, to its own count, for the lead to decide. 2026-11-12 (amounts): screen 1's
 * form with the calm amount hint ("Write an amount such as 1,850.00 or 10k.", the owner's words) is 49; both it and
 * the IBAN hint are held verbatim, so that state is raised to its count, for the lead to decide; with the cap's words
 * ("Demo invoices go up to EUR 5,000.") in its place it is 48.
 */
export const OVER_BUDGET: Record<string, number> = { "pay 7": 80, "invoice 3": 49, "invoice 4": 48 };

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
    "claude.capped": "Claude was not asked for this step. Purser's code read and decided.",
    "agent.tool": "Asked Purser's code a question and got its answer.",
    "agent.said": "Its own words, not checked yet.",
    "agent.nudged": "Reminded to finish with a decision.",
    "agent.run": "Finished its work on this step.",
    "ap.checker_decided": "The check is decided. Purser's code compared it with its own rules.",
    "ap.payer_proposed": "A way to pay was proposed. Purser's code checked it.",
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
