// The engine for tests and local runs: one engine host (src/engine/host.ts) per company in this process, each over
// its own better-sqlite3 ledger in memory, with its documents and its stand-in bank (test money) in memory too. What
// leaves the process is what the cloud holds: the archive goes into the document store under t/<tenant>/vault/, and
// the read model is fed through the cloud's own applySync (cloud/src/engine/target.ts). Stopping the process forgets
// every ledger; the Durable Object (one per company, on its own SQLite) is what keeps one.
//
// This file loads the whole engine. The Worker's entry point never imports it (test/cloud-engine.test.ts holds that).
import { TRY_ALONE_LIMIT, TRY_FX_QUOTE_MAX_MARKUP_BPS } from "../../../src/config/policy.js";
import { useDocStore, type DocStore } from "../../../src/ap/docStore.js";
import { openDb, type DB } from "../../../src/db/open.js";
import { feedCloud } from "../../../src/engine/feed.js";
import { EngineHost, parserOnly } from "../../../src/engine/host.js";
import { bankToText, standInBank } from "../../../src/engine/standInBank.js";
import type { Blobs, Sql } from "../store.js";
import { TenantDb } from "../tenant.js";
import type { EngineApi } from "./api.js";
import { SAMPLES } from "./samples.gen.js";
import { cloudTarget } from "./target.js";
import { blobVault } from "./vaultR2.js";
import { rpAllowed } from "../hostOrigin.js";
import { airwallexActions, memoryActStore } from "../../../src/engine/awxActions.js";
import type { GatewayPort } from "../../../src/airwallex/gateway.js";
import type { Rails3 } from "../../../src/airwallex/routedRail.js";
import type { PayeeNameVerifier } from "../../../src/airwallex/payeeName.js";
import { cloudGuard } from "./awxGuard.js";
import { wireAirwallex } from "./awxWire.js";
import { withLiveFx, type FxQuoteNote, type LiveFxSource } from "./liveFx.js";
import { sandboxPayout, simulatePayout, withAlonePayout, type PayoutSource } from "./livePayout.js";
import { frozen } from "../../../src/policy/rules.js";
import { railStop } from "../../../src/policy/emergencyStop.js";

export interface NodeEngineEnv {
  sql: Sql;
  blobs: Blobs;
  /** The approval passkey's relying party: the cloud's own host and origin. */
  rpId: string;
  origin: string;
  /** The cloud's clock, for what the read model stamps; the engine itself runs on the real clock, as its executor does. */
  now?: () => Date;
  /** The Airwallex gateway (tests hand in a fake one); absent: every action runs on the simulated bank, labelled. */
  awxGateway?: GatewayPort;
  /** Local checks only: an in-memory stand-in in Airwallex's place (see ./awxWire.ts). */
  awxStandIn?: { rail: Rails3; payees: PayeeNameVerifier };
  /**
   * /try's live FX quote (./liveFx.ts), as purser-try has it through its AWX_FX binding for its test companies; here,
   * when handed in (tests and local checks, with a stand-in source), for every company of this process.
   */
  liveFx?: { source: LiveFxSource; allowed: () => Promise<boolean> };
  /** /try's sandbox payout (./livePayout.ts), the same way: a stand-in source in tests and local checks. */
  livePayout?: { source: PayoutSource; allowed: () => Promise<boolean> };
}

/** A ledger's documents in memory: no file is written anywhere. */
function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

interface Engine { db: DB; host: EngineHost; acts: ReturnType<typeof airwallexActions>; fxNote: (terms: unknown) => FxQuoteNote | null; payoutNotes: Map<string, string> }

/** The company's engine, made on first use: its name and language are read once, and the treasury's test money is seeded. */
async function start(env: NodeEngineEnv, tenantId: string): Promise<Engine> {
  const tenant = new TenantDb(env.sql, tenantId);
  const company = await env.sql.first<{ name: string; language: string }>("SELECT name, language FROM tenants WHERE id = ?", [tenantId]);
  if (!company) throw new Error("no such company");
  const db = openDb(":memory:");
  useDocStore(db, memoryDocs());
  const kept = { text: null as string | null };
  const bank = standInBank({ load: () => kept.text, save: (text) => { kept.text = text; } });
  const target = cloudTarget(tenant, env.blobs, env.now ?? (() => new Date()));
  const notes = new Map<string, string>();
  const fx = env.liveFx
    ? withLiveFx(bank, { company: tenantId, source: env.liveFx.source, allowed: env.liveFx.allowed, db, keep: { get: (id) => notes.get(id) ?? null, set: (id, n) => { notes.set(id, n); } } })
    : null;
  const rail = fx ? fx.rail : bank;
  const store = memoryActStore();
  const guard = cloudGuard({ sql: env.sql, tenantId, gateway: !!env.awxGateway || !!env.awxStandIn, cacheMs: 0 });
  // The emergency stop is asked at the rail too, immediately before every create at either bank (src/policy/emergencyStop.ts).
  const awx = wireAirwallex({ bank: rail, store, guard, port: env.awxGateway ?? null, ...(env.awxStandIn ? { standIn: env.awxStandIn } : {}), stop: railStop(db) });
  const host = new EngineHost({
    db, reader: parserOnly, rails: awx.rails, payeeVerifier: awx.verifier, afterMoney: () => { kept.text = bankToText(bank); },
    rp: { rpId: env.rpId, origin: env.origin }, company: { name: company.name, lang: company.language === "en" ? "en" : "nl" },
    vault: blobVault(env.blobs, tenantId), feed: (d, now) => feedCloud(d, target, now),
    samples: SAMPLES, ...(tenantId.startsWith("t_try_") ? { maxDocuments: TRY_MAX_DOCUMENTS, seedPaid: true, fxMarkupBps: TRY_FX_QUOTE_MAX_MARKUP_BPS, aloneLimit: TRY_ALONE_LIMIT } : {}),
  });
  await host.seed();
  return { db, host, acts: airwallexActions({ host, db, rail: awx.routed, guard, store, caps: () => guard.caps() }), fxNote: (terms) => (fx ? fx.noteFor(terms) : null), payoutNotes: new Map() };
}

/** A visitor's test company (t_try_...) holds at most this many documents, whatever route brings them. */
export const TRY_MAX_DOCUMENTS = 8;

export function nodeEngines(env: NodeEngineEnv): (tenantId: string) => EngineApi {
  const engines = new Map<string, Promise<Engine>>();
  return (tenantId) => {
    const host = async (): Promise<EngineHost> => {
      let e = engines.get(tenantId);
      if (!e) {
        e = start(env, tenantId);
        engines.set(tenantId, e);
        // A start that failed is not kept: the next call tries again.
        e.catch(() => { if (engines.get(tenantId) === e) engines.delete(tenantId); });
      }
      return (await e).host;
    };
    const acts = async () => { await host(); return (await engines.get(tenantId)!).acts; };
    return {
      status: async () => (await host()).status(),
      seed: async () => (await host()).seed(),
      upload: async (doc) => (await host()).upload(doc),
      invoices: async () => (await host()).invoices(),
      invoice: async (id) => (await host()).invoice(id),
      // 16 Nov: the agent's own payment within the limit, once paid, also asked of the Airwallex sandbox (./livePayout.ts withAlonePayout).
      propose: async (invoiceId) => {
        const out = await (await acts()).propose(invoiceId);
        const { host: h, db, payoutNotes } = await engines.get(tenantId)!;
        return withAlonePayout(out, (id) => h.terms(id), (proposalId, termsSha256, terms) => sandboxPayout({
          company: tenantId, proposalId, termsSha256, terms, source: env.livePayout?.source ?? null, allowed: env.livePayout?.allowed ?? (async () => false), db, stopped: () => frozen(db),
          keep: { get: (pid) => payoutNotes.get(pid) ?? null, set: (pid, n) => { payoutNotes.set(pid, n); } },
        }));
      },
      proposal: async (id) => (await host()).proposal(id),
      passkeyStart: async (rp) => (await host()).passkeyStart(rp && rpAllowed(rp, env) ? { rpId: rp.rpId, origin: rp.origin } : undefined),
      passkeyFinish: async (a) => (await host()).passkeyFinish(a),
      securityKeyStart: async (a) => (await host()).securityKeyStart({ label: a.label, ...(a.rp && rpAllowed(a.rp, env) ? { rp: { rpId: a.rp.rpId, origin: a.rp.origin } } : {}) }),
      securityKeyFinish: async (a) => (await host()).securityKeyFinish(a),
      proposeSecondKey: async (changes, by) => (await host()).proposeSecondKey(changes, by),
      emergencyStop: async (stop, by) => (await host()).emergencyStop(stop, by),
      approve: async (a) => (await acts()).approve(a),
      retry: async (proposalId) => (await acts()).retry(proposalId),
      sync: async () => (await host()).sync(),
      events: async (after, limit) => (await host()).events(after, limit),
      vaultFiles: async () => (await host()).vaultFiles(),
      vaultFile: async (path) => (await host()).vaultFile(path),
      forgetPasskey: async (person) => (await host()).forgetPasskey(person),
      samples: async () => (await host()).samples(),
      uploadSample: async (key) => (await host()).uploadSample(key),
      clearHold: async (id) => (await host()).clearHold(id),
      rejectHold: async (id) => (await host()).rejectHold(id),
      negotiated: async (r, f) => (await host()).negotiated(r, f),
      agreed: async (x, f) => (await host()).agreed(x, f),
      suppliers: async () => (await host()).suppliers(),
      compose: async (input) => (await host()).compose(input),
      terms: async (id) => {
        await host();
        const { host: h, fxNote } = await engines.get(tenantId)!;
        const t = h.terms(id);
        const note = t ? fxNote(t.terms) : null;
        return t && note ? { ...t, fx_quote: note } : t;
      },
      paySigned: async (id, sent, credential) => {
        const h0 = await host();
        const out = await (await acts()).runAt(id, () => h0.paySigned(id, sent, credential));
        if (!env.livePayout || !out || "bad" in out || (out.outcome !== "paid" && out.outcome !== "paid_once")) return out;
        const { host: h, db, payoutNotes } = await engines.get(tenantId)!;
        const t = h.terms(id);
        if (!t) return out;
        const note = await sandboxPayout({
          company: tenantId, proposalId: id, termsSha256: t.terms_sha256, terms: t.terms as unknown as Record<string, unknown>, source: env.livePayout.source, allowed: env.livePayout.allowed, db, stopped: () => frozen(db),
          keep: { get: (pid) => payoutNotes.get(pid) ?? null, set: (pid, n) => { payoutNotes.set(pid, n); } },
        });
        return { ...out, airwallex_payout: note };
      },
      payoutSimulate: async (proposalId) => {
        await host();
        const { db, payoutNotes } = await engines.get(tenantId)!;
        if (!env.livePayout) return { ok: false as const, reason: "no_binding" as const, note: null };
        return simulatePayout({ company: tenantId, proposalId, source: env.livePayout.source, allowed: env.livePayout.allowed, db, keep: { get: (pid) => payoutNotes.get(pid) ?? null, set: (pid, n) => { payoutNotes.set(pid, n); } } });
      },
      addSupplier: async (invoiceId, v) => (await acts()).addSupplier(invoiceId, v),
      proposeBatch: async (ids) => (await acts()).proposeBatch(ids),
      depositIn: async (a) => (await acts()).depositIn(a),
      airwallex: async () => (await acts()).view(),
      exportBatch: async () => (await host()).exportBatch(),
      exportPdf: async () => (await host()).exportPdf(),
      wipe: async () => {
        const e = engines.get(tenantId);
        engines.delete(tenantId);
        if (e) await e.then((x) => x.db.close(), () => undefined);
      },
    };
  };
}
