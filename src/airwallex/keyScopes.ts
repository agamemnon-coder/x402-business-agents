// Scoped Airwallex keys per role (security hardening, 19 November). Airwallex lets an API key carry Read or Write per
// resource instead of full access (https://www.airwallex.com/docs/developer-tools/api/api-key-scopes.md): Read covers a
// resource's GET endpoints, Write its GET and POST endpoints. Purser can hold one key per role, each created in the
// Airwallex web app with only that role's scopes, so a key that leaks from one part reaches only what that part needs:
//   AIRWALLEX_API_KEY_READ     reads: balances, reconciliation, verify, the card transactions
//   AIRWALLEX_API_KEY_PAYOUT   the payout executors: FX, beneficiaries, transfers (and the sandbox's simulations)
//   AIRWALLEX_API_KEY_ISSUING  the agents' cards: issue, limits, freeze
//   AIRWALLEX_API_KEY_SPEND    bills and vendors (Airwallex Spend)
// each with the same AIRWALLEX_CLIENT_ID, and each falling back to AIRWALLEX_API_KEY when unset (then nothing changes).
// With a role key, the client mirrors Airwallex's scopes itself: a call outside the role's list is refused before
// anything is sent (AirwallexScopeRefused), and a process whose role code would make such a call refuses to start
// (assertRoleKeys, also run by fromEnv for the role asked). Airwallex refuses the same call on its side anyway; this
// makes a wrong key or a wrong call fail at once, in our words, without a request. A company's own OAuth token
// (AIRWALLEX_OAUTH=on) is not a key: roles do not apply to it.

export const ROLES = ["read", "payout", "issuing", "spend"] as const;
export type AirwallexRole = (typeof ROLES)[number];

export const ROLE_ENV: Readonly<Record<AirwallexRole, string>> = {
  read: "AIRWALLEX_API_KEY_READ",
  payout: "AIRWALLEX_API_KEY_PAYOUT",
  issuing: "AIRWALLEX_API_KEY_ISSUING",
  spend: "AIRWALLEX_API_KEY_SPEND",
};

/** Airwallex's scope labels, as the web app shows them when a key is created. */
export type Scope = "Balances" | "Deposits" | "Global Accounts" | "Transfers" | "Beneficiaries" | "Conversion" | "Financial Transactions"
  | "Bills" | "Vendors" | "Authorizations and Transactions" | "Cards" | "Cardholders" | "Simulations" | "Upload Files";

/** What the owner creates for each role in the Airwallex web app: these scopes, at this access, and nothing else. */
export const ROLE_SCOPES: Readonly<Record<AirwallexRole, { read: readonly Scope[]; write: readonly Scope[] }>> = {
  read: { read: ["Balances", "Deposits", "Global Accounts", "Transfers", "Beneficiaries", "Conversion", "Financial Transactions", "Bills", "Vendors", "Authorizations and Transactions", "Cards"], write: [] },
  payout: { read: ["Balances"], write: ["Transfers", "Beneficiaries", "Conversion", "Simulations"] },
  issuing: { read: ["Authorizations and Transactions"], write: ["Cards", "Cardholders"] },
  spend: { read: [], write: ["Bills", "Vendors", "Upload Files"] },
};

/** The resource an endpoint belongs to, by its path (under /api/v1), as Airwallex's scope reference lists it. */
const RESOURCES: readonly [RegExp, Scope][] = [
  [/^\/balances\//, "Balances"],
  [/^\/deposits(\/|$)/, "Deposits"],
  [/^\/global_accounts(\/|$)/, "Global Accounts"],
  [/^\/(transfers|batch_transfers)(\/|$)/, "Transfers"],
  [/^\/beneficiaries(\/|$)/, "Beneficiaries"],
  [/^\/fx\//, "Conversion"],
  [/^\/financial_transactions(\/|$)/, "Financial Transactions"],
  [/^\/(spend\/)?bills(\/|$)/, "Bills"],
  [/^\/(spend\/)?vendors(\/|$)/, "Vendors"],
  [/^\/issuing\/(authorizations|transactions|card_transactions|card_transaction_events|card_transaction_lifecycles)(\/|$)/, "Authorizations and Transactions"],
  [/^\/issuing\/cards(\/|$)/, "Cards"],
  [/^\/issuing\/cardholders(\/|$)/, "Cardholders"],
  [/^\/simulation\//, "Simulations"],
  [/^\/files\/upload(\/|$)/, "Upload Files"],
];

/** The scope an endpoint needs, or null for one no role's scopes cover (webhooks, accounts, payment acceptance). */
export function resourceOf(path: string): Scope | null {
  const p = path.split("?")[0]!;
  return RESOURCES.find(([re]) => re.test(p))?.[1] ?? null;
}

/** Whether a key of `role` may make this call: GET needs Read or Write on its resource, POST needs Write. */
export function scopeAllows(role: AirwallexRole, method: "GET" | "POST", path: string): boolean {
  const r = resourceOf(path);
  if (!r) return false;
  const s = ROLE_SCOPES[role];
  return method === "GET" ? s.read.includes(r) || s.write.includes(r) : s.write.includes(r);
}

/** Why a key of `role` may not make this call, in words, or null when it may. */
function refusal(role: AirwallexRole, method: "GET" | "POST", path: string): string | null {
  if (scopeAllows(role, method, path)) return null;
  const r = resourceOf(path);
  const has = r && ROLE_SCOPES[role].read.includes(r) ? "Read" : "no access";
  return `the ${role} key may not call ${method} ${path} (${r ? `${r} needs ${method === "POST" ? "Write" : "Read"}; the ${role} key has ${has}` : "no role's scopes cover it"})`;
}

/** A call refused by the client because the role's key does not carry its scope. Nothing was sent. */
export class AirwallexScopeRefused extends Error {
  constructor(readonly role: AirwallexRole, readonly method: string, readonly path: string, why: string) {
    super(`Airwallex ${method} ${path}: refused before sending: ${why}`);
  }
}

/** Throws AirwallexScopeRefused when a key of `role` may not make this call. */
export function checkScope(role: AirwallexRole, method: "GET" | "POST", path: string): void {
  const why = refusal(role, method, path);
  if (why) throw new AirwallexScopeRefused(role, method, path, why);
}

/**
 * The calls Purser's own code makes with each role's key ("METHOD /path", an id as {id}). Held to the code by
 * test/airwallex-key-scopes.test.ts, which runs the payout rail and the card rail on a recording stand-in.
 */
export const ROLE_CALLS: Readonly<Record<AirwallexRole, readonly string[]>> = {
  // src/finance/sources.ts (reconciliation), src/cli/verify.ts, src/cli/reconcile.ts, the after-payout check.
  read: ["GET /balances/current", "GET /deposits", "GET /transfers", "GET /transfers/{id}", "GET /fx/conversions", "GET /fx/conversions/{id}", "GET /financial_transactions", "GET /beneficiaries", "GET /global_accounts", "GET /issuing/transactions", "GET /issuing/cards/{id}"],
  // src/airwallex/adapter.ts as the payout executors use it, the one batch transfer, the sandbox's simulations.
  payout: ["GET /balances/current", "GET /fx/rates/current", "POST /fx/quotes/create", "POST /fx/conversions/create", "GET /fx/conversions", "GET /beneficiaries",
    "POST /beneficiaries/schema", "POST /beneficiaries/validate", "POST /beneficiaries/create", "POST /transfers/create", "GET /transfers", "GET /transfers/{id}",
    "POST /batch_transfers/create", "POST /batch_transfers/{id}/add_items", "POST /batch_transfers/{id}/quote", "POST /batch_transfers/{id}/submit", "POST /batch_transfers/{id}/delete",
    "GET /batch_transfers", "GET /batch_transfers/{id}", "GET /batch_transfers/{id}/items", "POST /simulation/transfers/{id}/transition", "POST /simulation/issuing/create"],
  // src/airwallex/issuing.ts: the card rail (its sandbox charge simulation runs on the payout key).
  issuing: ["GET /issuing/cardholders", "POST /issuing/cardholders/create", "GET /issuing/cards", "POST /issuing/cards/create", "GET /issuing/cards/{id}", "POST /issuing/cards/{id}/update", "GET /issuing/transactions"],
  // Airwallex Spend (bills and vendors); no Spend call is in this build yet, so nothing is used with this key.
  spend: [],
};

/** Each call in `calls` a key of `role` may not make, in words; empty when all are allowed. */
export function roleCallRefusals(role: AirwallexRole, calls: readonly string[]): string[] {
  return calls.flatMap((c) => {
    const [method, path] = c.split(" ") as ["GET" | "POST", string];
    const why = refusal(role, method, path);
    return why ? [why] : [];
  });
}

/**
 * At start: for each role whose own key is set, every call Purser's code makes with it must be in the role's list;
 * otherwise this throws, naming the variable and the calls, and the process does not start. Unset role keys are not
 * checked (the general key is not scoped by this client).
 */
export function assertRoleKeys(env: Record<string, string | undefined>, calls: Readonly<Record<AirwallexRole, readonly string[]>> = ROLE_CALLS): void {
  const bad = ROLES.flatMap((role) => (env[ROLE_ENV[role]] ? roleCallRefusals(role, calls[role]).map((w) => `${ROLE_ENV[role]}: ${w}`) : []));
  if (bad.length) throw new Error(`a scoped Airwallex key would be used outside its scopes; not starting: ${bad.join("; ")}`);
}
