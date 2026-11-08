// The phone's side of passkey approvals (tier 2 item 5), served as /assets/approve.js to the approval and
// enrolment pages. It trusts nothing it is sent: it canonicalises and hashes each proposal's terms itself
// (WebCrypto), refuses anything that does not hash to the hash it would sign, and builds every line of the approval
// view from those hashed terms, only after checking the runner signed them (the runner's key is pinned from the
// viewer link; a new run's key replaces it only on the person's press). Mis-tap prevention: the approval view shows
// the one proposal (or the one option chosen) with "Approve with Face ID", which arms after a moment; the passkey's
// challenge is that proposal's hash.
//
// No imports: the deploy step only strips the types (TypeScript transpileModule) and serves the result as is.

export interface PhoneProposal {
  proposal_id: string;
  kind: string;
  group: string;
  canonical: string;
  terms_sha256: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  review: { model: string | null; recommendation: string; text: string } | null;
  /** Planted instructions code found in the proposal's documents (signed by the runner). */
  warnings?: string[];
  /** E1: this one needs two different people; who has approved it so far (signed by the runner). */
  four_eyes?: { approved_by: string[] };
  /** With the agents on: the Treasury agent's recommendation for this price option, advisory (signed by the runner). */
  agent_advice?: { agent: string; model: string | null; recommends: boolean; text: string; verdict?: string };
}

interface Approvals {
  proposals: PhoneProposal[];
  names: Record<string, string>;
  passkey: { rp_id: string; credentials: { id: string; label: string; enrolled_at: string }[] };
  relay: { synced_at: string; age_ms: number };
  enrolment_open: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── Canonical JSON and hashing (RFC 8785 for JSON without numbers, which the terms never contain) ──

/** RFC 8785: keys sorted by UTF-16 code units, no whitespace, strings escaped as JSON.stringify does. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("not JSON");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
  throw new Error("not JSON");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What the passkey signs to reject: a hash derived from the terms hash (the runner's rejectionSha256), so a
 * rejection can never be replayed as an approval, whose challenge is the terms hash itself.
 */
export async function rejectionHash(termsSha256: string): Promise<string> {
  return sha256Hex(`kit11 reject v1 ${termsSha256}`);
}

export interface OptionCheck {
  ok: boolean;
  terms: Obj | null;
  problem: string | null;
}

/** The terms must parse, be in canonical form, hash to the hash that would be signed, and belong to this proposal. */
export async function checkOption(p: PhoneProposal): Promise<OptionCheck> {
  const bad = (problem: string): OptionCheck => ({ ok: false, terms: null, problem });
  let terms: unknown;
  try {
    terms = JSON.parse(p.canonical);
  } catch {
    return bad("the terms are not readable");
  }
  if (!isObj(terms)) return bad("the terms are not readable");
  let canonical: string;
  try {
    canonical = canonicalize(terms);
  } catch {
    return bad("the terms are not readable");
  }
  if (canonical !== p.canonical) return bad("the terms are not in canonical form, so their hash cannot be checked");
  if ((await sha256Hex(p.canonical)) !== p.terms_sha256) return bad("the terms do not hash to the hash shown");
  if (terms.proposal_id !== p.proposal_id) return bad(`these terms belong to ${str(terms.proposal_id)}, not ${p.proposal_id}`);
  if (terms.expires_at !== p.expires_at) return bad("the expiry shown is not the one in the terms");
  return { ok: true, terms, problem: null };
}

// ── Words for the confirm screen, built from the hashed terms only ──

/** Thousands grouped, decimals untouched: money arrives as decimal strings and never goes through a float. */
export function money(s: unknown): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(str(s));
  if (!m) return str(s);
  return `${m[1] ? "−" : ""}${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[3] ?? ""}`;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const shortAddr = (a: string) => (ADDRESS.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export interface Facts {
  approvable: boolean;
  title: string;
  sentence: string;
  amount: string;
  margin: string | null;
  /** One line: who receives money (names from the ledger beside the hashed addresses). */
  recipient: string;
  rows: [string, string][];
  /** How another option names this one: "option A: sell at 0.05 per query (margin 0.01)". */
  short: string;
  warnings: string[];
  /** What the amount row is called on the confirm screen (an amount of money, or a policy's new value). */
  amountLabel?: string;
  /** For the option card: a short name, and the one number that matters, big, with its unit. */
  label: string;
  big: string;
  unit: string;
}

/**
 * Whether a policy change makes it less strict; the same rule the runner enforces (src/policy/rules.ts loosens):
 * the phone may only tighten (review N2), so the page says so before Face ID instead of after.
 */
export function policyLoosens(c: { key: string; from: string; to: string }): boolean {
  const cents = (v: string) => (/^\d+\.\d{2}$/.test(v) ? Number(v.replace(".", "")) : null);
  const [from, to] = [cents(c.from), cents(c.to)];
  if (c.key.startsWith("cap.")) return from !== null && (to === null || to > from);
  if (c.key.startsWith("card.")) return from !== null && (to === null || to > from);
  if (c.key === "approval.four_eyes_eur") return from !== null && (to === null || to > from);
  if (c.key.startsWith("approval.")) return from !== null && to !== null && to > from;
  if (c.key.endsWith("_floor")) return from !== null && (to === null || to < from);
  if (c.key.startsWith("counterparty:")) return c.from === "blocked" && c.to === "allowed";
  if (c.key === "freeze" || c.key.startsWith("stop.") || c.key.startsWith("pause.")) return c.from === "on" && c.to !== "on";
  return true;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Nov 2026, 23:59 UTC": the same on every phone, whatever its time zone. */
function utcMinute(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** The account calls an owners_execute may carry (src/metal/ownersExecute.ts OWNER_CALL_SELECTORS; a test keeps them equal). */
export const OWNER_SELECTORS = { bind: "0x240c29bb", revoke: "0xb75c7dc6" } as const;

export function describeTerms(t: Obj, names: Record<string, string>): Facts {
  const nameOf = (a: string) => names[a.toLowerCase()] ?? null;
  const who = (a: string) => (nameOf(a) ? `${nameOf(a)} ${shortAddr(a)}` : shortAddr(a));
  const whoFull = (a: string) => (nameOf(a) ? `${nameOf(a)} ${a}` : a);
  const kind = str(t.kind);

  if (kind === "mandate_replace") {
    const steps = arr(t.steps).filter(isObj);
    const [q, u, m] = [str(t.query_price), str(t.upstream_price), str(t.margin)];
    const payeesOf = (s: Obj) => arr(s.payees).map(str);
    const warnings: string[] = [];
    for (const s of steps) {
      const payees = payeesOf(s);
      if (payees.length > 1) warnings.push(`The ${str(s.agent)} mandate may pay ${payees.length} addresses`);
      for (const p of payees) if (!nameOf(p)) warnings.push(`The ${str(s.agent)} mandate may pay an address the ledger has no name for: ${p}`);
    }
    const rows: [string, string][] = [["Price per query", `${q} USDZ`], ["Supplier price", `${u} USDZ`], ["Margin per sale", m]];
    for (const s of steps) {
      const spent = s.spent_at_proposal === undefined ? "" : ` (${str(s.spent_at_proposal)} already spent)`;
      rows.push([`Step ${str(s.order)}: ${str(s.agent)} mandate`, `up to ${str(s.cap)} per payment, ${str(s.budget)} in total${spent}`]);
      rows.push([`Step ${str(s.order)}: may pay`, arr(s.payees).map((p) => whoFull(str(p))).join(", ")]);
    }
    rows.push(["All agents' budgets", `${str(t.total_budget)} USDZ in total`]);
    return {
      approvable: true,
      title: `Option ${str(t.option)}: sell at ${q}`,
      sentence: `Sell each query at ${q} USDZ. The supplier now charges ${u}, so each sale earns ${m}.`,
      amount: `${q} USDZ per query`,
      margin: `${m} per sale`,
      recipient: steps.map((s) => `${payeesOf(s).map(who).join(", ")} (${str(s.agent)})`).join("; "),
      rows,
      short: `option ${str(t.option)}: sell at ${q} per query (margin ${m})`,
      warnings,
      label: `Option ${str(t.option)}`,
      big: q,
      unit: "USDZ per query",
    };
  }

  if (kind === "refund_batch") {
    const refunds = arr(t.refunds).filter(isObj);
    const n = refunds.length;
    const sales = `${n} sale${n === 1 ? "" : "s"}`;
    const customer = str(t.customer);
    const payees = [...new Set(refunds.map((r) => str(r.to).toLowerCase()))];
    const elsewhere = payees.filter((p) => p !== customer.toLowerCase());
    return {
      approvable: true,
      title: `Refund ${sales}`,
      sentence: `Refund ${sales} to ${nameOf(customer) ?? shortAddr(customer)}, ${str(t.total)} USDZ in total.`,
      amount: `${str(t.total)} USDZ`,
      margin: null,
      recipient: [customer, ...elsewhere].map(who).join("; "),
      rows: [
        ["Total", `${str(t.total)} USDZ`],
        ["Pays", whoFull(customer)],
        ["Sales", refunds.map((r) => `#${str(r.sale_id)} ${str(r.amount)}`).join(", ")],
        ["Reason", str(t.reason)],
        ...(t.dispute_id ? [["Dispute", str(t.dispute_id)] as [string, string]] : []),
      ],
      short: `refund ${sales}, ${str(t.total)} USDZ`,
      warnings: elsewhere.length ? [`Pays addresses other than the customer: ${elsewhere.join(", ")}`] : [],
      label: `Refund ${sales}`,
      big: money(t.total),
      unit: "USDZ",
    };
  }

  if (kind === "invoice_payment") {
    const cur = str(t.currency) || "EUR";
    const c = isObj(t.conversion) ? t.conversion : null;
    const recipient = `${str(t.beneficiary_name)}, IBAN …${str(t.iban_last4)}, BIC ${str(t.bic)}`;
    const fee = t.fee_max !== undefined ? `at most ${cur} ${money(t.fee_max)} (the real fee is recorded)` : `about ${cur} ${money(t.fee)}`;
    const after = isObj(t.after) ? t.after : {};
    const fx = c ? `${str(c.sell_currency)} ${money(c.sell_amount)} into ${str(c.buy_currency)} ${money(c.buy_amount)}` : null;
    const rows: [string, string][] = [
      ["Amount", `${cur} ${money(t.amount)}`],
      ["Bank fee", fee],
      ["Pays", recipient],
      ["Invoice", `${str(t.invoice_no)} from ${str(t.vendor)}, reference ${str(t.reference)}`],
      ["Method", str(t.method)],
      ["Conversion", fx ? `${fx} at rate ${str(c!.client_rate)}, quote valid until ${str(c!.valid_to)}` : "none: paid from free EUR"],
      ["After payment", `EUR free above the floor ${money(after.eur_free)}, USD ${money(after.usd_available)}`],
    ];
    return {
      approvable: true,
      title: `Pay invoice ${str(t.invoice_no)}`,
      sentence: `Pay ${str(t.vendor)} ${cur} ${money(t.amount)} for invoice ${str(t.invoice_no)} by ${str(t.method) || "SWIFT"}${fx ? `, after converting ${fx}` : ", from free EUR"}.`,
      amount: `${cur} ${money(t.amount)}`,
      margin: null,
      recipient,
      rows,
      short: `pay ${cur} ${money(t.amount)} to ${str(t.beneficiary_name)}`,
      warnings: str(t.vendor) && str(t.vendor) !== str(t.beneficiary_name) ? [`The account holder (${str(t.beneficiary_name)}) is not the vendor on the invoice (${str(t.vendor)})`] : [],
      label: `Invoice ${str(t.invoice_no)}`,
      big: money(t.amount),
      unit: cur,
    };
  }

  if (kind === "supplier_payment") {
    // A supplier paid in the invoice's own currency on its route (src/payouts/plan.ts).
    const cur = str(t.currency);
    const c = isObj(t.conversion) ? t.conversion : null;
    const fx = c ? `${str(c.sell_currency)} ${money(c.sell_amount)} into ${str(c.buy_currency)} ${money(c.buy_amount)}` : null;
    const recipient = `${str(t.beneficiary_name)}, ${str(t.account)}`;
    const how = `${str(t.method)}${str(t.clearing) ? ` (${str(t.clearing)})` : ""}`;
    return {
      approvable: true,
      title: `Pay invoice ${str(t.invoice_no)}`,
      sentence: `Pay ${str(t.vendor)} ${cur} ${money(t.amount)} for invoice ${str(t.invoice_no)} by ${how}${fx ? `, after converting ${fx}` : `, from the ${cur} balance`}.`,
      amount: `${cur} ${money(t.amount)}`,
      margin: null,
      recipient,
      rows: [
        ["Amount", `${cur} ${money(t.amount)}`],
        ["Fee reserve", `at most ${cur} ${money(t.fee_reserve)} held back (the real fee is recorded)`],
        ["Pays", recipient],
        ["Invoice", `${str(t.invoice_no)} from ${str(t.vendor)}, reference ${str(t.reference)}`],
        ["Method", how],
        ["Conversion", fx ? `${fx} at rate ${str(c!.client_rate)}, quote valid until ${str(c!.valid_to)}` : `none: paid from the ${cur} balance`],
      ],
      short: `pay ${cur} ${money(t.amount)} to ${str(t.beneficiary_name)}`,
      warnings: str(t.vendor) && str(t.vendor) !== str(t.beneficiary_name) ? [`The account holder (${str(t.beneficiary_name)}) is not the vendor on the invoice (${str(t.vendor)})`] : [],
      label: `Invoice ${str(t.invoice_no)}`,
      big: money(t.amount),
      unit: cur,
    };
  }

  if (kind === "policy_change") {
    const changes = arr(t.changes).filter(isObj);
    const shown = (v: unknown) => str(v) || "no extra limit";
    const one = changes.length === 1 ? changes[0]! : null;
    return {
      approvable: true,
      title: "Policy change",
      sentence: `${one ? `Change ${str(one.label)} from ${shown(one.from)} to ${shown(one.to)}` : `Change ${changes.length} policy settings`}. Reason: ${str(t.reason)}.`,
      amount: one ? shown(one.to) : `${changes.length} settings`,
      margin: null,
      recipient: "nobody: no money moves",
      rows: [...changes.map((c) => [str(c.label), `${shown(c.from)} → ${shown(c.to)}`] as [string, string]), ["Reason", str(t.reason)]],
      short: "this policy change",
      warnings: changes.filter((c) => policyLoosens({ key: str(c.key), from: str(c.from), to: str(c.to) })).map((c) => `This loosens ${str(c.label)}`),
      amountLabel: "New value",
      label: "Policy change",
      big: one ? shown(one.to) : String(changes.length),
      unit: one ? str(one.label) : "settings",
    };
  }

  if (kind === "payee_change") {
    const v = (isObj(t.verification) ? t.verification : {}) as Obj;
    const iban = str(t.new_iban);
    return {
      approvable: true, title: "Supplier bank details",
      sentence: `Pay ${str(t.vendor)} from now on to IBAN ${iban.replace(/(.{4})/g, "$1 ").trim()} (BIC ${str(t.new_bic)}) instead of the account ending ${str(t.old_iban_last4)}. ${str(v.by)} recorded that the supplier confirmed it: ${str(v.how)}.`,
      amount: "0.00 (nothing moves now)", margin: null, recipient: `${str(t.vendor)}, account ending ${iban.slice(-4)}`,
      rows: [["Supplier", str(t.vendor)], ["Old account", `…${str(t.old_iban_last4)}`], ["New IBAN", iban], ["New BIC", str(t.new_bic)], ["Verified by", str(v.by)], ["How", str(v.how)]],
      short: "this bank-detail change",
      warnings: ["Changed bank details are how invoice fraud works. Approve only if the new IBAN matches what the supplier told you on a number you already had."],
      amountLabel: "Moves now", label: "Bank details", big: `…${iban.slice(-4)}`, unit: "new account",
    };
  }

  if (kind === "payee_add" && isObj(t.bank) && !str(t.bank.iban)) {
    // A supplier without an IBAN (US, China, UK): the full account number and routing code the CFO approves.
    const v = (isObj(t.verification) ? t.verification : {}) as Obj;
    const a = (isObj(t.address) ? t.address : {}) as Obj;
    const b = t.bank;
    const number = str(b.accountNumber);
    const routing = str(b.routingType) === "aba" ? `ABA ${str(b.routingValue)}` : str(b.routingType) === "sort_code" ? `sort code ${str(b.routingValue).replace(/^(\d\d)(\d\d)(\d\d)$/, "$1-$2-$3")}` : str(b.routingType) ? `${str(b.routingType)} ${str(b.routingValue)}` : "";
    const where = [routing, str(b.swiftCode) ? `BIC ${str(b.swiftCode)}` : ""].filter(Boolean).join(", ");
    return {
      approvable: true, title: "New supplier",
      sentence: `Add ${str(t.vendor)} as a supplier, paid in ${str(b.currency)} by ${str(b.method)} to account ${number} (${where}, ${str(b.country)}). ${str(v.by)} recorded that the supplier confirmed it: ${str(v.how)}.`,
      amount: "0.00 (nothing moves now)", margin: null, recipient: `${str(t.vendor)}, account ending ${number.slice(-4)}`,
      rows: [["Supplier", str(t.vendor)], ["Account number", number], ["Routing", where], ["Bank country", str(b.country)], ["Paid in", `${str(b.currency)} by ${str(b.method)}${str(b.clearing) ? ` (${str(b.clearing)})` : ""}`],
        ["Address", `${str(a.street)}, ${str(a.postcode)} ${str(a.city)}`], ["Verified by", str(v.by)], ["How", str(v.how)]],
      short: "this new supplier",
      warnings: ["A supplier's own invoice is how invoice fraud works. Approve only if the account matches what the supplier told you on a number you already had."],
      amountLabel: "Moves now", label: "New supplier", big: `…${number.slice(-4)}`, unit: "new supplier",
    };
  }

  if (kind === "payee_add") {
    const v = (isObj(t.verification) ? t.verification : {}) as Obj;
    const a = (isObj(t.address) ? t.address : {}) as Obj;
    const iban = str(t.iban);
    // Terms from the payout routes carry the currency and method the supplier is paid in; older ones only the IBAN.
    const b = (isObj(t.bank) ? t.bank : null) as Obj | null;
    const paidIn = b ? `${str(b.currency)} by ${str(b.method)}${str(b.clearing) ? ` (${str(b.clearing)})` : ""}` : "";
    return {
      approvable: true, title: "New supplier",
      sentence: `Add ${str(t.vendor)} as a supplier, paid${paidIn ? ` in ${paidIn}` : ""} to IBAN ${iban.replace(/(.{4})/g, "$1 ").trim()} (BIC ${str(t.bic) || "none"}). ${str(v.by)} recorded that the supplier confirmed it: ${str(v.how)}.`,
      amount: "0.00 (nothing moves now)", margin: null, recipient: `${str(t.vendor)}, account ending ${iban.slice(-4)}`,
      rows: [["Supplier", str(t.vendor)], ["IBAN", iban], ["BIC", str(t.bic)], ...(paidIn ? [["Paid in", paidIn] as [string, string]] : []), ["Address", `${str(a.street)}, ${str(a.postcode)} ${str(a.city)}`], ["Verified by", str(v.by)], ["How", str(v.how)]],
      short: "this new supplier",
      warnings: ["A supplier's own invoice is how invoice fraud works. Approve only if the IBAN matches what the supplier told you on a number you already had."],
      amountLabel: "Moves now", label: "New supplier", big: `…${iban.slice(-4)}`, unit: "new supplier",
    };
  }

  if (kind === "quarantine_release") {
    const back = str(t.action) === "return";
    return {
      approvable: true, title: back ? "Return a held payment" : "Accept a held payment",
      sentence: back
        ? `Send the ${str(t.amount)} test USD that Metal held in quarantine back to its sender ${str(t.originator)}. Nothing else moves.`
        : `Accept the ${str(t.amount)} test USD from ${str(t.originator)}, held by Metal in quarantine, into the sweep wallet. Only accept it if you know who sent it and why.`,
      amount: `${str(t.amount)} test USD`, margin: null, recipient: back ? str(t.originator) : `the sweep wallet ${str(t.to)}`,
      rows: [["From", str(t.originator)], ["Amount", `${str(t.amount)} test USD`], ["Goes to", back ? `its sender ${str(t.to)}` : `the sweep wallet ${str(t.to)}`], ["Held in", `transaction ${str(t.tx_hash).slice(0, 10)}…`]],
      short: back ? "returning it" : "accepting it", warnings: back ? [] : ["Money from someone you do not know can be a mistake or an attempt to mix funds with yours."],
      amountLabel: back ? "Returns" : "Accepts", label: "Held payment", big: str(t.amount), unit: "test USD",
    };
  }

  if (kind === "task_card") {
    const mccs = Array.isArray(t.merchant_categories) ? t.merchant_categories.map(str).join(", ") : "";
    const where = mccs === "4511" ? "an airline" : mccs === "7011" ? "a hotel" : mccs === "4112" ? "a railway" : mccs === "5734" ? "a software or data seller" : "a merchant";
    const ends = utcMinute(str(t.valid_until));
    const by = str(t.asked_by);
    // D22: one of Northwind's own agents may ask for a single-use card for a one-off purchase it chose to make.
    const own = by.startsWith("agent:") ? `the ${by.slice(6).charAt(0).toUpperCase()}${by.slice(7)} agent` : null;
    const asked = by === "cfo-at-runner" ? "you, at the runner" : own ?? (by.startsWith("ext:") ? `outside agent ${by}` : "someone with the dashboard link");
    const check = by === "cfo-at-runner" ? "Purser read this from your own message."
      : own ? `${own.charAt(0).toUpperCase()}${own.slice(1)} chose this purchase and asked for the card; it cannot pay before you approve, and the card pays once.`
      : by.startsWith("ext:") ? `An outside agent (${by}) asked for this card, not you. Approve only if you expect it.`
      : "This came from a chat message sent with the dashboard link: your phone, or anyone you gave the viewer link. Approve only if you sent it.";
    return {
      approvable: true, title: "Task card",
      sentence: `Issue a single-use virtual card at Airwallex for a ${str(t.label).toLowerCase()}: one purchase of at most ${money(t.amount)} EUR at ${where} (merchant category ${mccs}), until ${ends}. For: ${str(t.purpose)}.`,
      amount: `${money(t.amount)} EUR at most, once`, margin: null, recipient: `${where} (merchant category ${mccs})`,
      rows: [["For", str(t.purpose)], ["Asked by", asked], ["Most", `${money(t.amount)} EUR`], ["Pays", "one purchase, then Airwallex declines"], ["Merchant category", mccs], ["Ends", ends]],
      short: "this task card", warnings: [`${check} Check the amount and the end date before you approve.`],
      amountLabel: "Card limit", label: str(t.label), big: money(t.amount), unit: "EUR, one purchase",
    };
  }

  if (kind === "airi_purchase") {
    // The Airi rail (src/airi/purchase.ts): the CFO signs agent, amount, currency, merchant and items. Airi's own tap
    // (the wallet owner's passkey in Airi) comes after this, for the same mandate.
    const m = isObj(t.merchant) ? t.merchant : {};
    const items = arr(t.items).filter(isObj).map((i) => `${str(i.quantity)} × ${str(i.name)} at ${money(i.unit_price)}`).join("; ");
    const agent = str(t.agent);
    return {
      approvable: true, title: "Airi purchase",
      sentence: `Let the ${agent} agent pay ${str(t.currency)} ${money(t.amount)} to ${str(m.name)} (${str(m.url)}) with a single-use card credential from Airi, for: ${str(t.description)}.`,
      amount: `${str(t.currency)} ${money(t.amount)}`, margin: null, recipient: `${str(m.name)}, ${str(m.country)}`,
      rows: [["Agent", agent], ["Amount", `${str(t.currency)} ${money(t.amount)}`], ["Merchant", `${str(m.name)} (${str(m.url)})`], ["Items", items], ["For", str(t.description)]],
      short: "this Airi purchase",
      warnings: ["After your Face ID, Airi asks the wallet owner to confirm the same purchase with a passkey; Purser re-checks these exact terms before it asks Airi for the card."],
      amountLabel: "Pays", label: "Airi purchase", big: money(t.amount), unit: str(t.currency),
    };
  }

  if (kind === "agent_onboard") {
    const c = isObj(t.card) ? t.card : {};
    return {
      approvable: true, title: "Company card for an outside agent",
      sentence: `Issue ${str(t.display_name)} (outside agent ${str(t.agent_id)}, connected through the agent API) a virtual company card at Airwallex: at most ${money(c.per_tx)} EUR per purchase and ${money(c.monthly)} EUR per month. For: ${str(t.purpose)}.`,
      amount: `${money(c.monthly)} EUR a month at most`, margin: null, recipient: "merchants the agent pays, within the card's limits",
      rows: [["Agent", `${str(t.display_name)} (${str(t.agent_id)})`], ["For", str(t.purpose)], ["Most per purchase", `${money(c.per_tx)} EUR`], ["Most per month", `${money(c.monthly)} EUR`]],
      short: "this card", warnings: ["This agent is not one of ours. Approve only if you know who runs it and what it buys; its limits then follow your policy, and the emergency stop freezes its card too."],
      amountLabel: "Spending limit", label: "Outside agent", big: money(c.per_tx), unit: "EUR per purchase",
    };
  }

  // Block 1: the approval is the on-chain signature. The passkey signs the account's Execute digest, and the Metal
  // account checks both Face IDs itself; no server key is an owner.
  if (kind === "owners_execute") {
    const a = isObj(t.action) ? t.action : {};
    const digest = str(t.onchain_digest);
    const calls = arr(t.calls).filter(isObj);
    const c = calls[0] ?? {};
    const exp = Math.floor(Date.parse(str(t.expires_at)) / 1000), until = Number(str(t.valid_until));
    let laneOk: boolean;
    try { laneOk = /^\d+$/.test(str(t.nonce)) && (BigInt(str(t.nonce)) >> BigInt(255)) === BigInt(0); } catch { laneOk = false; }
    // What the page itself can check without decoding the call (the runner decodes it and compares cap, budget, payee).
    const problems = [
      ...(/^0x[0-9a-f]{64}$/.test(digest) ? [] : ["The terms carry no valid on-chain digest"]),
      ...(calls.length === 1 && str(c.target).toLowerCase() === str(t.account).toLowerCase() && str(c.value) === "0" ? [] : ["The call does not go to the account itself with no value"]),
      ...(str(c.call_data).slice(0, 10) === OWNER_SELECTORS[str(a.what) as keyof typeof OWNER_SELECTORS] ? [] : ["The call is not the mandate change the words name"]),
      ...(Number.isSafeInteger(until) && until >= exp && until <= exp + 300 ? [] : ["The signed deadline does not end with this proposal"]),
      ...(laneOk ? [] : ["The nonce is not a two-owner lane"]),
    ];
    const okDigest = problems.length === 0;
    const payee = str(a.payee);
    return {
      approvable: okDigest,
      title: `${str(a.what) === "revoke" ? "Revoke" : "Bind"} the ${str(a.agent)} mandate, signed on chain`,
      sentence: `Your Face ID signs this on chain: the business account ${shortAddr(str(t.account))} is owned by two passkeys, the CFO's and the controller's, and runs this only with both. Up to ${str(a.cap)} per payment, ${str(a.budget)} in total, to ${str(a.payee_name)} only.`,
      amount: `${str(a.budget)} USDZ in total`, margin: null, recipient: `${str(a.payee_name)} ${shortAddr(payee)}`,
      rows: [["Account", str(t.account)], ["Mandate", str(a.mandate)], ["Per payment", `${str(a.cap)} USDZ`], ["Budget", `${str(a.budget)} USDZ`], ["May pay", whoFull(payee)],
        ["Signed on chain", "the account's Execute digest (what your passkey signs)"], ["Digest", digest], ["Valid until", utcMinute(new Date(Number(str(t.valid_until)) * 1000).toISOString())]],
      short: "the on-chain mandate change", warnings: problems.map((w) => `${w}; this cannot be signed`),
      label: "On chain", big: str(a.budget), unit: "USDZ budget",
    };
  }

  if (kind === "dev_test") {
    return {
      approvable: true, title: str(t.label), sentence: `${str(t.purpose)}. Approving it records the approval and moves no money.`,
      amount: "0.00 (nothing moves)", margin: null, recipient: "nobody", rows: [["Purpose", str(t.purpose)], ["Moves", "nothing"]],
      short: "the dev test", warnings: [], label: "Dev test", big: "0.00", unit: "nothing moves",
    };
  }

  return {
    approvable: false, title: `Proposal of kind ${kind || "unknown"}`, sentence: "This kind of proposal cannot be approved on the phone.",
    amount: "", margin: null, recipient: "", rows: [], short: kind, warnings: [], label: kind || "unknown", big: "", unit: "",
  };
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The agent behind a proposal, for the first line of the approval view: from the hashed terms where they name one
 * (who asked for a task card, the agent an Airi purchase or a mandate is for), else who proposed it (runner-signed).
 */
export function agentOf(createdBy: string, t: Obj): string {
  const kind = str(t.kind);
  if (kind === "task_card") {
    const by = str(t.asked_by);
    if (by === "cfo-at-runner") return "None: you asked at the runner";
    if (by.startsWith("agent:")) return `${cap1(by.slice(6))} agent`;
    if (by.startsWith("ext:")) return `Outside agent ${by.slice(4)}`;
    return "None: a chat message with the dashboard link";
  }
  if (kind === "agent_onboard") return `${str(t.display_name)} (outside agent ${str(t.agent_id)})`;
  if (kind === "airi_purchase" && str(t.agent)) return `${cap1(str(t.agent))} agent`;
  if (kind === "owners_execute" && isObj(t.action) && str(t.action.agent)) return `${cap1(str(t.action.agent))} agent`;
  if (createdBy === "human") return "None: a change made by a person";
  if (createdBy === "system" || createdBy === "") return "Purser";
  if (createdBy.startsWith("ext:")) return `Outside agent ${createdBy.slice(4)}`;
  return `${cap1(createdBy)} agent`;
}

/**
 * Why this waits for the CFO, in one line: the rule that sends it here, from the hashed terms and the runner-signed
 * policy; and when two people must approve it, that too.
 */
export function whyYou(t: Obj, policy: { key: string; value: string }[] = [], fourEyes?: { approved_by: string[] }): string {
  const val = (k: string) => policy.find((e) => e.key === k)?.value ?? "";
  const kind = str(t.kind);
  const [each, perDispute, cardEur] = [val("approval.refund_each"), val("approval.refund_per_dispute"), val("approval.task_card_eur")];
  const why = kind === "mandate_replace" ? "It changes what agents may pay on chain, and a mandate changes only with your Face ID."
    : kind === "refund_batch" ? (each && perDispute ? `Your policy sends refunds above ${each} USDZ each, or ${perDispute} per dispute, to you.` : "Your policy sends refunds above its limits to you.")
    : kind === "invoice_payment" || kind === "supplier_payment" ? "A supplier is paid from the Airwallex account only with your Face ID."
    : kind === "policy_change" ? "The CFO policy changes only with your Face ID."
    : kind === "payee_change" ? "A supplier's bank details change only with your Face ID."
    : kind === "payee_add" ? "A new supplier is paid only after your Face ID."
    : kind === "quarantine_release" ? "Money Metal held in quarantine moves only with your Face ID."
    : kind === "task_card" ? (cardEur ? `Without your Face ID, a task card is issued only when you ask at the runner, up to ${cardEur} EUR.` : "A task card is issued only with your Face ID.")
    : kind === "airi_purchase" ? "An agent's purchase through Airi starts only with your Face ID."
    : kind === "agent_onboard" ? "An outside agent gets a company card only with your Face ID."
    : kind === "owners_execute" ? "The business account on chain runs this only with your passkey and the controller's."
    : kind === "dev_test" ? "It checks Face ID on this phone; nothing moves."
    : "This kind of proposal cannot be approved on the phone.";
  if (!fourEyes) return why;
  const so = fourEyes.approved_by.length ? ` Approved so far: ${fourEyes.approved_by.join(", ")}.` : "";
  return `${why} It needs two people (four eyes).${so}`;
}

/** "0,03" (a decimal comma, as many phones type it) reads as 0.03; nothing else is guessed. */
export function normalizeAmount(input: string): string {
  const v = input.trim();
  return /^\d+,\d+$/.test(v) ? v.replace(",", ".") : v;
}

/** Why an amount cannot be a policy value, checked before anything is signed; null when it can. */
export function amountProblem(kind: "money" | "optional_money" | "choice", value: string): string | null {
  if (kind === "choice" || (kind === "optional_money" && value === "")) return null;
  if (value === "") return "write an amount";
  return /^\d{1,9}\.\d{2}$/.test(value) ? null : `write it with two decimals, like 0.03 (not ${JSON.stringify(value)})`;
}

/** The terms of a policy change made on the phone: its own id (C-…), ten minutes, the exact changes. */
export function buildPolicyTerms(changes: { key: string; label: string; from: string; to: string }[], reason: string, now: Date, randomHex: string): Obj {
  return {
    schema: "kit11.approval-terms/v1", kind: "policy_change", proposal_id: `C-${randomHex}`,
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), changes, reason,
  };
}

/** The alternatives a person did not tap, as the confirm screen lists them ("This is not …"). */
export function notList(chosen: PhoneProposal, all: PhoneProposal[], names: Record<string, string>): string[] {
  return all.filter((p) => p.group === chosen.group && p.proposal_id !== chosen.proposal_id).map((p) => {
    try {
      const t = JSON.parse(p.canonical) as unknown;
      return isObj(t) ? describeTerms(t, names).short : p.proposal_id;
    } catch {
      return p.proposal_id;
    }
  });
}

// ── Bytes ──

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error("not hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToB64url(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── The pages ──

function el(tag: string, cls?: string, kids: (Node | string | null | false | undefined)[] = []): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  return n;
}
const txt = (tag: string, cls: string, s: unknown) => el(tag, cls, [str(s)]);

function countdown(iso: string): { text: string; soon: boolean; over: boolean } {
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return { text: "", soon: false, over: false };
  if (ms <= 0) return { text: "expired", soon: true, over: true };
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return { text: `expires in ${h ? `${h}h ` : ""}${m}m ${String(s % 60).padStart(2, "0")}s`, soon: ms < 120_000, over: false };
}

/** Keeps every [data-expires] countdown on the page current. */
function tickCountdowns(): void {
  document.querySelectorAll<HTMLElement>("[data-expires]").forEach((n) => {
    const c = countdown(n.dataset.expires!);
    n.textContent = c.text;
    n.classList.toggle("soon", c.soon);
  });
}

/**
 * The approvals the relay hands over were signed by the runner (security review M3). The phone checks that signature
 * against the runner's key, pinned from the viewer link, over exactly the part it decides on; anything the relay
 * changed or left unsigned fails.
 */
export async function verifyRunnerSignature(a: Obj, runnerSpki: string): Promise<boolean> {
  try {
    const sig = isObj(a.signature) ? str(a.signature.sig) : "";
    if (!sig || !runnerSpki) return false;
    const key = await crypto.subtle.importKey("spki", b64urlToBytes(runnerSpki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const text = canonicalize({ proposals: a.proposals, names: a.names, passkey: a.passkey, policy: a.policy, ledger_seq: a.ledger_seq });
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlToBytes(sig), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

const VIEW_STORE = "kit11.view";
let viewKey = "";

/**
 * The relay answers only with its viewer key (security review M2). It arrives once as a link with #view=<key>
 * (a fragment never reaches a server), is kept on this device, and is removed from the address bar at once.
 */
export function takeViewKey(hash: string, store: Pick<Storage, "getItem" | "setItem"> | null): string {
  return takeFromLink(hash, store, "view", /^[0-9a-f]{32}$/, VIEW_STORE);
}

const RUNNER_STORE = "kit11.runner";
/** Another runner key a link brought to this device: kept apart, never used to verify until the person accepts it. */
const OFFER_STORE = "kit11.runner.offer";
const RUNNER_KEY = /^[A-Za-z0-9_-]{80,200}$/;
const SEQ_STORE = "kit11.seq";

/** The runner key this device has pinned, and another one a link offered (null when none). */
export interface RunnerPin {
  key: string;
  offered: string | null;
}

/**
 * The runner's public key from the same link (base64url SPKI), pinned on this device. A link never replaces a pinned
 * key by itself (review N3): another key in a link is kept apart as an offer. Each new run has its own key, so the
 * page then asks; only the person's press on "This is a new run: use the new key" makes the offer the pin
 * (useNewRunnerKey), and only when that key signed what the relay sends now (judgeRunnerKey).
 */
export function takeRunnerKey(hash: string, store: Pick<Storage, "getItem" | "setItem"> | null): RunnerPin {
  const get = (k: string) => { try { return store?.getItem(k) ?? ""; } catch { return ""; } };
  const set = (k: string, v: string) => { try { store?.setItem(k, v); } catch { /* private mode: this page only */ } };
  const raw = /(?:^#|&)runner=([^&]*)(?:&|$)/.exec(hash)?.[1];
  const fromLink = raw !== undefined && RUNNER_KEY.test(raw) ? raw : null;
  const pinned = get(RUNNER_STORE);
  if (!pinned) {
    // The first link on this device pins its key, as before.
    if (fromLink) { set(RUNNER_STORE, fromLink); set(OFFER_STORE, ""); }
    return { key: fromLink ?? "", offered: null };
  }
  if (fromLink === pinned) { set(OFFER_STORE, ""); return { key: pinned, offered: null }; }
  if (fromLink) { set(OFFER_STORE, fromLink); return { key: pinned, offered: fromLink }; }
  const kept = get(OFFER_STORE);
  return { key: pinned, offered: RUNNER_KEY.test(kept) && kept !== pinned ? kept : null };
}

export type RunnerVerdict =
  | { state: "signed"; key: string }
  | { state: "new_run"; pinned: string; offered: string }
  | { state: "unsigned" };

/**
 * Whose signature the relay's answer carries. The pinned key's: show it. Not the pinned key's but the key a link
 * offered: a new run, and the page asks before it uses that key. Neither: refuse it, whatever any link said.
 */
export async function judgeRunnerKey(a: Obj, pin: RunnerPin): Promise<RunnerVerdict> {
  if (pin.key && (await verifyRunnerSignature(a, pin.key))) return { state: "signed", key: pin.key };
  if (pin.key && pin.offered && pin.offered !== pin.key && (await verifyRunnerSignature(a, pin.offered))) {
    return { state: "new_run", pinned: pin.key, offered: pin.offered };
  }
  return { state: "unsigned" };
}

/**
 * The person's press on "This is a new run: use the new key": the offered key becomes the pin, and the ledger counter
 * starts again (a new run's ledger counts from its own start). Anything but a real press (a click the browser marks
 * as the user's, isTrusted) or a verdict other than new_run changes nothing and returns null.
 */
export function useNewRunnerKey(v: RunnerVerdict, press: { isTrusted: boolean } | null | undefined, store: Pick<Storage, "getItem" | "setItem"> | null): RunnerPin | null {
  if (v.state !== "new_run" || press?.isTrusted !== true || !RUNNER_KEY.test(v.offered)) return null;
  try {
    store?.setItem(RUNNER_STORE, v.offered);
    store?.setItem(OFFER_STORE, "");
    store?.setItem(SEQ_STORE, "0");
  } catch { /* private mode: the new key holds for this page only */ }
  return { key: v.offered, offered: null };
}

/** A runner key's fingerprint, as the runner prints it beside the viewer link: SHA-256 of the SPKI, first 16 hex. */
export async function runnerKeyFingerprint(spki: string): Promise<string> {
  try {
    return await passkeyFingerprint(b64urlToBytes(spki).buffer);
  } catch {
    return "unreadable";
  }
}

/** The newest ledger counter this phone has seen signed; an older signed set is a replay (review N4). */
export function freshEnough(seq: number, store: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!Number.isInteger(seq) || seq < 0) return false;
  let seen: number;
  try { seen = Number(store?.getItem(SEQ_STORE) ?? "0") || 0; } catch { seen = 0; }
  if (seq < seen) return false;
  try { store?.setItem(SEQ_STORE, String(seq)); } catch { /* keep going without memory */ }
  return true;
}

function takeFromLink(hash: string, store: Pick<Storage, "getItem" | "setItem"> | null, name: string, ok: RegExp, storeKey: string): string {
  const v = new RegExp(`(?:^#|&)${name}=([^&]*)(?:&|$)`).exec(hash)?.[1];
  if (v !== undefined && ok.test(v)) {
    try { store?.setItem(storeKey, v); } catch { /* private mode: keep it for this page only */ }
    return v;
  }
  try { return store?.getItem(storeKey) ?? ""; } catch { return ""; }
}

let runnerPin: RunnerPin = { key: "", offered: null };
let deviceStore: Pick<Storage, "getItem" | "setItem"> | null = null;
const REPLAYED = "The relay sent an older signed state than this phone already saw. Nothing can be signed here; tell Claude.";
const UNSIGNED = "What the relay sent is not signed by the runner this phone knows, nor by a key from a link opened on it. Nothing can be signed here. Open this run's viewer link from Claude on this phone: if it is a new run, this page then asks once to use its key. Tell Claude if this stays.";

/**
 * The relay's answer may be shown only when the pinned runner key signed it and it is not older than what this phone
 * saw. A new run's key, offered by a link, gets the question first (keyChangePanel); anything else is refused.
 */
async function trusted(app: HTMLElement, data: Obj, again: () => void): Promise<boolean> {
  const v = await judgeRunnerKey(data, runnerPin);
  if (v.state === "new_run") {
    keyChangePanel(app, v, again);
    return false;
  }
  if (v.state === "unsigned") {
    app.replaceChildren(txt("p", "alarm", UNSIGNED));
    return false;
  }
  if (!freshEnough(Number(data.ledger_seq), deviceStore)) {
    app.replaceChildren(txt("p", "alarm", REPLAYED));
    return false;
  }
  return true;
}

/**
 * The key changed because the run did: the old and new key's fingerprints, and one button. Only its press replaces
 * the pin (useNewRunnerKey checks the press is the person's); nothing is signed or approved by it.
 */
function keyChangePanel(app: HTMLElement, v: Extract<RunnerVerdict, { state: "new_run" }>, again: () => void): void {
  const oldFp = txt("dd", "mono fp", "…");
  const newFp = txt("dd", "mono fp", "…");
  void runnerKeyFingerprint(v.pinned).then((t) => { oldFp.textContent = t; });
  void runnerKeyFingerprint(v.offered).then((t) => { newFp.textContent = t; });
  const use = el("button", "confirm", ["This is a new run: use the new key"]) as HTMLButtonElement;
  use.type = "button";
  use.id = "use-new-key";
  const status = el("p", "sheet-status");
  use.addEventListener("click", (e) => {
    const next = useNewRunnerKey(v, e, deviceStore);
    if (!next) {
      status.textContent = "The key was not changed.";
      return;
    }
    runnerPin = next;
    use.disabled = true;
    status.textContent = "This phone now uses the new run's key. Loading…";
    again();
  });
  app.replaceChildren(el("section", "keychange", [
    txt("p", "eyebrow", "New run"),
    txt("h1", "", "This link is from a new run"),
    txt("p", "lead", "Each run of Purser has its own runner key, so this phone still knows the last run's key."),
    el("dl", "facts", [txt("dt", "", "This phone knows"), oldFp, txt("dt", "", "The new link has"), newFp]),
    txt("p", "muted small", "What the relay sends now is signed by the new key. Use it only if Claude just gave you this run's link. Switching signs and approves nothing."),
    use,
    status,
  ]));
}

const NEEDS_LINK = "This device needs the viewer link. Open the link Claude gave you once on this phone, then come back.";

/**
 * A guest without the viewer link: say what this page is and where to look instead, without asking the relay (which
 * would only answer 401). On localhost the page may run without a key, so it asks as before.
 */
function guestWithoutLink(app: HTMLElement): boolean {
  if (viewKey || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return false;
  const signin = el("a", "", ["how the CFO signs in"]) as HTMLAnchorElement;
  signin.href = "/?signin";
  const rec = el("a", "", ["the recorded CFO dashboard"]) as HTMLAnchorElement;
  rec.href = "/?recorded";
  app.replaceChildren(el("p", "alarm", ["This page is for the CFO and needs the private viewer link. As a guest, see ", signin, " or ", rec, "."]));
  return true;
}

/** D20: the relay asks for a passkey session before the CFO's actions (policy, policy text, Ask Purser). */
const SESSION_NEEDED = /^sign in with your passkey first/;

/** D20: signs in with the enrolled passkey (Face ID); the relay sets a session cookie the page itself cannot read. */
async function passkeySignIn(): Promise<boolean> {
  const view = { "x-kit11-view": viewKey };
  const o = await fetch("/api/session/options", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json", ...view }, body: "{}" }).catch(() => null);
  if (!o || !o.ok) return false;
  const opt = (await o.json().catch(() => ({}))) as { challenge?: string; allow?: string[] };
  if (typeof opt.challenge !== "string") return false;
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({ publicKey: {
      challenge: b64urlToBytes(opt.challenge), rpId: location.hostname, userVerification: "required", timeout: 60_000,
      allowCredentials: (opt.allow ?? []).map((id) => ({ type: "public-key" as const, id: b64urlToBytes(id) })),
    } })) as PublicKeyCredential | null;
  } catch {
    return false;
  }
  if (!cred) return false;
  const res = await fetch("/api/session", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json", ...view }, body: JSON.stringify({ challenge: opt.challenge, credential: serializeAssertion(cred) }) }).catch(() => null);
  return !!res && res.status === 200;
}

/** D20: the relay's word (in /api/approvals) that this device has no passkey session yet; null when it said nothing. */
let sessionMissing: boolean | null = null;
const SESSION_PATHS = new Set(["/api/policy", "/api/policy-text", "/api/ask"]);

async function api(path: string, body?: unknown, retried = false): Promise<{ status: number; data: Obj }> {
  const view = { "x-kit11-view": viewKey };
  // D20: sign in first when the relay said this device has no session, so the CFO's action is not refused first.
  if (body !== undefined && !retried && sessionMissing === true && SESSION_PATHS.has(path)) {
    // One Face ID prompt per action: signed in or not, a 401 that follows does not ask again (security review, 1 Nov).
    if (await passkeySignIn()) sessionMissing = false;
    retried = true;
  }
  const res = await fetch(path, body === undefined
    ? { cache: "no-store", headers: { accept: "application/json", ...view } }
    : { method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json", ...view }, body: JSON.stringify(body) });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (path === "/api/approvals" && isObj(data) && typeof data.session_active === "boolean") sessionMissing = !data.session_active;
  // D20: a session is needed first (it lapsed meanwhile): sign in with the passkey once, then send the same request again.
  if (body !== undefined && !retried && res.status === 401 && isObj(data) && typeof data.error === "string" && SESSION_NEEDED.test(data.error)) {
    if (await passkeySignIn()) return api(path, body, true);
  }
  return { status: res.status, data: isObj(data) ? data : {} };
}

/** The terms hash: the first 8 characters to compare, the rest on one line (the whole hash on hover and when copied). */
function hashCell(hash: string): Node {
  const dd = el("dd", "hash", [txt("strong", "mono", hash.slice(0, 8)), txt("span", "mono", hash.slice(8))]);
  dd.title = hash;
  return dd;
}

/** Every field of the hashed terms, nested, as text (the "All terms" section). */
function termsTable(v: unknown): Node {
  if (Array.isArray(v)) {
    if (v.length === 0) return txt("span", "muted", "(none)");
    const t = el("table", "terms");
    v.forEach((x, i) => t.appendChild(el("tr", "", [txt("th", "", `${i + 1}`), el("td", "", [termsTable(x)])])));
    return t;
  }
  if (isObj(v)) {
    const t = el("table", "terms");
    for (const [k, x] of Object.entries(v)) t.appendChild(el("tr", "", [txt("th", "", k), el("td", "", [termsTable(x)])]));
    return t;
  }
  return txt("span", "mono", v === null ? "null" : v);
}

function serializeAssertion(c: PublicKeyCredential): Obj {
  const r = c.response as AuthenticatorAssertionResponse;
  return {
    id: c.id, rawId: bytesToB64url(c.rawId), type: c.type,
    response: {
      clientDataJSON: bytesToB64url(r.clientDataJSON), authenticatorData: bytesToB64url(r.authenticatorData), signature: bytesToB64url(r.signature),
      ...(r.userHandle ? { userHandle: bytesToB64url(r.userHandle) } : {}),
    },
    clientExtensionResults: c.getClientExtensionResults(),
    ...(c.authenticatorAttachment ? { authenticatorAttachment: c.authenticatorAttachment } : {}),
  };
}

function serializeRegistration(c: PublicKeyCredential): Obj {
  const r = c.response as AuthenticatorAttestationResponse;
  return {
    id: c.id, rawId: bytesToB64url(c.rawId), type: c.type,
    response: {
      clientDataJSON: bytesToB64url(r.clientDataJSON), attestationObject: bytesToB64url(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : [],
    },
    clientExtensionResults: c.getClientExtensionResults(),
    ...(c.authenticatorAttachment ? { authenticatorAttachment: c.authenticatorAttachment } : {}),
  };
}

function passkeyError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelled. Nothing was signed.";
  if (name === "InvalidStateError") return "This phone already has a passkey for this site.";
  if (name === "SecurityError") return "The passkey cannot be used on this address.";
  return `The passkey did not answer: ${e instanceof Error ? e.message : String(e)}`;
}

const FINAL = new Set(["pending", "rejected", "executed", "failed", "refused", "too_late", "already", "enrolled", "drafted", "cosigned", "answered"]);
const VERDICT: Record<string, { tone: string; head: string; lead: string }> = {
  queued: { tone: "wait", head: "Signed", lead: "Waiting for the runner to check your signature." },
  approved: { tone: "wait", head: "Approved", lead: "The runner checked your signature. Executing now." },
  rejected: { tone: "ok", head: "Rejected", lead: "Rejected with your passkey. Nothing will be paid." },
  executed: { tone: "ok", head: "Done", lead: "Approved with your passkey and executed." },
  failed: { tone: "bad", head: "Approved, but execution stopped", lead: "" },
  refused: { tone: "bad", head: "Refused", lead: "Nothing was approved." },
  too_late: { tone: "warn", head: "Too late", lead: "Nothing was approved." },
  already: { tone: "info", head: "Already decided", lead: "" },
  enrolled: { tone: "ok", head: "Passkey enrolled", lead: "From now on, approvals need this passkey." },
  cosigned: { tone: "wait", head: "1 of 2 approvals", lead: "Your Face ID counts. This one needs a second person (four eyes): it runs only once someone else approves it with their own passkey." },
  drafted: { tone: "ok", head: "Rules drafted", lead: "Opus turned your words into rules and the runner checked each one. Nothing has changed yet: review them and approve with Face ID." },
  answered: { tone: "info", head: "Purser", lead: "" },
  pending: { tone: "wait", head: "Confirm on the runner", lead: "Tell Claude the fingerprint above. The passkey counts once the runner confirms that same fingerprint." },
};

/**
 * The new passkey's fingerprint, computed on the phone from its own public key (SPKI SHA-256, first 16 hex): the
 * person on the runner confirms only this one, so a passkey slipped in by someone else does not count (M3).
 */
export async function passkeyFingerprint(spki: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", spki));
  const h = [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return h.match(/.{4}/g)!.join("-");
}

/** Polls a ticket and shows the runner's verdict until it is final; returns the last answer. */
async function follow(ticket: string, into: HTMLElement, done: Node, what = "", queuedLead?: string): Promise<{ status: string; message: string }> {
  const icon = el("div", "verdict-icon");
  const head = el("h2", "verdict-head");
  const subject = txt("p", "verdict-what", what);
  const lead = el("p", "verdict-lead");
  const detail = el("p", "verdict-detail");
  const box = el("div", "verdict", [icon, head, what ? subject : null, lead, detail]);
  into.replaceChildren(box, done);
  const started = Date.now();
  for (;;) {
    const { status, data } = await api(`/api/tickets/${encodeURIComponent(ticket)}`).catch(() => ({ status: 0, data: {} as Obj }));
    const s = status === 200 ? str(data.status) : "queued";
    const v = VERDICT[s] ?? VERDICT.queued!;
    box.className = `verdict ${v.tone}`;
    head.textContent = v.head;
    lead.textContent = s === "queued" && queuedLead ? queuedLead : v.lead;
    detail.textContent = s === "queued" && Date.now() - started > 20_000
      ? "The runner has not picked it up yet. If it is offline, your signature waits for it (up to 30 minutes)."
      : str(data.message);
    if (FINAL.has(s) || Date.now() - started > 5 * 60_000) return { status: s, message: str(data.message) };
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** What the confirm screen needs besides the proposal: names, alternatives, the passkey, and where to send. */
interface SheetContext {
  names: Record<string, string>;
  nots: string[];
  enrolled: boolean;
  credentials: { id: string }[];
  /** The element to return focus to on Back. */
  from: HTMLElement;
  /** REJECTED: the sheet says so, and the passkey signs the rejection hash instead of the terms hash. */
  decision?: "APPROVED" | "REJECTED";
  /** Sends the signed assertion; 202 means queued for the runner. */
  send: (credential: Obj, decision: "APPROVED" | "REJECTED") => Promise<{ status: number; data: Obj }>;
}

/**
 * A loud line when the CFO is about to approve what Opus advises rejecting (Friday run 2: a refund batch Opus advised
 * against was approved, meant as a rejection). Advice only: it never stops the CFO.
 */
export function againstAdvice(decision: "APPROVED" | "REJECTED", review: { recommendation: string } | null | undefined): string[] {
  return decision === "APPROVED" && review?.recommendation === "reject"
    ? ["Opus advises rejecting this. \"Approve anyway\" means you are about to APPROVE it; to say no, tap Reject."]
    : [];
}

/**
 * Checks once more and asks the passkey (Face ID) to sign: an approval signs the terms hash (Block 1: an
 * owners_execute signs the account's Execute digest from the hashed terms), a rejection the rejection hash. Says on
 * `status` why not, with `retry` true when the same button may be pressed again.
 */
async function askPasskey(o: PhoneProposal, terms: Obj, decision: "APPROVED" | "REJECTED", credentials: { id: string }[], status: HTMLElement):
  Promise<{ assertion: Obj; retry?: undefined } | { assertion: null; retry: boolean }> {
  const rejecting = decision === "REJECTED";
  status.textContent = rejecting ? "Waiting for Face ID to reject…" : "Waiting for Face ID…";
  // Rejecting is always safe, so it does not need the terms to check out; approving does.
  const again = rejecting ? { ok: true, problem: "" } : await checkOption(o);
  if (!again.ok) {
    status.textContent = `Not signed: ${again.problem}.`;
    return { assertion: null, retry: false };
  }
  if (Date.parse(o.expires_at) - Date.now() < 3000) {
    status.textContent = "This proposal has expired. Nothing was signed.";
    return { assertion: null, retry: false };
  }
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: hexToBytes(rejecting ? await rejectionHash(o.terms_sha256) : str(terms.kind) === "owners_execute" ? str(terms.onchain_digest).slice(2) : o.terms_sha256),
        rpId: location.hostname,
        allowCredentials: credentials.map((c) => ({ type: "public-key" as const, id: b64urlToBytes(c.id) })),
        userVerification: "required",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    status.textContent = passkeyError(e);
    return { assertion: null, retry: true };
  }
  if (!cred) {
    status.textContent = "Cancelled. Nothing was signed.";
    return { assertion: null, retry: true };
  }
  return { assertion: serializeAssertion(cred) };
}

/**
 * The full-screen summary of one change made on the phone (the policy editor): built only from its hashed terms; Confirm arms
 * after 0.8 s and only it starts the passkey, whose challenge is this proposal's hash; Back signs nothing.
 */
function openSheet(o: PhoneProposal, terms: Obj, x: SheetContext): void {
  const sheet = document.getElementById("sheet")!;
  const f = describeTerms(terms, x.names);
  const rejecting = x.decision === "REJECTED";
  const nots = rejecting ? [] : x.nots;
  const from = x.from;
  const cd = el("span", "countdown big");
  cd.dataset.expires = o.expires_at;
  // Approving what Opus advises rejecting is the slow, second choice: twice in live runs a CFO who meant to reject
  // tapped the proposal and approved it. The sheet then says "Approve anyway", arms after 3 s, and offers to reject.
  const against = !rejecting && o.review?.recommendation === "reject";
  const confirm = el("button", rejecting ? "confirm reject" : against ? "confirm against" : "confirm",
    [rejecting ? "Reject with Face ID" : against ? "Approve anyway with Face ID" : "Confirm with Face ID"]) as HTMLButtonElement;
  const backBtn = el("button", "secondary", ["Back"]) as HTMLButtonElement;
  const instead = against ? el("button", "confirm reject instead", ["Reject instead"]) as HTMLButtonElement : null;
  confirm.type = "button";
  backBtn.type = "button";
  // A double tap on the option must not land on Confirm: it arms after a moment.
  confirm.disabled = true;
  const arm = setTimeout(() => { confirm.disabled = !x.enrolled || countdown(o.expires_at).over; }, against ? 3000 : 800);
  const body = el("div", "sheet-body", [
    txt("p", "eyebrow", rejecting ? "You are rejecting" : "You are approving"),
    el("h2", "sheet-title", [f.title]),
    txt("p", "sentence", rejecting ? `Nothing of this will happen: ${f.sentence}` : f.sentence),
    ...againstAdvice(rejecting ? "REJECTED" : "APPROVED", o.review).map((w) => txt("p", "alarm big", w)),
    ...f.warnings.map((w) => txt("p", "alarm", w)),
    ...(o.warnings ?? []).map((w) => txt("p", "alarm", w)),
    el("dl", "facts", [
      txt("dt", "", f.amountLabel ?? "Amount"), txt("dd", "num", f.amount),
      ...(f.margin ? [txt("dt", "", "Margin"), txt("dd", "num", f.margin)] : []),
      txt("dt", "", "Recipient"), el("dd", "lines", f.recipient.split("; ").map((r) => txt("span", "", r))),
      txt("dt", "", "Expires"), el("dd", "", [cd]),
      txt("dt", "", "Hash"), hashCell(o.terms_sha256),
    ]),
    nots.length ? el("div", "nots", [txt("p", "eyebrow", "This is not"), el("ul", "", nots.map((n) => txt("li", "", n)))]) : null,
    o.agent_advice ? el("div", "review", [txt("p", "eyebrow", `${o.agent_advice.agent}${o.agent_advice.model ? ` (${modelWord(o.agent_advice.model)})` : ""}, advisory: ${o.agent_advice.verdict ?? (o.agent_advice.recommends ? "recommends this option" : "recommends the other option")}`), txt("p", "", o.agent_advice.text)]) : null,
    o.review ? el("div", "review", [txt("p", "eyebrow", o.review.recommendation === "drafted" ? "Drafted by Opus from your words, each rule checked by code" : `Opus review, advisory: ${o.review.recommendation.replace(/_/g, " ")}`), txt("p", "", o.review.text)]) : null,
    el("details", "all", [txt("summary", "", "All terms (exactly what is hashed)"), el("dl", "rows", f.rows.flatMap(([k, v]) => [txt("dt", "", k), txt("dd", "", v)])), termsTable(terms)]),
  ]);
  const status = el("div", "sheet-status");
  const actions = el("div", "sheet-actions", instead ? [backBtn, instead, confirm] : [backBtn, confirm]);
  sheet.replaceChildren(el("div", "sheet-card", [body, status, actions]));
  sheet.hidden = false;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", `${rejecting ? "Reject" : "Confirm"} ${f.title}`);
  document.body.classList.add("locked");
  tickCountdowns();
  backBtn.focus();

  const close = () => {
    clearTimeout(arm);
    sheet.hidden = true;
    sheet.replaceChildren();
    document.body.classList.remove("locked");
    from.focus();
  };
  backBtn.addEventListener("click", close);
  instead?.addEventListener("click", () => { clearTimeout(arm); openSheet(o, terms, { ...x, decision: "REJECTED" }); });
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    backBtn.disabled = true;
    const got = await askPasskey(o, terms, rejecting ? "REJECTED" : "APPROVED", x.credentials, status);
    if (!got.assertion) {
      backBtn.disabled = false;
      confirm.disabled = !got.retry;
      return;
    }
    status.textContent = "Sending the signature…";
    const sent = await x.send(got.assertion, rejecting ? "REJECTED" : "APPROVED")
      .catch(() => ({ status: 0, data: { error: "the relay cannot be reached" } as Obj }));
    if (sent.status !== 202) {
      status.textContent = `Not accepted: ${str(sent.data.error) || `error ${sent.status}`}. ${rejecting ? "Nothing was rejected." : "Nothing was approved."}`;
      backBtn.disabled = false;
      return;
    }
    const home = el("a", "back", ["← Dashboard"]) as HTMLAnchorElement;
    home.href = "/";
    actions.remove();
    await follow(str(sent.data.ticket), body, home, f.title);
    status.textContent = "";
  });
}

/** The terms as sent, for the reject screen of a proposal whose terms did not check out (it still names what it is). */
function parsedOrEmpty(canonical: string): Obj {
  try {
    const v: unknown = JSON.parse(canonical);
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * The approval view (Max, 7 Nov: the first screen holds what he decides on). At 390 × 844 the first screen shows what
 * (amount, payee, agent), why it needs him in one line, "Approve with Face ID" and Reject; the rest (the exact terms,
 * the hash, the review, the options it is not) is behind one fold, "Details". Every line is built from the hashed
 * terms (the agent and the policy from the runner-signed part). Mis-tap prevention: the buttons arm only 0.8 s after
 * the view or the chosen option changes (3 s to approve against Opus's advice, where Reject comes first), alternatives
 * are chosen apart from signing and the button names the one chosen, and Face ID itself is the last confirmation.
 */
async function approvePage(attempt = 0): Promise<void> {
  const app = document.getElementById("app")!;
  if (guestWithoutLink(app)) return;
  const id = decodeURIComponent(location.pathname.split("/").pop() ?? "");
  const { status, data } = await api("/api/approvals").catch(() => ({ status: 0, data: {} as Obj }));
  if (status !== 200) {
    app.replaceChildren(txt("p", "alarm", status === 401 ? NEEDS_LINK : status === 503 ? "The runner has not connected yet. Try again in a moment." : "Cannot reach the approval relay."));
    return;
  }
  if (!(await trusted(app, data, () => void approvePage(attempt)))) return;
  const a = data as unknown as Approvals & { policy?: { key: string; value: string }[] };
  const p = a.proposals.find((x) => x.proposal_id === id);
  const back = el("a", "back", ["← Dashboard"]) as HTMLAnchorElement;
  back.href = "/";
  if (!p) {
    // A proposal made a moment ago reaches the relay at the runner's next sync. That is usually seconds, but can be
    // longer while the runner checks the books with Airwallex (dry-14 waited about 25 s): look again for 90 seconds.
    if (attempt < 36) {
      app.replaceChildren(txt("h1", "", id), txt("p", "", `Looking for ${id}: the runner sends new proposals as soon as it is free, usually within seconds.`), back);
      setTimeout(() => void approvePage(attempt + 1), 2500);
      return;
    }
    app.replaceChildren(txt("h1", "", id), txt("p", "", `${id} is not waiting for approval: it was decided, it expired, or it does not exist.`), back);
    return;
  }
  const group = a.proposals.filter((x) => x.group === p.group);
  const checked = await Promise.all(group.map(async (g) => ({ p: g, check: await checkOption(g) })));
  const enrolled = a.passkey.credentials.length > 0;
  const stale = a.relay.age_ms > 15_000;
  const many = checked.length > 1;
  let chosen = checked.find((c) => c.p.proposal_id === id) ?? checked[0]!;

  // Alternatives (price options): choosing one only changes what the view shows; nothing is signed by it.
  const choices = many ? checked.map((c) => {
    const f = c.check.terms ? describeTerms(c.check.terms, a.names) : null;
    const b = el("button", "option", [
      txt("span", "option-title", f ? f.label : c.p.proposal_id),
      f?.big ? el("span", "option-amount", [f.big, txt("small", "", ` ${f.unit}`)]) : null,
      f?.margin ? txt("span", "option-margin", `margin ${f.margin}`) : null,
      c.p.agent_advice?.recommends ? txt("span", "chip approve", `${c.p.agent_advice.agent} recommends this`) : null,
      c.check.ok ? null : txt("span", "chip reject", "Do not approve"),
    ]) as HTMLButtonElement;
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", `${f ? f.title : c.p.proposal_id}. Shows it; signs nothing.`);
    b.addEventListener("click", () => { if (chosen !== c) { chosen = c; render(); } });
    return { c, b };
  }) : [];
  const view = el("div", "approval");
  app.replaceChildren(...[
    el("div", "toprow", [back, txt("span", "pid mono", group.map((g) => g.proposal_id).join(" · "))]),
    stale ? txt("p", "warn-box", `The runner last synced ${Math.round(a.relay.age_ms / 1000)} s ago. Your approval waits until it is back.`) : null,
    enrolled ? null : txt("p", "warn-box", "No passkey is enrolled yet, so nothing can be signed here."),
    many ? el("div", `choices n${choices.length}`, choices.map((x) => x.b)) : null,
    view,
  ].filter((n): n is HTMLElement => n !== null));
  if (many) choices[0]!.b.parentElement!.setAttribute("role", "radiogroup");
  if (many) choices[0]!.b.parentElement!.setAttribute("aria-label", "Options");

  let timers: ReturnType<typeof setTimeout>[] = [];
  function render(): void {
    for (const t of timers) clearTimeout(t);
    timers = [];
    for (const { c, b } of choices) {
      b.setAttribute("aria-checked", String(c === chosen));
      b.classList.toggle("chosen", c === chosen);
    }
    const o = chosen.p;
    const check = chosen.check;
    const f = check.terms ? describeTerms(check.terms, a.names) : null;
    const terms = check.terms ?? parsedOrEmpty(o.canonical);
    const approvable = check.ok && !!f && f.approvable;
    // When Opus advises against it, saying no comes first, and approving is the slow, second choice (twice in live
    // runs a CFO who meant to reject approved by tapping the proposal).
    const against = o.review?.recommendation === "reject";
    const cd = el("span", "countdown");
    cd.dataset.expires = o.expires_at;
    const essentials = el("section", "essentials", [
      el("p", "eyebrow need", [o.four_eyes ? "Needs your approval, and a second person's" : "Needs your approval", " · ", cd]),
      txt("h1", "what-title", f ? f.title : o.proposal_id),
      f ? el("p", "hero", [txt("span", "hero-label", f.amountLabel ?? "Amount"), txt("span", "hero-amount num", f.amount)]) : null,
      f ? el("dl", "key-facts", [
        txt("dt", "", "Payee"), el("dd", "lines", f.recipient.split("; ").map((r) => txt("span", "", r))),
        txt("dt", "", "Agent"), txt("dd", "", agentOf(o.created_by, terms)),
        txt("dt", "", "Why you"), txt("dd", "why", whyYou(terms, a.policy ?? [], o.four_eyes)),
      ]) : null,
    ]);
    // The warnings stay in the first screen: they are what a person must see before Face ID.
    const warnings = [...(f?.warnings ?? []), ...(o.warnings ?? [])];
    const alarms = [
      check.ok ? null : txt("p", "alarm big", `Do not approve: ${check.problem}.`),
      check.ok && f && !f.approvable ? txt("p", "alarm", f.sentence) : null,
      ...againstAdvice("APPROVED", o.review).map((w) => txt("p", "alarm big", w)),
      warnings.length ? el("div", "alarm list", [el("ul", "", warnings.map((w) => txt("li", "", w)))]) : null,
    ];
    const name = many && f ? `${f.label.charAt(0).toLowerCase()}${f.label.slice(1)} ` : "";
    const approve = el("button", against ? "confirm against" : "confirm", [against ? `Approve ${name}anyway with Face ID` : `Approve ${name}with Face ID`]) as HTMLButtonElement;
    approve.id = "approve";
    const reject = el("button", against ? "confirm reject" : "reject-btn", [against ? "Reject (Opus advises this)" : "Reject"]) as HTMLButtonElement;
    reject.id = "reject";
    for (const b of [approve, reject]) b.type = "button";
    approve.setAttribute("aria-label", `Approve ${f ? f.title : o.proposal_id} with Face ID`);
    reject.setAttribute("aria-label", `Reject ${f ? f.title : o.proposal_id} with Face ID`);
    // A double tap (on the dashboard's link, or on an option) must not land on a button: they arm after a moment.
    approve.disabled = true;
    reject.disabled = true;
    const armApprove = () => { approve.disabled = !enrolled || !approvable || countdown(o.expires_at).over; };
    const armReject = () => { reject.disabled = !enrolled; };
    timers.push(setTimeout(armApprove, against ? 3000 : 800), setTimeout(armReject, 800));
    const signStatus = el("p", "sheet-status");
    signStatus.id = "sign-status";
    signStatus.setAttribute("role", "status");
    const actions = el("div", against ? "actions against" : "actions", against ? [reject, approve, signStatus] : [approve, reject, signStatus]);

    const cd2 = el("span", "countdown big");
    cd2.dataset.expires = o.expires_at;
    const nots = many ? notList(o, checked.filter((c) => c.check.ok).map((c) => c.p), a.names) : [];
    const details = el("details", "more", [
      txt("summary", "", "Details"),
      f ? txt("p", "sentence", f.sentence) : null,
      el("dl", "facts", [
        ...(f ? [txt("dt", "", f.amountLabel ?? "Amount"), txt("dd", "num", f.amount)] : []),
        ...(f?.margin ? [txt("dt", "", "Margin"), txt("dd", "num", f.margin)] : []),
        ...(f ? [txt("dt", "", "Recipient"), el("dd", "lines", f.recipient.split("; ").map((r) => txt("span", "", r)))] : []),
        txt("dt", "", "Expires"), el("dd", "", [cd2]),
        txt("dt", "", "Hash"), hashCell(o.terms_sha256),
        txt("dt", "", "Proposal"), txt("dd", "mono", o.proposal_id),
      ]),
      nots.length ? el("div", "nots", [txt("p", "eyebrow", "This is not"), el("ul", "", nots.map((n) => txt("li", "", n)))]) : null,
      o.agent_advice ? el("div", "review", [txt("p", "eyebrow", `${o.agent_advice.agent}${o.agent_advice.model ? ` (${modelWord(o.agent_advice.model)})` : ""}, advisory: ${o.agent_advice.verdict ?? (o.agent_advice.recommends ? "recommends this option" : "recommends the other option")}`), txt("p", "", o.agent_advice.text)]) : null,
      o.review ? el("div", "review", [txt("p", "eyebrow", o.review.recommendation === "drafted" ? "Drafted by Opus from your words, each rule checked by code" : `Opus review, advisory: ${o.review.recommendation.replace(/_/g, " ")}`), txt("p", "", o.review.text)]) : null,
      f ? el("details", "all", [txt("summary", "", "All terms (exactly what is hashed)"), el("dl", "rows", f.rows.flatMap(([k, v]) => [txt("dt", "", k), txt("dd", "", v)])), termsTable(terms)]) : null,
      txt("p", "fineprint", "Your passkey signs the SHA-256 of these exact terms. This page computes that hash itself, and the runner signed what the relay sent; any change to the terms makes the signature worthless."),
    ]);
    view.replaceChildren(...[essentials, ...alarms, actions, details].filter((n): n is HTMLElement => n !== null));
    tickCountdowns();

    const go = async (decision: "APPROVED" | "REJECTED") => {
      for (const t of timers) clearTimeout(t);
      approve.disabled = true;
      reject.disabled = true;
      for (const { b } of choices) b.disabled = true;
      const unlock = (retry: boolean) => {
        armReject();
        if (retry) armApprove();
        for (const { b } of choices) b.disabled = false;
      };
      const got = await askPasskey(o, terms, decision, a.passkey.credentials, signStatus);
      if (!got.assertion) {
        unlock(got.retry);
        return;
      }
      signStatus.textContent = "Sending the signature…";
      const sent = await api("/api/assertions", { proposal_id: o.proposal_id, terms_sha256: o.terms_sha256, decision, credential: got.assertion })
        .catch(() => ({ status: 0, data: { error: "the relay cannot be reached" } as Obj }));
      if (sent.status !== 202) {
        signStatus.textContent = `Not accepted: ${str(sent.data.error) || `error ${sent.status}`}. ${decision === "REJECTED" ? "Nothing was rejected." : "Nothing was approved."}`;
        unlock(true);
        return;
      }
      const home = el("a", "back", ["← Dashboard"]) as HTMLAnchorElement;
      home.href = "/";
      await follow(str(sent.data.ticket), app, home, f ? f.title : o.proposal_id);
    };
    approve.addEventListener("click", () => void go("APPROVED"));
    reject.addEventListener("click", () => void go("REJECTED"));
  }
  render();
}

function enrolPage(): void {
  const app = document.getElementById("app")!;
  const input = el("input", "code") as HTMLInputElement;
  input.id = "code";
  input.autocomplete = "one-time-code";
  input.setAttribute("autocapitalize", "characters");
  input.spellcheck = false;
  input.maxLength = 12;
  input.placeholder = "XXXX-XXXX";
  const go = el("button", "confirm", ["Create passkey with Face ID"]) as HTMLButtonElement;
  go.type = "button";
  const status = el("p", "sheet-status");
  const label = el("label", "", ["One-time code from Claude"]);
  label.setAttribute("for", "code");
  const box = el("div", "enrol", [label, input, go, status]);
  app.replaceChildren(
    txt("h1", "", "Enrol your passkey"),
    txt("p", "lead", "Once enrolled, every approval needs this passkey: Face ID signs the hash of the exact terms you see."),
    box,
  );
  go.addEventListener("click", async () => {
    go.disabled = true;
    status.textContent = "Checking the code…";
    const opt = await api("/api/enrol/options", { code: input.value }).catch(() => ({ status: 0, data: { error: "the relay cannot be reached" } as Obj }));
    if (opt.status !== 200) {
      const left = opt.data.attempts_left === undefined ? "" : ` (${str(opt.data.attempts_left)} tries left)`;
      status.textContent = `${str(opt.data.error) || `error ${opt.status}`}${left}.`;
      go.disabled = false;
      return;
    }
    const o = opt.data as { challenge: string; rp: { id: string; name: string }; user: { id: string; name: string; displayName: string };
      pubKeyCredParams: { type: "public-key"; alg: number }[]; timeout: number; attestation: AttestationConveyancePreference;
      authenticatorSelection: AuthenticatorSelectionCriteria; excludeCredentials: { type: "public-key"; id: string }[] };
    status.textContent = "Waiting for Face ID…";
    let cred: PublicKeyCredential | null;
    try {
      cred = (await navigator.credentials.create({
        publicKey: {
          challenge: b64urlToBytes(o.challenge), rp: o.rp,
          user: { id: b64urlToBytes(o.user.id), name: o.user.name, displayName: o.user.displayName },
          pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: o.attestation, authenticatorSelection: o.authenticatorSelection,
          excludeCredentials: o.excludeCredentials.map((c) => ({ type: c.type, id: b64urlToBytes(c.id) })),
        },
      })) as PublicKeyCredential | null;
    } catch (e) {
      status.textContent = passkeyError(e);
      go.disabled = false;
      return;
    }
    if (!cred) {
      status.textContent = "Cancelled. No passkey was created.";
      go.disabled = false;
      return;
    }
    const att = cred.response as AuthenticatorAttestationResponse;
    const spki = typeof att.getPublicKey === "function" ? att.getPublicKey() : null;
    const fp = spki ? await passkeyFingerprint(spki) : "";
    const sent = await api("/api/enrol", { code: input.value, credential: serializeRegistration(cred) })
      .catch(() => ({ status: 0, data: { error: "the relay cannot be reached" } as Obj }));
    if (sent.status !== 202) {
      status.textContent = `Not accepted: ${str(sent.data.error) || `error ${sent.status}`}.`;
      go.disabled = false;
      return;
    }
    const home = el("a", "back", ["← Dashboard"]) as HTMLAnchorElement;
    home.href = "/";
    const end = await follow(str(sent.data.ticket), box, home, fp ? `Fingerprint ${fp}` : "This browser cannot show the fingerprint; do not confirm it on the runner.");
    // The runner names the fingerprint of the passkey it received: it must be the one this phone made.
    if (end.status === "pending" && fp && !end.message.includes(fp)) {
      box.prepend(txt("p", "alarm", `The runner received another passkey than this phone made (${fp}). Do not confirm it; tell Claude.`));
    }
  });
}

interface PolicyRow {
  key: string;
  /** The agent the setting belongs to (the Agents page opens this page with ?agent=<id>). */
  agent?: string;
  label: string;
  unit: string;
  kind: "money" | "optional_money" | "choice";
  choices?: string[];
  value: string;
  display: string;
}

/**
 * The CFO policy editor: every setting with its value now; a change is written here, shown on the same full-screen
 * summary and signed with Face ID. The runner checks it again and applies it; nothing changes without the passkey.
 */
async function policyPage(): Promise<void> {
  const app = document.getElementById("app")!;
  if (guestWithoutLink(app)) return;
  const { status, data } = await api("/api/approvals").catch(() => ({ status: 0, data: {} as Obj }));
  if (status !== 200) {
    app.replaceChildren(txt("p", "alarm", status === 401 ? NEEDS_LINK : status === 503 ? "The runner has not connected yet. Try again in a moment." : "Cannot reach the relay."));
    return;
  }
  if (!(await trusted(app, data, () => void policyPage()))) return;
  const a = data as unknown as Approvals & { policy: PolicyRow[] };
  const enrolled = a.passkey.credentials.length > 0;
  const back = el("a", "back", ["← Dashboard"]) as HTMLAnchorElement;
  back.href = "/";
  const fields = a.policy.map((e, i) => {
    const id = `p${i}`;
    let input: HTMLInputElement | HTMLSelectElement;
    if (e.kind === "choice") {
      const sel = document.createElement("select");
      for (const c of e.choices ?? []) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      }
      sel.value = e.value;
      input = sel;
    } else {
      const inp = document.createElement("input");
      inp.inputMode = "decimal";
      inp.value = e.value;
      inp.placeholder = e.kind === "optional_money" ? "none" : "0.00";
      inp.autocomplete = "off";
      input = inp;
    }
    input.id = id;
    input.className = "policy-input";
    const label = el("label", "policy-label", [e.label, e.unit ? txt("span", "muted", ` (${e.unit})`) : null]);
    label.setAttribute("for", id);
    const row = el("div", "policy-row", [label, txt("span", "policy-now", `now: ${e.display}`), input]);
    const read = () => {
      const v = e.kind === "choice" ? input.value : normalizeAmount(input.value);
      return e.kind === "optional_money" && (v === "" || v.toLowerCase() === "none") ? "" : v;
    };
    return { e, row, read };
  });
  // The dashboard's emergency stop opens this page with ?freeze=on: the switch is set, the CFO reviews and signs.
  if (/[?&]freeze=on(&|$)/.test(location.search)) {
    const f = fields.find((x) => x.e.key === "freeze" && x.e.value !== "on");
    if (f) (f.row.querySelector("select") as HTMLSelectElement).value = "on";
  }
  // The Agents page opens this page for one agent (?agent=<id>), and with &stop=on to stop it: the switch is set, the
  // CFO reviews and signs. Only that agent's settings show; the rest of the policy is unchanged.
  const agentParam = /[?&]agent=([^&]+)/.exec(location.search);
  const agent = agentParam ? decodeURIComponent(agentParam[1]!) : null;
  const mine = agent ? fields.filter((f) => f.e.agent === agent) : fields;
  const wantStop = !!agent && /[?&]stop=on(&|$)/.test(location.search);
  if (wantStop) {
    const f = mine.find((x) => x.e.key === `stop.${agent}` && x.e.value !== "on");
    if (f) (f.row.querySelector("select") as HTMLSelectElement).value = "on";
  }
  // 4.2 &pause=on: the CFO pauses this one agent; the runner revokes its Metal mandate and freezes its card.
  const wantPause = !!agent && /[?&]pause=on(&|$)/.test(location.search);
  if (wantPause) {
    const f = mine.find((x) => x.e.key === `pause.${agent}` && x.e.value !== "on");
    if (f) (f.row.querySelector("select") as HTMLSelectElement).value = "on";
  }
  const reason = document.createElement("input");
  reason.id = "reason";
  reason.className = "policy-input";
  reason.maxLength = 300;
  reason.placeholder = "Why, in one line";
  if (/[?&]freeze=on(&|$)/.test(location.search)) reason.value = "Emergency stop";
  if (wantStop) reason.value = "Stop this agent";
  if (wantPause) reason.value = "Pause this agent";
  const reasonLabel = el("label", "policy-label", ["Reason"]);
  reasonLabel.setAttribute("for", "reason");
  const review = el("button", "confirm", ["Review change"]) as HTMLButtonElement;
  review.type = "button";
  const note = el("p", "sheet-status");
  // P2: the policy in the CFO's own words. Opus drafts rules on the runner; code checks them; from here they can only
  // tighten the policy. What comes back is a proposal like any other, approved with Face ID on its own page.
  const words = document.createElement("textarea");
  words.id = "words";
  words.className = "policy-input words";
  words.maxLength = 2000;
  words.rows = 4;
  words.placeholder = "For example: the sourcing agent's card at most €25 per purchase. Refunds above 0.05 I want to see.";
  const wordsLabel = el("label", "policy-label", ["In your own words"]);
  wordsLabel.setAttribute("for", "words");
  const draft = el("button", "secondary", ["Draft rules from my words"]) as HTMLButtonElement;
  draft.type = "button";
  const drafted = el("div", "drafted");
  const wordsBox = el("section", "policy-words", [
    wordsLabel, words,
    txt("p", "muted", "Opus turns your words into rules, the runner checks each one, and you approve the result with Face ID. From the phone, words can only tighten the policy."),
    draft, drafted,
  ]);
  draft.addEventListener("click", async () => {
    const text = words.value.trim();
    if (text === "") {
      drafted.replaceChildren(txt("p", "sheet-status", "Write the policy first."));
      return;
    }
    draft.disabled = true;
    const { status, data } = await api("/api/policy-text", { text }).catch(() => ({ status: 0, data: {} as Obj }));
    if (status !== 202) {
      drafted.replaceChildren(txt("p", "alarm", str(data.error) || "The relay did not take the text."));
      draft.disabled = false;
      return;
    }
    const open = el("a", "confirm", ["Review and approve"]) as HTMLAnchorElement;
    open.hidden = true;
    const out = await follow(str(data.ticket), drafted, open, `"${text.length > 120 ? `${text.slice(0, 120)}…` : text}"`, "Opus is reading your words on the runner. This takes up to a minute.");
    const id = /^(P-\d{4})\b/.exec(out.message)?.[1];
    if (out.status === "drafted" && id) {
      open.href = `/approve/${id}`;
      open.hidden = false;
    }
    draft.disabled = false;
  });
  // Ask Purser (G): a request in plain words; at most a task card proposal comes back, approved with Face ID.
  const ask = document.createElement("textarea");
  ask.id = "ask";
  ask.className = "policy-input words";
  ask.maxLength = 500;
  ask.rows = 2;
  ask.placeholder = "For example: book a flight to Berlin on 12 November, at most €250.";
  const askLabel = el("label", "policy-label", ["Ask Purser"]);
  askLabel.setAttribute("for", "ask");
  const askSend = el("button", "secondary", ["Ask"]) as HTMLButtonElement;
  askSend.type = "button";
  const asked = el("div", "drafted");
  const askBox = el("section", "policy-words", [
    askLabel, ask,
    txt("p", "muted", "For a flight, a hotel or a train: Purser proposes a card that can pay once, up to your amount, until the day you name. Nothing is issued before you approve it with Face ID."),
    askSend, asked,
  ]);
  askSend.addEventListener("click", async () => {
    const text = ask.value.trim();
    if (text === "") {
      asked.replaceChildren(txt("p", "sheet-status", "Write what you need first."));
      return;
    }
    askSend.disabled = true;
    const { status, data } = await api("/api/ask", { text }).catch(() => ({ status: 0, data: {} as Obj }));
    if (status !== 202) {
      asked.replaceChildren(txt("p", "alarm", str(data.error) || "The relay did not take the message."));
      askSend.disabled = false;
      return;
    }
    const open = el("a", "confirm", ["Review and approve"]) as HTMLAnchorElement;
    open.hidden = true;
    const out = await follow(str(data.ticket), asked, open, `"${text.length > 120 ? `${text.slice(0, 120)}…` : text}"`, "Purser is reading your message on the runner.");
    const id = /\bI proposed (P-\d{4})\b/.exec(out.message)?.[1];
    if (out.status === "answered" && id) {
      open.href = `/approve/${id}`;
      open.hidden = false;
    }
    askSend.disabled = false;
  });
  app.replaceChildren(...[
    el("div", "toprow", [back]),
    txt("h1", "", agent && mine.length ? `CFO policy: ${mine[0]!.e.label.split(/:|'s /)[0]}` : "CFO policy"),
    txt("p", "lead", agent && mine.length
      ? "This agent's settings. Tightening one needs your passkey and takes effect at once; loosening is a proposal from the runner."
      : "Limits the agents work within, inside their mandates on chain. A change needs your passkey and takes effect at once."),
    enrolled ? null : txt("p", "warn-box", "No passkey is enrolled yet, so no change can be signed here."),
    agent ? null : askBox,
    agent ? null : wordsBox,
    el("div", "policy", (mine.length ? mine : fields).map((f) => f.row)),
    el("div", "policy-row", [reasonLabel, reason]),
    review,
    note,
  ].filter((n): n is HTMLElement => n !== null));

  review.addEventListener("click", async () => {
    const changes = fields.filter((f) => f.read() !== f.e.value).map((f) => ({ key: f.e.key, label: f.e.label, from: f.e.value, to: f.read() }));
    if (changes.length === 0) {
      note.textContent = "Nothing changed.";
      return;
    }
    for (const f of fields) {
      const problem = f.read() === f.e.value ? null : amountProblem(f.e.kind, f.read());
      if (problem) {
        note.textContent = `${f.e.label}: ${problem}.`;
        return;
      }
    }
    if (reason.value.trim() === "") {
      note.textContent = "Say why, in one line.";
      return;
    }
    const looser = changes.filter((c) => policyLoosens(c));
    if (looser.length) {
      note.textContent = `${looser.map((c) => c.label).join(", ")}: this would loosen the policy. On the phone you can only tighten it; ask Claude to propose it on the runner, then approve it here with Face ID.`;
      return;
    }
    note.textContent = "";
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
    const now = new Date();
    const terms = buildPolicyTerms(changes, reason.value.trim(), now, hex);
    const canonical = canonicalize(terms);
    const hash = await sha256Hex(canonical);
    const o: PhoneProposal = {
      proposal_id: str(terms.proposal_id), kind: "policy_change", group: str(terms.proposal_id), canonical, terms_sha256: hash,
      expires_at: str(terms.expires_at), created_by: "human", created_at: now.toISOString(), review: null,
    };
    openSheet(o, terms, {
      names: a.names, nots: [], enrolled, credentials: a.passkey.credentials, from: review,
      send: (credential) => api("/api/policy", { canonical, terms_sha256: hash, credential }),
    });
  });
}

export function boot(): void {
  let store: Storage | null;
  try { store = localStorage; } catch { store = null; }
  viewKey = takeViewKey(location.hash, store);
  deviceStore = store;
  runnerPin = takeRunnerKey(location.hash, store);
  if (location.hash.includes("view=") || location.hash.includes("runner=")) history.replaceState(null, "", location.pathname + location.search);
  setInterval(tickCountdowns, 1000);
  if (document.body.dataset.page === "approve") void approvePage();
  if (document.body.dataset.page === "enrol") enrolPage();
  if (document.body.dataset.page === "policy") void policyPage();
}

if (typeof document !== "undefined") boot();

/** "claude-opus-5-5" → "Opus": the model's family name for a person. */
function modelWord(model: string): string {
  return /opus/i.test(model) ? "Opus" : /sonnet/i.test(model) ? "Sonnet" : /haiku/i.test(model) ? "Haiku" : model;
}
