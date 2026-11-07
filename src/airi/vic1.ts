// vic-1: the Airi rail's run (docs/runs/vic-1-plan.md). A preflight, then three purchases by the Sourcing agent:
//   A  within the CFO's limit: runs alone (Max taps once, in Airi);
//   B  above the limit: the CFO's Face ID on the terms, then the runner executes it (Max taps in Airi again);
//   C  at a merchant the CFO does not allow: refused by Purser, Airi is not called.
// Then a record with safe references only. `--dry` runs the same code on the stand-ins, 0 network, and says so.
//
// The run log gets every line but the one-time Airi link: that goes to the console only (`tap`), as an "AIRI TAP A" or
// "AIRI TAP B" line (src/airi/deps.ts). The checkout is Airwallex's Hosted Payment Page by default (AIRI_CHECKOUT).

import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import type { AiriClient, AiriPaymentMethod } from "./client.js";
import { AIRI_CURRENCY, ALONE_KEY, MERCHANT_KEY_PREFIX, PER_DAY_KEY, airiPolicy, merchantById } from "./policy.js";
import { airiPurchases, requestAiriPurchase, type AiriDeps, type AiriOutcome, type AiriPurchaseRequest } from "./purchase.js";

export const RUN = "vic-1";
/** The one merchant the run buys from (src/airi/policy.ts) and the one it is refused at. */
export const MERCHANT = merchantById("northwind-sandbox")!;
export const NOT_ALLOWED_URL = "https://shop.example/checkout";
/** The run's initial policy for this rail: 20.00 alone, 3 a day, the test shop allowed. */
export const INITIAL_POLICY: Record<string, string> = { [ALONE_KEY]: "20.00", [PER_DAY_KEY]: "3", [`${MERCHANT_KEY_PREFIX}${MERCHANT.id}`]: "allowed" };
/** Minimum Airi session time left at the preflight. Every airi-cli command renews a session close to its end (README), so
 *  this only has to cover the gap to the next command; a lapsed one needs Max to log in again. */
export const SESSION_MARGIN_MS = 10 * 60_000;

export interface Vic1Deps {
  db: DB;
  mode: "dry" | "live";
  /** The conductor's own rail, for A and C (B runs in the runner live, in-process dry). */
  rail: AiriDeps;
  /** For the preflight. */
  airi: AiriClient & { version?: () => Promise<string> };
  log: (line: string) => void;
  /** Waits until proposal `id` is decided and executed (live: Max's Face ID, then the runner; dry: a stand-in approval). */
  awaitCfo: (id: string) => Promise<string>;
  now?: () => Date;
}

export interface Vic1Record {
  run: string;
  mode: "dry" | "live";
  label: string;
  started_at: string;
  ended_at: string;
  preflight: { cli: string; session_expires: string | null; payment_methods: { count: number; selected: string } };
  purchases: Record<"A" | "B" | "C", Json>;
  checks: Record<string, { ok: boolean; detail: string }>;
  rows: Json[];
  audit: Json[];
  airi_calls: { op: string; by: string }[];
}

export class Vic1Stop extends Error {}

/** Preflight: the CLI pinned, Max's Airi session alive for the run, an agent-enabled card. 2 Airi calls. */
export async function preflight(d: Vic1Deps): Promise<{ cli: string; sessionExpires: string | null; method: AiriPaymentMethod }> {
  const now = (d.now ?? (() => new Date()))();
  const cli = d.airi.version ? await d.airi.version() : d.airi.kind;
  const s = await d.airi.whoami();
  const left = s.sessionExpires ? Date.parse(s.sessionExpires) - now.getTime() : NaN;
  if (!s.authenticated || !Number.isFinite(left) || left < SESSION_MARGIN_MS) {
    throw new Vic1Stop(`Max must log in again: the Airi session ${!s.authenticated ? "is not signed in" : !Number.isFinite(left) ? "has no expiry" : left <= 0 ? "has lapsed" : `ends in ${Math.round(left / 60_000)} min, less than the run needs`} (airi-cli auth login, then auth poll)`);
  }
  const methods = await d.airi.listPaymentMethods();
  const cards = methods.filter((m) => m.type === "CARD");
  if (cards.length === 0) throw new Vic1Stop("no agent-enabled card in Airi: Max turns on agent use for the test card in app.airi.com");
  const chosen = process.env.AIRI_PAYMENT_METHOD_ID ? cards.find((m) => m.paymentMethodId === process.env.AIRI_PAYMENT_METHOD_ID) : cards[0];
  if (!chosen) throw new Vic1Stop("AIRI_PAYMENT_METHOD_ID names no agent-enabled card");
  d.log(`preflight  ${cli}; Airi session until ${s.sessionExpires}; ${cards.length} agent-enabled card(s), using ${chosen.display}`);
  return { cli, sessionExpires: s.sessionExpires, method: chosen };
}

/**
 * The rail's initial policy in a fresh vic-1 ledger: written once, before any Airi purchase, and audited. Refused in a
 * ledger that already has an Airi setting or purchase: from then on only the CFO changes it (policy_change, Face ID).
 */
export function seedPolicy(db: DB, now: Date): void {
  const set = db.prepare("SELECT key FROM settings WHERE key LIKE 'approval.airi_%' OR key LIKE 'airi.merchant.%'").all() as { key: string }[];
  const any = db.prepare("SELECT 1 FROM airi_purchases LIMIT 1").get();
  if (set.length || any) {
    const p = airiPolicy(db);
    if (p.aloneMaxCents !== 2000 || !p.merchants.includes(new URL(MERCHANT.url).origin)) throw new Vic1Stop("this ledger's Airi policy is not the run's (20.00 alone, the test shop allowed); use a fresh vic-1 ledger");
    return;
  }
  for (const [k, v] of Object.entries(INITIAL_POLICY)) db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(k, v, now.toISOString());
  audit(db, "system", "airi.policy_initial", RUN, { run: RUN, values: INITIAL_POLICY }, now);
}

const order = (paymentMethodId: string, p: { amount: string; item: string; url?: string; name?: string; description: string }): AiriPurchaseRequest => ({
  agent: "sourcing", paymentMethodId, merchantName: p.name ?? MERCHANT.name, merchantUrl: p.url ?? MERCHANT.url, merchantCountry: MERCHANT.country,
  amount: p.amount, currency: AIRI_CURRENCY, items: [{ name: p.item, unitPrice: p.amount, quantity: "1" }], description: p.description,
});

const brief = (o: AiriOutcome): Json => JSON.parse(JSON.stringify(o)) as Json;

/** Runs A, B and C. Stops at nothing but a Vic1Stop: every outcome, a decline included, is recorded as it came. */
export async function runVic1(d: Vic1Deps, calls: () => { op: string; by: string }[] = () => []): Promise<Vic1Record> {
  const clock = d.now ?? (() => new Date());
  const started = clock();
  const pf = await preflight(d);
  seedPolicy(d.db, started);
  const pm = pf.method.paymentMethodId;

  d.log("A          within the limit: 12.00 EUR, the agent alone (Max taps once in Airi)");
  const a = await requestAiriPurchase(d.db, d.rail, order(pm, { amount: "12.00", item: "Trail map pack", description: "vic-1 A: within the CFO's limit" }), clock());
  d.log(`A          ${a.status}${"code" in a && a.code ? ` (${a.code}${"by" in a ? `, by ${a.by}` : ""})` : ""}`);

  d.log("B          above the limit: 45.00 EUR, the CFO's Face ID first (then Max taps in Airi)");
  const b = await requestAiriPurchase(d.db, d.rail, order(pm, { amount: "45.00", item: "Field repair kit", description: "vic-1 B: above the CFO's limit" }), clock());
  let bEnd: string = b.status;
  if (b.status === "pending_approval") bEnd = await d.awaitCfo(b.proposalId);
  d.log(`B          ${b.status === "pending_approval" ? `${b.proposalId} ${bEnd}` : b.status}`);

  d.log("C          a merchant the CFO does not allow: refused by Purser, no Airi call");
  const before = calls().length;
  const c = await requestAiriPurchase(d.db, d.rail, order(pm, { amount: "5.00", item: "Sticker", url: NOT_ALLOWED_URL, name: "Example shop (not allowed)", description: "vic-1 C: a merchant the CFO does not allow" }), clock());
  const cCalls = calls().length - before;
  d.log(`C          ${c.status}${"code" in c ? ` (${c.code})` : ""}; Airi calls for C: ${cCalls}`);

  const rows = airiPurchases(d.db);
  const bRow = b.status === "pending_approval" ? (d.db.prepare("SELECT status, outcome, code, mandate_id, checkout_ref FROM airi_purchases WHERE proposal_id = ?").get(b.proposalId) as Json | undefined) ?? null : null;
  const auditRows = (d.db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'airi.%' OR event IN ('proposal.created', 'proposal.approved', 'proposal.rejected', 'proposal.executed', 'proposal.failed') ORDER BY seq").all() as { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }[])
    .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json }));
  const answered = (o: AiriOutcome) => o.status === "succeeded" || (o.status === "refused" && o.by === "checkout");
  const checks: Vic1Record["checks"] = {
    a_alone: { ok: a.status !== "pending_approval" && !(a.status === "refused" && a.by === "purser"), detail: `A ran without the CFO: ${a.status}` },
    a_answered: { ok: answered(a), detail: answered(a) ? `the checkout answered for A (${a.status === "succeeded" ? "accepted" : `declined, ${(a as { code: string }).code}`}), reported to Airi` : `A did not reach a checkout answer (${a.status})` },
    b_cfo_first: { ok: b.status === "pending_approval", detail: b.status === "pending_approval" ? `B waited for the CFO: ${b.proposalId}` : `B did not ask the CFO (${b.status})` },
    b_ran_after_face_id: { ok: bEnd === "EXECUTED" || (bEnd === "FAILED" && !!bRow && (bRow as { outcome?: string }).outcome === "DECLINED"), detail: `B after the CFO: ${bEnd}${bRow ? `, ${JSON.stringify(bRow)}` : ""}` },
    c_refused_by_purser: { ok: c.status === "refused" && c.by === "purser" && c.code === "PURSER_MERCHANT_NOT_ALLOWED" && cCalls === 0, detail: `C: ${c.status}${"code" in c ? ` ${c.code}` : ""}, ${cCalls} Airi call(s)` },
  };
  const record: Vic1Record = {
    run: RUN, mode: d.mode,
    label: d.mode === "dry" ? "DRY RUN on stand-ins: no Airi, no Airwallex, no card; not the run's evidence" : `live: airi-cli 0.1.0-beta.4 and the Airwallex sandbox (test money); checkout: ${d.rail.checkout.label}`,
    started_at: started.toISOString(), ended_at: clock().toISOString(),
    preflight: { cli: pf.cli, session_expires: pf.sessionExpires, payment_methods: { count: 1, selected: pf.method.display } },
    purchases: { A: brief(a), B: { ...(brief(b) as Record<string, Json>), end: bEnd, row: bRow }, C: { ...(brief(c) as Record<string, Json>), airi_calls: cCalls } },
    checks, rows, audit: auditRows, airi_calls: calls(),
  };
  assertNoSecrets(JSON.stringify(record));
  return record;
}

/** A record or a log must hold no link and no card-like number: refused outright otherwise. */
export function assertNoSecrets(text: string): void {
  if (/https?:\/\/[^\s"]*airi\.com/i.test(text)) throw new Error("refused: an Airi link would be written");
  if (/\b\d{13,19}\b/.test(text)) throw new Error("refused: a card-like number would be written");
}

/** Wraps a client so every call is counted by name (never its arguments), and refused past the budget. */
export function counted<T extends object>(target: T, by: string, sink: { op: string; by: string }[], budget = Infinity): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv) as unknown;
      if (typeof v !== "function" || ["constructor"].includes(String(prop))) return v;
      return (...args: unknown[]) => {
        if (sink.length >= budget) throw new Vic1Stop(`the approved call budget of ${budget} is spent; ${by}.${String(prop)} was not called`);
        sink.push({ op: String(prop), by });
        return (v as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
}
