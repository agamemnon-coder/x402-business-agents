// npm run hero-receipt [-- --out <file>]: writes the sample receipt Home's hero checks in the browser
// (docs/demo/hero-receipt.json; src/redesign/heroReceipt.ts says what the hero does with it and how to swap it).
// Nothing is typed by hand: the Airwallex-only scenario runs offline on the in-memory rails (0 network: no key is read,
// fetch is refused), Purser's own code builds the terms of the invoice the 7 November record paid (the same invoice
// file, so the same number, payee, amount and IBAN), and a software passkey made here signs their SHA-256. Its private
// key lives in this process only and is never written. Run once; the output is committed. A sample: not the CFO's
// signature, not Face ID, and no record of a payment.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_CALL_BUDGET", "AIRWALLEX_CALL_LOG", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "KIT11_AGENTS", "KIT11_AUTONOMY", "HUB_PUSH_ENABLED", "HUB_DECISIONS_ENABLED", "T0_ENABLED"]) delete process.env[k];
globalThis.fetch = (async (input: unknown) => { throw new Error(`hero-receipt: no network (${String(input).slice(0, 60)})`); }) as typeof fetch;

const args = process.argv.slice(2);
const repo = resolve(import.meta.dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "hero-receipt-"));
process.env.KIT11_DB = join(dir, "hero-receipt.sqlite");
process.env.KIT11_KEYS_DIR = join(dir, "hero-receipt-keys");
try {
  const { openDb } = await import("../db/open.js");
  const { runAwx1 } = await import("../awx/scenario.js");
  const { standInDeps } = await import("../awx/standIn.js");
  const { FakeAuthenticator } = await import("../redteam/authenticator.js");
  const { canonicalTerms, RECEIPT_FORMAT, verifyReceipt } = await import("../try/receipt.js");
  const { heroDemoFacts } = await import("../redesign/heroDemo.js");
  const { HERO_RECEIPT_FILE, HERO_SAMPLE_ORIGIN, HERO_SAMPLE_RP, heroReceipt } = await import("../redesign/heroReceipt.js");

  const facts = heroDemoFacts();
  if (!facts) throw new Error("docs/demo/airwallex-run.json holds no paid, passkey-approved invoice of the Treasury agent");
  const db = openDb();
  const w = await standInDeps(db, { log: () => undefined });
  await runAwx1(w.deps);
  const row = db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE kind = 'invoice_payment' AND json_extract(terms_json, '$.invoice_no') = ?").get(facts.invoice) as { terms_json: string; terms_sha256: string } | undefined;
  db.close();
  if (!row) throw new Error(`the offline run filed no payment for invoice ${facts.invoice}`);
  const terms = JSON.parse(row.terms_json) as Record<string, unknown>;
  const hash = createHash("sha256").update(canonicalTerms(terms)).digest("hex");
  if (hash !== row.terms_sha256) throw new Error("the terms do not hash to the hash Purser filed for them");
  if (terms.amount !== facts.amount) throw new Error(`the offline run's amount (${String(terms.amount)}) is not the record's (${facts.amount})`);

  const key = new FakeAuthenticator();
  const a = key.sign({ challenge: Buffer.from(hash, "hex").toString("base64url"), origin: HERO_SAMPLE_ORIGIN, rpId: HERO_SAMPLE_RP, counter: 1 });
  const out = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]!) : resolve(repo, HERO_RECEIPT_FILE);
  const receipt = {
    receipt: RECEIPT_FORMAT,
    note: `A sample for Home's hero, not a record of a payment: the terms of the ${String(terms.currency)} ${facts.amount} payment of invoice ${facts.invoice} in the Airwallex-only run of ${facts.date}, built again by Purser's own code in an offline test world (the ids and balances in them are that world's) and signed once with a test key. Not the CFO's signature and not Face ID; nothing real moved.`,
    terms, terms_sha256: hash, algorithm: "ES256", public_key: key.publicJwk, credential_id: key.credentialId, rp_id: HERO_SAMPLE_RP, origin: HERO_SAMPLE_ORIGIN,
    assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature },
    verify: `npm run verify-receipt -- ${HERO_RECEIPT_FILE}`,
  };
  const v = verifyReceipt(receipt);
  if (!v.ok) throw new Error(`the receipt does not verify: ${v.checks.filter((c) => !c.ok).map((c) => c.check).join(", ")}`);
  if (heroReceipt(facts, receipt)?.kind !== "sample") throw new Error("the hero would not take this receipt as a labelled sample");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`wrote ${out}: ${facts.invoice}, ${String(terms.currency)} ${facts.amount}, terms hash ${hash}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
