// Home's hero (home-story, 12 Nov): four steps, the first three from the Airwallex-only run's record, the fourth the
// visitor's own check, run in the browser on a receipt file: since 12 November the published receipt of the approval of
// 7 November itself (docs/runs/2026-11-07-awx-1/receipt-P-0002.json, published by the owner's decision). Held here: every
// figure of steps 1 to 3 against the record; the verification the page embeds, run in Node on that receipt (untouched,
// one cent more, another IBAN, back again); the receipt itself (it verifies, its canonical terms hash to the hash the
// record holds and Airwallex's transfer carries, its note says what it is, no private key anywhere); the page's data
// (only what the check needs); and that the hero follows the file, not the code: another valid receipt drives it, a bad
// one removes it, a labelled sample would be called one.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { DEMO_LINES, DEMO_STEPS, HERO_CHECK_JS, HERO_DEMO_CSS, HERO_DEMO_JS, HERO_VERDICT, heroDemoFacts, heroDemoHtml, heroProvenance } from "../src/redesign/heroDemo.js";
import { HERO_DATA_KEYS, HERO_RECEIPT_FILE, heroReceipt } from "../src/redesign/heroReceipt.js";
import { homePage } from "../src/redesign/home.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { canonicalTerms, RECEIPT_FORMAT, verifyReceipt, type TryReceipt } from "../src/try/receipt.js";
import { VERIFY_CORE } from "../src/try/verify.js";
import { CAVEAT_LINE } from "../src/config/brand.js";
import { scriptBlocks, scriptBody } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const rec = JSON.parse(read("docs/demo/airwallex-run.json")) as { attempts: { at: string }[]; invoices: { invoice_no: string; amount: string; transfer_id: string; transfer_request_id: string; approval_sha256: string; proposal_id: string; status: string }[]; proposals: { proposal_id: string; terms_sha256: string; method: string; created_by: string; decided_by: string }[]; verify: { level: string; what: string; detail: string }[] };
const RAW = read(HERO_RECEIPT_FILE);
const RECEIPT = JSON.parse(RAW) as TryReceipt & { verify?: string };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

interface Verdict { ok: boolean; failed: string[]; signed: string; now: string; terms: Record<string, unknown> }
/** The check as the page embeds it (the two strings are in Home's one script, word for word), run with Node's WebCrypto. */
const web = new Function(`${VERIFY_CORE}\n${HERO_CHECK_JS}\nreturn { heroCheck: heroCheck, heroPlusCent: heroPlusCent, heroOtherIban: heroOtherIban };`)() as {
  heroCheck: (r: unknown, edit?: { amount?: string; iban_last4?: string }) => Promise<Verdict>; heroPlusCent: (a: string) => string | null; heroOtherIban: (s: string) => string;
};
const dataOf = (html: string) => JSON.parse(/<script type="application\/json" id="run-data">([\s\S]*?)<\/script>/.exec(html)![1]!) as Record<string, unknown>;

/** Another receipt for the same payment, made here: the same terms shape, other values, another key. */
function receiptFor(change: Record<string, unknown> = {}, o: { note?: string; breakSignature?: boolean } = {}): TryReceipt {
  const terms = { ...RECEIPT.terms, beneficiary_name: "Stockline Daten AG", iban_last4: "7731", ...change };
  const hash = sha(canonicalTerms(terms));
  const key = new FakeAuthenticator();
  const a = key.sign({ challenge: Buffer.from(hash, "hex").toString("base64url"), origin: "https://other.purser.test", rpId: "other.purser.test", counter: 1 });
  const sig = o.breakSignature ? a.response.signature.replace(/.$/, (c) => (c === "A" ? "B" : "A")) : a.response.signature;
  return {
    receipt: RECEIPT_FORMAT, note: o.note ?? "Another sample, made in a test: signed with a test key.", terms, terms_sha256: hash, algorithm: "ES256", public_key: key.publicJwk, credential_id: key.credentialId,
    rp_id: "other.purser.test", origin: "https://other.purser.test", assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: sig },
  };
}

describe("the hero's steps 1 to 3", () => {
  const f = heroDemoFacts()!;
  it("take every figure from the record: the Treasury agent's invoice, its signed hash, Airwallex's transfer, the run's day", () => {
    const inv = rec.invoices.find((i) => i.invoice_no === f.invoice)!;
    const p = rec.proposals.find((x) => x.proposal_id === inv.proposal_id)!;
    expect([inv.status, inv.amount, inv.transfer_id, inv.approval_sha256]).toEqual(["PAID", f.amount, f.transfer, f.hash]);
    expect([p.terms_sha256, p.method, p.created_by]).toEqual([f.hash, "passkey", "treasury"]);
    expect(f.date).toBe(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(rec.attempts[0]!.at)));
    expect(f.date).toBe("7 November 2026");
    // Step 3's line says the signed hash is in Airwallex's record: the run's own verify line says so for this transfer.
    expect(f.inRecord).toBe(true);
    expect(rec.verify.find((v) => v.what.includes(f.transfer))).toMatchObject({ level: "ok", detail: expect.stringContaining("approval hash in metadata") });
  });

  it("are four steps, the fourth named after what the visitor does, each with one short line", () => {
    expect(DEMO_STEPS).toEqual(["Ask", "Face ID", "Paid", "+1 cent"]);
    expect(DEMO_LINES).toHaveLength(4);
    for (const l of DEMO_LINES) expect(l.split(/\s+/).length).toBeLessThanOrEqual(12);
    const html = heroDemoHtml();
    const strip = /<ol class="hd-steps">[\s\S]*?<\/ol>/.exec(html)![0];
    expect([...strip.matchAll(/<li data-p="(\d)"><span>\d<\/span>([^<]+)<\/li>/g)].map((m) => m[2])).toEqual([...DEMO_STEPS]);
    // A8: no lowercase "refused" tab that reads as a product failure.
    expect(strip).not.toMatch(/refused|Tamper/i);
    for (const l of DEMO_LINES) expect(html).toContain(l);
    expect(html).toContain(f.transfer.slice(0, 8));
    expect(html).toContain(f.hash.slice(0, 16));
    // No run label, date or caveat inside the hero: Home's one provenance line carries them.
    expect(html).not.toMatch(/Recorded run|sandbox|test money|simulated|\b\d{1,2} Nov/i);
  });

  it("is on Home in the hero section, light enough to inline, with a still frame for reduced motion", () => {
    const home = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).home!;
    expect(/<section class="hero">[\s\S]*?<\/section>/.exec(home)![0]).toContain('id="hero-demo"');
    expect(Buffer.byteLength(heroDemoHtml() + HERO_DEMO_CSS + HERO_DEMO_JS)).toBeLessThan(48_000);
    expect(HERO_DEMO_CSS).toContain("prefers-reduced-motion: reduce");
    expect(HERO_DEMO_JS).toContain("prefers-reduced-motion: reduce");
    // Real controls: buttons, a labelled input, the verdict in a polite live region, a focus ring on the dark stage.
    const html = heroDemoHtml();
    expect([...html.matchAll(/<button type="button" class="hd-btn[^"]*" data-act="(\w+)">([^<]+)<\/button>/g)].map((m) => [m[1], m[2]])).toEqual([["cent", "+1 cent"], ["iban", "Change the IBAN"], ["reset", "Reset"]]);
    expect(html).toMatch(/<label[^>]*>[\s\S]*?<input class="hd-in" [^>]*inputmode="decimal"[^>]*>/);
    expect(html).toMatch(/<p class="hd-verdict" role="status" aria-live="polite">/);
    expect(HERO_DEMO_CSS).toMatch(/\.hd-btn:focus-visible, \.hd-in:focus-visible \{ outline: 3px solid/);
  });
});

describe("the hero's step 4: the check the page embeds, on the published receipt", () => {
  it("is in Home's one script word for word: the checks of /try/verify and the hero's few lines around them", () => {
    const script = scriptBody(scriptBlocks(homePage()).find((b) => b.toLowerCase().startsWith("<script>"))!);
    expect(script).toContain(VERIFY_CORE);
    expect(script).toContain(HERO_CHECK_JS);
    // No verdict but the check's: the script calls no network and holds no hash or amount of its own.
    expect(script).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\bimport\s*\(/);
    expect(script).not.toContain(RECEIPT.terms_sha256);
    expect(script).not.toContain(String(RECEIPT.terms.amount));
  });

  it("passes every check untouched, and shows the hash the passkey signed", async () => {
    const data = dataOf(homePage());
    const v = await web.heroCheck(data);
    expect(v).toMatchObject({ ok: true, failed: [], signed: RECEIPT.terms_sha256, now: RECEIPT.terms_sha256 });
    expect(v.now).toBe(sha(canonicalTerms(RECEIPT.terms)));
  });

  it("fails on the terms hash and the challenge with one cent more, and the hash shown is the changed terms' own", async () => {
    const data = dataOf(homePage());
    const amount = web.heroPlusCent(String(RECEIPT.terms.amount))!;
    expect(amount).toBe("240.01");
    const v = await web.heroCheck(data, { amount });
    expect(v.ok).toBe(false);
    expect(v.failed).toEqual(["terms hash"]);
    expect(v.signed).toBe(RECEIPT.terms_sha256);
    expect(v.now).toBe(sha(canonicalTerms({ ...RECEIPT.terms, amount: "240.01" })));
    expect(v.now).not.toBe(v.signed);
    // The same receipt with the changed hash claimed as signed: now the challenge check fails (the passkey signed the other).
    const claimed = await new Function(`${VERIFY_CORE}\nreturn verifyReceiptWeb;`)()({ ...data, terms: { ...RECEIPT.terms, amount: "240.01" }, terms_sha256: v.now }) as { ok: boolean; checks: { check: string; ok: boolean }[] };
    expect(claimed.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["challenge"]);
    // Node's verifier says the same of the same change.
    expect(verifyReceipt({ ...RECEIPT, terms: { ...RECEIPT.terms, amount: "240.01" } }).checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["terms hash"]);
  });

  it("fails the same way with another IBAN, any other amount, and passes again once both are back", async () => {
    const data = dataOf(homePage());
    const iban = web.heroOtherIban(String(RECEIPT.terms.iban_last4));
    expect(iban).not.toBe(RECEIPT.terms.iban_last4);
    expect(iban).toMatch(/^\d{4}$/);
    const v = await web.heroCheck(data, { iban_last4: iban });
    expect([v.ok, v.failed]).toEqual([false, ["terms hash"]]);
    expect(v.now).toBe(sha(canonicalTerms({ ...RECEIPT.terms, iban_last4: iban })));
    for (const amount of ["239.99", "240", "240,00", "", "1.00"]) expect({ amount, ok: (await web.heroCheck(data, { amount })).ok }).toEqual({ amount, ok: false });
    expect((await web.heroCheck(data, { amount: String(RECEIPT.terms.amount), iban_last4: String(RECEIPT.terms.iban_last4) })).ok).toBe(true);
    expect(web.heroPlusCent("239.99")).toBe("240.00");
    expect(web.heroPlusCent("0.99")).toBe("1.00");
    expect(web.heroPlusCent("abc")).toBeNull();
  });
});

describe("the published receipt of the approval of 7 November (docs/runs/2026-11-07-awx-1/receipt-P-0002.json)", () => {
  const f = heroDemoFacts()!;
  const inv = rec.invoices.find((i) => i.invoice_no === f.invoice)!;
  it("is the one file the hero reads, and the sample that stood in for it is gone", () => {
    expect(HERO_RECEIPT_FILE).toBe("docs/runs/2026-11-07-awx-1/receipt-P-0002.json");
    expect(RECEIPT.verify).toBe(`npm run verify-receipt -- ${HERO_RECEIPT_FILE}`);
    expect(existsSync(new URL("../docs/demo/hero-receipt.json", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/cli/heroReceipt.ts", import.meta.url))).toBe(false);
    expect((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts["hero-receipt"]).toBeUndefined();
  });

  it("verifies with verifyReceipt, and is the recorded approval: its hash is the record's, which Airwallex's transfer carries", () => {
    const v = verifyReceipt(RECEIPT);
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.ok).toBe(true);
    expect([RECEIPT.terms.invoice_no, RECEIPT.terms.amount, RECEIPT.terms.currency, RECEIPT.terms.proposal_id]).toEqual([f.invoice, f.amount, "EUR", inv.proposal_id]);
    // The canonical terms hash to exactly the hash the record holds for this invoice (and the third proof row shows).
    expect(sha(canonicalTerms(RECEIPT.terms))).toBe(RECEIPT.terms_sha256);
    expect(RECEIPT.terms_sha256).toBe(f.hash);
    expect(RECEIPT.terms_sha256).toBe("b0f075d94da077084d7fc6745f99e2c2253548d967e9c0413bffa9748dbbf7bb");
    expect(RECEIPT.terms.transfer_request_id).toBe(inv.transfer_request_id);
    // The challenge the passkey signed is that hash, as WebAuthn defines it (base64url inside the client data).
    const client = JSON.parse(Buffer.from(RECEIPT.assertion.clientDataJSON, "base64url").toString("utf8")) as { type: string; challenge: string; origin: string };
    expect(client).toMatchObject({ type: "webauthn.get", challenge: Buffer.from(f.hash, "hex").toString("base64url"), origin: RECEIPT.origin });
    // Made by the passkey the record names for that approval.
    const decided = rec.proposals.find((p) => p.proposal_id === inv.proposal_id)!.decided_by;
    expect(RECEIPT.credential_id.startsWith(/passkey (\S+)\)/.exec(decided)![1]!)).toBe(true);
    expect(heroReceipt(f)).toMatchObject({ kind: "recorded", shown: { invoice: f.invoice, amount: f.amount, currency: "EUR", ibanLast4: RECEIPT.terms.iban_last4 } });
  });

  it("has the terms exactly as signed, shaped as Purser's code builds them (src/agents/euroBill.ts InvoicePaymentTerms)", () => {
    const t = RECEIPT.terms as Record<string, unknown>;
    expect(Object.keys(t)).toEqual(["schema", "kind", "proposal_id", "expires_at", "invoice_no", "vendor", "amount", "currency", "fee_max", "beneficiary_id", "beneficiary_name", "iban_last4", "bic", "method", "reference", "reason", "transfer_request_id", "conversion", "balances_before", "floors", "after", "evidence"]);
    expect([t.schema, t.kind, t.amount, t.currency, t.method, t.conversion]).toEqual(["kit11.approval-terms/v1", "invoice_payment", "240.00", "EUR", "SWIFT", null]);
    for (const k of ["proposal_id", "expires_at", "invoice_no", "vendor", "fee_max", "beneficiary_id", "beneficiary_name", "iban_last4", "bic", "reference", "reason", "transfer_request_id"]) expect({ k, type: typeof t[k] }).toEqual({ k, type: "string" });
    for (const k of ["balances_before", "floors", "after"]) for (const v of Object.values(t[k] as Record<string, unknown>)) expect(typeof v).toBe("string");
    expect(t.iban_last4).toMatch(/^\d{4}$/);
    const ev = t.evidence as { type: string; ref: string; sha256: string }[];
    expect(ev.map((e) => Object.keys(e))).toEqual([["type", "ref", "sha256"]]);
    // The evidence is the invoice file the 7 November run paid: the same document, hashed.
    expect(ev[0]).toEqual({ type: "invoice", ref: f.invoice, sha256: sha(read("fixtures/stockline-licence-SLL-2026-11.txt")) });
  });

  it("says what it is in its note: the run, live in the sandbox with test money, the owner's own passkey, Face ID as stated, no attestation", () => {
    for (const label of ["Airwallex-only run", "live, Airwallex sandbox, test money", "7 November 2026", `EUR ${f.amount}`, f.invoice, "the owner's own passkey on an iPhone", "Face ID, as stated by the owner", "the server checks no attestation", "The terms are exactly as signed."]) expect({ label, found: RECEIPT.note.includes(label) }).toEqual({ label, found: true });
    expect([RECEIPT.rp_id, RECEIPT.origin]).toEqual(["kit11.max-31b.workers.dev", "https://kit11.max-31b.workers.dev"]);
  });

  it("carries public data only: no private key", () => {
    expect(Object.keys(RECEIPT)).toEqual(["receipt", "note", "terms", "terms_sha256", "algorithm", "public_key", "credential_id", "rp_id", "origin", "assertion", "verified_by_server_at", "verify"]);
    expect(Object.keys(RECEIPT.public_key)).toEqual(["kty", "crv", "x", "y"]);
    expect(RAW).not.toMatch(/PRIVATE KEY|"d"\s*:|private/i);
    expect(RAW.endsWith("}\n")).toBe(true);
  });
});

describe("the hero follows the receipt file, not the code", () => {
  const f = heroDemoFacts()!;
  it("puts into the page's data only what the check needs", () => {
    const data = dataOf(homePage());
    expect(Object.keys(data)).toEqual([...HERO_DATA_KEYS]);
    expect(Object.keys(data)).toEqual(["receipt", "terms", "terms_sha256", "algorithm", "public_key", "rp_id", "origin", "assertion"]);
    expect(data.terms).toEqual(RECEIPT.terms);
    expect(Object.keys(data.assertion as object)).toEqual(["authenticatorData", "clientDataJSON", "signature"]);
    expect(JSON.stringify(data)).not.toContain(RECEIPT.credential_id);
  });

  it("is driven by another valid receipt of the same shape with no code change", async () => {
    const other = receiptFor();
    const html = homePage(undefined, { receipt: other });
    const data = dataOf(html);
    expect(data.terms).toEqual(other.terms);
    expect(html).toContain("Stockline Daten AG");
    expect(html).toContain("····7731");
    expect(html).not.toContain(String(RECEIPT.terms.iban_last4));
    // Step 4's hashes are the other receipt's. (The record's hash, which the published receipt shares, still shows in
    // steps 2 and 3 and in the third proof row: those come from the run record, not from the file.)
    const step4 = /<p class="hd-hashes">[\s\S]*?<\/p>/.exec(html)![0];
    expect(step4).toContain(`title="${other.terms_sha256}"`);
    expect(step4).not.toContain(RECEIPT.terms_sha256);
    const v = await web.heroCheck(data);
    expect(v).toMatchObject({ ok: true, signed: other.terms_sha256 });
    expect((await web.heroCheck(data, { amount: "240.01" })).failed).toEqual(["terms hash"]);
  });

  it("says what step 4 is from the file: the recorded approval itself, or a copy signed with a test key", () => {
    const real = heroReceipt(f)!;
    expect(real.kind).toBe("recorded");
    expect(heroProvenance(f, real)).toEqual([`Steps 1 to 3: recorded ${f.date} in the Airwallex sandbox.`, CAVEAT_LINE, "Step 4 checks that payment's real signature in your browser: the owner's own passkey, acting as the CFO (Face ID, as stated by the owner)."]);
    // A receipt whose hash is the one the record holds is the approval itself, whatever its note says.
    const plain = receiptFor({}, { note: "" });
    expect(heroReceipt({ ...f, hash: plain.terms_sha256 }, plain)!.kind).toBe("recorded");
    // Any other receipt must call itself a sample signed with a test key, and the page says so.
    const sample = heroReceipt(f, receiptFor())!;
    expect(sample.kind).toBe("sample");
    expect(heroProvenance(f, sample)[2]).toBe("Step 4 runs in your browser, on a copy of these terms signed with a test key.");
    expect(HERO_VERDICT).toEqual({ valid: "Signature valid for these exact terms", refused: "Hash no longer matches" });
  });

  it("is gone when the file is missing, invalid, disagrees with the record, or is neither the recorded approval nor a labelled sample", () => {
    const cases: [string, string | object][] = [
      ["missing", "docs/demo/no-such-receipt.json"],
      ["invalid signature", receiptFor({}, { breakSignature: true })],
      ["terms changed after signing", { ...RECEIPT, terms: { ...RECEIPT.terms, amount: "240.01" } }],
      ["another amount than the record's", receiptFor({ amount: "241.00" })],
      ["another invoice than the record's", receiptFor({ invoice_no: "SLL-2026-12" })],
      ["not the recorded approval and not labelled a sample", receiptFor({}, { note: "A receipt." })],
      ["labelled a sample but not as signed with a test key", receiptFor({}, { note: "A sample." })],
    ];
    for (const [name, source] of cases) {
      expect({ name, receipt: heroReceipt(f, source) }).toEqual({ name, receipt: null });
      const html = homePage(undefined, { receipt: source });
      expect({ name, hero: html.includes('id="hero-demo"'), data: html.includes('id="run-data"') }).toEqual({ name, hero: false, data: false });
    }
    expect(heroDemoHtml(null)).toBe("");
    expect(heroDemoHtml(f, null)).toBe("");
    // The committed file is none of these: the hero is on Home.
    expect(homePage()).toContain('id="hero-demo"');
  });
});
