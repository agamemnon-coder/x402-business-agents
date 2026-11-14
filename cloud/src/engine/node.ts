// The engine for tests and local runs: one engine host (src/engine/host.ts) per company in this process, each over
// its own better-sqlite3 ledger in memory, with its documents and its stand-in bank (test money) in memory too. What
// leaves the process is what the cloud holds: the archive goes into the document store under t/<tenant>/vault/, and
// the read model is fed through the cloud's own applySync (cloud/src/engine/target.ts). Stopping the process forgets
// every ledger; the Durable Object (one per company, on its own SQLite) is what keeps one.
//
// This file loads the whole engine. The Worker's entry point never imports it (test/cloud-engine.test.ts holds that).
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
}

/** A ledger's documents in memory: no file is written anywhere. */
function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

interface Engine { db: DB; host: EngineHost; acts: ReturnType<typeof airwallexActions> }

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
  const store = memoryActStore();
  const guard = cloudGuard({ sql: env.sql, tenantId, gateway: !!env.awxGateway || !!env.awxStandIn, cacheMs: 0 });
  const awx = wireAirwallex({ bank, store, guard, port: env.awxGateway ?? null, ...(env.awxStandIn ? { standIn: env.awxStandIn } : {}) });
  const host = new EngineHost({
    db, reader: parserOnly, rails: awx.rails, payeeVerifier: awx.verifier, afterMoney: () => { kept.text = bankToText(bank); },
    rp: { rpId: env.rpId, origin: env.origin }, company: { name: company.name, lang: company.language === "en" ? "en" : "nl" },
    vault: blobVault(env.blobs, tenantId), feed: (d, now) => feedCloud(d, target, now),
    samples: SAMPLES, ...(tenantId.startsWith("t_try_") ? { maxDocuments: TRY_MAX_DOCUMENTS, seedPaid: true } : {}),
  });
  await host.seed();
  return { db, host, acts: airwallexActions({ host, db, rail: awx.routed, guard, store, caps: () => guard.caps() }) };
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
      propose: async (invoiceId) => (await acts()).propose(invoiceId),
      proposal: async (id) => (await host()).proposal(id),
      passkeyStart: async (rp) => (await host()).passkeyStart(rp && rpAllowed(rp, env) ? { rpId: rp.rpId, origin: rp.origin } : undefined),
      passkeyFinish: async (a) => (await host()).passkeyFinish(a),
      securityKeyStart: async (a) => (await host()).securityKeyStart({ label: a.label, ...(a.rp && rpAllowed(a.rp, env) ? { rp: { rpId: a.rp.rpId, origin: a.rp.origin } } : {}) }),
      securityKeyFinish: async (a) => (await host()).securityKeyFinish(a),
      proposeSecondKey: async (changes) => (await host()).proposeSecondKey(changes),
      approve: async (a) => (await acts()).approve(a),
      retry: async (proposalId) => (await acts()).retry(proposalId),
      sync: async () => (await host()).sync(),
      events: async (after, limit) => (await host()).events(after, limit),
      vaultFiles: async () => (await host()).vaultFiles(),
      vaultFile: async (path) => (await host()).vaultFile(path),
      forgetPasskey: async (person) => (await host()).forgetPasskey(person),
      samples: async () => (await host()).samples(),
      uploadSample: async (key) => (await host()).uploadSample(key),
      suppliers: async () => (await host()).suppliers(),
      compose: async (input) => (await host()).compose(input),
      terms: async (id) => (await host()).terms(id),
      paySigned: async (id, sent, credential) => { const h = await host(); return (await acts()).runAt(id, () => h.paySigned(id, sent, credential)); },
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
