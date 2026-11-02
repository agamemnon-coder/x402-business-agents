// D25, the live TAP run (Max, 2 November), in a fresh test world: never live-1, the reserve worktree or the hosted relay.
//   1. The Sourcing agent (Claude) wakes to Packwise's notice that its Starter plan is due, picks the rail itself (code
//      refuses a rail Packwise does not take) and buys on its card. With KIT11_TAP_RAIL on, its checkout is signed with
//      TAP (signature 1) and our body signature (signature 2), POSTed to /product/checkout through Visa's reference
//      proxy (cloned at 16d59bd outside the repo, unchanged), checked by our merchant layer, and only then the agent's
//      own Airwallex sandbox card is charged, inside its limit.
//   2. Code makes one attempt over the card's per-purchase limit (Packwise Pro) on the same rail: TAP passes, and
//      Airwallex itself declines it.
// Every step's evidence comes from the ledger (the tap.* and card.* audit rows and their D24 origins), and each Airwallex
// transaction and the card are read back with read-only GETs; the card brand is recorded as Airwallex returns it, never
// assumed. No approval is asked for or given in this run. The TAP key is a test key made for this run, kept in memory.

import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import { publish } from "../autonomy/bus.js";
import { wake } from "../autonomy/runtime.js";
import { sourcingProfile, type SoftwarePlan, type SourcingWorld } from "../autonomy/sourcingProfile.js";
import { INITIAL_MANDATES, PLANS, SELL_PRICE_CENTS } from "../config/policy.js";
import { SUPPLIERS } from "../config/suppliers.js";
import type { DB } from "../db/open.js";
import { cardOf, cardRows, setupCards } from "../policy/cards.js";
import { withOrigin, type Origin } from "../provenance/origin.js";
import { registerAgent } from "./tap.js";
import { buySoftwareOnCard, proxyTransport, type TapSigner, type TapTransport } from "./tapRail.js";
import { startTapMerchant } from "./tapServer.js";
import { ed25519FromSeed } from "./tapSig.js";

export const LIVE_LABELS = [
  "Packwise is a merchant we run (simulated); its checkout is served by our code behind Visa's reference proxy.",
  "Signature 1 follows Visa's Trusted Agent Protocol as Visa's reference proxy (github.com/visa/trusted-agent-protocol, commit 16d59bd, unmodified) reads it; signature 2 (body integrity over Content-Digest), the tag, window and payment checks are our own layer.",
  "The agent registry is Visa's reference registry, self-hosted on localhost, with a test key made for this run: not Visa's directory, not a Visa-approved agent.",
  "Card payments are Airwallex sandbox simulated authorisations.",
  "No approval was asked for or given in this run.",
];

/** Null when this ledger is a fresh test world's; otherwise why the run must not use it. */
export function freshWorldProblem(dbPath: string | undefined, exists: boolean): string | null {
  if (!dbPath) return "name the fresh test world's ledger with KIT11_DB (for example data/visa-tap-live-2026-11-02.sqlite)";
  if (/live-1/i.test(dbPath)) return "never live-1: use a fresh test world";
  if (/reserve/i.test(dbPath)) return "never the reserve: use a fresh test world";
  if (exists) return `${dbPath} exists already: the live TAP run starts a fresh test world`;
  return null;
}

export const REF_COMMIT = "16d59bdf3f8a542bc538d0962edbb80ea30a02af";

export interface PreflightIo {
  exists(path: string): boolean;
  /** git with an argument array (no shell), in the given directory. */
  git(dir: string, args: string[]): { status: number | null; stdout: string };
  today(): string;
}

/**
 * Everything npm run visa:tap-live checks before it touches anything: a fresh test world; the Airwallex sandbox keys
 * and the Anthropic key present (the agent picks the rail with Claude); the reference clone at 16d59bd with its tracked
 * files unchanged (untracked files are allowed: the proxy's node_modules); a run record that does not exist yet.
 */
export function liveRunPreflight(env: Record<string, string | undefined>, io: PreflightIo): { problem: string } | { dbPath: string; refDir: string; refCommit: string; out: string } {
  const dbPath = env.KIT11_DB;
  const fresh = freshWorldProblem(dbPath, !!dbPath && io.exists(dbPath));
  if (fresh) return { problem: fresh };
  if (!env.AIRWALLEX_CLIENT_ID || !env.AIRWALLEX_API_KEY) return { problem: "the Airwallex sandbox keys are not set" };
  if (!env.KIT11_ANTHROPIC_API_KEY) return { problem: "the Anthropic key is not set: the Sourcing agent picks the rail itself, with Claude" };
  const refDir = env.TAP_REF_DIR;
  if (!refDir) return { problem: "TAP_REF_DIR must name the clone of github.com/visa/trusted-agent-protocol the proxy and registry run from" };
  const head = io.git(refDir, ["rev-parse", "HEAD"]);
  const commit = head.status === 0 ? head.stdout.trim() : null;
  if (commit !== REF_COMMIT) return { problem: `the reference in TAP_REF_DIR must be a clone at 16d59bd, tracked files unchanged: it is at ${commit ?? "no commit (not a git clone?)"}` };
  const status = io.git(refDir, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.status !== 0 || status.stdout.trim() !== "") return { problem: "the reference in TAP_REF_DIR must be a clone at 16d59bd, tracked files unchanged: git status shows changes" };
  const out = env.RUN_OUT ?? `docs/runs/visa-tap-live-${io.today()}.json`;
  if (io.exists(out)) return { problem: `${out} exists already: a run record is never overwritten (set RUN_OUT to a new path)` };
  return { dbPath: dbPath!, refDir, refCommit: commit, out };
}

/** Read-only GETs at Airwallex, to confirm what the ledger says. */
export interface ReadBack {
  /** GET /issuing/cards/{id}, as returned. */
  card(cardId: string): Promise<Record<string, unknown>>;
  /** GET /issuing/transactions?card_id=… */
  transactions(cardId: string): Promise<CardTransaction[]>;
}

export interface LiveRunDeps {
  db: DB;
  issuing: { rail: IssuingRail; sim: IssuingSim };
  readBack: ReadBack;
  /** The reference proxy, e.g. http://localhost:3001 (loopback only). */
  proxyUrl: string;
  /** The reference registry, e.g. http://127.0.0.1:9002. */
  registryUrl: string;
  /** Where the proxy forwards /product/*: our merchant listens here (3000 for the reference proxy). */
  merchantPort: number;
  /** Claude for the Sourcing agent (null: the agent cannot run, and the run says so). */
  client: Anthropic | null;
  /** The reference clone's commit, when known. */
  refCommit: string | null;
  fetchImpl?: typeof fetch;
  /** Waits between read-back tries (Airwallex's list can lag a fresh authorisation). */
  sleep?: (ms: number) => Promise<void>;
  readBackTries?: number;
  /** The card nickname's suffix for this run (default tap-<MMDD>-<4 hex>); tests fix it. */
  cardSuffix?: string;
}

type Row = { seq: number; event: string; subject: string; payload_json: string };
const rowsAfter = (db: DB, seq: number, events: string[]) =>
  (db.prepare(`SELECT seq, event, subject, payload_json FROM audit_log WHERE seq > ? AND event IN (${events.map(() => "?").join(",")}) ORDER BY seq`).all(seq, ...events) as Row[])
    .map((r) => ({ ...r, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
const lastSeq = (db: DB) => (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;

export interface LiveStep {
  step: string;
  by: string;
  plan: string | null;
  rail: string | null;
  tap: { key_id: string | null; nonce: string | null; proxy_status: number | null; sig1: string | null; sig2: string | null; merchant: string } | null;
  airwallex: { transaction_id: string; approved: boolean; status: string; failure_reason: string | null; confirmed_by_get: { status: string; approved: boolean; failure_reason: string | null; amount: string; currency: string } | null } | null;
  origin: Origin | null;
  ok: boolean;
  note: string;
}

export interface LiveRecord {
  ran_at: string;
  kind: "visa-tap-live";
  reference: { repo: string; commit: string | null; proxy: string; registry: string };
  merchant: { name: string; checkout: string };
  key_id: string;
  card: { agent: string; last4: string; nickname: string; brand_as_returned: Record<string, unknown> | string; other_fields_as_returned: Record<string, unknown>; per_purchase_limit: string | null } | null;
  steps: LiveStep[];
  labels: string[];
  ok: boolean;
}

/** Fields that name the card's network, recorded exactly as Airwallex returns them (never assumed). */
const BRAND_FIELDS = ["brand", "card_brand", "network", "card_network", "scheme", "card_scheme"];
/** Recorded apart, not as the brand. */
const OTHER_CARD_FIELDS = ["form_factor", "type", "card_type"];
/** Airwallex's reason for a charge over a card's limit, as live Airwallex returned it (docs/runs/2026-10-30-friday-1.md). */
export const PER_TX_LIMIT_REASON = "LIMIT_EXCEEDED";

/** Steps 1 and 2, then the read-backs; never throws for a refused or declined step (the record says what happened). */
export async function runTapLive(d: LiveRunDeps): Promise<LiveRecord> {
  const f = d.fetchImpl ?? fetch;
  const sleep = d.sleep ?? ((ms: number) => new Promise((ok) => setTimeout(ok, ms)));
  const db = d.db;
  const transport: TapTransport = proxyTransport(d.proxyUrl);
  const authority = transport.config.authority;
  const reg0 = new URL(d.registryUrl);
  if (reg0.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(reg0.hostname)) throw new Error("the reference registry must be on this machine (loopback), e.g. http://127.0.0.1:9002");

  // 0. The reference must be up: the proxy and the registry, both on this machine.
  for (const [what, url] of [["the reference proxy", `${d.proxyUrl.replace(/\/$/, "")}/test-proxy`], ["the reference registry", `${d.registryUrl.replace(/\/$/, "")}/`]] as const) {
    const ok = await f(url).then((r) => r.ok, () => false);
    if (!ok) throw new Error(`${what} is not running at ${url}; start Visa's reference (unchanged, at 16d59bd) first`);
  }

  // The Sourcing agent's card only, issued fresh for this run under its own nickname (review B1: a fresh ledger has no
  // business account, so the plain nickname would adopt, and change, another world's card). Any adoption stops the run
  // before anything is charged.
  const suffix = d.cardSuffix ?? `tap-${new Date().toISOString().slice(5, 10).replace("-", "")}-${randomBytes(2).toString("hex")}`;
  const before0 = lastSeq(db);
  await setupCards(db, d.issuing.rail, new Date(), { agents: ["sourcing"], nicknameSuffix: suffix });
  const card = cardOf(db, "sourcing");
  if (!card) throw new Error("the Sourcing agent has no card after setup");
  const issued = rowsAfter(db, before0, ["card.issued", "card.adopted"]);
  if (issued.some((r) => r.event === "card.adopted") || !issued.some((r) => r.event === "card.issued" && r.subject === "sourcing") || cardRows(db).length !== 1) {
    throw new Error(`the Sourcing agent's card was not issued fresh for this run (${issued.map((r) => r.event).join(", ") || "no card event"}); nothing was charged`);
  }
  const seed = randomBytes(32);
  const k = ed25519FromSeed(seed);
  const signer: TapSigner = { agent: "sourcing", keyId: `purser-sourcing-live-${randomBytes(6).toString("hex")}`, privateKey: k.privateKey };
  // Our pinned list (what our merchant trusts), and Visa's reference registry (what the proxy reads), via its API.
  registerAgent(db, { agent: "sourcing", keyid: signer.keyId, publicJwk: k.publicKey.export({ format: "jwk" }), domains: [authority], notAfter: Math.floor(Date.now() / 1000) + 6 * 3600 });
  const reg = await f(`${d.registryUrl.replace(/\/$/, "")}/agents/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Purser Sourcing agent (live TAP run, test key)", domain: "https://purser-live.example", description: "D25 live run, a fresh test key", keys: [{ key_id: signer.keyId, public_key: k.publicRaw.toString("base64"), algorithm: "ed25519", description: "test key", is_active: "true" }] }),
  });
  if (!reg.ok) throw new Error(`the reference registry refused the test key: ${reg.status}`);

  const merchant = await startTapMerchant(db, transport.config, { port: d.merchantPort });
  const env = { KIT11_TAP_RAIL: "on" };
  const buy = (plan: string) => buySoftwareOnCard(db, d.issuing.sim, plan, { env, signer: () => signer, transport });
  const steps: LiveStep[] = [];
  try {
    // 1. The Sourcing agent, woken by Packwise's notice, picks the rail and buys.
    const world: SourcingWorld = {
      // The stock-check market is not part of this run: its suppliers are not running, and the agent is told so.
      suppliers: async () => Object.values(SUPPLIERS).map((s) => ({ id: s.id, name: s.name, price_cents: s.defaultPriceCents, data_age_seconds: s.dataAgeSeconds, available: false, last20: { paid: 0, refused: 0, unavailable: 0 } })),
      mandate: async () => ({ capCents: INITIAL_MANDATES.sourcing.capCents, budgetLeftCents: INITIAL_MANDATES.sourcing.budgetCents }),
      sellCents: () => SELL_PRICE_CENTS,
      card: async () => { const c = cardRows(db).find((x) => x.agent === "sourcing"); return c ? { perTxCents: c.per_tx_cents, monthlyCents: c.monthly_cents } : null; },
      buyPlan: async (plan: SoftwarePlan) => {
        const t = await buy(plan);
        return t.approved ? { approved: true, text: "approved by Airwallex", ref: t.transactionId } : { approved: false, text: `declined by Airwallex (${t.failureReason ?? t.status})`, ref: t.transactionId };
      },
    };
    const starter = PLANS["packwise-starter"]!;
    publish(db, "supplier.notice", { supplier: "Packwise", text: `Your Packwise Starter plan (${(starter.amountCents / 100).toFixed(2)} EUR a month) is due today. Packwise takes a card checkout only.` }, "sourcing", "system");
    const before1 = lastSeq(db);
    const w = await wake(db, sourcingProfile(world), { client: d.client, force: true });
    const buys = (w?.run?.calls ?? []).filter((c) => c.tool === "buy_software");
    const picked = buys.map((c) => `${(c.input as { plan?: string }).plan} on ${(c.input as { rail?: string }).rail}${c.blocked ? ` (refused by code: ${c.blocked})` : ""}`);
    steps.push(await describeStep(db, d, before1, {
      step: "the Sourcing agent buys Packwise's plan on the rail it picks",
      by: w?.run?.model ? `the Sourcing agent (${w.run.model})` : "the Sourcing agent (Claude did not run)",
      rail: buys.find((c) => !c.blocked) ? String((buys.find((c) => !c.blocked)!.input as { rail?: string }).rail) : null,
      note: picked.length ? `its buy_software calls: ${picked.join("; ")}` : `it made no purchase (${w?.run?.status ?? "no wake"}${w?.run?.note ? `: ${w.run.note}` : ""})`,
      expect: { approved: true },
    }, sleep));

    // 2. Over the card's per-purchase limit, by code, on the same rail: Airwallex declines it itself.
    const before2 = lastSeq(db);
    const over: Origin = { actor: "code", rule: "live TAP run: one attempt over the card's per-purchase limit, to show Airwallex's own decline", agent: "sourcing" };
    let err: string | null = null;
    await withOrigin(over, () => buy("packwise-pro")).catch((e: Error) => { err = e.message; });
    steps.push(await describeStep(db, d, before2, { step: "code tries Packwise Pro, over the card's per-purchase limit", by: "code", rail: "airwallex_card", note: err ?? "", expect: { approved: false, reason: PER_TX_LIMIT_REASON } }, sleep));
  } finally {
    await merchant.close();
  }

  // The card, as Airwallex's GET returns it: the brand fields verbatim (not assumed), last 4 digits only.
  let brand: Record<string, unknown> | string;
  let other: Record<string, unknown> = {};
  try {
    const raw = await d.readBack.card(card.card_id);
    const found = Object.fromEntries(BRAND_FIELDS.filter((x) => x in raw).map((x) => [x, raw[x]]));
    brand = Object.keys(found).length ? found : `no brand field in Airwallex's card GET (fields: ${Object.keys(raw).sort().join(", ")})`;
    other = Object.fromEntries(OTHER_CARD_FIELDS.filter((x) => x in raw).map((x) => [x, raw[x]]));
  } catch (e) {
    brand = `the card GET failed: ${(e as Error).message.slice(0, 120)}`;
  }
  const row = cardRows(db).find((x) => x.agent === "sourcing");
  return {
    ran_at: new Date().toISOString(),
    kind: "visa-tap-live",
    reference: { repo: "github.com/visa/trusted-agent-protocol", commit: d.refCommit, proxy: d.proxyUrl, registry: d.registryUrl },
    merchant: { name: "Packwise (a merchant we run, simulated)", checkout: `${authority}${transport.config.checkoutPath}` },
    key_id: signer.keyId,
    card: { agent: "sourcing", last4: card.last4, nickname: card.nickname, brand_as_returned: brand, other_fields_as_returned: other, per_purchase_limit: row ? (row.per_tx_cents / 100).toFixed(2) : null },
    steps,
    labels: LIVE_LABELS,
    ok: steps.length === 2 && steps.every((s) => s.ok),
  };
}

/** One step's record from the ledger after `from`, with the read-back; ok only when everything below holds. */
export async function describeStep(db: DB, d: Pick<LiveRunDeps, "readBack" | "readBackTries">, from: number, s: { step: string; by: string; rail: string | null; note: string; expect: { approved: boolean; reason?: string } }, sleep: (ms: number) => Promise<void>): Promise<LiveStep> {
  const tapRow = rowsAfter(db, from, ["tap.checkout_verified", "tap.checkout_refused"]).at(-1);
  const charge = rowsAfter(db, from, ["card.charge_approved", "card.charge_declined"]).at(-1);
  const started = rowsAfter(db, from, ["card.purchase_started"]).at(-1);
  const p = tapRow?.payload ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const tap = tapRow ? {
    key_id: str(p.key_id), nonce: str(p.nonce), proxy_status: typeof p.proxy_status === "number" ? p.proxy_status : null,
    sig1: str(p.sig1), sig2: str(p.sig2), merchant: tapRow.event === "tap.checkout_verified" ? "accepted" : `refused: ${String(p.reason)}`,
  } : null;
  let airwallex: LiveStep["airwallex"] = null;
  if (charge) {
    const id = charge.subject;
    const card = cardOf(db, "sourcing")!;
    let confirmed: NonNullable<LiveStep["airwallex"]>["confirmed_by_get"] = null;
    for (let i = 0; i < (d.readBackTries ?? 6) && !confirmed; i++) {
      if (i) await sleep(5000);
      const t = await d.readBack.transactions(card.card_id).then((l) => l.find((x) => x.transactionId === id || x.legacyId === id), () => undefined);
      if (t) confirmed = { status: t.status, approved: t.approved, failure_reason: t.failureReason, amount: (t.amountCents / 100).toFixed(2), currency: t.currency };
    }
    const tx = db.prepare("SELECT status, approved, failure_reason FROM card_transactions WHERE transaction_id = ?").get(id) as { status: string; approved: number; failure_reason: string | null } | undefined;
    airwallex = { transaction_id: id, approved: tx?.approved === 1, status: tx?.status ?? "?", failure_reason: tx?.failure_reason ?? null, confirmed_by_get: confirmed };
  }
  const originRow = charge ?? started;
  const origin = (originRow?.payload.origin ?? null) as Origin | null;
  const plan = started?.subject ?? null;
  const planned = plan && PLANS[plan] ? (PLANS[plan]!.amountCents / 100).toFixed(2) : null;
  const tapOk = !!tap && tap.merchant === "accepted" && tap.proxy_status === 200 && tap.sig1 === "verified" && tap.sig2 === "verified";
  // Holds when TAP passed through the proxy and our layer; Airwallex answered as expected (for a decline: its
  // per-purchase-limit reason, any other decline is recorded as it is and is not ok); a read-only GET confirms the
  // outcome, the reason and the planned amount; and the charge's origin names Airwallex's transaction id.
  const g = airwallex?.confirmed_by_get;
  const ok = tapOk && !!airwallex && !!g && planned !== null
    && airwallex.approved === s.expect.approved && g.approved === s.expect.approved
    && (s.expect.reason === undefined || (airwallex.failure_reason === s.expect.reason && g.failure_reason === s.expect.reason))
    && g.amount === planned && g.currency === "EUR"
    && (origin as { tap?: { awx_transaction_id?: string } } | null)?.tap?.awx_transaction_id === airwallex.transaction_id;
  return { step: s.step, by: s.by, plan, rail: s.rail, tap, airwallex, origin, ok, note: s.note };
}
