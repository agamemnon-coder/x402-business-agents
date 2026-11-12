// Payables: a watched folder (npm run payables -- watch <dir>). Each PDF or saved e-mail (.eml) in it goes through
// the one way in, as source "folder"; a file filed before is recognised by its hash. Nothing is moved or deleted.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "../db/open.js";
import { ingestDocument, MAX_DOCUMENT_BYTES, type InboxDeps, type IngestResult } from "./inbox.js";

export interface ScanResult { filed: number; already: number; skipped: string[]; failed: { file: string; error: string }[]; results: IngestResult[] }

const count = (r: IngestResult): { filed: number; already: number } =>
  r.kind === "invoice" ? { filed: 1, already: 0 } : r.kind === "duplicate_document" ? { filed: 0, already: 1 }
    : r.results.map(count).reduce((a, b) => ({ filed: a.filed + b.filed, already: a.already + b.already }), { filed: 0, already: 0 });

export async function scanFolder(db: DB, deps: InboxDeps, folder: string): Promise<ScanResult> {
  const out: ScanResult = { filed: 0, already: 0, skipped: [], failed: [], results: [] };
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    const st = statSync(path);
    if (!st.isFile()) continue;
    if (!/\.(pdf|eml)$/i.test(name)) { out.skipped.push(name); continue; }
    // The size before the bytes: a huge file in the folder is refused without being read into memory (red team round 2).
    if (st.size > MAX_DOCUMENT_BYTES) { out.failed.push({ file: name, error: `${name} is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB; it was not read; nothing was filed` }); continue; }
    try {
      const r = await ingestDocument(db, deps, { bytes: readFileSync(path), filename: name, source: "folder", meta: { folder } });
      const c = count(r);
      out.filed += c.filed;
      out.already += c.already;
      out.results.push(r);
    } catch (e) {
      out.failed.push({ file: name, error: (e as Error).message });
    }
  }
  return out;
}
