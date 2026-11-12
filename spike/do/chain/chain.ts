// The real chain for one supplier invoice, step by step, on whatever ledger handle it is given: better-sqlite3 in Node
// or the Durable Object shim in workerd. Only the outside world is a stand-in: the parser instead of Claude
// (as test/fakes/vaultWorld.ts), the in-memory Airwallex the tests use, and a software passkey that signs the exact
// terms (the caller plays the CFO's phone and sends the WebAuthn JSON).
import { verifyAuditChain } from "../../../src/audit/log.js";
import { seedTreasury } from "../../../src/agents/euroBill.js";
import { ingestDocument } from "../../../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../../../src/ap/pay.js";
import type { Asker } from "../../../src/ap/read.js";
import { apInvoice } from "../../../src/ap/store.js";
import { batchesFor, type CloudState } from "../../../src/cloudsync/client.js";
import type { DB } from "../../../src/db/open.js";
import { execute } from "../../../src/executors/index.js";
import { verifyLedger } from "../../../src/ledger/core.js";
import { syncLedger } from "../../../src/ledger/feed.js";
import { sha256Hex } from "../../../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../../../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../../../src/passkey/process.js";
import { challengeFor } from "../../../src/passkey/webauthn.js";
import type { FakeAirwallex } from "../../../src/redteam/airwallex.js";

export const RP = "purser-do-spike.invalid";
export const ORIGIN = `https://${RP}`;
export const PASSKEY_LABEL = "spike software passkey (not Face ID)";

const parserOnly = { ask: async (_a: unknown, fallback: () => unknown) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as unknown as Asker;

export interface World { db: DB; awx: FakeAirwallex; dir: string }

const EMPTY: CloudState = { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] };

export const STEPS = ["seed", "enrolOpen", "enrolFinish", "ingest", "propose", "approve", "execute", "syncPayments", "syncLedger", "batches"] as const;
export type StepName = (typeof STEPS)[number] | "dump";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function steps(w: World): Record<StepName, (a: any) => unknown> {
  const now = () => new Date();
  const { db, awx } = w;
  return {
    async seed() {
      const t = await seedTreasury(db, awx, awx);
      return { usd: t.usdAvailableCents, eur: t.eurAvailableCents };
    },
    enrolOpen() {
      const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now());
      return { challenge: window.challenge, code };
    },
    async enrolFinish(a: { code: string; credential: unknown; spkiSha256: string }) {
      const item: InboxItem = { ticket: "spike-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code: a.code, credential: a.credential }), received_at: now().toISOString() };
      const out = await processRegistration(db, item, { label: PASSKEY_LABEL }, now());
      if (out.status !== "pending") throw new Error(`the passkey was not enrolled: ${JSON.stringify(out)}`);
      return { status: out.status, confirmed: confirmPasskey(db, fingerprintOf(a.spkiSha256), now()) };
    },
    async ingest(a: { base64: string; filename: string }) {
      const out = await ingestDocument(db, { dir: w.dir, reader: parserOnly, now }, { bytes: Buffer.from(a.base64, "base64"), filename: a.filename, source: "upload" });
      if (out.kind !== "invoice") throw new Error(out.kind);
      const i = out.invoice;
      return { id: i.id, status: i.status, vendor: i.vendor, invoice_no: i.invoice_no, total: i.total, currency: i.currency, read_by: i.read_by, findings: i.findings.map((f) => `${f.level}:${f.code}`) };
    },
    async propose(a: { id: string }) {
      const out = await payApInvoice(db, awx, a.id, now());
      if (out.kind !== "proposed") throw new Error(out.reason);
      const p = db.prepare("SELECT proposal_id, kind, status, terms_sha256, terms_json FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { proposal_id: string; kind: string; status: string; terms_sha256: string; terms_json: string };
      return { proposal_id: p.proposal_id, kind: p.kind, status: p.status, terms_sha256: p.terms_sha256, challenge: challengeFor(p.terms_sha256), invoice_status: apInvoice(db, a.id)?.status };
    },
    async approve(a: { proposal_id: string; terms_sha256: string; credential: unknown }) {
      const item: InboxItem = { ticket: `spike-${a.proposal_id}`, kind: "assertion", proposal_id: a.proposal_id, body: JSON.stringify({ proposal_id: a.proposal_id, terms_sha256: a.terms_sha256, credential: a.credential }), received_at: now().toISOString() };
      const out = await processAssertion(db, item, now());
      return { status: out.status, message: out.message };
    },
    async execute(a: { proposal_id: string }) {
      await execute(db, a.proposal_id, undefined, undefined, { rail: awx, sim: awx });
      const p = db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(a.proposal_id) as { status: string };
      const t = db.prepare("SELECT status, amount, currency, fee_actual FROM transfers").all();
      return { proposal: p.status, transfers: t };
    },
    async syncPayments() {
      const changed = await syncPayments(db, { now });
      return changed.map((i) => ({ id: i.id, status: i.status }));
    },
    syncLedger() {
      const r = syncLedger(db, now());
      return { result: r, entries: (db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n, lines: (db.prepare("SELECT COUNT(*) AS n FROM ledger_lines").get() as { n: number }).n };
    },
    batches() {
      const b = batchesFor(db, EMPTY, { now: now() });
      const shape = b.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])));
      return { batches: b.length, shape, bytes: JSON.stringify(b).length, sha256: sha256Hex(JSON.stringify(b)) };
    },
    /** Every row of every engine table, and the two chains checked by the engine's own verifiers. */
    dump() {
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'do\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      const rows: Record<string, unknown[]> = {};
      for (const t of tables) {
        const r = db.prepare(`SELECT * FROM "${t}"`).all();
        if (r.length) rows[t] = r;
      }
      const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'do\\_%' ESCAPE '\\' ORDER BY type, name").all();
      return { tables: tables.length, rows, schema, audit: verifyAuditChain(db), ledger: verifyLedger(db) };
    },
  };
}
