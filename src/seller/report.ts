// The evidence report the seller sends the customer: one self-contained HTML page (no script, no outside request)
// with the decision, each payment's evidence and the links to check it on Metal's explorer. Everything on it comes
// from the stored case; nothing is recomputed or rephrased here.

import { EXPLORER_TX } from "../metal/network.js";
import { fromCents } from "../lib/money.js";
import { CLAIM_WORDS } from "./disputeDesk.js";
import type { DisputeCase } from "./desk.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (h: string) => (h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h);
const tx = (h: string) => (/^0x[0-9a-fA-F]{64}$/.test(h) ? `<a href="${esc(EXPLORER_TX + h)}">${esc(short(h))}</a>` : esc(h || "—"));
const yes = (ok: boolean, good: string, bad: string) => `<span class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"} ${esc(ok ? good : bad)}</span>`;

const OUTCOME: Record<DisputeCase["decision"]["outcome"], string> = { rejected: "Not refunded", refund: "Refunded in full", partial_refund: "Partly refunded" };

export function disputeReportHtml(c: DisputeCase, seller = "Northwind Outdoor"): string {
  const routeLine = c.route === "auto" ? "Refunded at once, within the CFO's automatic limits."
    : c.route === "approval" ? `The refund is above the CFO's automatic limits and waits for the CFO's approval with Face ID (${esc(c.proposal_id)}).`
    : "Nothing to refund.";
  const rows = c.packs.map((p) => {
    const d = c.decision.per_sale.find((x) => x.sale_id === p.sale_id)!;
    const paid = c.refunds.find((r) => r.sale_id === p.sale_id);
    return `<tr>
      <td><b>${esc(p.sale_id)}</b><div class="sub">${esc(p.request)}</div><div class="sub">${esc(p.paid_at.replace("T", " ").slice(0, 19))} UTC</div></td>
      <td class="num">${esc(fromCents(p.charged_cents))}</td>
      <td>${yes(p.order.valid, `signed for ${fromCents(p.order.amount_cents ?? 0)}`, p.order.present ? "does not verify" : "none")}${p.order.first_use_sale && p.order.first_use_sale !== p.sale_id ? `<div class="sub bad">already used for ${esc(p.order.first_use_sale)}</div>` : ""}</td>
      <td>${yes(p.mandate.within, "inside the bound mandate", p.mandate.detail)}<div class="sub">payment ${tx(p.tx)}</div>${p.finality ? `<div class="sub">${p.finality.status === "REPORTED" ? `Metal reported it final: block ${esc(p.finality.block_number)}, ${esc(p.finality.signers)} of ${esc(p.finality.participants)} validators (their signature not verified)` : p.finality.status === "NOT_KEPT" ? "finality certificate no longer kept by the node" : p.finality.status === "NOT_FOUND" ? "never showed as final" : "finality certificate FAILED a check"}</div>` : ""}</td>
      <td>${yes(p.delivery.matches, "as we recorded it", "differs from our record")}<div class="sub mono">${esc(p.delivery.body_sha256.slice(0, 16))}…</div></td>
      <td><b>${d.refund_cents ? esc(fromCents(d.refund_cents)) : "0.00"}</b>${paid?.tx ? `<div class="sub">refund ${tx(paid.tx)}</div>` : ""}${p.refunded_cents ? `<div class="sub">${esc(fromCents(p.refunded_cents))} already refunded earlier</div>` : ""}<div class="sub">${esc(d.why)}</div></td>
    </tr>`;
  }).join("");
  const m = c.packs.find((p) => p.mandate.bound_tx)?.mandate;
  const passkeys = c.packs.filter((p) => p.human.passkey);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dispute ${esc(c.case_id)}: ${esc(seller)}</title>
<style>
:root { --text: #0f172a; --muted: #5b6475; --border: #e3e6ec; --ok: #0f7a3d; --bad: #b42318; --bg: #fff; --sunken: #f5f6f8; --accent: #4f46e5; }
@media (prefers-color-scheme: dark) { :root { --text: #e8eaf0; --muted: #9aa3b5; --border: #2a2f3a; --ok: #4ade80; --bad: #f87171; --bg: #0d0f14; --sunken: #161a22; --accent: #a5b4fc; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 32px 16px 48px; overflow-wrap: anywhere; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.01em; } h2 { font-size: 17px; margin: 28px 0 8px; }
.sub { color: var(--muted); font-size: 13px; } .mono { font-family: ui-monospace, Menlo, monospace; }
.box { background: var(--sunken); border-radius: 12px; padding: 14px 16px; margin: 12px 0; }
.outcome { font-size: 20px; font-weight: 700; }
table { width: 100%; border-collapse: collapse; font-size: 14px; } th { text-align: left; color: var(--muted); font-weight: 600; font-size: 12.5px; padding: 6px; overflow-wrap: normal; white-space: nowrap; }
td { border-top: 1px solid var(--border); padding: 8px 6px; vertical-align: top; overflow-wrap: anywhere; } td.num { text-align: right; white-space: nowrap; }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; } a { color: var(--accent); }
.tablewrap { overflow-x: auto; }
.gap { margin-top: 6px; }
@media (max-width: 640px) { thead { display: none; } tr { display: block; border-top: 1px solid var(--border); padding: 8px 0; } td { display: block; border: 0; padding: 3px 0; } td.num { text-align: left; } }
</style></head>
<body><main>
<p class="sub">${esc(seller)} · Dispute desk · test money on Metal testnet</p>
<h1>Your dispute ${esc(c.case_id)}</h1>
<p class="sub">Opened ${esc(c.opened_at.replace("T", " ").slice(0, 16))} UTC · ${esc(c.packs.length)} payment${c.packs.length === 1 ? "" : "s"} from ${esc(c.customer)}</p>
<div class="box"><div class="sub">You said</div><div>${esc(CLAIM_WORDS[c.claim].charAt(0).toUpperCase() + CLAIM_WORDS[c.claim].slice(1))}.${c.text ? ` <span class="sub">"${esc(c.text)}"</span>` : ""}</div></div>
<div class="box"><div class="outcome">${esc(OUTCOME[c.decision.outcome])}: ${esc(fromCents(c.decision.refund_cents))} test USD</div><div>${routeLine} Refunds go only to the account that paid, ${esc(c.decision.refund_to)}.</div></div>

<h2>The evidence, per payment</h2>
<div class="tablewrap"><table>
<thead><tr><th>Payment</th><th>Charged</th><th>Signed order</th><th>Chain check</th><th>Delivered</th><th>Refund</th></tr></thead>
<tbody>${rows}</tbody></table></div>

<h2>Who stood behind the purchase</h2>
<div class="box">${m ? `Every payment above is checked on chain against the mandate bound on your account <span class="mono">${esc(m.principal)}</span> (bound in ${tx(m.bound_tx)}). Metal records that this mandate was bound by your account's owner key, with its limits and its only payee; the chain refuses any payment outside it.` : "No bound mandate was found for these payments."}
<div class="sub gap">What the chain does not prove: that the owner key is held by a person. ${passkeys.length ? `Your owner also confirmed this mandate with a passkey (Face ID or similar) for ${passkeys.length} payment${passkeys.length === 1 ? "" : "s"}: ${passkeys.map((p) => (p.human.passkey!.verified ? "verified" : "did not verify")).join(", ")}. That confirmation is Purser's own addition, not enforced by Metal.` : "No passkey confirmation from your side is on file."}</div></div>

<h2>The decision, explained</h2>
<div class="box">${esc(c.explanation)}${c.packs.some((p) => p.refunded_cents) ? `<div class="sub gap">Note: orders ${esc(c.packs.filter((p) => p.refunded_cents).map((p) => p.sale_id).join(", "))} had already been refunded earlier (${esc(fromCents(c.packs.reduce((n, p) => n + (p.refunded_cents ?? 0), 0)))} test USD in all) for wrong data; the explanation above does not say so.</div>` : ""}<div class="sub gap">Explained by ${esc(c.explained_by)}. The decision and every amount were made by code from the evidence above; the explanation is advice.</div></div>

<h2>Check it yourself</h2>
<p class="sub">Each payment and refund links to Metal's explorer. The signed orders, the mandate and each payment can be checked with <span class="mono">verifyMandatePayment</span> from <span class="mono">@metalntwx/metal-pay</span> (step 4: the payment is your agent's per-payment mandate, inside the mandate at its block). The delivered data's SHA-256 is shown so you can compare it with what you received.</p>
</main></body></html>
`;
}
