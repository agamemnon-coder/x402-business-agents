// The chain in a Durable Object without the golden comparison's harness: real node:crypto randomness in workerd, the
// real time for every step, and a software passkey here that enrols against and signs what this very run produced
// (nothing replayed). Checks the end state and both hash chains with the engine's own verifiers, and that a second
// company's object is untouched. Usage: tsx live.ts <dist dir built from wrangler.live.jsonc>
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pdfText } from "../../../src/ap/pdfText.js";
import { FakeAuthenticator } from "../../../src/redteam/authenticator.js";
import { EN } from "../../../test/fakes/apInvoices.js";
import { pdfOf } from "../../../test/fakes/pdf.js";
// @ts-expect-error plain .mjs helper
import { workerd } from "../mf.mjs";
import { ORIGIN, RP } from "./chain.js";

const dist = process.argv[2]!;
const modules = readdirSync(dist).filter((f) => f.endsWith(".js") || f.endsWith(".sql")).sort((a, b) => Number(b === "engineWorker.js") - Number(a === "engineWorker.js"))
  .map((f) => ({ type: f.endsWith(".js") ? "ESModule" : "Text", path: join(dist, f) }));
const mf = workerd({ modules, modulesRoot: dist, binding: "COMPANY", className: "CompanyEngine" });
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(company: string, step: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await mf.dispatchFetch(`http://engine/${step}?company=${company}`, { method: "POST", body: JSON.stringify({ clock: Date.now(), ...body }) });
  const out = await res.json() as { result?: unknown; error?: string; stack?: string[] };
  if (out.error) throw new Error(`${step}: ${out.error}\n${(out.stack ?? []).join("\n")}`);
  return out.result;
}
try {
  const pdf = await pdfOf(EN);
  const read = await pdfText(pdf);
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const auth = new FakeAuthenticator();
  const c = "live-company";
  await call(c, "open");
  await call(c, "seed");
  const enrol = await call(c, "enrolOpen") as { challenge: string; code: string };
  await call(c, "enrolFinish", { args: { code: enrol.code, credential: auth.register({ challenge: enrol.challenge, origin: ORIGIN, rpId: RP }), spkiSha256: auth.spkiSha256 } });
  const inv = await call(c, "ingest", { args: { base64: pdf.toString("base64"), filename: "bergtex.pdf" }, text: { sha256, text: read.text, pages: read.pages } }) as { id: string; status: string };
  const p = await call(c, "propose", { args: { id: inv.id } }) as { proposal_id: string; terms_sha256: string; challenge: string };
  // A signature over other terms is refused; the one over these exact terms approves.
  const wrong = await call(c, "approve", { args: { proposal_id: p.proposal_id, terms_sha256: p.terms_sha256, credential: auth.sign({ challenge: Buffer.from(createHash("sha256").update("other terms").digest()).toString("base64url"), origin: ORIGIN, rpId: RP, counter: 1 }) } }) as { status: string; message: string };
  const ok = await call(c, "approve", { args: { proposal_id: p.proposal_id, terms_sha256: p.terms_sha256, credential: auth.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: 2 }) } }) as { status: string; message: string };
  const exec = await call(c, "execute", { args: { proposal_id: p.proposal_id } });
  const paid = await call(c, "syncPayments");
  const ledger = await call(c, "syncLedger");
  const batches = await call(c, "batches");
  const dump = await call(c, "dump") as { rows: Record<string, unknown[]>; audit: unknown; ledger: unknown };
  const other = await call("another-company", "dump") as { rows: Record<string, unknown[]> };
  console.log(JSON.stringify({
    invoice: inv, proposal: { id: p.proposal_id, terms_sha256: p.terms_sha256 }, signature_over_other_terms: wrong, signature_over_these_terms: ok, execute: exec, syncPayments: paid, syncLedger: ledger,
    batches, audit: dump.audit, ledger: dump.ledger, transfer_request_id: (dump.rows.transfers?.[0] as { request_id?: string } | undefined)?.request_id,
    rows_in_another_company: Object.fromEntries(Object.entries(other.rows).map(([k, v]) => [k, v.length])),
  }, null, 1));
} finally { await mf.dispose(); }
