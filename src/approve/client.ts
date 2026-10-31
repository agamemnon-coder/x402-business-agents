// The phone's side of passkey approvals (tier 2 item 5), served as /assets/approve.js to the approval and
// enrolment pages. It trusts nothing it is sent: it canonicalises and hashes each proposal's terms itself
// (WebCrypto), refuses anything that does not hash to the hash it would sign, and builds every line of the confirm
// screen from those hashed terms. Mis-tap prevention: a tap on an option opens a full-screen summary of that one
// option; only "Confirm with Face ID" there starts the passkey, whose challenge is that option's hash.
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
  if (c.key === "freeze" || c.key.startsWith("stop.")) return c.from === "on" && c.to !== "on";
  return true;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Nov 2026, 23:59 UTC": the same on every phone, whatever its time zone. */
function utcMinute(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

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
    const where = mccs === "4511" ? "an airline" : mccs === "7011" ? "a hotel" : mccs === "4112" ? "a railway" : "a merchant";
    const ends = utcMinute(str(t.valid_until));
    const by = str(t.asked_by);
    const asked = by === "cfo-at-runner" ? "you, at the runner" : by.startsWith("ext:") ? `outside agent ${by}` : "someone with the dashboard link";
    const check = by === "cfo-at-runner" ? "Purser read this from your own message."
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
/**
 * The runner's public key from the same link (base64url SPKI), pinned on this device. The first one stays: a later
 * link with another key does not replace it (review N3); to re-pin, clear this site's data on the phone.
 */
export function takeRunnerKey(hash: string, store: Pick<Storage, "getItem" | "setItem"> | null): { key: string; conflict: boolean } {
  let pinned: string;
  try { pinned = store?.getItem(RUNNER_STORE) ?? ""; } catch { pinned = ""; }
  const fromLink = /(?:^#|&)runner=([A-Za-z0-9_-]{80,200})(?:&|$)/.exec(hash)?.[1];
  if (pinned) return { key: pinned, conflict: fromLink !== undefined && fromLink !== pinned };
  return { key: takeFromLink(hash, store, "runner", /^[A-Za-z0-9_-]{80,200}$/, RUNNER_STORE), conflict: false };
}

const SEQ_STORE = "kit11.seq";
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

let runnerKey = "";
let runnerConflict = false;
let deviceStore: Pick<Storage, "getItem" | "setItem"> | null = null;
const KEY_CONFLICT = "This link carries another runner key than the one this phone pinned, so it was not accepted. If the runner really changed, clear this site's data on the phone and open the new link.";
const REPLAYED = "The relay sent an older signed state than this phone already saw. Nothing can be signed here; tell Claude.";
const UNSIGNED = "What the relay sent is not signed by the runner this phone knows. Nothing can be signed here. If you opened another run's viewer link on this phone before, it still holds that runner's key: open this run's viewer link in a private tab, or clear this site's data and open it again. Tell Claude if this stays.";

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

async function api(path: string, body?: unknown): Promise<{ status: number; data: Obj }> {
  const view = { "x-kit11-view": viewKey };
  const res = await fetch(path, body === undefined
    ? { cache: "no-store", headers: { accept: "application/json", ...view } }
    : { method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json", ...view }, body: JSON.stringify(body) });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data: isObj(data) ? data : {} };
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
    ? ["Opus advises rejecting this, and you are about to APPROVE it. To reject, go Back and tap Reject."]
    : [];
}

/**
 * The full-screen summary of one proposal (mis-tap prevention): built only from its hashed terms; Confirm arms
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
      txt("dt", "", "Recipient"), txt("dd", "", f.recipient),
      txt("dt", "", "Expires"), el("dd", "", [cd]),
      txt("dt", "", "Hash"), el("dd", "hash", [txt("strong", "mono", o.terms_sha256.slice(0, 8)), txt("span", "mono", o.terms_sha256.slice(8))]),
    ]),
    nots.length ? el("div", "nots", [txt("p", "eyebrow", "This is not"), el("ul", "", nots.map((n) => txt("li", "", n)))]) : null,
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
    status.textContent = "Waiting for Face ID…";
    // Rejecting is always safe, so it does not need the terms to check out; approving does.
    const again = rejecting ? { ok: true, problem: "" } : await checkOption(o);
    if (!again.ok) {
      status.textContent = `Not signed: ${again.problem}.`;
      backBtn.disabled = false;
      return;
    }
    if (Date.parse(o.expires_at) - Date.now() < 3000) {
      status.textContent = "This proposal has expired. Nothing was signed.";
      backBtn.disabled = false;
      return;
    }
    let cred: PublicKeyCredential | null;
    try {
      cred = (await navigator.credentials.get({
        publicKey: {
          challenge: hexToBytes(rejecting ? await rejectionHash(o.terms_sha256) : o.terms_sha256),
          rpId: location.hostname,
          allowCredentials: x.credentials.map((c) => ({ type: "public-key" as const, id: b64urlToBytes(c.id) })),
          userVerification: "required",
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
    } catch (e) {
      status.textContent = passkeyError(e);
      backBtn.disabled = false;
      confirm.disabled = false;
      return;
    }
    if (!cred) {
      status.textContent = "Cancelled. Nothing was signed.";
      backBtn.disabled = false;
      confirm.disabled = false;
      return;
    }
    status.textContent = "Sending the signature…";
    const sent = await x.send(serializeAssertion(cred), rejecting ? "REJECTED" : "APPROVED")
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

async function approvePage(): Promise<void> {
  const app = document.getElementById("app")!;
  if (guestWithoutLink(app)) return;
  const id = decodeURIComponent(location.pathname.split("/").pop() ?? "");
  const { status, data } = await api("/api/approvals").catch(() => ({ status: 0, data: {} as Obj }));
  if (status !== 200) {
    app.replaceChildren(txt("p", "alarm", status === 401 ? NEEDS_LINK : status === 503 ? "The runner has not connected yet. Try again in a moment." : "Cannot reach the approval relay."));
    return;
  }
  if (runnerConflict) {
    app.replaceChildren(txt("p", "alarm", KEY_CONFLICT));
    return;
  }
  if (!(await verifyRunnerSignature(data, runnerKey))) {
    app.replaceChildren(txt("p", "alarm", UNSIGNED));
    return;
  }
  if (!freshEnough(Number(data.ledger_seq), deviceStore)) {
    app.replaceChildren(txt("p", "alarm", REPLAYED));
    return;
  }
  const a = data as unknown as Approvals;
  const p = a.proposals.find((x) => x.proposal_id === id);
  const back = el("a", "back", ["← Dashboard"]) as HTMLAnchorElement;
  back.href = "/";
  if (!p) {
    app.replaceChildren(txt("h1", "", id), txt("p", "", `${id} is not waiting for approval: it was decided, it expired, or it does not exist.`), back);
    return;
  }
  const group = a.proposals.filter((x) => x.group === p.group);
  const checked = await Promise.all(group.map(async (g) => ({ p: g, check: await checkOption(g) })));
  const enrolled = a.passkey.credentials.length > 0;
  const stale = a.relay.age_ms > 15_000;

  const cards = checked.map(({ p: o, check }) => {
    const f = check.terms ? describeTerms(check.terms, a.names) : null;
    const cd = el("span", "countdown");
    cd.dataset.expires = o.expires_at;
    const card = el("button", `option${o.proposal_id === id ? " suggested" : ""}`, [
      txt("span", "option-title", f ? f.label : o.proposal_id),
      f?.big ? el("span", "option-amount", [f.big, txt("small", "", ` ${f.unit}`)]) : null,
      f?.margin ? txt("span", "option-margin", `margin ${f.margin}`) : null,
      f && group.length === 1 ? txt("span", "option-sentence", f.sentence) : null,
      o.review ? txt("span", `chip ${o.review.recommendation}`, o.review.recommendation === "drafted" ? "Drafted by Opus from your words" : `Opus: ${o.review.recommendation.replace(/_/g, " ")} (advisory)`) : null,
      el("span", "option-meta", [cd, " · ", el("span", "mono", [`hash ${o.terms_sha256.slice(0, 8)}`])]),
      check.ok ? null : txt("span", "alarm", `Do not approve: ${check.problem}.`),
      check.ok && f && !f.approvable ? txt("span", "alarm", f.sentence) : null,
      ...(o.warnings ?? []).map((w) => txt("span", "alarm", w)),
      o.four_eyes ? txt("span", "chip", `Needs two people (four eyes)${o.four_eyes.approved_by.length ? ` · approved so far: ${o.four_eyes.approved_by.join(", ")}` : ""}`) : null,
    ]) as HTMLButtonElement;
    card.type = "button";
    card.disabled = !check.ok || !f || !f.approvable;
    card.setAttribute("aria-label", `${f ? f.title : o.proposal_id}. Opens a summary to confirm.`);
    card.addEventListener("click", () => openSummary(o, check.terms!, card));
    // Rejecting needs no working terms: whatever this proposal is, a person may say no to it.
    const advisedNo = o.review?.recommendation === "reject";
    const no = el("button", advisedNo ? "reject-btn advised" : "reject-btn", [advisedNo ? "Reject (Opus advises this)" : "Reject"]) as HTMLButtonElement;
    no.type = "button";
    no.disabled = !enrolled;
    no.setAttribute("aria-label", `Reject ${f ? f.title : o.proposal_id}. Opens a summary to confirm.`);
    no.addEventListener("click", () => openSummary(o, check.terms ?? parsedOrEmpty(o.canonical), no, "REJECTED"));
    // When Opus advises against it, saying no comes first.
    return el("div", advisedNo ? "option-wrap advised-no" : "option-wrap", advisedNo ? [no, card] : [card, no]);
  });

  app.replaceChildren(...[
    el("div", "toprow", [back, txt("span", "pid mono", group.map((g) => g.proposal_id).join(" · "))]),
    txt("h1", "", group.length > 1 ? "Choose one option" : "Review this proposal"),
    txt("p", "lead", group.length > 1
      ? "Tap the option you want, or reject one. You will see exactly what it does before Face ID signs."
      : "Tap the proposal, or Reject, to see exactly what it does before Face ID signs."),
    stale ? txt("p", "warn-box", `The runner last synced ${Math.round(a.relay.age_ms / 1000)} s ago. Your approval waits until it is back.`) : null,
    enrolled ? null : txt("p", "warn-box", "No passkey is enrolled yet, so nothing can be signed here."),
    el("div", `options n${cards.length}`, cards),
    txt("p", "fineprint", "Your passkey signs the SHA-256 of these exact terms. This page computes that hash itself; any change to the terms makes the signature worthless."),
  ].filter((n): n is HTMLElement => n !== null));
  tickCountdowns();

  function openSummary(o: PhoneProposal, terms: Obj, from: HTMLButtonElement, decision: "APPROVED" | "REJECTED" = "APPROVED"): void {
    openSheet(o, terms, {
      names: a.names, nots: notList(o, checked.filter((c) => c.check.ok).map((c) => c.p), a.names), enrolled,
      credentials: a.passkey.credentials, from, decision,
      send: (credential, d) => api("/api/assertions", { proposal_id: o.proposal_id, terms_sha256: o.terms_sha256, decision: d, credential }),
    });
  }
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
  if (runnerConflict) {
    app.replaceChildren(txt("p", "alarm", KEY_CONFLICT));
    return;
  }
  if (!(await verifyRunnerSignature(data, runnerKey))) {
    app.replaceChildren(txt("p", "alarm", UNSIGNED));
    return;
  }
  if (!freshEnough(Number(data.ledger_seq), deviceStore)) {
    app.replaceChildren(txt("p", "alarm", REPLAYED));
    return;
  }
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
  const reason = document.createElement("input");
  reason.id = "reason";
  reason.className = "policy-input";
  reason.maxLength = 300;
  reason.placeholder = "Why, in one line";
  if (/[?&]freeze=on(&|$)/.test(location.search)) reason.value = "Emergency stop";
  if (wantStop) reason.value = "Stop this agent";
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
  ({ key: runnerKey, conflict: runnerConflict } = takeRunnerKey(location.hash, store));
  if (location.hash.includes("view=") || location.hash.includes("runner=")) history.replaceState(null, "", location.pathname + location.search);
  setInterval(tickCountdowns, 1000);
  if (document.body.dataset.page === "approve") void approvePage();
  if (document.body.dataset.page === "enrol") enrolPage();
  if (document.body.dataset.page === "policy") void policyPage();
}

if (typeof document !== "undefined") boot();
