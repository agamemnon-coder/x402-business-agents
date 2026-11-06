// awx-1 (Max's last round, item 2.1): one run in a fresh world, on the Airwallex sandbox only, that shows the card
// controls (a–e), the EUR balance choosing between paying from EUR and converting the shortfall (f), and a SWIFT
// payout after Face ID followed to PAID (g). This file is the plan Max approves before anything runs: every Airwallex
// call the run makes, endpoint by endpoint, with the code that makes it, and the Claude calls the agents make.
//
// Two numbers per line: `expected` (what the code makes when the sandbox lists fit on one page, as on 3 November) and
// `upTo` (with the page counts below at their stated maximum). The call guard (src/airwallex/callBudget.ts) is set to
// the approved number and refuses the call after it, whoever makes it.

/** Where the call happens: each process logs in once, and again every 25 minutes (src/airwallex/client.ts). */
export type Proc = "preflight" | "conductor" | "runner" | "verify" | "reconcile";

export interface CallLine {
  step: "0" | "a" | "b" | "c" | "d" | "e" | "f1" | "f2" | "g" | "close";
  proc: Proc;
  method: "GET" | "POST";
  endpoint: string;
  expected: number;
  upTo: number;
  why: string;
  /** The code that makes the call. */
  code: string;
}

/**
 * The sandbox lists the run reads whose length we cannot know without reading them (no call is made to find out):
 * cardholders (one page of 100 holds the three agents' cardholders, created once on 29 October), each agent's cards
 * (every world issued one more card per cardholder; the run pages through all of them to be sure it adopts none),
 * deposits of the last 30 days (the seed deposit is looked up among them) and beneficiaries (the two payees).
 */
export const PAGES = {
  cardholders: { expected: 1, upTo: 2 },
  cardsPerHolder: { expected: 2, upTo: 3 },
  deposits30d: { expected: 3, upTo: 6 },
  beneficiaries: { expected: 1, upTo: 2 },
} as const;

/** How long each process runs at most, for its logins (a token lives 30 minutes and is renewed 5 minutes early). */
export const RUN_MINUTES = { conductor: 90, runner: 100 } as const;
const logins = (minutes: number) => Math.ceil(minutes / 25);

const AGENTS = 3;

function lines(): CallLine[] {
  const out: CallLine[] = [];
  const add = (step: CallLine["step"], proc: Proc, method: CallLine["method"], endpoint: string, expected: number, upTo: number, why: string, code: string) =>
    out.push({ step, proc, method, endpoint, expected, upTo, why, code });
  const login = "POST";
  // 0 Preflight: one process, read-only.
  add("0", "preflight", login, "/authentication/login", 1, 1, "the preflight's token", "Airwallex.login");
  add("0", "preflight", "GET", "/balances/current", 1, 1, "EUR and USD available: is there enough EUR for f1 to go without FX?", "awx-1 preflight");
  add("0", "preflight", "GET", "/webhooks", 1, 1, "the relay's subscription (23 events since 30 October) is still there", "listWebhooks");
  // The conductor: one process for the scenario's own steps (npm run awx-1 -- live).
  add("0", "conductor", login, "/authentication/login", logins(RUN_MINUTES.conductor), logins(RUN_MINUTES.conductor), `the conductor's token, renewed every 25 minutes over at most ${RUN_MINUTES.conductor} minutes`, "Airwallex.login");
  add("a", "conductor", "GET", "/issuing/cardholders", AGENTS * PAGES.cardholders.expected, AGENTS * PAGES.cardholders.upTo, "finds each agent's DELEGATE cardholder (none is created twice)", "setupCards → findCardholderByEmail");
  add("a", "conductor", "GET", "/issuing/cards", AGENTS * PAGES.cardsPerHolder.expected, AGENTS * PAGES.cardsPerHolder.upTo, "pages through each holder's cards: no awx-1 card may exist yet (none is adopted)", "setupCards → findCard");
  add("a", "conductor", "POST", "/issuing/cards/create", AGENTS, AGENTS, "one virtual card per agent with the policy's limit, MCC, currency and end date", "setupCards → createCard");
  add("a", "conductor", "GET", "/issuing/cards/{id}", AGENTS, AGENTS, "reads each card back: the controls as Airwallex holds them", "awx-1 step a read-back");
  add("b", "conductor", "POST", "/simulation/issuing/create", 1, 1, "sandbox only: Packwise charges 19.99 EUR (MCC 5734) on the Sourcing card (limit 30.00)", "merchantCharge");
  add("c", "conductor", "POST", "/simulation/issuing/create", 2, 2, "sandbox only: Packwise Pro 45.00 EUR over the 30.00 limit; after the CFO's raise, the same charge again", "merchantCharge");
  add("d", "conductor", "POST", "/simulation/issuing/create", 1, 1, "sandbox only: Packwise (MCC 5734) on the Support card, which may pay only MCC 7372", "merchantCharge");
  add("f1", "conductor", "GET", "/deposits", PAGES.deposits30d.expected, PAGES.deposits30d.upTo, "is the seed deposit there (last 30 days)? Then no new one", "seedTreasury → findDepositsByReference");
  add("f1", "conductor", "GET", "/balances/current", 2, 2, "the seed's calibration, then the licence's plan: free EUR decides FX or not", "seedTreasury, proposeInvoicePayment");
  add("f1", "conductor", "GET", "/beneficiaries", 2 * PAGES.beneficiaries.expected, 2 * PAGES.beneficiaries.upTo, "the two allowlisted payees, found by IBAN (none is created)", "seedTreasury → findBeneficiaryByIban");
  add("f2", "conductor", "GET", "/balances/current", 2, 2, "after the licence was paid: the EUR balance now falls short of Bergtex's 1,850.00", "awx-1 step f2, proposeInvoicePayment");
  add("f2", "conductor", "GET", "/fx/rates/current", 1, 1, "the market rate, to check the quote against", "proposeInvoicePayment → currentRate");
  add("f2", "conductor", "POST", "/fx/quotes/create", 1, 1, "a fresh quote for the shortfall only, valid 15 minutes", "proposeInvoicePayment → createQuote");
  add("close", "conductor", "GET", "/issuing/transactions", AGENTS, AGENTS, "one poll of each card: every authorisation the webhooks brought, and none they missed", "pollCardTransactions");
  add("close", "conductor", "GET", "/issuing/cards/{id}", AGENTS, AGENTS, "each card read back at the end (the raised limit as Airwallex holds it)", "awx-1 close read-back");
  // The runner (npm run relay): executes what the CFO approved, and its hourly reconciliation. Card poll off (webhooks).
  add("0", "runner", login, "/authentication/login", logins(RUN_MINUTES.runner), logins(RUN_MINUTES.runner), `the runner's token over at most ${RUN_MINUTES.runner} minutes`, "Airwallex.login");
  add("c", "runner", "GET", "/issuing/cards/{id}", 2, 2, "the approved raise: the card read before and after its update", "syncCardsAfterPolicy → syncOne");
  add("c", "runner", "POST", "/issuing/cards/{id}/update", 1, 1, "the raised per-purchase limit, set at Airwallex", "setCardLimits");
  // The invoice payment executor (src/executors/invoicePayment.ts), once per approved invoice.
  for (const step of ["f1", "f2"] as const) {
    if (step === "f2") add(step, "runner", "POST", "/fx/conversions/create", 1, 1, "converts only the shortfall on the approved quote, metadata.approval_sha256", "executeInvoicePayment → createConversion");
    add(step, "runner", "GET", "/balances/current", 2, 2, "the balance before the payout and after it", "executeInvoicePayment: snapshot pre-exec, post-exec");
    add(step, "runner", "POST", "/transfers/create", 1, 1, "the SWIFT payout with its request_id and metadata.approval_sha256", "submitTransfer → createTransfer");
    add(step, "runner", "GET", "/transfers/{id}", 3, 3, "status and fee read back after create, SENT and PAID", "settleInSandbox → getTransfer");
    add(step, "runner", "POST", "/simulation/transfers/{id}/transition", 2, 2, "sandbox only: SENT, then PAID (the sandbox does not settle SWIFT by itself)", "settleInSandbox → transitionTransfer");
  }
  add("close", "runner", "GET", "/issuing/transactions", 2 * AGENTS, 2 * AGENTS, "the runner's reconciliation, a minute after start and an hour later", "reconcile → cardTransactions");
  add("close", "runner", "GET", "/transfers/{id}", 2, 2, "the hour-later reconciliation of both payouts", "reconcile → transfer");
  // npm run verify and npm run reconcile, each its own process.
  add("g", "verify", login, "/authentication/login", 1, 1, "verify's token", "Airwallex.login");
  add("g", "verify", "GET", "/transfers", 2, 2, "each payout by its request_id: amount, payee, reference, approval hash in metadata, PAID", "verifyAirwallex");
  add("g", "verify", "GET", "/fx/conversions", 1, 1, "the conversion by its request_id: quote, amounts, SETTLED", "verifyAirwallex");
  add("close", "reconcile", login, "/authentication/login", 1, 1, "reconcile's token", "Airwallex.login");
  add("close", "reconcile", "GET", "/transfers/{id}", 2, 2, "each payout's status and amount", "reconcile → transfer");
  add("close", "reconcile", "GET", "/issuing/transactions", AGENTS, AGENTS, "each card's authorisations against the ledger", "reconcile → cardTransactions");
  return out;
}

export const AWX1_CALLS: readonly CallLine[] = lines();

export const total = (field: "expected" | "upTo", l: readonly CallLine[] = AWX1_CALLS) => l.reduce((s, x) => s + x[field], 0);

/** The run's calls per endpoint, summed over steps and processes. */
export function byEndpoint(l: readonly CallLine[] = AWX1_CALLS): { endpoint: string; expected: number; upTo: number }[] {
  const m = new Map<string, { expected: number; upTo: number }>();
  for (const x of l) {
    const k = `${x.method} ${x.endpoint}`;
    const v = m.get(k) ?? { expected: 0, upTo: 0 };
    m.set(k, { expected: v.expected + x.expected, upTo: v.upTo + x.upTo });
  }
  return [...m].map(([endpoint, v]) => ({ endpoint, ...v }));
}

/**
 * What is not in the budget above, and what each costs if it happens. Each needs Max's go before it runs; the guard
 * refuses it otherwise.
 */
export const CONTINGENCIES = [
  { what: "EUR too low for f1 to go without FX (preflight: EUR available under the floor 25,000.00 + 1,500.00): a simulated EUR deposit into the EUR Global Account", calls: 3, endpoints: "login, GET /global_accounts, POST /simulation/deposit/create" },
  { what: "the webhook secret on file does not match (first webhook 'bad signature'): a new subscription with a new secret (npm run cards -- webhook --replace; also changes the relay Worker's secret)", calls: 5, endpoints: "login, GET /webhooks, POST /webhooks/create, POST /webhooks/{id}/delete, GET /webhooks" },
  { what: "the Bergtex quote expires before Face ID (14.5 minutes): a new plan on a fresh quote", calls: 4, endpoints: "GET /balances/current ×2, GET /fx/rates/current, POST /fx/quotes/create" },
  { what: "Airwallex answers fee_unknown on a transfer: the same request_id again after 15, 30, 60, 90 and 120 s (never a second payout)", calls: 5, endpoints: "POST /transfers/create (same request_id)" },
  { what: "a webhook does not arrive within 2 minutes: the card is polled once instead (recorded as such)", calls: 1, endpoints: "GET /issuing/transactions" },
] as const;

/** The single costliest retry: step a again in a fresh world, if the cards come out wrong (new cards, new nicknames). */
export const WORST_SINGLE_RETRY = (() => {
  const a = AWX1_CALLS.filter((x) => x.step === "a");
  return { what: "step a again (three new cards in a fresh world awx-1b, with their read-back)", expected: total("expected", a), upTo: total("upTo", a) };
})();

// ---- Claude ----------------------------------------------------------------------------------------------------

export type Model = "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5";

/** The Claude calls of awx-1 with the agents on (KIT11_AGENTS=on) and the autonomous loops off (no Metal). */
export const AWX1_CLAUDE: readonly { step: CallLine["step"]; model: Model; calls: number; why: string; code: string }[] = [
  { step: "c", model: "claude-haiku-5-5", calls: 2, why: "the Sourcing agent reads Airwallex's LIMIT_EXCEEDED and asks the CFO for a raise (read_decline, propose_raise)", code: "meetDecline" },
  { step: "d", model: "claude-haiku-5-5", calls: 2, why: "the Support agent reads MERCHANT_CATEGORY_NOT_ALLOWED and asks for nothing (read_decline, no_raise)", code: "meetDecline" },
  { step: "f1", model: "claude-haiku-5-5", calls: 1, why: "sorts the licence invoice", code: "Tools.classify" },
  { step: "f1", model: "claude-sonnet-5-5", calls: 1, why: "reads the licence invoice into checked fields", code: "Tools.invoice" },
  { step: "f1", model: "claude-opus-5-5", calls: 2, why: "the Treasury agent advises when to pay", code: "adviseTiming" },
  { step: "f1", model: "claude-opus-5-5", calls: 1, why: "the advisory review beside the proposal", code: "attachReview" },
  { step: "f2", model: "claude-haiku-5-5", calls: 1, why: "sorts Bergtex's invoice", code: "Tools.classify" },
  { step: "f2", model: "claude-sonnet-5-5", calls: 1, why: "reads Bergtex's invoice", code: "Tools.invoice" },
  { step: "f2", model: "claude-opus-5-5", calls: 2, why: "the Treasury agent advises when to pay (with the quote)", code: "adviseTiming" },
  { step: "f2", model: "claude-opus-5-5", calls: 1, why: "the advisory review", code: "attachReview" },
];

/** Average cost per call by model, in micro-USD, from a run record's own trace (the main run: docs/demo/main-run.json). */
export function averageCostPerCall(record: { snapshot: { traces: { model: string; cost_usd_micros: number; request_ids?: unknown[] | null; turns?: number }[] } }): Record<Model, number> {
  const out = {} as Record<Model, number>;
  for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const) {
    const ts = record.snapshot.traces.filter((t) => t.model === model);
    const calls = ts.reduce((s, t) => s + (t.request_ids?.length ?? t.turns ?? 1), 0);
    const cost = ts.reduce((s, t) => s + t.cost_usd_micros, 0);
    if (!calls) throw new Error(`the record has no ${model} calls to average`);
    out[model] = Math.ceil(cost / calls);
  }
  return out;
}

/** The Claude estimate in micro-USD: the run, and the run with the costliest single retry (re-planning Bergtex). */
export function claudeEstimate(avg: Record<Model, number>): { calls: number; micros: number; retry: { what: string; calls: number; micros: number } } {
  const cost = (l: readonly { model: Model; calls: number }[]) => l.reduce((s, x) => s + x.calls * avg[x.model], 0);
  const f2 = AWX1_CLAUDE.filter((x) => x.step === "f2");
  return {
    calls: AWX1_CLAUDE.reduce((s, x) => s + x.calls, 0), micros: cost(AWX1_CLAUDE),
    retry: { what: "Bergtex planned again on a fresh quote (its quote expired before Face ID)", calls: f2.reduce((s, x) => s + x.calls, 0), micros: cost(f2) },
  };
}

const usd = (micros: number) => `${(micros / 1e6).toFixed(4)} USD`;

/** The plan as Markdown: the tables docs/runs/awx-1-plan.md carries (a test checks it carries exactly these). `mainRun`:
 *  docs/demo/main-run.json, whose own trace gives the average cost per Claude call. */
export function planMarkdown(mainRun: Parameters<typeof averageCostPerCall>[0]): string {
  const avg = averageCostPerCall(mainRun);
  const c = claudeEstimate(avg);
  const rows = (l: typeof AWX1_CALLS) => l.map((x) => `| ${x.step} | ${x.proc} | \`${x.method} ${x.endpoint}\` | ${x.expected} | ${x.upTo} | ${x.why} | \`${x.code}\` |`);
  return [
    `**Airwallex: ${total("expected")} calls expected, at most ${total("upTo")}.** Read-only paging is the only difference (list lengths we cannot know without reading them: cardholders ${PAGES.cardholders.expected}–${PAGES.cardholders.upTo} page(s), each holder's cards ${PAGES.cardsPerHolder.expected}–${PAGES.cardsPerHolder.upTo}, deposits of 30 days ${PAGES.deposits30d.expected}–${PAGES.deposits30d.upTo}, beneficiaries ${PAGES.beneficiaries.expected}–${PAGES.beneficiaries.upTo} per payee).`,
    "",
    "| Step | Process | Endpoint | Expected | At most | Why | Code |",
    "|---|---|---|---|---|---|---|",
    ...rows(AWX1_CALLS),
    "",
    "By endpoint:",
    "",
    "| Endpoint | Expected | At most |",
    "|---|---|---|",
    ...byEndpoint().map((e) => `| \`${e.endpoint}\` | ${e.expected} | ${e.upTo} |`),
    `| **Total** | **${total("expected")}** | **${total("upTo")}** |`,
    "",
    `**Worst single retry:** ${WORST_SINGLE_RETRY.what}: ${WORST_SINGLE_RETRY.expected} calls, at most ${WORST_SINGLE_RETRY.upTo}, so ${total("upTo") + WORST_SINGLE_RETRY.upTo} at most with it.`,
    "",
    "Not in the budget; each only on Max's go (the guard refuses it otherwise):",
    "",
    "| If | Calls | Endpoints |",
    "|---|---|---|",
    ...CONTINGENCIES.map((x) => `| ${x.what} | ${x.calls} | ${x.endpoints} |`),
    "",
    `**Claude: ${c.calls} calls, about ${usd(c.micros)}** at the main run's own average cost per call (docs/demo/main-run.json: Haiku ${avg["claude-haiku-5-5"]} µUSD, Sonnet ${avg["claude-sonnet-5-5"]} µUSD, Opus ${avg["claude-opus-5-5"]} µUSD, from list prices in src/claude/pricing.ts). Worst single retry: ${c.retry.what}, ${c.retry.calls} calls, about ${usd(c.retry.micros)}; ${usd(c.micros + c.retry.micros)} with it.`,
    "",
    "| Step | Model | Calls | Why | Code |",
    "|---|---|---|---|---|",
    ...AWX1_CLAUDE.map((x) => `| ${x.step} | ${x.model} | ${x.calls} | ${x.why} | \`${x.code}\` |`),
    "",
    "**Metal: 0 calls** (METAL_RPC_URL unset; no bootstrap, no mandate, no sweep).",
  ].join("\n");
}
