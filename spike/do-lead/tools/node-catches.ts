// SPIKE: the same catches on better-sqlite3 in Node (the engine's own opener and its worker-thread PDF reader), to
// compare with what the Durable Object answered in spike/do-lead/results/lead-run.json.
//   npx tsx spike/do-lead/tools/node-catches.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedTreasury } from "../../../src/agents/euroBill.js";
import { ingestDocument } from "../../../src/ap/inbox.js";
import type { Asker } from "../../../src/ap/read.js";
import { openDb } from "../../../src/db/open.js";
import { FakeAirwallex } from "../../../src/redteam/airwallex.js";

const here = dirname(fileURLToPath(import.meta.url));
const parserOnly = { ask: async (_a: unknown, fallback: () => unknown) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as unknown as Asker;
const db = openDb(":memory:");
const awx = new FakeAirwallex();
await seedTreasury(db, awx, awx);
const dir = mkdtempSync(join(process.env.TMPDIR ?? "/dev/shm", "lead-node-"));
const now = () => new Date();
const file = async (name: string, filename: string) => {
  const r = await ingestDocument(db, { dir, reader: parserOnly, now }, { bytes: readFileSync(resolve(here, "../fixtures", name)), filename, source: "upload" });
  if (r.kind !== "invoice") return { kind: r.kind };
  const i = r.invoice;
  return { kind: r.kind, id: i.id, status: i.status, invoice_no: i.invoice_no, findings: i.findings.map((f) => `${f.level}:${f.code}`) };
};
const out = {
  first: await file("bergtex.pdf", "bergtex-BTX-2026-21.pdf"),
  same_file_again: await file("bergtex.pdf", "bergtex-BTX-2026-21 (copy).pdf"),
  renumbered_copy_same_total: await file("renumbered.pdf", "bergtex-BTX-2026-17.pdf"),
  changed_bank_details: await file("bankchange.pdf", "bergtex-BTX-2027-01.pdf"),
};
console.log(JSON.stringify(out, null, 1));
process.exit(0);
