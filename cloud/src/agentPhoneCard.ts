// An agent's card on a phone (23 Nov, the owner: "cards that you can connect with your phone"). Apple Wallet needs the
// owner's Pass Type ID certificate (./walletPass.ts, behind configuration; not set yet), so the console also offers a QR
// code: the phone opens a read-only view of that agent's card, in the same design, with what it spent this month.
//
//   GET  /v1/card-design                    the company's card design (cosmetic: colour, initials, a small logo, a preset
//                                            per agent), and whether this caller may save it;
//   POST /v1/card-design                    an owner or admin saves it (never the demo company's shared guest: the console
//                                            keeps a guest's design in the browser and says so);
//   POST /v1/agents/{id}/phone-card/link    a link to the agent's card view that works for PHONE_LINK_DAYS, and its QR as SVG;
//   GET  /card/{link}                       that view: pcd.<company>.<agent>.<expiry>.<MAC>, the MAC an HMAC-SHA-256 (128
//                                            bits) under a key derived from the session secret. ?s, ?c, ?i carry the design
//                                            the console showed (cosmetic only, each checked; outside the MAC).
// The view shows the agent's name, the card's last four (never more), its limits, what it spent and its status. It has no
// script, no form and no way to act: it pays, freezes and changes nothing. Every value is escaped.

import { CARD_ART_CSS, CARD_ART_DEFS, CARD_PRESETS, cardSvg, cleanDesign, EMPTY_DESIGN, modelShort, styleOf, type CardDesign, type CardPreset } from "./agentCardArt.js";
import { REPO_BLOB, ROSTER } from "./agentRoster.js";
import { recordedNegotiation } from "../../src/negotiate/negotiate.js";
import { agentsOf } from "./consoleData.js";
import { hmacB64u, sameString } from "./crypto.js";
import { isDemoTenant } from "./guest/guest.js";
import { qrSvg } from "./qr.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";
import type { PassConfig } from "./walletPass.js";
import { walletPassLink } from "./walletPassRoutes.js";

export const PHONE_LINK_DAYS = 7;
const TAG = "pcd";
const linkSecret = (sessionSecret: string) => `phone-card:${sessionSecret}`;
const linkMac = async (sessionSecret: string, body: string) => (await hmacB64u(linkSecret(sessionSecret), body)).slice(0, 22);

// ---- The company's card design ----

const TABLE = "CREATE TABLE IF NOT EXISTS card_designs (tenant_id TEXT PRIMARY KEY, design_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)";
const ready = new WeakSet<Sql>();
async function table(sql: Sql) { if (!ready.has(sql)) { await sql.exec(TABLE); ready.add(sql); } }

export async function designOf(sql: Sql, tenantId: string): Promise<{ design: CardDesign; updated_at: string | null }> {
  await table(sql);
  const r = await sql.first<{ design_json: string; updated_at: string }>("SELECT design_json, updated_at FROM card_designs WHERE tenant_id = ?", [tenantId]);
  if (!r) return { design: EMPTY_DESIGN, updated_at: null };
  let raw: unknown = null;
  try { raw = JSON.parse(r.design_json); } catch { /* a broken row reads as no design */ }
  return { design: cleanDesign(raw), updated_at: r.updated_at };
}

/** Saves a design; the demo company's is never saved (its guests share one viewer). Answers what was kept. */
export async function saveDesign(sql: Sql, tenantId: string, by: string, body: unknown, now: Date): Promise<CardDesign> {
  if (isDemoTenant(tenantId)) throw new Error("the demo company's design is kept in each guest's browser");
  const d = cleanDesign(body);
  await table(sql);
  await sql.run("INSERT INTO card_designs (tenant_id, design_json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET design_json = excluded.design_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    [tenantId, JSON.stringify(d), now.toISOString(), by.slice(0, 80)]);
  return d;
}

// ---- What the phone shows ----

interface AgentRec { id: string; name: string; role: string; status: string; models: string[]; card: { last4: string; currency: string; per_purchase: string | null; per_month: string | null; spent_month: string | null; month: string | null } | null }
export interface PhoneCardData {
  company: string; demo: boolean; agent: string; name: string; role: string; status: string; model: string | null;
  card: AgentRec["card"];
}

export async function phoneCardData(sql: Sql, tenantId: string, agent: string): Promise<PhoneCardData | null> {
  const company = await sql.first<{ name: string }>("SELECT name FROM tenants WHERE id = ?", [tenantId]);
  const a = ((await agentsOf(new TenantDb(sql, tenantId))).agents as AgentRec[]).find((x) => x.id === agent);
  if (!company || !a) return null;
  const roster = ROSTER.find((r) => r.id === agent);
  return { company: company.name, demo: isDemoTenant(tenantId), agent, name: a.name, role: a.role, status: a.status, model: roster?.model ?? a.models[0] ?? null, card: a.card };
}

/** The design the console showed, from the link's query: each part checked, anything else dropped. */
export function designFromQuery(q: URLSearchParams, agent: string, stored: CardDesign): CardDesign {
  const s = q.get("s"), c = q.get("c"), i = q.get("i");
  const styles = { ...stored.styles };
  if (s && (CARD_PRESETS as readonly string[]).includes(s)) styles[agent] = s as CardPreset;
  return cleanDesign({ ...stored, styles, color: c && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : stored.color, initials: i && /^[A-Z0-9]{1,3}$/.test(i) ? i : stored.initials });
}

/** A link to the agent's card view, and its QR; null when the company's records name no such agent. */
export async function phoneCardLink(sql: Sql, sessionSecret: string, tenantId: string, agent: string, origin: string, now: Date, design: unknown): Promise<{ url: string; expires_at: string; qr_svg: string } | null> {
  if (!/^[a-z0-9_]{1,40}$/.test(agent) || !(await phoneCardData(sql, tenantId, agent))) return null;
  const exp = (now.getTime() + PHONE_LINK_DAYS * 86_400_000).toString(36);
  const body = `${TAG}.${tenantId}.${agent}.${exp}`;
  const d = cleanDesign(design);
  const q = new URLSearchParams();
  const s = d.styles[agent];
  if (s) q.set("s", s);
  if (d.color) q.set("c", d.color.slice(1));
  if (d.initials) q.set("i", d.initials);
  const url = `${origin.replace(/\/+$/, "")}/card/${body}.${await linkMac(sessionSecret, body)}${q.size ? `?${q}` : ""}`;
  return { url, expires_at: new Date(parseInt(exp, 36)).toISOString(), qr_svg: qrSvg(url, { margin: 2 }) };
}

/** The company and agent a link names, while it is good; null otherwise. */
export async function phoneCardLinkOpen(sessionSecret: string, token: string, now: Date): Promise<{ tenantId: string; agent: string; expires_at: string } | null> {
  const m = /^pcd\.(t_[A-Za-z0-9_-]{6,64})\.([a-z0-9_]{1,40})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m || !sameString(await linkMac(sessionSecret, `${TAG}.${m[1]}.${m[2]}.${m[3]}`), m[4]!)) return null;
  const exp = parseInt(m[3]!, 36);
  if (exp <= now.getTime()) return null;
  return { tenantId: m[1]!, agent: m[2]!, expires_at: new Date(exp).toISOString() };
}

// ---- The page ----

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (cur: string, v: string | null) => (v === null ? "—" : `${cur === "EUR" ? "€" : `${esc(cur)} `}${esc(Number(v).toFixed(2))}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : m);
const STATUS: Record<string, string> = { active: "Active", paused: "Paused", revoked: "Revoked" };

/** The card's face as markup: the same classes the console draws with (CARD_ART_CSS); every value escaped. 26 Nov (the
 * owner: "far too busy"): on the card only the name, one mark, the last four and the network; the rest is under it. */
export function cardFaceHtml(d: PhoneCardData, design: CardDesign): string {
  const preset = styleOf(design, d.agent);
  const c = d.card;
  // 27 Nov (Obsidian): the art is a few <use> of the page's shared shapes (CARD_ART_DEFS); Purser's quill in the medallion
  // until the company sets its own initials or logo.
  return `<div class="acard p-${preset}${c && c.last4 ? "" : " bare"}${d.status !== "active" ? " frozen" : ""}" role="img" aria-label="${esc(`${d.name}, ${d.company}: ${c ? `card ending ${c.last4}` : "no card"}, ${STATUS[d.status] ?? d.status}`)}">`
    + cardSvg({ agent: d.agent, name: d.name, last4: c && c.last4 ? c.last4 : null, logo: design.logo, initials: design.initials }, esc) + `<span class="ac-shine"></span></div>`;
}

/** Under the card, in small muted words: its status and honesty label, then its month on a thin meter. */
export function cardMetaHtml(d: PhoneCardData): string {
  const c = d.card;
  const spent = c && c.per_month && c.spent_month !== null ? Number(c.spent_month) : null;
  const cap = c && c.per_month ? Number(c.per_month) : 0;
  const pct = spent !== null && cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const honest = c ? `<span class="hon">${d.demo ? "Simulated card · test money" : "Sandbox card · test money"}</span>` : "";
  const month = spent !== null && c ? `<p class="mt"><span><b>${money(c.currency, c.spent_month)}</b> of ${money(c.currency, c.per_month)} this month</span><span class="ac-bar${spent >= cap ? " full" : ""}"><span class="w${Math.round(pct)}"></span></span></p>` : "";
  return `<div class="meta"><p class="st"><i class="${esc(d.status.replace(/[^a-z]/g, ""))}"></i><span>${esc(STATUS[d.status] ?? d.status)}</span>${honest}</p>${month}</div>`;
}

/** The meter's width as a class: the page's style allows no inline style attribute. */
const WIDTHS = Array.from({ length: 101 }, (_, i) => `.ac-bar > span.w${i}{width:${i}%}`).join("");

export function phoneCardPage(nonce: string, d: PhoneCardData, design: CardDesign, o: { expires_at: string; wallet: string | null; walletConfigured: boolean }): string {
  const c = d.card;
  const brand = design.color ? `.acard{--brand:${design.color}}` : "";
  const row = (k: string, v: string) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
  const rows = [
    c ? row("Card", `•••• ${esc(c.last4)} · Visa · Airwallex`) : row("Card", "None: this agent pays nothing on a card"),
    c && c.per_purchase ? row("Per purchase", money(c.currency, c.per_purchase)) : "",
    c && c.per_month ? row(`Spent${c.month ? ` in ${esc(monthName(c.month))}` : ""}`, `${money(c.currency, c.spent_month)} of ${money(c.currency, c.per_month)}`) : "",
    row("Role", esc(d.role)),
    row("Model", d.model ? esc(modelShort(d.model)) : "Code only"),
    row("Status", esc(STATUS[d.status] ?? d.status)),
  ].join("");
  const wallet = o.wallet ? `<a class="wal" href="${esc(o.wallet)}">Add to Apple Wallet</a>` : `<p class="wal off" aria-disabled="true">Apple Wallet: ${o.walletConfigured ? "this agent has no card to carry" : "waiting for the pass certificate"}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0b1020"><title>${esc(d.name)} · ${esc(d.company)} · Purser</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0b1020;color:#e5e7eb;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;padding:max(16px,env(safe-area-inset-top)) 16px 28px}
main{max-width:440px;margin:0 auto;display:grid;gap:16px}.band{font-size:12px;font-weight:650;color:#fde68a;background:rgba(253,230,138,.1);border:1px solid rgba(253,230,138,.25);border-radius:10px;padding:7px 10px}
h1{font-size:13px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af;margin:0}.rows{display:grid;gap:0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:4px 14px}
.row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)}.row:last-child{border-bottom:0}.row span{color:#9ca3af}.row b{font-weight:600;text-align:right;overflow-wrap:anywhere}
.wal{display:block;text-align:center;padding:12px;border-radius:12px;background:#000;color:#fff;font-weight:650;text-decoration:none;border:1px solid #333;margin:0}.wal.off{background:transparent;color:#9ca3af;border-style:dashed;font-weight:550}
.fine{font-size:12.5px;color:#9ca3af;margin:0}.meta{display:grid;gap:6px;margin:-4px 2px 0;font-size:12.5px;color:#9ca3af}.meta p{margin:0}.st{display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px}.st i{width:6px;height:6px;border-radius:50%;background:#94a3b8}.st i.active{background:#4ade80}.st span:not(.hon){color:#e5e7eb;font-weight:550}.st .hon::before{content:"·";margin-right:8px}.mt{display:grid;gap:5px}.mt b{color:#e5e7eb;font-weight:600}.meta .ac-bar{display:block;height:2px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}.meta .ac-bar>span{display:block;height:100%;background:linear-gradient(90deg,#a97b25,#d9b768)}.meta .ac-bar.full>span{background:#fca5a5}a{color:#93c5fd}
${CARD_ART_CSS}${WIDTHS}${brand}
</style></head><body><main>
<p class="band">${d.demo ? "Demo company · made-up data · test money" : "Purser · test money · Airwallex sandbox"}</p>
<h1>${esc(d.company)}</h1>
${CARD_ART_DEFS}
${cardFaceHtml(d, design)}
${cardMetaHtml(d)}
<div class="rows">${rows}</div>
${wallet}
<p class="fine">Read only: this page cannot pay, freeze or change anything. The CFO acts in Purser Cloud, with Face ID. This link works until ${esc(o.expires_at.slice(0, 16).replace("T", " "))} UTC.</p>
<p class="fine"><a href="${esc(REPO_BLOB)}cloud/src/agentPhoneCard.ts" rel="noopener noreferrer">How this page is made</a></p>
</main></body></html>`;
}

export const phoneCardCsp = (n: string) => `default-src 'none'; style-src 'nonce-${n}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** GET /card/{link}: the view while the link is good; a plain 404 otherwise. */
export async function phoneCardResponse(url: URL, env: { sql: Sql; sessionSecret: string; origin: string; walletPass?: PassConfig }, now: Date): Promise<Response> {
  const notFound = () => new Response("This card link is not valid or has expired. Open the agent's card in Purser Cloud for a new one.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  const open = await phoneCardLinkOpen(env.sessionSecret, decodeURIComponent(url.pathname.slice("/card/".length)), now);
  if (!open) return notFound();
  const d = await phoneCardData(env.sql, open.tenantId, open.agent);
  if (!d) return notFound();
  const stored = isDemoTenant(open.tenantId) ? EMPTY_DESIGN : (await designOf(env.sql, open.tenantId)).design;
  const design = designFromQuery(url.searchParams, open.agent, stored);
  const wallet = env.walletPass && d.card ? (await walletPassLink(env.walletPass, env.sql, env.sessionSecret, open.tenantId, open.agent, env.origin, now))?.url ?? null : null;
  const b = crypto.getRandomValues(new Uint8Array(18));
  const n = btoa(String.fromCharCode(...b));
  return new Response(phoneCardPage(n, d, design, { expires_at: open.expires_at, wallet, walletConfigured: !!env.walletPass }), { status: 200, headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000; includeSubDomains", "content-security-policy": phoneCardCsp(n) } });
}

// ---- The Sourcing agent's negotiation, for the Agents page ----

/** The recorded negotiation (src/negotiate/negotiate.ts: written in advance, the rails computed now), turn by turn. */
export async function negotiationPreview(today: string): Promise<{ label: string; supplier: string; invoice_no: string; currency: string; amount: string; outcome: string; turns: { who: string; amount: string; discount_pct: string; ok: boolean; accept: boolean; refused: string | null }[] }> {
  const n = await recordedNegotiation(today, "shown on the Agents page");
  return {
    label: "Recorded negotiation: written in advance, not a live model call; the rails' answers are computed",
    supplier: `${n.scene.supplier.name} (simulated supplier)`, invoice_no: n.scene.invoice_no, currency: n.scene.currency, amount: (n.scene.amount_cents / 100).toFixed(2), outcome: n.outcome,
    turns: n.turns.map((t) => ({ who: t.who, amount: t.proposed.amount, discount_pct: t.proposed.discount_pct, ok: t.rails.ok, accept: t.accept, refused: t.rails.refusals[0]?.says ?? null })),
  };
}
