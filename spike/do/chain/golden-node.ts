// The chain on better-sqlite3 in Node, with the engine's own opener (openDb) and its real PDF reader: the reference
// the Durable Object run is compared with. It also makes the run's inputs once (the invoice PDF, its text, the software
// passkey's enrolment and its signature over the terms) and writes everything to a file, so the Durable Object can be
// given exactly the same bytes. Usage: tsx golden-node.ts <out.json>
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pdfText } from "../../../src/ap/pdfText.js";
import { openDb } from "../../../src/db/open.js";
import { FakeAirwallex } from "../../../src/redteam/airwallex.js";
import { FakeAuthenticator } from "../../../src/redteam/authenticator.js";
import { EN } from "../../../test/fakes/apInvoices.js";
import { pdfOf } from "../../../test/fakes/pdf.js";
import { ORIGIN, RP, STEPS, steps, type StepName } from "./chain.js";
import { resetRandom, setClock } from "./det.js";
import { installDeterminism } from "./detNode.js";

const out = process.argv[2]!;
const BASE = Date.parse("2026-11-12T10:00:00.000Z");

// The outside world, made before the clock and the randomness are fixed: one invoice PDF and one software passkey.
const pdf = await pdfOf(EN);
const read = await pdfText(pdf);
const auth = new FakeAuthenticator();

installDeterminism();
resetRandom();
setClock(BASE);
const db = openDb(":memory:");
// Count what the engine asks of its ledger, per step (the Durable Object shim counts the same).
const counts = { statements: 0, transactions: 0 };
{
  const d = db as unknown as Record<string, (...a: unknown[]) => unknown>;
  const prepare = d.prepare!.bind(db), exec = d.exec!.bind(db), pragma = d.pragma!.bind(db), transaction = d.transaction!.bind(db);
  d.prepare = (sql) => {
    const st = prepare(sql) as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ["run", "get", "all"]) { const f = st[m]!.bind(st); st[m] = (...a) => { counts.statements++; return f(...a); }; }
    return st;
  };
  d.exec = (sql) => { counts.statements++; return exec(sql); };
  d.pragma = (...a) => { counts.statements++; return pragma(...a); };
  d.transaction = (fn) => {
    const tx = transaction(fn) as ((...a: unknown[]) => unknown) & Record<string, (...a: unknown[]) => unknown>;
    const wrap = (g: (...a: unknown[]) => unknown) => (...a: unknown[]) => { counts.transactions++; return g(...a); };
    return Object.assign(wrap(tx), { default: wrap(tx.default!), deferred: wrap(tx.deferred!), immediate: wrap(tx.immediate!), exclusive: wrap(tx.exclusive!) });
  };
}
const dir = mkdtempSync(join(process.env.TMPDIR ?? "/dev/shm", "golden-node-"));
const s = steps({ db, awx: new FakeAirwallex(), dir: join(dir, "ap") });

const results: Record<string, unknown> = {};
const stats: Record<string, { statements: number; transactions: number; ms: number }> = {};
const inputs: Record<string, unknown> = {
  pdf: { base64: pdf.toString("base64"), filename: "bergtex-BTX-2026-21.pdf", sha256: createHash("sha256").update(pdf).digest("hex"), text: read.text, pages: read.pages },
  spkiSha256: auth.spkiSha256, clockBase: BASE,
};
const args: Record<string, unknown> = {};
let i = 0;
for (const name of STEPS) {
  setClock(BASE + ++i * 1000);
  // What the CFO's phone would send, made from what the engine just said.
  if (name === "enrolFinish") {
    const o = results.enrolOpen as { challenge: string; code: string };
    args.enrolFinish = { code: o.code, credential: auth.register({ challenge: o.challenge, origin: ORIGIN, rpId: RP }), spkiSha256: auth.spkiSha256 };
  }
  if (name === "ingest") args.ingest = { base64: (inputs.pdf as { base64: string }).base64, filename: (inputs.pdf as { filename: string }).filename };
  if (name === "propose") args.propose = { id: (results.ingest as { id: string }).id };
  if (name === "approve") {
    const p = results.propose as { proposal_id: string; terms_sha256: string; challenge: string };
    args.approve = { proposal_id: p.proposal_id, terms_sha256: p.terms_sha256, credential: auth.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) };
  }
  if (name === "execute") args.execute = { proposal_id: (results.propose as { proposal_id: string }).proposal_id };
  const before = { ...counts };
  const t0 = performance.now();
  results[name] = await s[name as StepName](args[name] ?? {});
  stats[name] = { statements: counts.statements - before.statements, transactions: counts.transactions - before.transactions, ms: Number((performance.now() - t0).toFixed(2)) };
}
setClock(BASE + ++i * 1000);
const dump = s.dump({});
writeFileSync(out, JSON.stringify({ inputs, args, results, stats, dump }));
console.log(`node golden run written to ${out}: ${STEPS.length} steps, ${Object.values(stats).reduce((a, x) => a + x.statements, 0)} statements`);
process.exit(0);
