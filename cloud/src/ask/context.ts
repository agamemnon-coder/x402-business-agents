// Ask Purser in context (21 Nov, "Purser Bot as a real financial copilot"): opened from a page of Purser Cloud, the
// panel knows which page and which record the person is viewing (an invoice's id, a page's kind; never a token, a
// session, an amount or anything secret) and offers three quick actions that fit it: check an invoice's status, view
// the transactions, explain a decision. The context reaches the agent as one line it may read; it is checked here (a
// kind from a fixed list, an id of letters, digits and _.:- only), so it can carry no instruction.
//
// Read-only stays: the agent reads the DEMO company's records only (./tools.ts). When the person is in the demo company
// (a guest), the record they view is the demo record, and the agent may read it by its id. In their own company the
// agent cannot read it: it says so and explains from the docs. Any financial action goes through Purser's own workflow:
// the panel can open the page where the CFO approves with Face ID, never act (ASK_NAV, the button's navigate message).

export const ASK_CONTEXT_KINDS = ["overview", "invoices", "invoice", "transactions", "payment", "agents", "policy", "books", "audit", "proof"] as const;
export type AskContextKind = (typeof ASK_CONTEXT_KINDS)[number];
export interface AskContext { kind: AskContextKind; id?: string; demo?: boolean }
/** A record's id as a page shows it: "AP-0042", "inv_3f2a", "P-0005". */
export const CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/** The context from untrusted input (URL parameters, a message, a request body), or null when it is not one. */
export function parseContext(v: unknown): AskContext | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== "string" || !(ASK_CONTEXT_KINDS as readonly string[]).includes(o.kind)) return null;
  const id = typeof o.id === "string" && CONTEXT_ID.test(o.id) ? o.id : undefined;
  return { kind: o.kind as AskContextKind, ...(id ? { id } : {}), ...(o.demo === true ? { demo: true } : {}) };
}

const WORDS: Record<AskContextKind, string> = {
  overview: "the overview", invoices: "the invoices", invoice: "invoice", transactions: "the transactions", payment: "payment",
  agents: "the agents and their limits", policy: "the CFO's policy and settings", books: "the books", audit: "the audit archive", proof: "the run records",
};
/** What the panel says it is looking at: "Invoice AP-0042", "The transactions". */
export function contextLabel(c: AskContext): string {
  const w = c.id && (c.kind === "invoice" || c.kind === "payment") ? `${WORDS[c.kind]} ${c.id}` : WORDS[c.kind];
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** The line the agent reads before the question. */
export function contextLine(c: AskContext): string {
  const where = `The person has Ask Purser open on Purser Cloud's page of ${c.id && (c.kind === "invoice" || c.kind === "payment") ? `${WORDS[c.kind]} ${c.id}` : WORDS[c.kind]}`;
  return c.demo
    ? `${where}, in the demo company (Northwind Outdoor, made-up data): "this invoice", "this payment" or "this page" means that record, which your tools can read${c.id ? ` by its id ${c.id}` : ""}.`
    : `${where}, in their own company, which your tools cannot read: say so if they ask about that record, answer from the docs how Purser treats such a record, and say that any approval is made on that page by the CFO with Face ID.`;
}

export type QuickKey = "status" | "transactions" | "decision";
export const QUICK_LABELS: Record<QuickKey, string> = { status: "Check invoice status", transactions: "View transactions", decision: "Explain a decision" };
/** Each quick action's question, by the page's kind ("*" when no rule names it); {id} is the record's id. */
export const QUICK_QUESTIONS: Record<QuickKey, Partial<Record<AskContextKind | "*", string>>> = {
  status: {
    invoice: "What is the status of invoice {id}, and what is it waiting for?",
    payment: "Which invoice does payment {id} pay, and what is its status?",
    "*": "Which invoices are waiting, and for what?",
  },
  transactions: {
    invoice: "Which payments were made for invoice {id}?",
    "*": "Show the latest payments and transactions.",
  },
  decision: {
    invoice: "Explain the decision on invoice {id}: who decided, and under which rule?",
    payment: "Explain payment {id}: who allowed it, and how?",
    policy: "Explain how the CFO's policy decides whether an agent may pay alone.",
    agents: "Explain the agents' newest decisions and the limits they work within.",
    audit: "Explain the audit trail of the newest payment.",
    "*": "Explain the newest agent decision and the rule behind it.",
  },
};
/** The three quick actions for a page, in a fixed order. */
export function quickActions(c: AskContext | null): { key: QuickKey; label: string; q: string }[] {
  return (["status", "transactions", "decision"] as const).map((key) => {
    const t = QUICK_QUESTIONS[key], byKind = c ? t[c.kind] : undefined;
    const q = byKind && (!byKind.includes("{id}") || c?.id) ? byKind.replace("{id}", c?.id ?? "") : t["*"]!;
    return { key, label: QUICK_LABELS[key], q };
  });
}

/** Where the panel may send the console (the person acts there, with their own passkey): a hash, checked. */
export const ASK_NAV = /^#\/(?:overview|transactions|agents|books|archive|invoices(?:\?f=waiting_cfo)?|invoices\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,63})$/;
export const OPEN_APPROVAL = "Open where the CFO approves";
/** The page where the CFO approves what the person views: the invoice itself, else what waits for the CFO. */
export const approvalHash = (c: AskContext | null): string | null =>
  !c ? null : c.kind === "invoice" && c.id ? `#/invoices/${c.id}` : c.kind === "invoices" || c.kind === "overview" || c.kind === "policy" ? "#/invoices?f=waiting_cfo" : null;

/** The same, in the page's script (one source: the tables above as data). */
export const CONTEXT_JS = `
const QUICK = ${JSON.stringify({ labels: QUICK_LABELS, questions: QUICK_QUESTIONS, words: WORDS, kinds: ASK_CONTEXT_KINDS, open: OPEN_APPROVAL })};
const CTX_ID = ${CONTEXT_ID.toString()};
function parseCtx(o) {
  if (!o || typeof o !== 'object' || typeof o.kind !== 'string' || !QUICK.kinds.includes(o.kind)) return null;
  const c = { kind: o.kind }; if (typeof o.id === 'string' && CTX_ID.test(o.id)) c.id = o.id; if (o.demo === true || o.demo === '1') c.demo = true; return c;
}
function ctxLabel(c) { const w = c.id && (c.kind === 'invoice' || c.kind === 'payment') ? QUICK.words[c.kind] + ' ' + c.id : QUICK.words[c.kind]; return w.charAt(0).toUpperCase() + w.slice(1); }
function quickOf(c) {
  return ['status', 'transactions', 'decision'].map((key) => {
    const t = QUICK.questions[key], k = c ? t[c.kind] : undefined;
    return { key, label: QUICK.labels[key], q: k && (k.indexOf('{id}') < 0 || (c && c.id)) ? k.replace('{id}', (c && c.id) || '') : t['*'] };
  });
}
function approvalOf(c) { return !c ? null : c.kind === 'invoice' && c.id ? '#/invoices/' + c.id : (c.kind === 'invoices' || c.kind === 'overview' || c.kind === 'policy') ? '#/invoices?f=waiting_cfo' : null; }
`;
