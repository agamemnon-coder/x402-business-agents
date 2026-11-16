// /try/negotiate's one route (15 Nov), behind the visitor's session like the demo's other engine routes, added to the
// route table by one line in cloud/src/app.ts and listed in ./gate.ts's TRY_ROUTES:
//   POST /v1/try/negotiate   Purser's Sourcing agent and a simulated supplier's agent (both Claude) negotiate an
//       early-payment discount on Bergtex's test invoice, 2 to 4 turns, every turn through the rails
//       (src/negotiate/rails.ts). Answers the turns, the agreement, its canonical JSON and SHA-256, and the invoice the
//       engine files for the agreed terms (POST /v1/engine/compose), which the visitor then signs as on /try.
// /try's caps hold: the company was started under the per-address start limits; Claude runs only under the switch
// `claude` (the kill switch) and one reservation against the caps (cloud/src/engine/spend.ts), which every turn's worst
// case must fit; at most MAX_TURNS turns of TURN_MAX_TOKENS each; NEGOTIATIONS_PER_COMPANY a company. Claude off,
// capped or failing: the recorded negotiation, labelled as such, never a fake live one.
import { bump } from "../auth.js";
import type { CappedReason, Reservation } from "../../../src/engine/budget.js";
import { actionBudget, claudeSpeak, type Budget } from "../../../src/negotiate/claude.js";
import { d1Spend } from "../engine/spend.js";
import type { Sql } from "../store.js";
import { readSwitches } from "./switches.js";
import { z } from "zod";
import { negotiate, recordedNegotiation, sceneFromInvoice, sceneOf, type BestOffer, type Negotiation, type Speak, type Turn } from "../../../src/negotiate/negotiate.js";
import type { Scene } from "../../../src/negotiate/rails.js";
import { agreedInvoiceNo, boundsOf, cents, money, normIban } from "../../../src/negotiate/rails.js";
import { supplierKey } from "../../../src/config/trySample.js";
import type { EngineKit, EngineRoute } from "../engine/routes.js";
import type { TryEngineCtx } from "./engineRoutes.js";
import { isTryTenant, tryScopes, TryRefused } from "./start.js";

/** Per test company, over its whole life. */
export const NEGOTIATIONS_PER_COMPANY = 3;

/** Claude for one company's negotiation: a reservation under /try's caps, and the turns spending from its budget. */
export interface NegotiateClaude {
  reserve(): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: CappedReason }>;
  speak(budget: Budget): Speak;
}

/**
 * The Worker's Claude for negotiations (cloud/src/worker.ts): only with ENGINE_CLAUDE "on" and the demo's capped key,
 * the same two the engine's Claude needs (cloud/src/engine/tryClaude.ts). The caps and the kill switch are /try's own:
 * the switch `claude`, cap_action_micros and the company's, address's, pool's and all-time caps (./switches.ts). A
 * switch table that cannot be read keeps Claude off (fail closed), as a missing row does.
 */
export function negotiateClaudeOf(sql: Sql, engineClaude: string | undefined, key: string | undefined, fetcher?: typeof fetch): ((tenantId: string) => NegotiateClaude | undefined) | undefined {
  if (engineClaude !== "on" || !key) return undefined;
  return (tenantId) => ({
    reserve: async () => {
      const switches = await readSwitches(sql).catch(() => ({}));
      const scope = await tryScopes(sql, tenantId).catch(() => null);
      return d1Spend(sql, switches, { tenantId, pool: scope?.pool ?? "smoke", address: scope?.addr ?? null }).reserve();
    },
    speak: (budget) => claudeSpeak(key, budget, fetcher),
  });
}

/** What the route needs of the request's context: /try's engine context, and Claude for the company when it is set up. */
export interface NegotiateCtx extends TryEngineCtx { env: TryEngineCtx["env"] & { negotiateClaude?: (tenantId: string) => NegotiateClaude | undefined; waitUntil?: (p: Promise<unknown>) => void } }

/** Why the recorded negotiation is shown, in words a visitor reads. */
export function reasonWords(reason: CappedReason | "not_set_up" | "failed", detail?: string): string {
  switch (reason) {
    case "switch_off": return "Claude is switched off on the demo right now.";
    case "no_key": case "not_set_up": return "Claude is not set up on this deployment.";
    case "busy": return "Claude is busy with other visitors right now.";
    case "failed": return `Claude stopped answering mid-negotiation (${detail ?? "no answer"}).`;
    default: return "The demo's Claude spending cap is reached for now.";
  }
}

export const NEGOTIATE_ROUTE = "POST /v1/try/negotiate";
const Body = z.object({ invoice_id: z.string().min(1).max(80).optional() }).strict();
const Agreed = z.object({
  invoice_id: z.string().min(1).max(80).optional(),
  turns: z.number().int().min(1).max(4),
  agreement_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  compose: z.object({ supplier_key: z.string().max(40), invoice_no: z.string().max(64), amount: z.string().max(32), issue_date: z.string().max(32), due_date: z.string().max(32), iban: z.string().max(64) }).strict(),
}).strict();

/** Why the public recording is shown (GET /v1/try/negotiate/recorded?why=): the page's own words, never the caller's. */
export const RECORDED_WHY = {
  limit: "Today's live limit is reached, so the recorded negotiation is shown.",
  paused: "The live demo is paused right now, so the recorded negotiation is shown.",
  start: "A test company could not be started right now, so the recorded negotiation is shown.",
} as const;

/**
 * What /v1/try/negotiate agreed, kept so /agreed files only that (security review, 16 Nov: the hash, the turns and the
 * amount came from the client, so a negotiation that never took place could be filed as agreed). A row in rate_hits
 * under the company's start time, kept as long as the company's other lifetime counters: 1 while it may be filed, 0
 * once it was. The key holds everything the invoice is filed with, so another amount or date is another key.
 */
const agreedKey = (tenant: string, invoiceId: string | null, sha256: string, turns: number, x: { invoice_no: string; amount: string; due_date: string; iban: string }) =>
  `agreed:${tenant}:${invoiceId ?? ""}:${sha256}:${turns}:${x.invoice_no}:${x.amount}:${x.due_date}:${normIban(x.iban)}`;
const bornOf = async (sql: Sql, tenant: string, now: Date) => {
  const row = await sql.first<{ created_at: string }>("SELECT created_at FROM try_companies WHERE tenant_id = ?", [tenant]);
  return Math.floor(Date.parse(row?.created_at ?? now.toISOString()) / 1000);
};

export function tryNegotiateRoutes<C extends NegotiateCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  return [
    { method: "POST", path: "/v1/try/negotiate", summary: "Agents negotiate (the hands-on demo, a test company only): Purser's Sourcing agent and a simulated supplier's agent, both Claude, negotiate an early-payment discount on a test invoice of Bergtex Textil GmbH (EUR 1,850.00, net 30), at most 4 turns, each through the CFO's rails in code (the most it may pay, the latest pay-by date, nothing beyond the invoice, the payee's bank details unchanged). Answers { mode (live or recorded), label, reason, scene, bounds, rules, turns, outcome, agreement, canonical, sha256, compose, micros }; compose is the invoice POST /v1/engine/compose files for the agreed terms. Claude off, capped or failing: the recorded negotiation, labelled. 3 a company.", need: "admin", run: async (c) => {
      const tenant = c.caller!.tenantId;
      if (!isTryTenant(tenant)) return err(403, "only a test company of the hands-on demo negotiates here");
      const born = await bornOf(c.env.sql, tenant, c.now);
      if ((await bump(c.env.sql, `negotiate:${tenant}`, born, 1)) > NEGOTIATIONS_PER_COMPANY)
        throw new TryRefused(429, "limit", `This test company has negotiated ${NEGOTIATIONS_PER_COMPANY} times, its limit. Start a new one to watch again.`);
      const today = c.now.toISOString().slice(0, 10);
      // { invoice_id } (15 Nov, the negotiation inside /try's flow): the visitor's own invoice, if it can be negotiated.
      let scene: Scene = sceneOf(today);
      let invoiceId: string | null = null;
      if ((c.req.headers.get("content-type") ?? "").includes("json")) {
        const b = await kit.body(c, Body, 1_000);
        if (b.invoice_id) {
          invoiceId = b.invoice_id;
          const inv = await c.env.engine?.(tenant)?.invoice(b.invoice_id);
          if (!inv) return err(404, "no invoice");
          const sc = sceneFromInvoice(inv, today);
          if ("refused" in sc) throw new TryRefused(409, "not_negotiable", sc.refused);
          scene = sc;
        }
      }
      const claude = c.env.negotiateClaude?.(tenant);
      // The whole negotiation; onTurn hears each live turn as Claude answers it, and reset that the live turns are dropped.
      const run = async (onTurn?: (t: Turn, best: BestOffer | null) => void, reset?: (reason: string) => void, onLive?: () => void): Promise<Negotiation> => {
        if (!claude) return recordedNegotiation(today, reasonWords("not_set_up"), scene);
        const got = await claude.reserve();
        if (!got.ok) return recordedNegotiation(today, reasonWords(got.reason), scene);
        const budget = actionBudget(got.reservation.micros);
        onLive?.();
        try {
          const n = await negotiate({ today, scene, speak: claude.speak(budget), mode: "live", ...(onTurn ? { onTurn } : {}) });
          await got.reservation.settle(n.micros);
          return n;
        } catch (x) {
          // What the turns may have cost: every sent turn's worst case, as the budget counted it.
          await got.reservation.settle(got.reservation.micros - Math.max(0, budget.left()));
          const reason = reasonWords("failed", x instanceof Error ? x.message.slice(0, 120) : undefined);
          reset?.(reason);
          return recordedNegotiation(today, reason, scene);
        }
      };
      // An agreement is kept for /agreed, live or recorded alike (both are the terms the rails let stand).
      const kept = async (n: Negotiation): Promise<Negotiation> => {
        if (n.outcome === "agreed") await c.env.sql.run("INSERT INTO rate_hits (bucket, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket, window_start) DO NOTHING", [agreedKey(tenant, invoiceId, n.sha256, n.turns.length, n.compose), born]);
        return n;
      };
      if (c.url.searchParams.get("stream") !== "1") return json(200, await kept(await run()));
      // ?stream=1 (15 Nov, the page's chat): one JSON object a line, as it happens. {type: "start", live: true, bounds} once live Claude is reserved, then {type: "turn", turn, best} for each
      // live turn the moment Claude has answered it and the rails have checked it; {type: "reset", reason} when Claude
      // failed mid-way and the live turns are dropped; then {type: "done", negotiation}, the same object as without it.
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const w = writable.getWriter();
      const enc = new TextEncoder();
      const line = (o: unknown) => { void w.write(enc.encode(`${JSON.stringify(o)}\n`)).catch(() => undefined); };
      const done = run((turn, best) => line({ type: "turn", turn, best }), (reason) => line({ type: "reset", reason }), () => line({ type: "start", live: true, bounds: boundsOf(scene, today) }))
        .then(kept)
        .then((negotiation) => line({ type: "done", negotiation }), () => line({ type: "error", message: "The negotiation could not finish. Nothing was paid." }))
        .finally(() => { void w.close().catch(() => undefined); });
      c.env.waitUntil?.(done);
      return new Response(readable, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    } },
    // 15 Nov (jury run): the agreed terms filed. On the visitor's own invoice the agreed invoice REPLACES it (one payable,
    // one expense); on the page's seeded scene it is filed as the agreed one. Either way what was negotiated is recorded
    // with it, and the proof file carries it beside the signed terms.
    { method: "POST", path: "/v1/try/negotiate/agreed", summary: "File a negotiation's agreed terms (a test company only): { agreement_sha256, compose, turns, invoice_id? } with compose as the negotiation answered it. The agreed invoice is filed (as POST /v1/engine/compose) and what was negotiated is recorded with it (the original and agreed amounts, the discount, the agreement's SHA-256, the turns), carried by the proof file beside the signed terms. With invoice_id (the visitor's own invoice) it replaces the original: the original's unsigned payment is superseded and it leaves the books with that reason, its accrual reversed. Only terms that fit the invoice negotiated: the same supplier and account on file, numbered as it plus the agreement's reference, for less, paid no later than it is due. Answers { invoice (the agreed one, ready to sign), superseded (the original, or null) }.", need: "admin", run: async (c) => {
      const tenant = c.caller!.tenantId;
      if (!isTryTenant(tenant)) return err(403, "only a test company of the hands-on demo negotiates here");
      const e = c.env.engine?.(tenant);
      if (!e) return err(503, "the demo's engine is not set up");
      const b = await kit.body(c, Agreed, 2_000);
      const today = c.now.toISOString().slice(0, 10);
      let sc: Scene = sceneOf(today);
      if (b.invoice_id) {
        const inv = await e.invoice(b.invoice_id);
        if (!inv) return err(404, "no invoice");
        const s2 = sceneFromInvoice(inv, today);
        if ("refused" in s2) throw new TryRefused(409, "not_negotiable", s2.refused);
        sc = s2;
      }
      const x = b.compose, amt = cents(x.amount);
      const fits = x.supplier_key === supplierKey(sc.supplier.name) && normIban(x.iban) === normIban(sc.supplier.iban) && x.invoice_no === agreedInvoiceNo(sc, b.agreement_sha256)
        && Number.isFinite(amt) && amt > 0 && amt < sc.amount_cents && /^\d{4}-\d{2}-\d{2}$/.test(x.due_date) && x.due_date >= today && x.due_date <= sc.due_date;
      if (!fits) throw new TryRefused(409, "not_the_agreement", "These terms are not an agreement on this invoice: the same supplier and account, the agreement's reference, less than the invoice, paid by its due date.");
      // The agreement /v1/try/negotiate answered for this company and invoice, not filed yet: taken in one write, so two
      // filings at once cannot both have it. Given back when the filing below does not go through.
      const key = agreedKey(tenant, b.invoice_id ?? null, b.agreement_sha256, b.turns, x);
      const born = await bornOf(c.env.sql, tenant, c.now);
      const taken = await c.env.sql.first<{ count: number }>("UPDATE rate_hits SET count = 0 WHERE bucket = ? AND window_start = ? AND count = 1 RETURNING count", [key, born]);
      if (!taken) throw new TryRefused(409, "not_the_agreement", "These terms are not an agreement this company negotiated, or they were filed already.");
      const giveBack = () => c.env.sql.run("UPDATE rate_hits SET count = 1 WHERE bucket = ? AND window_start = ?", [key, born]);
      const out = await e.compose(x);
      if ("refused" in out) { await giveBack(); return json(400, { error: out.refused.message, code: `invalid_${out.refused.field}`, message: out.refused.message, field: out.refused.field }); }
      const agreed = out.invoice;
      if (!agreed || agreed.status !== "ready") { await giveBack(); return json(409, { error: "the agreed invoice was not filed as ready to pay", code: "not_ready", message: "The agreed invoice could not be filed as ready to pay; the original stands. Pay the invoice as issued instead.", ...(agreed ? { invoice: agreed } : {}) }); }
      const done = await e.negotiated(agreed.id, { original_id: b.invoice_id ?? null, original_invoice_no: sc.invoice_no, original_amount: money(sc.amount_cents), agreement_sha256: b.agreement_sha256, turns: b.turns });
      if (!done.ok) return json(409, { error: done.reason, code: "not_recorded", message: `The agreed invoice could not replace the original: ${done.reason}.` });
      return json(200, { invoice: done.invoice, superseded: done.superseded });
    } },
  ];
}

/**
 * GET /v1/try/negotiate/recorded (public, the hands-on deployment's /v1/try block): the recorded negotiation on the
 * seeded scene, labelled, for a visitor the live path turned away (a start limit, a pause): no company, no Claude, no
 * cost, nothing signable. ?why= picks one of RECORDED_WHY's sentences.
 */
export function tryNegotiatePublicRoutes<C extends { now: Date; url?: URL; req: Request }>(kit: { json(status: number, body: unknown): Response }, live: (run: (c: C) => Promise<Response>) => (c: C) => Promise<Response>): { method: "GET"; path: string; summary: string; need: "public"; run: (c: C) => Promise<Response> }[] {
  return [
    { method: "GET", path: "/v1/try/negotiate/recorded", summary: "The recorded negotiation (public): the seeded scene's four turns, written in advance and labelled as such, checked by the rails live. For a visitor the live path turned away; nothing to sign. ?why=limit|paused|start says why in the page's own words.", need: "public", run: live(async (c) => {
      const why = new URL(c.req.url).searchParams.get("why");
      const reason = why && why in RECORDED_WHY ? RECORDED_WHY[why as keyof typeof RECORDED_WHY] : RECORDED_WHY.start;
      const today = c.now.toISOString().slice(0, 10);
      const r = kit.json(200, { ...(await recordedNegotiation(today, reason)), signable: false });
      r.headers.set("cache-control", "no-store");
      return r;
    }) },
  ];
}
