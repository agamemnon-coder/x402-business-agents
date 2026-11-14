// The words of the hands-on page at /try (cloud/src/tryPage.ts), English only, as plain constants per screen so a test
// counts them (test/try-page.test.ts): at most 45 visible words per screen outside the live panel and the invoice. The
// page's script reads them from here; it has no words of its own. This page does not use the shared catalogue
// (src/ui/i18n.ts). Honest words only: "test company", "test money", "simulated bank"; "Claude" only where Claude ran.

import { TWIN_DAYS, UNUSUAL_FACTOR } from "../../src/config/checkNumbers.js";

/**
 * The page's frame: the brand mark.
 *
 * 12 Nov 2026 (owner): the frame is now the site's own header (cloud/src/siteHeader.ts): the brand and the menu, Home,
 * Try, Proof and More. Its brand word stays counted here, as before; its menu words are left out of the budget: they are
 * the site's navigation, identical on every page of the site and of Purser Cloud, not this page's copy. Counted, they
 * would put 14 screen states over 45 (4 more words each) for no word of the demo's own.
 */
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
  /**
   * Under the button, first (jury review, 13 Nov): what the visit is and how long. "Your passkey", not "Face ID": the flow
   * signs with the device's own passkey (Face ID, Touch ID or Windows Hello, by device), so Face ID alone is not true.
   */
  what: "About 2 minutes: read an invoice, sign it with your passkey, see it booked.",
  /** Under the button. */
  fine: "Test money · deleted after 24 h",
  /** Under that, small: the walkthrough on YouTube (its address is FILM_URL, src/config/brand.ts, sent as `film`; 13 Nov). */
  walk: "Or watch the walkthrough",
  /** Under the card, small and grey. */
  trust: "Works with Airwallex · Metal · Visa via Airwallex Airi · Claude (sandbox and testnet runs)",
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
  /** Under the form, calmly, when the suppliers could not be read; the link reads them again. */
  suppliersFailed: "Suppliers not loaded.",
  retry: "Retry",
  /**
   * The same hint for an amount outside the demo's range, as the engine says it: up to the simulated bank's USD floor, and
   * from EUR 100, so the bank's flat transfer fee (EUR 13.40) stays in proportion to the invoice (owner, 13 Nov).
   */
  amountCap: "Demo invoices go from EUR 100 to EUR 5,000.",
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
  /** 14 Nov: an invoice that cannot be paid as it is says why (WHY, below), in place of "Not ready to pay:" and the list. */
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

/**
 * Why Purser holds or refuses (14 Nov, owner and a tester): every hold says why, big and first, before any detail. One
 * entry per finding code the engine can return (src/ap/checkerCore.ts and the inbox's own), and nowhere else: `head` is
 * the headline, `rule` the check in one line, as the code does it (its numbers are the code's own constants). The
 * evidence beside it is data: the invoice's fields, the earlier invoice it matches, what is on file. The engine's own
 * sentence stays in the fold. test/try-why.test.ts holds one test per code.
 */
export const WHY = {
  /** The fold under the reason: the engine's own words, then the invoice. */
  more: "Show the details",
  /** The side-by-side's labels. */
  thisOne: "This invoice",
  earlier: "Filed before",
  earlierPaid: "Paid before",
  onInvoice: "On the invoice",
  onFile: "On file",
  notOnFile: "Not among your suppliers",
  /** An invoice's line: {vendor} its supplier, {no} its number, {money} its total, {date} the day it was paid or dated. */
  paidOn: "{vendor} · {no} · {money} · paid {date}",
  issuedOn: "{vendor} · {no} · {money} · dated {date}",
  /** The same file again: {sha} the start of its SHA-256, the fingerprint it was known by. */
  sameFile: "The same file, fingerprint {sha}…",
  /** The same file again (the upload's kind duplicate_document): matched by its SHA-256 before it is read. */
  again: { head: "Held: this invoice was already paid.", headFiled: "Held: this invoice was already filed.", rule: "The same file again is known by its fingerprint: a second copy is never paid." },
  /** A finding whose code is not below: the engine's words are the reason. */
  other: { head: "Held: a person must look." },
  codes: {
    duplicate: { head: "Held: this invoice was already filed.", headPaid: "Held: this invoice was already paid.", rule: "The same supplier and the same invoice number: a second copy is never paid." },
    possible_duplicate: {
      head: "Held: this may be an invoice already filed.", headPaid: "Held: this may be an invoice already paid.",
      rule: `The same supplier and the same total within ${TWIN_DAYS} days: likely the same invoice under another number, so a person must look.`,
      ruleLoose: "The same supplier and the invoice number written differently: a person checks it is not the same invoice.",
    },
    rejected_before: { head: "Held: a person rejected this invoice before.", rule: "A copy of a rejected invoice goes back to a person." },
    possible_fraud: { head: "Held: the payee does not match the supplier on file.", rule: "Nothing is paid until a person checks with the supplier on a number already on file." },
    bank_details_changed: { head: "Held: the bank details changed." },
    account_name_mismatch: { head: "Held: the account holder is not the supplier." },
    lookalike_vendor: { head: "Held: the name only looks like a supplier on file." },
    mixed_scripts: { head: "Held: the supplier's name mixes alphabets." },
    new_supplier: { head: "Held: this supplier is not on file yet.", rule: "A new supplier is paid only after a person verifies its bank details with the supplier and the CFO approves it." },
    sum_mismatch: { head: "Held: the total is not its lines.", rule: "The subtotal plus tax must equal the total, to the cent." },
    iban_invalid: { head: "Refused: the IBAN is not valid.", rule: "An IBAN that fails its checksum is never paid to." },
    bank_details_invalid: { head: "Refused: the bank details are not valid.", rule: "Bank details that fail their checks are never paid to." },
    no_bank_details: { head: "Held: no account to pay to.", rule: "Without an IBAN or account number, a person checks how this supplier is paid." },
    payee_blocked: { head: "Refused: this supplier is blocked.", rule: "A supplier the CFO's policy blocks is never paid." },
    account_currency: { head: "Held: the currency is not the account's.", rule: "A supplier's account on file receives one currency; a person checks which to pay." },
    currency_not_paid: { head: "Held: Purser does not pay this currency.", rule: "Purser pays two-decimal currencies that SWIFT carries; a person pays this one by hand." },
    unusual_amount: { head: "Flagged: an unusual amount.", rule: `More than ${UNUSUAL_FACTOR} times the median of this supplier's earlier invoices is flagged.` },
    overdue: { head: "Flagged: the due date has passed.", rule: "The due date is checked against today." },
    bank_change_language: { head: "Flagged: the invoice announces a new bank.", rule: "Such words are evidence for the person who verifies; they never speed up a payment." },
    pressure_language: { head: "Flagged: the invoice pushes for speed.", rule: "Such words are evidence for the person who verifies; they never speed up a payment." },
    missing_fields: { head: "Held: something on the invoice could not be read.", rule: "An invoice is paid only when every field it needs is read." },
    no_text: { head: "Held: no text could be read.", rule: "A document Purser cannot read goes to a person." },
    ambiguous_total: { head: "Held: the total is not clear.", rule: "When the page shows more than one total, a person decides." },
    credit_note: { head: "Held: this is a credit note.", rule: "A credit note is never paid; a person sets it against the supplier's invoices." },
    reminder: { head: "Held: this is a payment reminder.", rule: "A reminder is never paid on its own." },
    receipt: { head: "Held: this is a receipt.", rule: "A receipt is for a payment already made: nothing to pay." },
    not_an_invoice: { head: "Held: this is not an invoice.", rule: "Only invoices are paid; a person looks at anything else." },
    read_from_scan: { head: "Held: read from a scan.", rule: "A scan is paid only when two independent readings agree on every field." },
    checker_hold: { head: "Held: the Checker agent asks a person to look.", rule: "An agent may hold an invoice; it can never let through what the code stops." },
    checker_reject: { head: "Held: the Checker agent says not as it is.", rule: "An agent may stop an invoice; a person makes the final call." },
    payment_not_planned: { head: "Held: the payment could not be planned.", rule: "A payment is filed for approval only when it can be planned." },
    payment_planned_later: { head: "Planned for later.", rule: "The payment is planned for its due day." },
  } as Record<string, { head: string; headPaid?: string; rule?: string; ruleLoose?: string }>,
};

/**
 * The tampered payment's answer on screen 4 (14 Nov): the reason first, then what was signed beside what was asked,
 * the changed field marked, one plain line, and the fingerprints and each layer's words folded under "Show the proof".
 */
export const TAMPER = {
  head: "Refused: the terms changed after you signed.",
  signed: "You signed",
  asked: "Payment asked",
  /** {method}: the device's word for its passkey (METHOD). */
  line: "{method} signs the exact terms. Change one cent and the signature no longer matches, so nothing is paid.",
  proof: "Show the proof",
};

/** The invoice's fields in its fold (the invoice itself: outside the word budget). */
export const INVOICE_FIELDS = { vendor: "Supplier", number: "Invoice number", total: "Amount", due: "Due", status: "Status" };

/**
 * When this browser cannot make or use a passkey (no WebAuthn, or it refused at once without showing a prompt), 14 Nov:
 * the page says to open it in Safari or Chrome (APPROVE.noPasskey) and offers its address to copy. No guess from the
 * user agent: only what the browser itself answers.
 */
export const OPEN = {
  copy: "Copy link",
  copied: "Link copied",
};

/**
 * The steps of a visit, shown small under the band on every screen after the start: one segment per step, and only the
 * current step's name in words (the others are segments, named for screen readers only). Counted in each screen's budget.
 * 14 Nov (tester: "what are the other dots at the top?"): every dot carries its word, small, the current one marked; the
 * seven words are a fixed legend, outside each screen's count.
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
  /** While the terms are prepared ({method}: the device's word for its passkey). Nothing is signed or paid yet. */
  filing: "Preparing the terms for {method}…",
  terms: "Show the exact terms",
  /** In the fold, above the terms (pretty-printed): what the passkey signs. */
  termsNote: "Your passkey signs the SHA-256 of these fields, written as canonical JSON.",
  /** Before the passkey exists, both sentences; once it exists, the first only. */
  signs: "Your passkey signs exactly these terms.",
  saves: "This saves a test passkey for {host} on this device; you can delete it afterwards.",
  create: "Create your approval passkey",
  approve: "Approve {amount} with {method}",
  /** On the button, each only while its step runs: the browser's passkey prompt is open, finish runs, approve runs. */
  waiting: "Waiting for your passkey…",
  saving: "Saving your passkey…",
  approving: "Approving…",
  /** Under the button when a request is still out after 30 s (screens 3 and 4). */
  slow: "This is taking longer than usual.",
  /** The approval's held answer: shown as it comes back, while the pay call (in the same tap) runs. */
  approved: "Approved. Nothing is paid yet.",
  cancelled: "Nothing was signed. Try again when you are ready.",
  noPasskey: "This device cannot make a passkey here. Open this page in Safari or Chrome on your phone.",
  /** The passkey's prompt gave no answer in 30 s (in-app browsers can leave it open without showing it): given up. */
  timeout: "Your passkey did not answer.",
  /** The main button after a passkey failed or timed out, or when this browser has none: never a dead end. */
  again: "Try again",
  /**
   * Tester, 14 Nov: "is the limit per transaction or a total?" Here, every supplier invoice waits for the CFO: the
   * agents have no amount they may pay alone (src/ap/checks.ts, policy.aloneLimit: null). Said where the approval is.
   */
  limit: "Every invoice waits for your signature here, whatever its amount.",
  fileAgain: "File it again",
  failed: "Purser could not file this payment.",
};

/**
 * The terms' own labels: screen 3's rows beside the engine's facts, and screen 4's three fields (the terms: outside the
 * word budget, as the invoice's fields are).
 */
export const PROPOSAL_FIELDS = {
  account: "Account ending", due: "Due", amount: "Amount", payee: "Payee",
  /**
   * try-fixes, 13 Nov: every signed term in words. {sell}, {buy}: amounts; {rate}: the quote's rate; {money}: the cap.
   * final-polish, 13 Nov: the engine converts only the EUR shortfall (needed minus free EUR, src/policy/treasury.ts), so the
   * row says how much of the payment that part is and what it costs in USD.
   */
  fx: "Conversion", fxLine: "{buy} of it funded from the USD balance ({sell} at {rate})", feeCap: "Bank fee", feeLine: "at most {money}", expires: "Sign before",
};

/** The device's word for its passkey ({method} of APPROVE.approve), by a simple guess from the platform. */
export const METHOD = { ios: "Face ID", mac: "Touch ID", android: "fingerprint", windows: "Windows Hello", other: "your passkey" };

/**
 * The pay call. Screen 3 sends it in the approval's tap with the terms as signed ("Paying…" on its button; its other
 * outcomes in these words). Screen 4, reached after paid from screen 5's link, holds the terms the passkey signed in
 * fields; the visitor may change one and try to pay with the same signature. Everything of the outcome is drawn from
 * the pay route's answer, after it returned.
 */
export const PAY = {
  heading: "Pay it with your signature.",
  loading: "Loading the terms you signed…",
  /** final-polish, 13 Nov: the screen leads with what to do; it is shown above the fields. */
  line: "These are the terms you signed. Change one and press Pay.",
  /** Screen 4 comes after paid: a quiet line under the fields, not an error (final-polish, 13 Nov). */
  already: "This invoice is already paid.",
  /** Screen 4's quiet link back to screen 5. */
  back: "Back",
  button: "Pay with my signature",
  /** On the button while the pay request runs (with the ring). */
  paying: "Paying…",
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
  /** Beside the fee: where it comes from (src/redteam/airwallex.ts SANDBOX_SWIFT_FEE_CENTS, measured in the sandbox). */
  feeWhy: "the simulated bank's flat SWIFT fee",
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
  /**
   * A quiet link: Purser Cloud's guest dashboard, a sample company read only (cloud/src/try/books.ts CLOUD_URL), never
   * the visitor's own test company (a try company cannot sign in to Purser Cloud), and the note under it says so.
   */
  next: "See a sample company in Purser Cloud",
  cloudNote: "A demo company, read only: not your test company.",
  /** The main button: another invoice, in this same test company. */
  another: "File another invoice",
  /** For screen readers, on a block's skeleton while its reads run. */
  loading: "Loading",
  /** On a phone each ledger line stacks: its side in a word before the amount. */
  dr: "Dr", cr: "Cr",
  /** Under it: this visit's own record, screen 5b ("What Purser did with it"). */
  what: "What Purser did",
  /** A quiet link under the main button, to screen 4's fields. */
  cheat: "Try changing what you signed",
};

/**
 * Screen 6. The export is lane C's route (GET /v1/engine/export, a JSON file); the recorded runs are links to the site's
 * /runs, in a fold, each with the date src/redesign/runs.ts gives it (RECORDED, below).
 */
export const COMPANY = {
  heading: "Your company.",
  download: "Download your test company's records",
  /** 14 Nov (owner): the main download is a PDF a person reads (GET /v1/engine/export.pdf); the JSON is a quiet link. */
  line: "A PDF: each invoice's trail, the journal, the audit log.",
  json: "Download as JSON (for developers)",
  downloading: "Downloading…",
  /** In the line's place when the export did not come back. */
  failed: "Purser could not export your company.",
  again: "Start again",
  /** Start again asks first. */
  againAsk: "Start again with a new test company? This tab forgets this one.",
  againYes: "Yes, start again",
  againNo: "Keep this company",
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
    [START.heading, START.text, START.button, START.what, START.fine, START.walk, START.trust],
    [START.heading, START.text, START.starting, START.what, START.fine, START.walk, START.trust],
    [START.heading, START.failed, START.button, START.what, START.fine, START.walk, START.trust],
    [START.heading, START.runs, START.button, START.what, START.fine, START.walk, START.trust],
  ],
  invoice: [
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.loading, INVOICE.send],
    // H3 (12 Nov): the samples did not load: the calm line and its retry, the button off.
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.failed, INVOICE.retry, INVOICE.send],
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.send],
    // The suppliers did not load: the calm line and its retry, the button off.
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.suppliersFailed, INVOICE.retry, INVOICE.send],
    // An amount that cannot be read: the calm hint under the field (the owner's words, 8), over budget at its own count.
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.amountBad, INVOICE.send],
    // An amount past the demo's cap: the same hint in the cap's words (the lead's, 7), over budget at its own count.
    [INVOICE.heading, INVOICE.tabSample, INVOICE.tabWrite, INVOICE.supplier, INVOICE.invoiceNo, INVOICE.amount, INVOICE.issued, INVOICE.due, INVOICE.iban, INVOICE.ibanHint, INVOICE.amountCap, INVOICE.send],
  ],
  work: [
    [WORK.heading, WORK.reading, WORK.invoiceFold],
    [WORK.heading, WORK.readingCode, WORK.invoiceFold],
    [WORK.heading, WORK.ready, WORK.readySub, WORK.took, WORK.invoiceFold, WORK.claudeChip, WORK.pay],
    // 14 Nov (owner): held or refused, the reason first. The values beside the labels are data (the invoice, the earlier
    // one, what is on file), and so is the engine's own sentence; the fold (WHY.more) is closed. The five samples' answers:
    // the same file again; the paid invoice under a new number; new bank details; a new supplier; and a check with no
    // side by side (its engine sentence in its place), e.g. a total that is not its lines.
    [WORK.heading, WHY.again.head, WHY.earlierPaid, WHY.paidOn, WHY.thisOne, WHY.sameFile, WHY.again.rule, WHY.more, WORK.another],
    [WORK.heading, WHY.codes.possible_duplicate!.headPaid!, WHY.earlierPaid, WHY.paidOn, WHY.thisOne, WHY.issuedOn, WHY.codes.possible_duplicate!.rule!, WHY.more, WORK.another],
    [WORK.heading, WHY.codes.bank_details_changed!.head, WHY.onInvoice, WHY.onFile, WHY.codes.possible_fraud!.rule!, WHY.more, WORK.another],
    [WORK.heading, WHY.codes.new_supplier!.head, WHY.onInvoice, WHY.onFile, WHY.notOnFile, WHY.codes.new_supplier!.rule!, WHY.more, WORK.another],
    [WORK.heading, WHY.codes.sum_mismatch!.head, WHY.codes.sum_mismatch!.rule!, WHY.more, WORK.another],
    [WORK.heading, WORK.noInvoice, WORK.took, WORK.another],
    [WORK.heading, WORK.failed, WORK.another],
  ],
  approve: [
    [APPROVE.heading, APPROVE.filing],
    [APPROVE.heading, APPROVE.failed, APPROVE.fileAgain],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.saves, APPROVE.create],
    // The fold open: what the passkey signs, above the terms (the terms themselves are data).
    [APPROVE.heading, APPROVE.terms, APPROVE.termsNote, APPROVE.signs, APPROVE.create],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.saves, APPROVE.waiting],
    // Saving: the passkey is made on the device, so the sentence that it will be saved gives way.
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.saving, APPROVE.slow],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.approving, APPROVE.slow],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.approve.replace("{method}", METHOD.windows)],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.cancelled, APPROVE.approve.replace("{method}", METHOD.other)],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.noPasskey, APPROVE.again, OPEN.copy, OPEN.copied],
    // One tap: the approval's held answer, then the pay call with the ring (the rail on Pay); its other outcomes.
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.approved, PAY.paying, APPROVE.slow],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.approved, PAY.failed, PAY.retry],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, PAY.paidOnce, BOOKS.next],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, PAY.failed, APPROVE.fileAgain],
    // 14 Nov: a passkey that failed, was cancelled or gave no answer: a plain line and Try again; refused at once (no
    // prompt was shown): "open this page in Safari or Chrome" and its address to copy.
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.cancelled, APPROVE.again],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.noPasskey, APPROVE.again, OPEN.copy],
    [APPROVE.heading, APPROVE.limit, APPROVE.terms, APPROVE.signs, APPROVE.timeout, APPROVE.again],
  ],
  pay: [
    [PAY.heading, PAY.loading],
    [PAY.heading, PAY.line, PAY.already, PAY.button, PAY.back],
    [PAY.heading, PAY.line, PAY.already, PAY.amountBad, PAY.button, PAY.back],
    [PAY.heading, PAY.line, PAY.already, PAY.paying, APPROVE.slow, PAY.back],
    [PAY.heading, PAY.line, PAY.already, PAY.paidOnce, PAY.button, PAY.back],
    [PAY.heading, PAY.line, PAY.already, PAY.fileAgain, PAY.back],
    [PAY.heading, PAY.line, PAY.already, PAY.failed, PAY.retry, PAY.back],
    // Refused: the fields stay (edits can be repeated); the line and the deadline give way to the answer.
    // 14 Nov (owner): the reason first, signed beside asked, one plain line, the transfers; the stamp, the layers, the
    // fingerprints, the verdict, the round trip and the raw answer are in the closed fold (TAMPER.proof).
    [PAY.heading, PAY.button, TAMPER.head, TAMPER.signed, PROPOSAL_FIELDS.amount, TAMPER.asked, PROPOSAL_FIELDS.amount,
      TAMPER.line.replace("{method}", METHOD.ios), PAY.transfers, TAMPER.proof, PAY.putBack, PAY.back],
    // The same, its fold open: the stamp, one row per layer, both fingerprints, the verdict, the round trip, the raw answer.
    [PAY.heading, PAY.button, TAMPER.head, TAMPER.signed, PROPOSAL_FIELDS.amount, TAMPER.asked, PROPOSAL_FIELDS.amount,
      TAMPER.line.replace("{method}", METHOD.ios), PAY.transfers, TAMPER.proof, PAY.stamp, PAY.signature, PAY.signatureOff, PAY.executor, PAY.executorFold,
      PAY.signed, PAY.sent, PAY.vAmountCent, PAY.vCover, PAY.roundTrip, PAY.raw, PAY.putBack, PAY.back],
  ],
  books: [
    // Paid, booked and filed, all three back (the original and the receipt as two downloads).
    [BOOKS.heading, BOOKS.paid, BOOKS.fee, BOOKS.feeWhy, BOOKS.booked, BOOKS.account, BOOKS.debit, BOOKS.credit, BOOKS.dr, BOOKS.cr, BOOKS.even, BOOKS.head, BOOKS.filed, BOOKS.original, BOOKS.receipt, BOOKS.another, BOOKS.what, BOOKS.cheat, BOOKS.next, BOOKS.cloudNote],
    [BOOKS.heading, BOOKS.payment, BOOKS.fee, BOOKS.feeWhy, BOOKS.booked, BOOKS.account, BOOKS.debit, BOOKS.credit, BOOKS.uneven, BOOKS.head, BOOKS.filed, BOOKS.original, BOOKS.another, BOOKS.what, BOOKS.cheat, BOOKS.next, BOOKS.cloudNote],
    // While the blocks' reads run: a skeleton each, named for screen readers.
    [BOOKS.heading, BOOKS.loading, BOOKS.another, BOOKS.what, BOOKS.cheat, BOOKS.next, BOOKS.cloudNote],
    // A block whose part is not there yet says so in one sentence, without its heading (it claims nothing).
    [BOOKS.heading, BOOKS.noPayment, BOOKS.noLines, BOOKS.noFiles, BOOKS.another, BOOKS.what, BOOKS.cheat, BOOKS.next, BOOKS.cloudNote],
    [BOOKS.heading, BOOKS.failed, BOOKS.failed, BOOKS.failed, BOOKS.another, BOOKS.what, BOOKS.cheat, BOOKS.next, BOOKS.cloudNote],
    // The read model was not fed: one sentence for the books, the archive as the engine has it.
    [BOOKS.heading, BOOKS.notIn, BOOKS.filed, BOOKS.original, BOOKS.receipt, BOOKS.another, BOOKS.what, BOOKS.cheat, BOOKS.next, BOOKS.cloudNote],
    // settled.error: the engine's words (data), the retry as the main button, the next screen beside it; no blocks
    // until a payment that went through is drawn again from the retry's answer.
    [BOOKS.headingError, BOOKS.retry, BOOKS.what],
  ],
  company: [
    [COMPANY.heading, COMPANY.didFiled, COMPANY.didSigned, COMPANY.didPaid, COMPANY.download, COMPANY.line, COMPANY.again, COMPANY.proof, COMPANY.json, COMPANY.runs],
    [COMPANY.heading, COMPANY.didFiled, COMPANY.didSigned, COMPANY.didPaid, COMPANY.downloading, COMPANY.line, COMPANY.again, COMPANY.proof, COMPANY.json, COMPANY.runs],
    [COMPANY.heading, COMPANY.didFiled, COMPANY.didSigned, COMPANY.didPaid, COMPANY.download, COMPANY.failed, COMPANY.again, COMPANY.proof, COMPANY.json, COMPANY.runs],
    // Start again asks first: the question and its two answers in place of the button.
    [COMPANY.heading, COMPANY.didFiled, COMPANY.didSigned, COMPANY.didPaid, COMPANY.download, COMPANY.line, COMPANY.againAsk, COMPANY.againYes, COMPANY.againNo, COMPANY.proof, COMPANY.json, COMPANY.runs],
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
 * the IBAN hint are held verbatim, so that state is raised to its count, for the lead to decide; with the range's words
 * ("Demo invoices go from EUR 100 to EUR 5,000.") in its place it is 50.
 */
// 12 Nov (one-tap pay): screen 4 now comes after paid, so its states carry "Already paid." and a link back ("pay 4"
// paid once, "pay 6" failed with retry, "pay 7" refused); screen 5 carries the link to it ("books 0", "books 1").
// 13 Nov (owner): screen 5 says where the fee comes from ("the simulated bank's flat SWIFT fee") and has two ways on,
// "Open Purser Cloud" (its guest dashboard) and "What Purser did" (screen 5b): "books 0" and "books 1" are 59.
// Each is pinned at its exact count.
// try-fixes (13 Nov): screen 2 names the paid original a duplicate copies ("work 4"); screen 5 adds "File another
// invoice", the ledger's Dr/Cr on a phone, and says under the Cloud link that it is a sample company (the review's
// finding 2): every state of screen 5 but the loading one is over 45 ("books 0" to "books 5"); screen 6's Start again
// asks first ("company 3"). Each pinned at its exact count, for the lead to decide.
// 14 Nov (owner): screen 6 downloads a PDF and offers the JSON as a quiet link ("company 3" 58 to 60).
// The start screen: +14 words for START.what (jury review, 13 Nov: what the visit is and how long, under the button),
// and +5 for the walkthrough link (on YouTube; 13 Nov, owner; "Or watch the walkthrough", +4 since 14 Nov: no duration).
// Screen 4 (final-polish, 13 Nov): its lead line is shorter, so "pay 4" and "pay 6" are lower.
// 14 Nov (a tester's questions): the approval says the limit plainly ("Every invoice waits for your signature here,
// whatever its amount.", +10 words), so its states with the terms are pinned at their counts.
// 14 Nov (owner, after a tester's run): a hold or a refusal says why, big and first, with the evidence and the rule from
// the code (WHY, TAMPER). Screen 2's held answers carry the headline, the side by side's labels and lines (their
// {placeholders}, data, counted as words), the rule and the fold: "work 3" the same file again, "work 4" the paid invoice
// under a new number, "work 5" new bank details, "work 6" a new supplier; the round trip moved into the fold. Screen 4's
// refusal leads with the reason and folds the proof ("pay 7" is lower, 81 to 66); "pay 8" is that fold open.
export const OVER_BUDGET: Record<string, number> = { "start 0": 63, "start 1": 59, "start 2": 59, "start 3": 53, "pay 7": 66, "pay 8": 116, "invoice 4": 49, "invoice 5": 50, "pay 4": 49, "pay 6": 48, "books 0": 77, "books 1": 75, "work 3": 60, "work 4": 69, "work 5": 51, "work 6": 63, "books 3": 60, "books 4": 58, "books 5": 55, "company 3": 60, "approve 2": 55, "approve 4": 55, "approve 9": 53, "approve 10": 48, "approve 11": 54, "approve 12": 53, "approve 13": 48, "approve 14": 47, "approve 15": 57 };

/**
 * The live panel (outside the word budget): who did a step, and one line per engine event (cloud/src/tryEvents.ts).
 * A line's {placeholders} are filled from that event's allowlisted fields only; a line whose placeholder the event
 * cannot fill gives way to the next of `<event>_why`, `<event>`, `<event>_plain`.
 */
export const LIVE = {
  allSteps: "All steps",
  /**
   * Round 4 (14 Nov): a Claude call's row once its answer is in (the next row says what came of it), and, when Purser
   * had answered before any answer to that call came back, that fact in place of "asking…" (nothing keeps counting).
   */
  asked: "asked.",
  noAnswer: "asked; no answer had come back when Purser answered.",
  /** A row's time: seconds since the request started, as the browser measured it when the row arrived. */
  at: "+{s} s",
  reader: "Reader",
  step: "Purser recorded a step.",
  /** Added to every line where money moves. */
  money: "simulated bank · test money",
  who: { claude: "Claude", code: "Purser's code", you: "You", purser: "Purser" },
  /** Task A6: the payables agents' decisions, each its own step on the "At work" panel. */
  agents: { "ap.checker_decided": "Checker agent", "ap.coded": "Coder agent", "ap.payer_proposed": "Payer agent" } as Record<string, string>,
  /**
   * The Coder picked no VAT code: the accrual then books the invoice's own VAT by Purser's code (src/ap/books.ts
   * accrualEntries), which is the VAT line the ledger shows. Said so, so the two agree (try-fixes, 13 Nov).
   */
  noVat: "from the invoice, booked by Purser's code",
  /**
   * The Coder left a German supplier's 19% without a code (its codes are the Dutch return's); the books code it from the
   * supplier's German VAT id (src/ap/books.ts codedEntries) and book it to 1515 (final-polish, 13 Nov).
   */
  booksVat: "German VAT 19%: no Dutch purchase code applies; booked from the supplier's German VAT ID as VAT to reclaim from Germany",
  /** The same without a VAT id on the invoice: the rate only, and that a person codes it ({pct}: a whole percent). */
  uncodedVat: "VAT at {pct}%: no Dutch purchase code applies; booked without a VAT code for the accountant to check",
  /** VAT codes in words (P21 reads as 21% by itself). */
  vat: { PF_DE19: "German 19%, reclaimed from Germany" } as Record<string, string>,
  /** The agents' decisions and code's outcomes in words, never the raw value ("ask_cfo"). */
  actions: { pay: "pay", ask_cfo: "ask the CFO", hold: "hold for a person", reject: "reject", pay_later: "pay later", file_for_cfo: "file for the CFO" } as Record<string, string>,
  rails: { bank_swift: "a SWIFT bank transfer", bank_local: "a local bank transfer" } as Record<string, string>,
  /** An agent's decision on the page: its lead (with a reason, then without), its reason marked as its own words, and
   *  what Purser's code enforced, on a muted line under it. */
  lead: {
    "ap.checker_decided": "Decided: {action}, because", "ap.checker_decided_plain": "Decided: {action}.",
    "ap.coded": "{account} expense, VAT {vat}:", "ap.coded_plain": "{account} expense, VAT {vat}.",
    "ap.payer_proposed": "Proposed: pay on {pay_on} by {rail} from {currency}, because", "ap.payer_proposed_plain": "Proposed: pay on {pay_on} by {rail} from {currency}.",
  } as Record<string, string>,
  ownWords: "its own words",
  enforced: "Purser's code enforced: {enforced}",
  /** Round 4 (14 Nov): code's outcome differs from what the agent decided. */
  overrode: "Purser's code overrode it: {enforced}",
  /**
   * Why Claude was not asked for a step (claude.capped's reason, src/engine/budget.ts CappedReason), in words: the
   * fallback says plainly that Purser's code decided, and why (round 4: "because today's live budget is used").
   */
  caps: {
    pool_day_cap: "today's live budget for Claude is used", company_cap: "this test company's live budget for Claude is used",
    address_cap: "today's live budget for Claude from this address is used", all_time_cap: "the live budget for Claude is used",
    action_budget: "this step's live budget for Claude is used", switch_off: "live Claude is switched off", no_key: "live Claude is not set up",
    busy: "Claude is busy",
  } as Record<string, string>,
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
    "claude.capped_why": "Claude was not asked: {cap}. Purser's code read and decided.",
    "claude.capped": "Claude was not asked for this step. Purser's code read and decided.",
    "agent.tool": "Asked Purser's code a question and got its answer.",
    "agent.said": "Its own words, not checked yet.",
    "agent.nudged": "Reminded to finish with a decision.",
    "agent.run": "Finished its work on this step.",
    "ap.checker_decided_why": "Decided: {action}, because {reason}. Purser's code enforced: {outcome}; {enforced}.",
    "ap.checker_decided": "The check is decided. Purser's code compared it with its own rules.",
    "ap.coded_why": "{account} expense, VAT {vat}: {reason}. Purser's code enforced: {enforced}.",
    "ap.coded": "{account} expense, VAT {vat}: {reason}. Purser's code checked it and booked it.",
    "ap.coded_plain": "The invoice was coded. Purser's code checked it.",
    "ap.payer_proposed_why": "Proposed: pay on {pay_on} by {rail} from {currency}, because {reason}. Purser's code enforced: {outcome}; {enforced}.",
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
