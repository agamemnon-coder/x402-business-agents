// SPIKE (spike-do-runtime): the Node side of every probe. It runs the real engine in Node (better-sqlite3, pdfkit's Node
// build, unpdf in a worker thread) and writes what the workerd probes compare against. No network: the fake Airwallex
// sandbox and the parser instead of Claude, exactly as test/fakes/vaultWorld.ts does.
//
//   env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY TMPDIR=/dev/shm \
//     npx tsx spike/do-runtime/gen-fixtures.ts
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pdfText } from "../../src/ap/pdfText.js";
import { batchesFor } from "../../src/cloudsync/client.js";
import { pdfOf } from "../../src/e2e/documents.js";
import { WORLD } from "../../src/e2e/world.js";
import { challengeFor, verifyApprovalSignature, verifyEnrolmentResponse } from "../../src/passkey/webauthn.js";
import type { EnrolmentWindow, PasskeyRow } from "../../src/passkey/ledger.js";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";
import { monthData, receiptData } from "../../src/vault/data.js";
import { monthReportPdf, receiptPdf } from "../../src/vault/pdf.js";
import { vaultWorld } from "../../test/fakes/vaultWorld.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "fixtures");
mkdirSync(out, { recursive: true });
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const put = (name: string, data: Uint8Array | string) => writeFileSync(join(out, name), data);
const COMPANY = "Northwind Outdoor B.V. (test)";

// 1. A fixture invoice PDF (the e2e world's first Dutch invoice, rendered as the e2e renders it) and Node's reading.
const inv = WORLD[0]!.invoices[0]!;
const invoicePdf = await pdfOf(inv.text);
put("invoice.pdf", invoicePdf);
const t0 = performance.now();
const read = await pdfText(invoicePdf);
const pdfTextMs = performance.now() - t0;

// 2. The vault's documents from a real world: one invoice paid with approval and booked, the month closed.
const w = await vaultWorld({ close: true });
const receipt = receiptData(w.db, w.paidId)!;
const month = monthData(w.db, w.month);
put("receipt-data.json", JSON.stringify(receipt, null, 1));
put("month-data.json", JSON.stringify(month, null, 1));
const t1 = performance.now();
const receiptNode = await receiptPdf(COMPANY, receipt, "nl");
const receiptMs = performance.now() - t1;
const receiptNode2 = await receiptPdf(COMPANY, receipt, "nl");
const monthNode = await monthReportPdf(COMPANY, month, "nl");
put("receipt.node.pdf", receiptNode);
put("month.node.pdf", monthNode);
const receiptText = await pdfText(receiptNode);
const monthText = await pdfText(monthNode);

// 3. A software passkey (P-256, ES256): enrolled, then signing the paid proposal's exact terms hash.
const origin = "https://cloud.example.invalid", rpId = "cloud.example.invalid";
const phone = new FakeAuthenticator();
const window: EnrolmentWindow = { window_id: "w1", challenge: Buffer.from(sha("enrol"), "hex").toString("base64url"), user_id: "dQ", code_sha256: "", rp_id: rpId, origin } as EnrolmentWindow;
const registration = phone.register({ challenge: window.challenge, origin, rpId });
const enrolled = await verifyEnrolmentResponse(registration, window);
if (!enrolled.ok) throw new Error(enrolled.reason);
const termsSha = (w.db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(w.proposalId) as { terms_sha256: string }).terms_sha256;
const pk: PasskeyRow = {
  credential_id: enrolled.credentialId, public_key: enrolled.publicKey, counter: enrolled.counter, transports: JSON.stringify(enrolled.transports), rp_id: rpId, origin,
  label: "cfo", aaguid: enrolled.aaguid, registration_json: JSON.stringify(registration), enrolled_at: w.now.toISOString(), status: "ACTIVE",
};
const assertion = phone.sign({ challenge: challengeFor(termsSha), origin, rpId, counter: 1 });
const approved = await verifyApprovalSignature(assertion, termsSha, pk);
if (!approved.ok) throw new Error(approved.reason);
put("passkey.json", JSON.stringify({ window, registration, pk, termsSha, assertion, nodeVerdict: approved }, null, 1));

// 4. What the runner would push to Purser Cloud for this world: the batches of src/cloudsync/client.ts, unchanged.
const batches = batchesFor(w.db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] }, { now: w.now });
put("sync-batches.json", JSON.stringify({ now: w.now.toISOString(), batches }));

put("node-results.json", JSON.stringify({
  node: process.version,
  invoice: { bytes: invoicePdf.length, sha256: sha(invoicePdf), text: read.text, pages: read.pages, ms: Math.round(pdfTextMs) },
  receipt: { bytes: receiptNode.length, sha256: sha(receiptNode), deterministic: sha(receiptNode) === sha(receiptNode2), text: receiptText.text, pages: receiptText.pages, ms: Math.round(receiptMs) },
  month: { bytes: monthNode.length, sha256: sha(monthNode), text: monthText.text, pages: monthText.pages },
  company: COMPANY,
  sync: { batches: batches.length, kinds: batches.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, (v as unknown[]).length]))) },
}, null, 1));
console.log(JSON.stringify({ invoice: invoicePdf.length, receipt: receiptNode.length, month: monthNode.length, batches: batches.length, pdfTextMs: Math.round(pdfTextMs), receiptMs: Math.round(receiptMs) }));
process.exit(0);
