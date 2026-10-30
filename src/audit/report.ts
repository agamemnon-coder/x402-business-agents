// The audit report (tier 3 item 9): every decision with the agent that proposed it, the models that read or reviewed
// its evidence, what it does, the policy rule that sent it to a person, who decided, how, and the exact hash; then
// what the agents did alone and every refusal. Built from the ledger only, as data first (tested), then as a PDF.
// It ends with an anchor: `npm run verify-log -- --anchor <seq>:<hash>` later proves nothing was changed or cut off.

import PDFDocument from "pdfkit";
import { finalityView, NOT_CHECKED } from "../metal/finality.js";
import type { DB } from "../db/open.js";
import { verifyAuditChain, type AuditRowStored, type ChainCheck } from "./log.js";
import { approverName, describe, kindTitle, modelName, parseReview, REFUSAL_EVENTS, REFUSAL_WHAT, summarize } from "../dashboard/snapshot.js";

export interface ReportDecision {
  proposal_id: string;
  kind: string;
  title: string;
  proposed_by: string;
  proposed_at: string;
  what: string;
  rule: string;
  models: string[];
  advice: { model: string | null; recommendation: string; text: string } | null;
  status: string;
  decision: "APPROVED" | "REJECTED" | null;
  decided_by: string | null;
  method: string | null;
  decided_at: string | null;
  terms_sha256: string;
  outcome: string;
}

export interface AuditReport {
  generated_at: string;
  label: string;
  chain: ChainCheck;
  /** "<seq>:<row hash>" of the last row: what `verify-log --anchor` checks later. */
  anchor: string;
  alone: {
    sales: number; purchases_paid: number; purchases_refused: number; refunds_paid: number; sweeps_paid: number; injections_flagged: number; invoices_blocked: number;
    card_charges: number; card_declines: number; clearing_sales: number;
  };
  decisions: ReportDecision[];
  /** Each automatic refusal with the rule that made it (E5). */
  refusals: { at: string; agent: string; what: string; reason: string; rule: string }[];
  /** Metal finality certificates stored for the ledger's chain transactions (enterprise item 3). */
  finality: { certified: number; not_kept: number; failed: number; blocks: { block_number: number; block_hash: string; signers: number; participants: number; ok: boolean }[] };
}

/** Why a person had to decide, per kind (the CFO policy and the build plan's approval rules). */
const RULES: Record<string, string> = {
  mandate_replace: "Changing an agent's on-chain mandate (cap, budget, payee) always needs a person.",
  invoice_payment: "Every Airwallex payout needs a person; the fee ceiling and the reserve floors are part of the approved terms.",
  refund_batch: "Refunds outside the CFO policy's automatic limits need a person.",
  policy_change: "A change to the CFO policy needs the CFO's own approval.",
  payee_change: "A supplier's new bank details count only after a person verified them with the supplier on a contact already on file, and the CFO approved.",
  agent_onboard: "An outside agent gets a company card only after the CFO approves its request; the card's limits are then held by the CFO policy and enforced by Airwallex.",
  dev_test: "Dev test of the approval path; it moves no money.",
};

type P = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** The rule behind a policy change: a card limit or the emergency stop has its own words. */
function ruleOf(kind: string, termsJson: string): string {
  if (kind === "policy_change") {
    let keys: string[] = [];
    try {
      keys = ((JSON.parse(termsJson) as P).changes as { key: string }[]).map((c) => c.key);
    } catch { /* unreadable terms */ }
    if (keys.includes("freeze")) return "The emergency stop: the CFO may pull it from the phone (it tightens); lifting it loosens the policy, so it needs a proposal and the CFO's Face ID.";
    if (keys.some((k) => k.startsWith("card."))) return "A company card's limit is part of the CFO policy and is synced to the card at Airwallex; changing it needs the CFO's approval.";
  }
  return RULES[kind] ?? "Needs a person.";
}

/** The rule that made an automatic refusal, in words (E5). */
export function refusalRule(event: string, p: P): string {
  const reason = str(p.reason);
  if (event === "upstream.refused" || event === "refund.refused" || event === "sweep.refused") {
    if (reason.startsWith("frozen_by_cfo")) return "Emergency stop: every agent payment refused before signing";
    if (reason.startsWith("policy_cap_exceeded")) return "CFO policy limit, checked before anything is signed";
    if (reason.startsWith("mandate_")) return "The agent's mandate, enforced by the account on chain";
    return "Payment refused before or on chain";
  }
  if (event === "card.charge_declined") {
    if (reason === "CARD_INACTIVE") return "Emergency stop: the card is frozen at Airwallex";
    if (reason === "LIMIT_EXCEEDED") return "The card's limit at Airwallex, synced from the CFO policy";
    return "Declined by Airwallex";
  }
  const rules: Record<string, string> = {
    "invoice.fraud_suspected": "Invoice fraud check: bank details and vendor name against the allowlist; a person verifies by phone",
    "document.injection_flagged": "Documents are data: an instruction inside one changes nothing",
    "proposal.rejected": "The CFO's own decision (rejected with a signature)",
    "proposal.expired": "A proposal not approved in time can never run",
    "claude.rejected": "A model's answer must pass the code's check before it is used",
    "invoice.escalated": "An invoice outside what the agent may pay alone goes to a person",
    "sale.prepaid_undelivered": "A prepaid (clearing) sale that could not be delivered is owed and refunded",
  };
  return rules[event] ?? "";
}

function outcomeOf(status: string, executed: P | undefined, error: string | undefined): string {
  switch (status) {
    case "EXECUTED": {
      const e = executed ?? {};
      if (e.transfer_id) return `executed: transfer ${str(e.transfer_id)} ${str(e.status)}`.trim();
      if (e.steps) return `executed: ${str(e.steps)} mandate steps${e.query_price ? `, query price ${str(e.query_price)}` : ""}`;
      if (e.dev_test) return "executed: moved nothing";
      if (e.changes) return `executed: ${str(e.changes)} policy ${str(e.changes) === "1" ? "change" : "changes"} applied`;
      const parts = Object.entries(e).map(([k, v]) => `${k} ${str(v)}`);
      return `executed${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "REJECTED": return "rejected: nothing ran";
    case "EXPIRED": return "expired: nothing ran";
    case "SUPERSEDED": return "superseded: another option was approved";
    case "PENDING_APPROVAL": return "waiting for a decision";
    case "APPROVED": return "approved, not yet run";
    case "FAILED": return `failed: ${error ?? "see the ledger"}`;
    case "NEEDS_REAPPROVAL": return `needs a new approval: ${error ?? "see the ledger"}`;
    default: return status.toLowerCase();
  }
}

export function buildAuditReport(db: DB, now = new Date(), label = "ledger"): AuditReport {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[];
  const chain = verifyAuditChain(db);
  const payload = (r: AuditRowStored): P => { try { return JSON.parse(r.payload_json) as P; } catch { return {}; } };
  const lastOf = (event: string, subject: string) => [...rows].reverse().find((r) => r.event === event && r.subject === subject);
  const reads = rows.filter((r) => r.event === "claude.read").map((r) => ({ task: str(r.subject), p: payload(r) }));

  type PRow = { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; created_by: string; evidence_json: string | null; explanation: string | null; status: string; created_at: string };
  const proposals = db.prepare("SELECT * FROM proposals ORDER BY created_at, proposal_id").all() as PRow[];
  const decisions = proposals.map((p): ReportDecision => {
    let evidence: { sha256?: string }[] = [];
    try {
      const e: unknown = JSON.parse(p.evidence_json ?? "null") ?? (JSON.parse(p.terms_json) as P).evidence;
      if (Array.isArray(e)) evidence = e as { sha256?: string }[];
    } catch { /* no evidence */ }
    const shas = new Set(evidence.map((e) => e.sha256).filter(Boolean));
    const models = reads.filter((r) => shas.has(str(r.p.input_sha256))).map((r) => `${modelName(str(r.p.model))} (${r.task.replace(/_/g, " ")})`);
    const advice = parseReview(p.explanation);
    if (advice?.model) models.push(`${modelName(advice.model)} (review: ${advice.recommendation.replace(/_/g, " ")})`);
    const a = db.prepare("SELECT decision, approver, method, created_at FROM approvals WHERE proposal_id = ?").get(p.proposal_id) as
      { decision: "APPROVED" | "REJECTED"; approver: string; method: string; created_at: string } | undefined;
    const executed = lastOf("proposal.executed", p.proposal_id);
    const failed = lastOf("proposal.failed", p.proposal_id) ?? lastOf("proposal.needs_reapproval", p.proposal_id);
    return {
      proposal_id: p.proposal_id, kind: p.kind, title: kindTitle(p.kind), proposed_by: p.created_by, proposed_at: p.created_at,
      what: summarize(p.kind, p.terms_json), rule: ruleOf(p.kind, p.terms_json), models: [...new Set(models)], advice,
      status: p.status, decision: a?.decision ?? null, decided_by: a ? approverName(a.approver, a.method) : null, method: a?.method ?? null,
      decided_at: a?.created_at ?? null, terms_sha256: p.terms_sha256,
      outcome: outcomeOf(p.status, executed && payload(executed), failed && str(payload(failed).error)),
    };
  });

  const count = (...events: string[]) => rows.filter((r) => events.includes(r.event)).length;
  const refusals = rows.filter((r) => REFUSAL_EVENTS.has(r.event))
    .map((r) => ({ at: r.ts, agent: r.actor, what: REFUSAL_WHAT[r.event] ?? r.event, reason: describe(r as never, () => undefined).text, rule: refusalRule(r.event, payload(r)) }));
  const last = rows.at(-1);
  return {
    generated_at: now.toISOString(), label, chain, anchor: last ? `${last.seq}:${last.row_hash}` : "0:",
    alone: {
      sales: count("sale.delivered"), purchases_paid: count("upstream.paid", "upstream.paid_after_lookup"), purchases_refused: count("upstream.refused"),
      refunds_paid: count("refund.paid"), sweeps_paid: count("sweep.paid"), injections_flagged: count("document.injection_flagged"), invoices_blocked: count("invoice.fraud_suspected"),
      card_charges: count("card.charge_approved"), card_declines: count("card.charge_declined"),
      clearing_sales: rows.filter((r) => r.event === "sale.delivered" && str(payload(r).scheme) === "bajillion").length,
    },
    decisions, refusals,
    finality: { ...finalityView(db), blocks: (db.prepare("SELECT block_number, block_hash, ok, check_json FROM finality_certificates ORDER BY block_number").all() as { block_number: number; block_hash: string; ok: number; check_json: string }[])
      .map((b) => { const c = JSON.parse(b.check_json) as { quorum: { signers: number; participants: number } }; return { block_number: b.block_number, block_hash: b.block_hash, signers: c.quorum.signers, participants: c.quorum.participants, ok: b.ok === 1 }; }) },
  };
}

/** Cuts long advice at the last full sentence that fits. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return `${end > max / 2 ? cut.slice(0, end + 1) : cut} …`;
}

export type Line = { style: "title" | "h2" | "h3" | "text" | "mono" | "small"; text: string };

/** Exactly what the PDF prints, in order. */
export function reportLines(r: AuditReport): Line[] {
  const L: Line[] = [];
  const at = (iso: string | null) => (iso ? iso.replace("T", " ").replace(/\.\d{3}Z$|Z$/, " UTC") : "");
  L.push({ style: "title", text: "Northwind Outdoor: audit report" });
  L.push({ style: "text", text: `Generated ${at(r.generated_at)} from ${r.label}.` });
  L.push({ style: "h2", text: "Audit chain" });
  L.push({ style: "text", text: r.chain.ok
    ? `Intact: ${r.chain.rows} entries, each linked to the one before by SHA-256; the database refuses edits and deletes.`
    : `BROKEN at row ${r.chain.seq}: ${r.chain.reason}.` });
  L.push({ style: "mono", text: `Anchor ${r.anchor}` });
  L.push({ style: "small", text: `To prove later that nothing was changed or cut off: npm run verify-log -- --anchor ${r.anchor}` });
  L.push({ style: "h2", text: "What the agents did on their own, within their mandates and the policy" });
  const a = r.alone;
  L.push({ style: "text", text: `${a.sales} sales${a.clearing_sales ? ` (${a.clearing_sales} paid by Metal clearing)` : ""}; ${a.purchases_paid} supplier purchases paid and ${a.purchases_refused} refused; ${a.refunds_paid} refunds paid; ${a.sweeps_paid} sweeps; ${a.card_charges} card purchases approved and ${a.card_declines} declined by Airwallex; ${a.invoices_blocked} invoices blocked as possible fraud; ${a.injections_flagged} documents with planted instructions, ignored.` });
  L.push({ style: "h2", text: `Decisions that needed a person (${r.decisions.length})` });
  for (const d of r.decisions) {
    L.push({ style: "h3", text: `${d.proposal_id} · ${d.title}` });
    const by = d.proposed_by === "human" ? "a person" : d.proposed_by === "system" ? "the system" : `the ${d.proposed_by} agent`;
    L.push({ style: "text", text: `Proposed by ${by} at ${at(d.proposed_at)}: ${d.what}` });
    L.push({ style: "text", text: `Policy rule: ${d.rule}` });
    L.push({ style: "text", text: `Models: ${d.models.length ? d.models.join(", ") : "none (code only)"}` });
    if (d.advice && d.advice.text) L.push({ style: "small", text: `Advice (${d.advice.model ? modelName(d.advice.model) : "no model"}, ${d.advice.recommendation.replace(/_/g, " ")}): ${shorten(d.advice.text, 1500)}` });
    L.push({ style: "text", text: d.decision
      ? `Decision: ${d.decision.toLowerCase()} by ${d.decided_by} (${d.method === "passkey" ? "passkey signature over the hash" : `${d.method}, typed hash prefix`}) at ${at(d.decided_at)}`
      : `Decision: none (${d.status.toLowerCase().replace(/_/g, " ")})` });
    L.push({ style: "text", text: `Outcome: ${d.outcome}` });
    L.push({ style: "mono", text: `Terms SHA-256 ${d.terms_sha256}` });
  }
  const f = r.finality;
  if (f.certified + f.not_kept + f.failed > 0) {
    L.push({ style: "h2", text: "Finality on Metal" });
    L.push({ style: "text", text: `${f.certified} chain transaction(s) have Metal's finality certificate for their block, stored when fetched: the header hashes to the block and at least the quorum of validators signed.${f.not_kept ? ` ${f.not_kept} were looked up after the node stopped keeping the certificate (about 2 hours on testnet).` : ""}${f.failed ? ` ${f.failed} have a certificate that FAILED a check.` : ""}` });
    for (const b of f.blocks.slice(0, 40)) L.push({ style: "mono", text: `block ${b.block_number} ${b.block_hash.slice(0, 18)}... ${b.signers} of ${b.participants} validators ${b.ok ? "ok" : "FAILED"}` });
    L.push({ style: "small", text: `Not checked: ${NOT_CHECKED}. npm run verify checks the stored certificates again.` });
  }
  L.push({ style: "h2", text: `Refusals and escalations (${r.refusals.length})` });
  for (const x of r.refusals) {
    L.push({ style: "text", text: `${at(x.at)} · ${x.agent} · ${x.what}: ${x.reason}` });
    if (x.rule) L.push({ style: "small", text: `Rule: ${x.rule}` });
  }
  return L;
}

// The PDF's built-in fonts encode text as WinAnsi: Latin-1 plus a few typographic signs. Anything else is replaced.
const WINANSI_EXTRA = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
const SWAPS: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "≠": "!=", "✓": "ok" };

export function winAnsi(s: string): string {
  return [...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (ch === "\n" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)) return ch;
    return SWAPS[ch] ?? "?";
  }).join("");
}

/** Renders the report. `compress: false` keeps the file readable for tests. */
export function renderAuditPdf(r: AuditReport, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4", margin: 50, bufferPages: true, compress: opts.compress ?? true,
    info: { Title: "Northwind Outdoor audit report", Author: "x402-business-agents", Subject: `Audit report of ${r.label}`, Keywords: `anchor ${r.anchor}` },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const width = doc.page.width - 100;
  for (const l of reportLines(r)) {
    const text = winAnsi(l.text);
    switch (l.style) {
      case "title": doc.font("Helvetica-Bold").fontSize(18).fillColor("#111").text(text, { width }).moveDown(0.3); break;
      case "h2": doc.moveDown(0.6).font("Helvetica-Bold").fontSize(13).fillColor("#111").text(text, { width }).moveDown(0.2); break;
      case "h3": doc.moveDown(0.5).font("Helvetica-Bold").fontSize(10.5).fillColor("#111").text(text, { width }); break;
      case "mono": doc.font("Courier").fontSize(8).fillColor("#333").text(text, { width }); break;
      case "small": doc.font("Helvetica").fontSize(8).fillColor("#555").text(text, { width }); break;
      default: doc.font("Helvetica").fontSize(9.5).fillColor("#111").text(text, { width });
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would start a new page; the footer belongs in it.
    doc.page.margins.bottom = 0;
    doc.font("Courier").fontSize(7).fillColor("#777")
      .text(winAnsi(`Anchor ${r.anchor}  ·  page ${i + 1} of ${range.count}`), 50, doc.page.height - 35, { width, lineBreak: false });
  }
  doc.end();
  return done;
}
