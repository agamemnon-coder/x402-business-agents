// "Verify" per approval and payment (master list 686). One small control per signed approval: in the browser it reads
// the terms as the record stores them, puts them in canonical form (RFC 8785, as the phone does before it signs:
// src/approve/client.ts), hashes them with WebCrypto, and compares the result with the hash that was signed. The answer
// is plain words: "Hash matches the signed terms" or "Does not match the signed terms". The payment it led to sits next
// to it, with its link (Metal's explorer for a transaction; an Airwallex id as text, Airwallex has no public explorer).
//
// Only a record that keeps the full signed terms gets the button: the receipts of awx-1 and of the platform run, and the
// proposals of the main run and agent run whose published copy still hashes to the signed hash. The published ledgers
// are sanitised, so some of their terms are shortened: those say so in one line and get no button, never a false
// "Does not match". A record that keeps only the hash (the passkey account on Metal) shows its transaction link alone.
// The terms ride in the button's data-t attribute (no data <script>: a page keeps one script, its CSP hashes it).
// test/verify-terms.test.ts runs the browser's code in Node on a real receipt and on tampered terms.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalize } from "../approve/client.js";
import { EXPLORER_TX } from "../metal/network.js";
import { esc } from "./ui.js";

/** The verdicts and the other lines, word for word. */
export const VERIFY_WORDS = {
  button: "Verify",
  match: "Hash matches the signed terms",
  mismatch: "Does not match the signed terms",
  unavailable: "This browser cannot compute SHA-256 here",
  shortened: "The published copy of these terms is shortened, so the hash cannot be recomputed here.",
  hashOnly: "This record keeps the signed hash, not the terms: check the transaction.",
} as const;

export interface SignedRef { label: string; value: string; href?: string }
export interface Signed {
  /** The proposal id, P-0002. */
  id: string;
  /** What was signed, in a few words. */
  what: string;
  /** The SHA-256 that was signed (hex). */
  hash: string;
  /** The terms as the record stores them, when it stores them in full; else null. */
  terms: Record<string, unknown> | null;
  /** Why there is no button, when there is none. */
  why?: "shortened" | "hash-only";
  /** The payment or transaction it led to. */
  ref?: SignedRef;
  /** The record it is read from. */
  source: string;
}

const readJson = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T; } catch { return null; } };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const shortId = (id: string) => id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;

/** True when the terms, in canonical form, hash to the signed hash (the same test the browser runs). */
export function termsMatch(terms: unknown, hash: string): boolean {
  try { return sha(canonicalize(terms)) === hash; } catch { return false; }
}

interface Receipt { terms: Record<string, unknown>; terms_sha256: string }
function fromReceipt(file: string, ref?: SignedRef): Signed | null {
  const r = readJson<Receipt>(file);
  if (!r || typeof r.terms_sha256 !== "string") return null;
  const t = r.terms;
  const what = [t.currency, t.amount].every((x) => typeof x === "string") ? `${String(t.currency)} ${String(t.amount)} to ${String(t.vendor ?? t.beneficiary_name ?? "the supplier")}` : String(t.kind ?? "terms");
  return { id: String(t.proposal_id ?? ""), what, hash: r.terms_sha256, terms: termsMatch(t, r.terms_sha256) ? t : null, ...(termsMatch(t, r.terms_sha256) ? {} : { why: "shortened" as const }), ...(ref ? { ref } : {}), source: file };
}

interface LedgerRecord { ledger: { proposals: { proposal_id: string; kind: string; status: string; terms: Record<string, unknown> }[]; events: { event: string; subject?: string; payload?: { terms_sha256?: string } }[] } }
const KIND_WORDS: Record<string, string> = { policy_change: "a policy change", mandate_replace: "an agent's mandate", refund_batch: "a refund batch", invoice_payment: "an invoice payment", payee_add: "a new payee", supplier_payment: "a supplier payment" };
/** The proposals a person decided in a run's ledger, each with the hash its created row carries. */
function fromLedger(file: string): Signed[] {
  const rec = readJson<LedgerRecord>(file);
  if (!rec) return [];
  const out: Signed[] = [];
  for (const p of rec.ledger.proposals) {
    const hash = rec.ledger.events.find((e) => e.event === "proposal.created" && e.subject === p.proposal_id)?.payload?.terms_sha256;
    if (!hash || !["EXECUTED", "REJECTED"].includes(p.status)) continue;
    const ok = termsMatch(p.terms, hash);
    out.push({ id: p.proposal_id, what: `${KIND_WORDS[p.kind] ?? p.kind.replace(/_/g, " ")}, ${p.status === "REJECTED" ? "rejected" : "approved"}`, hash, terms: ok ? p.terms : null, ...(ok ? {} : { why: "shortened" as const }), source: file });
  }
  return out;
}

interface OwnersRecord { proposals: { proposal_id: string; what: string; status: string; terms_sha256: string; tx?: string; explorer?: string; cap?: string; budget?: string }[] }
/** The passkey account on Metal (12 Nov): each proposal's signed hash and the transaction the account ran it in. */
export function fromOwnersRecord(file: string): Signed[] {
  const rec = readJson<OwnersRecord>(file);
  if (!rec || !Array.isArray(rec.proposals)) return [];
  return rec.proposals.filter((p) => /^[0-9a-f]{64}$/.test(p.terms_sha256)).map((p) => {
    const href = p.tx && p.explorer === `${EXPLORER_TX}${p.tx}` ? p.explorer : undefined;
    return { id: p.proposal_id, what: `${p.what} the agent's mandate, signed by two passkeys`, hash: p.terms_sha256, terms: null, why: "hash-only" as const,
      ...(p.tx && href ? { ref: { label: "Run on Metal testnet", value: shortId(p.tx), href } } : {}), source: file };
  });
}

/** The record files read here. */
export const SIGNED_FILES = {
  awx1: "docs/runs/2026-11-07-awx-1/receipt-P-0002.json",
  platform: "docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json",
  main: "docs/demo/main-run.json",
  agent: "docs/demo/agent-run.json",
  owners: "docs/runs/2026-11-12-faceid-onchain.json",
} as const;

/** The signed approvals per run on /runs (its row key), read from the records. */
export function signedByRun(): Record<string, Signed[]> {
  const out: Record<string, Signed[]> = {};
  const add = (key: string, xs: (Signed | null)[]) => { const ok = xs.filter((x): x is Signed => !!x && !!x.id); if (ok.length) out[key] = ok; };
  const awxTransfer = readJson<{ invoices?: { proposal_id?: string; transfer_id?: string }[] }>("docs/demo/airwallex-run.json")?.invoices?.find((i) => i.proposal_id === "P-0002")?.transfer_id;
  add("awx-1", [fromReceipt(SIGNED_FILES.awx1, awxTransfer ? { label: "Airwallex transfer, PAID", value: awxTransfer } : undefined)]);
  const platformPayout = readJson<{ transfers?: { transfer_id: string; status: string }[] }[]>("docs/runs/2026-11-10-platform-e2e/facts.json")?.[0]?.transfers?.find((t) => t.status === "PAID")?.transfer_id;
  add("platform-e2e-1", [fromReceipt(SIGNED_FILES.platform, platformPayout ? { label: "Airwallex payout, PAID", value: platformPayout } : undefined)]);
  add("main-1", fromLedger(SIGNED_FILES.main));
  add("agent-1", fromLedger(SIGNED_FILES.agent));
  add("faceid-onchain-1", fromOwnersRecord(SIGNED_FILES.owners));
  return out;
}

/** One approval: what was signed, the control (or why there is none), the payment it led to. The hash stays last. */
export function verifyItem(s: Signed): string {
  const ref = s.ref ? `<span class="vfr">${esc(s.ref.label)}: ${s.ref.href ? `<a class="pf" href="${esc(s.ref.href)}" target="_blank" rel="noopener">${esc(s.ref.value)} ↗</a>` : `<code>${esc(s.ref.value)}</code>`}</span>` : "";
  const control = s.terms
    ? `<button type="button" class="vfb" data-t="${esc(JSON.stringify(s.terms))}" aria-label="${esc(`${VERIFY_WORDS.button} ${s.id}: hash its terms in this browser`)}">${esc(VERIFY_WORDS.button)}</button><output class="vfo" aria-live="polite"></output>`
    : `<span class="vfn">${esc(s.why === "hash-only" ? VERIFY_WORDS.hashOnly : VERIFY_WORDS.shortened)}</span>`;
  return `<div class="vf" role="listitem" data-h="${esc(s.hash)}"><span class="vfw"><b>${esc(s.id)}</b> · ${esc(s.what)}</span>${control}${ref}<code class="vfh" title="Signed terms, SHA-256">${esc(s.hash)}</code></div>`;
}

/** The list for one run, or "" when the run has none. */
export function verifyList(items: Signed[] | undefined): string {
  return items?.length ? `<div class="vfl" role="list" aria-label="Signed approvals">${items.map(verifyItem).join("")}</div>` : "";
}

/** The style: the site's tokens only. */
export const VERIFY_CSS = `
.vfl { margin: 8px 0; display: grid; gap: 8px; }
.vf { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 14px; line-height: 1.45; min-width: 0; }
.vf .vfw { flex: 1 1 220px; min-width: 0; }
.vf .vfb { font: 650 13px/1 Inter, system-ui, sans-serif; padding: 7px 14px; min-height: 44px; min-width: 44px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.vf .vfb:hover { border-color: var(--accent); }
.vf .vfb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.vf .vfo { font-weight: 650; } .vf .vfo.ok { color: var(--ok); } .vf .vfo.bad { color: var(--bad); }
.vf .vfn { color: var(--muted); font-size: 13.5px; flex-basis: 100%; }
.vf .vfr { color: var(--muted); font-size: 13.5px; overflow-wrap: anywhere; } .vf .vfr a { display: inline-flex; align-items: center; min-height: 44px; }
.vf .vfh { flex-basis: 100%; color: var(--muted); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }`;

/**
 * The browser's code (ES5, for a template string). vfCanonical and vfVerdict are the parts the test runs in Node; the
 * last block wires every .vfb on the page.
 */
export const VERIFY_TERMS_CORE = `
function vfCanonical(v) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") { if (!isFinite(v)) throw new Error("not JSON"); return JSON.stringify(v); }
  if (Array.isArray(v)) return "[" + v.map(vfCanonical).join(",") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + vfCanonical(v[k]); }).join(",") + "}";
  throw new Error("not JSON");
}
function vfVerdict(termsJson, hash) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(vfCanonical(JSON.parse(termsJson)))).then(function (d) {
    var hex = Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return hex === hash ? "match" : "mismatch";
  });
}`;

export const VERIFY_TERMS_JS = `${VERIFY_TERMS_CORE}
(function () {
  var W = ${JSON.stringify({ match: VERIFY_WORDS.match, mismatch: VERIFY_WORDS.mismatch, unavailable: VERIFY_WORDS.unavailable })};
  document.querySelectorAll(".vf .vfb").forEach(function (b) {
    b.addEventListener("click", function () {
      var li = b.closest(".vf"), out = li.querySelector(".vfo"), t = b.getAttribute("data-t");
      out.className = "vfo"; out.textContent = "";
      if (!window.crypto || !crypto.subtle) { out.textContent = W.unavailable; return; }
      vfVerdict(t, li.getAttribute("data-h")).then(function (v) {
        out.textContent = W[v]; out.className = "vfo " + (v === "match" ? "ok mo-rise" : "bad mo-shake");
      }, function () { out.textContent = W.mismatch; out.className = "vfo bad mo-shake"; });
    });
  });
})();`;
