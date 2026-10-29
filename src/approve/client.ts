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
    const rows: [string, string][] = [["Price per query", `${q} *USDZ`], ["Supplier price", `${u} *USDZ`], ["Margin per sale", m]];
    for (const s of steps) {
      const spent = s.spent_at_proposal === undefined ? "" : ` (${str(s.spent_at_proposal)} already spent)`;
      rows.push([`Step ${str(s.order)}: ${str(s.agent)} mandate`, `up to ${str(s.cap)} per payment, ${str(s.budget)} in total${spent}`]);
      rows.push([`Step ${str(s.order)}: may pay`, arr(s.payees).map((p) => whoFull(str(p))).join(", ")]);
    }
    rows.push(["All agents' budgets", `${str(t.total_budget)} *USDZ in total`]);
    return {
      approvable: true,
      title: `Option ${str(t.option)}: sell at ${q}`,
      sentence: `Sell each query at ${q} *USDZ. The supplier now charges ${u}, so each sale earns ${m}.`,
      amount: `${q} *USDZ per query`,
      margin: `${m} per sale`,
      recipient: steps.map((s) => `${payeesOf(s).map(who).join(", ")} (${str(s.agent)})`).join("; "),
      rows,
      short: `option ${str(t.option)}: sell at ${q} per query (margin ${m})`,
      warnings,
      label: `Option ${str(t.option)}`,
      big: q,
      unit: "*USDZ per query",
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
      sentence: `Refund ${sales} to ${nameOf(customer) ?? shortAddr(customer)}, ${str(t.total)} *USDZ in total.`,
      amount: `${str(t.total)} *USDZ`,
      margin: null,
      recipient: [customer, ...elsewhere].map(who).join("; "),
      rows: [
        ["Total", `${str(t.total)} *USDZ`],
        ["Pays", whoFull(customer)],
        ["Sales", refunds.map((r) => `#${str(r.sale_id)} ${str(r.amount)}`).join(", ")],
        ["Reason", str(t.reason)],
        ...(t.dispute_id ? [["Dispute", str(t.dispute_id)] as [string, string]] : []),
      ],
      short: `refund ${sales}, ${str(t.total)} *USDZ`,
      warnings: elsewhere.length ? [`Pays addresses other than the customer: ${elsewhere.join(", ")}`] : [],
      label: `Refund ${sales}`,
      big: money(t.total),
      unit: "*USDZ",
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
    const cents = (v: unknown) => (/^\d+\.\d{2}$/.test(str(v)) ? Number(str(v).replace(".", "")) : null);
    const loosens = (c: Obj): boolean => {
      const key = str(c.key);
      const [from, to] = [cents(c.from), cents(c.to)];
      if (key.startsWith("cap.") || key.startsWith("approval.")) return from !== null && (to === null || to > from);
      if (key.endsWith("_floor")) return from !== null && to !== null && to < from;
      if (key.startsWith("counterparty:")) return str(c.from) === "blocked" && str(c.to) === "allowed";
      return false;
    };
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
      warnings: changes.filter(loosens).map((c) => `This loosens ${str(c.label)}`),
      amountLabel: "New value",
      label: "Policy change",
      big: one ? shown(one.to) : String(changes.length),
      unit: one ? str(one.label) : "settings",
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

const VIEW_STORE = "kit11.view";
let viewKey = "";

/**
 * The relay answers only with its viewer key (security review M2). It arrives once as a link with #view=<key>
 * (a fragment never reaches a server), is kept on this device, and is removed from the address bar at once.
 */
export function takeViewKey(hash: string, store: Pick<Storage, "getItem" | "setItem"> | null): string {
  const m = /(?:^#|&)view=([0-9a-f]{32})(?:&|$)/.exec(hash);
  if (m) {
    try { store?.setItem(VIEW_STORE, m[1]!); } catch { /* private mode: keep it for this page only */ }
    return m[1]!;
  }
  try { return store?.getItem(VIEW_STORE) ?? ""; } catch { return ""; }
}

const NEEDS_LINK = "This device needs the viewer link. Open the link Claude gave you once on this phone, then come back.";

async function api(path: string, body?: unknown): Promise<{ status: number; data: Obj }> {
  const view = { "x-kit11-view": viewKey };
  const res = await fetch(path, body === undefined
    ? { cache: "no-store", headers: { accept: "application/json", ...view } }
    : { method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json", ...view }, body: JSON.stringify(body) });
  let data: unknown = {};
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

const FINAL = new Set(["rejected", "executed", "failed", "refused", "too_late", "already", "enrolled"]);
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
};

/** Polls a ticket and shows the runner's verdict until it is final. */
async function follow(ticket: string, into: HTMLElement, done: Node, what = ""): Promise<void> {
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
    lead.textContent = v.lead;
    detail.textContent = s === "queued" && Date.now() - started > 20_000
      ? "The runner has not picked it up yet. If it is offline, your signature waits for it (up to 30 minutes)."
      : str(data.message);
    if (FINAL.has(s) || Date.now() - started > 5 * 60_000) return;
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
  send: (credential: Obj) => Promise<{ status: number; data: Obj }>;
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
  const confirm = el("button", rejecting ? "confirm reject" : "confirm", [rejecting ? "Reject with Face ID" : "Confirm with Face ID"]) as HTMLButtonElement;
  const backBtn = el("button", "secondary", ["Back"]) as HTMLButtonElement;
  confirm.type = "button";
  backBtn.type = "button";
  // A double tap on the option must not land on Confirm: it arms after a moment.
  confirm.disabled = true;
  const arm = setTimeout(() => { confirm.disabled = !x.enrolled || countdown(o.expires_at).over; }, 800);
  const body = el("div", "sheet-body", [
    txt("p", "eyebrow", rejecting ? "You are rejecting" : "You are approving"),
    el("h2", "sheet-title", [f.title]),
    txt("p", "sentence", rejecting ? `Nothing of this will happen: ${f.sentence}` : f.sentence),
    ...f.warnings.map((w) => txt("p", "alarm", w)),
    el("dl", "facts", [
      txt("dt", "", f.amountLabel ?? "Amount"), txt("dd", "num", f.amount),
      ...(f.margin ? [txt("dt", "", "Margin"), txt("dd", "num", f.margin)] : []),
      txt("dt", "", "Recipient"), txt("dd", "", f.recipient),
      txt("dt", "", "Expires"), el("dd", "", [cd]),
      txt("dt", "", "Hash"), el("dd", "hash", [txt("strong", "mono", o.terms_sha256.slice(0, 8)), txt("span", "mono", o.terms_sha256.slice(8))]),
    ]),
    nots.length ? el("div", "nots", [txt("p", "eyebrow", "This is not"), el("ul", "", nots.map((n) => txt("li", "", n)))]) : null,
    o.review ? el("div", "review", [txt("p", "eyebrow", `Opus review, advisory: ${o.review.recommendation.replace(/_/g, " ")}`), txt("p", "", o.review.text)]) : null,
    el("details", "all", [txt("summary", "", "All terms (exactly what is hashed)"), el("dl", "rows", f.rows.flatMap(([k, v]) => [txt("dt", "", k), txt("dd", "", v)])), termsTable(terms)]),
  ]);
  const status = el("div", "sheet-status");
  const actions = el("div", "sheet-actions", [backBtn, confirm]);
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
    const sent = await x.send(serializeAssertion(cred))
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
  const id = decodeURIComponent(location.pathname.split("/").pop() ?? "");
  const { status, data } = await api("/api/approvals").catch(() => ({ status: 0, data: {} as Obj }));
  if (status !== 200) {
    app.replaceChildren(txt("p", "alarm", status === 401 ? NEEDS_LINK : status === 503 ? "The runner has not connected yet. Try again in a moment." : "Cannot reach the approval relay."));
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
      o.review ? txt("span", `chip ${o.review.recommendation}`, `Opus: ${o.review.recommendation.replace(/_/g, " ")} (advisory)`) : null,
      el("span", "option-meta", [cd, " · ", el("span", "mono", [`hash ${o.terms_sha256.slice(0, 8)}`])]),
      check.ok ? null : txt("span", "alarm", `Do not approve: ${check.problem}.`),
      check.ok && f && !f.approvable ? txt("span", "alarm", f.sentence) : null,
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
    return el("div", "option-wrap", [card, no]);
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
      send: (credential) => api("/api/assertions", { proposal_id: o.proposal_id, terms_sha256: o.terms_sha256, decision, credential }),
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
    const sent = await api("/api/enrol", { code: input.value, credential: serializeRegistration(cred) })
      .catch(() => ({ status: 0, data: { error: "the relay cannot be reached" } as Obj }));
    if (sent.status !== 202) {
      status.textContent = `Not accepted: ${str(sent.data.error) || `error ${sent.status}`}.`;
      go.disabled = false;
      return;
    }
    const home = el("a", "back", ["← Dashboard"]) as HTMLAnchorElement;
    home.href = "/";
    await follow(str(sent.data.ticket), box, home);
  });
}

interface PolicyRow {
  key: string;
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
  const { status, data } = await api("/api/approvals").catch(() => ({ status: 0, data: {} as Obj }));
  if (status !== 200) {
    app.replaceChildren(txt("p", "alarm", status === 401 ? NEEDS_LINK : status === 503 ? "The runner has not connected yet. Try again in a moment." : "Cannot reach the relay."));
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
  const reason = document.createElement("input");
  reason.id = "reason";
  reason.className = "policy-input";
  reason.maxLength = 300;
  reason.placeholder = "Why, in one line";
  const reasonLabel = el("label", "policy-label", ["Reason"]);
  reasonLabel.setAttribute("for", "reason");
  const review = el("button", "confirm", ["Review change"]) as HTMLButtonElement;
  review.type = "button";
  const note = el("p", "sheet-status");
  app.replaceChildren(...[
    el("div", "toprow", [back]),
    txt("h1", "", "CFO policy"),
    txt("p", "lead", "Limits the agents work within, inside their mandates on chain. A change needs your passkey and takes effect at once."),
    enrolled ? null : txt("p", "warn-box", "No passkey is enrolled yet, so no change can be signed here."),
    el("div", "policy", fields.map((f) => f.row)),
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
  let store: Storage | null = null;
  try { store = localStorage; } catch { store = null; }
  viewKey = takeViewKey(location.hash, store);
  if (location.hash.includes("view=")) history.replaceState(null, "", location.pathname + location.search);
  setInterval(tickCountdowns, 1000);
  if (document.body.dataset.page === "approve") void approvePage();
  if (document.body.dataset.page === "enrol") enrolPage();
  if (document.body.dataset.page === "policy") void policyPage();
}

if (typeof document !== "undefined") boot();
