// The run record of a live invoice-token run (npm run tokenize -- record, src/tokenize/runRecord.ts) and the one block
// it puts on /metal (src/redesign/tokenizeRun.ts). The record is built from the run's own ledger, its call log and the
// source ledger, with no request; the block shows only when a record exists, and every number and link in it is read
// from that record. Both states of the page are held here: without a record it is byte for byte the page it was.
// The run recorded here ran on the in-memory chain (test/support/tokenizeWorld.ts); it is never written to docs/runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { metalPage } from "../src/redesign/partners.js";
import { agentRun } from "../src/redesign/run.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { showable, tokenizeRun, tokenizeRunBlock, tokenizeRunFile, tokenizeRunSentence, TOKENIZE_RUN_TITLE } from "../src/redesign/tokenizeRun.js";
import { METAL_PAGE } from "../src/servers/dashboard.js";
import { callLog } from "../src/tokenize/live.js";
import { ROLES } from "../src/tokenize/keys.js";
import { buildRunRecord, recordRefusals, runRecordMarkdown, writeRunRecord, type TokenizeRunRecord } from "../src/tokenize/runRecord.js";
import { EXPLORER_TX } from "../src/metal/network.js";
import { liveWorld, removeTokenizeWorlds, ROOT, sampleRunRecord } from "./support/tokenizeWorld.js";

const NOW = () => new Date("2026-11-12T10:00:00.000Z");
const HASH = /^0x[0-9a-f]{64}$/, ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** As test/site-v4.test.ts counts them: the words a person reads without opening anything, in <main>. */
function visibleWords(html: string): number {
  let main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? html;
  for (let prev = ""; prev !== main;) { prev = main; main = main.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  // Tag names in any case, and an end tag with spaces or attributes in it (</SCRIPT >), as a browser reads them.
  const text = main.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ")
    .replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ");
  return text.replace(/&amp;/g, "&").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
const textOf = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

let world: Awaited<ReturnType<typeof liveWorld>>;
let rec: TokenizeRunRecord;
let repo: string;
beforeAll(async () => {
  world = await liveWorld();
  await world.upTo();
  repo = join(world.dir, "repo");
  mkdirSync(join(repo, "docs/runs"), { recursive: true });
  rec = buildRunRecord({ env: world.env, now: NOW, repo });
}, 120_000);
afterAll(removeTokenizeWorlds); // the keys, ledgers and call logs made here

/** A day as the block writes it ("12 November"), from an ISO date or time. The run's own day is the day the test runs. */
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
/** " on 7 November" when the approval was on another day than the run, as the block's sentence has it. */
const onDay = (r: TokenizeRunRecord) => (r.invoice.approval.approved_at.slice(0, 10) === r.date ? "" : ` on ${day(r.invoice.approval.approved_at)}`);

describe("tokenize record: built from the run's ledger, its call log and the source ledger", () => {
  it("carries its labels, the invoice with the passkey that approved it, the amounts, the four roles and every transaction", () => {
    expect(rec.kind).toBe("tokenize-run");
    expect(rec.recorded_at).toBe("2026-11-12T10:00:00.000Z");
    expect(rec.labels).toEqual({ prototype: true, network: "Metal testnet", chain_id: 63825, test_money: true, financier: "simulated", face_value_scaled_by: 100 });
    // The day of the run's first transaction, from the ledger (not the day the record is written).
    expect(rec.date).toBe(world.txs()[0]!.at.slice(0, 10));
    // The invoice: the proposal, the hash of the signed terms, the passkey and the day of the approval, read from the source ledger.
    const src = new Database(world.source.file, { readonly: true });
    const p = src.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(world.source.proposalId) as { terms_sha256: string };
    const a = src.prepare("SELECT created_at FROM approvals WHERE proposal_id = ?").get(world.source.proposalId) as { created_at: string };
    const status = (src.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(world.source.proposalId) as { status: string }).status;
    expect(rec.invoice).toMatchObject({ proposal_id: world.source.proposalId, kind: "invoice_payment", invoice_no: "SLL-2026-11B", amount: "240.00", currency: "EUR", terms_sha256: p.terms_sha256, source_status: status });
    expect(rec.invoice.document_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.invoice.approval).toMatchObject({ method: "passkey", approved_at: a.created_at, test_passkey: true, passkey_label: "tokenize virtual test passkey (not a phone)", described_in: null });
    expect(rec.invoice.approval.passkey_fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    // Face value and scale, discount and price.
    expect(rec.face_value).toEqual({ amount: "2.40", unit: "*USDZ", divisor: 100 });
    expect(rec.discount).toEqual({ bps: 200, price: "2.35" });
    // The four role addresses, as the keys directory holds them.
    for (const r of ROLES) expect(rec.roles[r]).toBe(world.role(r).address);
    expect(rec.contract).toMatch(ADDRESS);
    expect(rec.token_id).toBe(`0x${rec.invoice.document_sha256}`);
    // Every transaction with its hash and its explorer link, in the order it was sent.
    expect(rec.transactions.map((t) => t.key)).toEqual(["fund-issuer", "fund-creditor", "fund-financier", "fund-payer", "deploy", "mint", "offer", "financier-approve", "accept", "payer-approve", "settle"]);
    expect(rec.transactions.map((t) => t.hash)).toEqual(world.chain.mined.slice(world.baseline));
    for (const t of rec.transactions) {
      expect(t.hash).toMatch(HASH);
      expect(t.explorer).toBe(`${EXPLORER_TX}${t.hash}`);
      expect(t).toMatchObject({ status: "success" });
      expect(Number(t.gas_used)).toBeGreaterThan(21_000);
      expect(BigInt(t.gas_limit)).toBeGreaterThanOrEqual(BigInt(t.gas_used!));
    }
    expect(rec.transactions.map((t) => t.sender)).toEqual(["donor", "donor", "donor", "donor", "issuer", "issuer", "creditor", "financier", "financier", "payer", "payer"]);
    expect(rec.transactions.map((t) => t.what).slice(4)).toEqual(["Deploy PurserInvoiceToken", "Mint to the creditor", "Offer to the financier", "Financier approves the price", "Financier accepts: advance to the creditor", "Debtor approves the face value", "Debtor settles: face value to the holder, token burned"]);
    // What each side received, from the contract's own events; the verify result.
    expect(rec.received).toEqual({ creditor: "2.35", creditor_address: world.role("creditor").address, holder: "2.40", holder_address: world.role("financier").address });
    expect(rec.verify).toMatchObject({ ok: true, mismatches: [], settled_on_chain: true });
    // Calls used against the budget, from the call log.
    const lines = callLog(world.env.TOKENIZE_CALL_LOG!).lines();
    expect(rec.calls).toEqual({ used: lines.length, budget_total: 200, by_command: { fund: 14, deploy: 4, mint: 4, finance: 10, settle: 6, verify: 1 } });
    expect(rec.deviations).toEqual({ from_ledger: [], notes: null });
    expect(rec.go).toBeNull();
  });

  it("holds no key, no signed bytes and no reference salt", () => {
    const json = JSON.stringify(rec);
    const ledger = new Database(world.env.TOKENIZE_DB!, { readonly: true });
    const salt = (ledger.prepare("SELECT value FROM tokenize_state WHERE key = 'ref_salt'").get() as { value: string }).value;
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(json).not.toContain(salt);
    for (const row of ledger.prepare("SELECT raw FROM tokenize_txs").all() as { raw: string }[]) expect(json).not.toContain(row.raw);
    for (const r of ROLES) expect(json).not.toContain((JSON.parse(readFileSync(join(world.env.KIT11_KEYS_DIR!, `${r}.key.json`), "utf8")) as { privateKey: string }).privateKey.slice(2));
    expect(json).not.toMatch(/privateKey|ref_salt|rpc\.invalid/);
  });

  it("writes docs/runs/<date>-tokenize.md and .json in the form of the run template, with links that resolve", () => {
    const out = writeRunRecord({ env: world.env, now: NOW, repo });
    expect(out.json).toBe(join(repo, "docs/runs", `${rec.date}-tokenize.json`));
    expect(out.md).toBe(join(repo, "docs/runs", `${rec.date}-tokenize.md`));
    expect(JSON.parse(readFileSync(out.json, "utf8"))).toEqual(rec);
    const md = readFileSync(out.md, "utf8");
    expect(md).toBe(runRecordMarkdown(rec));
    // The labels, first.
    expect(md.split("\n").slice(0, 4).join(" ")).toMatch(/^# Invoice token on Metal testnet \(prototype\): the run of \d{1,2} \w+ 20\d\d\s+\*\*Prototype\. Metal testnet \(chain id 63825\), test money only\. The financier is simulated\. The face value is the invoice amount divided by 100\.\*\*/);
    // The template's sections, in its order.
    const template = readFileSync(join(ROOT, "docs/tokenize-run-template.md"), "utf8");
    const heads = (s: string) => [...s.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads(md)).toEqual(heads(template));
    // Before the run.
    expect(md).toContain(`- **Call budget:** 200 Metal RPC calls for the whole run (\`TOKENIZE_CALL_BUDGET_TOTAL\`)`);
    expect(md).toContain(`proposal \`${rec.invoice.proposal_id}\` (invoice_payment), invoice \`SLL-2026-11B\`, EUR 240.00`);
    expect(md).toContain(`signed terms SHA-256 \`${rec.invoice.terms_sha256}\``);
    expect(md).toContain(`by passkey \`${rec.invoice.approval.passkey_fingerprint}\`: a labelled test passkey ("tokenize virtual test passkey (not a phone)"), not a phone. Read from the source ledger.`);
    expect(md).toContain("- **Face value:** EUR 240.00 ÷ 100 = 2.40 *USDZ (test money, no exchange rate)");
    expect(md).toContain("- **Discount:** 2% (200 basis points): the simulated financier's price is 2.35 *USDZ");
    for (const r of ROLES) expect(md).toContain(`\`${rec.roles[r]}\``);
    // No go note was given: the record says what the files hold (the variable was set), and claims no person's go.
    expect(md).toContain("- **Max's go:** not given to this record. `TOKENIZE_GO=yes` was set on every live command (each refuses without it); who gave the go, and when, is not in the run's files.");
    expect(md).not.toMatch(/go:\*\* given/);
    // The proposal's status in the source ledger, as it stands there.
    expect(md).toContain(`  - status \`${rec.invoice.source_status}\` in the source ledger: ${rec.invoice.source_status === "EXECUTED" ? "the payment this approval was given for was already carried out there" : "the approval stands there; this run uses it to show the token path"}`);
    // The transactions: one row each, with the hash linked to the explorer.
    for (const t of rec.transactions) expect(md).toContain(`| ${t.what} | [\`${t.hash}\`](${EXPLORER_TX}${t.hash}) | success, block `);
    expect(md.match(/^\| .* \| \[`0x/gm)).toHaveLength(11);
    // Checks.
    expect(md).toMatch(/- `verify`: yes, the chain record matches the ledger and the document \(\d{4}-\d\d-\d\d \d\d:\d\d UTC\); the chain marks the invoice settled\./);
    expect(md).toContain(`received 2.35 *USDZ (the contract's Financed event), and the holder \`${rec.received.holder_address}\` (the simulated financier) received 2.40 *USDZ at settlement (the contract's Settled event).`);
    expect(md).toContain(`- Calls used: ${rec.calls.used} of 200 (from \`TOKENIZE_CALL_LOG\`): fund 14, deploy 4, mint 4, finance 10, settle 6, verify 1.`);
    expect(md).toMatch(/## What did not go as planned\n\nNothing in the ledger: every recorded transaction succeeded\. No notes were given to this record\.\n$/);
    // Every relative link points at a file that exists (the JSON beside it; the rest in the repository's docs).
    const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!).filter((l) => !/^https?:/.test(l));
    expect(links.sort()).toEqual(["../tokenize.md", `${rec.date}-tokenize.json`]);
    expect(existsSync(resolve(ROOT, "docs/runs", "../tokenize.md"))).toBe(true);
    expect(existsSync(resolve(dirname(out.md), `${rec.date}-tokenize.json`))).toBe(true);
    // No word the public pages may not carry, and no gendered pronoun.
    expect(md).not.toMatch(/stand-in|\b(he|she|his|her)\b/i);
  });

  it("takes Max's go, the deviations and the earlier record of the approval from the operator, and says so when a transaction did not succeed", () => {
    const notes = join(world.dir, "deviations.txt");
    writeFileSync(notes, "The first deploy stopped at its budget of 3 calls; run again with 6.\n");
    const withNotes = buildRunRecord({ env: { ...world.env, TOKENIZE_DEVIATIONS: notes, TOKENIZE_GO_NOTE: " 12 Nov 11:02 CET, \"go for tokenize\" " }, now: NOW, repo });
    expect(withNotes.go).toBe("12 Nov 11:02 CET, \"go for tokenize\"");
    expect(withNotes.deviations.notes).toBe("The first deploy stopped at its budget of 3 calls; run again with 6.");
    const md = runRecordMarkdown(withNotes);
    expect(md).toContain("- **Max's go:** 12 Nov 11:02 CET, \"go for tokenize\"");
    expect(md).toMatch(/## What did not go as planned\n\n\nThe first deploy stopped at its budget of 3 calls; run again with 6\.\n$/);

    // A person's passkey (not labelled a test passkey): its label stays out; an earlier record that names it is linked.
    const person = join(world.dir, "person.sqlite");
    writeFileSync(person, readFileSync(world.source.file));
    new Database(person).prepare("UPDATE passkeys SET label = 'cfo'").run();
    const earlier = join(repo, "docs/runs/earlier-run.md");
    writeFileSync(earlier, `Approved with Face ID; passkey ${rec.invoice.approval.passkey_fingerprint}.\n`);
    const real = buildRunRecord({ env: { ...world.env, TOKENIZE_SOURCE_DB: person, TOKENIZE_APPROVAL_RECORD: earlier }, now: NOW, repo });
    expect(real.invoice.approval).toMatchObject({ test_passkey: false, passkey_label: null, described_in: "docs/runs/earlier-run.md" });
    expect(runRecordMarkdown(real)).toContain(`by passkey \`${rec.invoice.approval.passkey_fingerprint}\`: not a labelled test passkey; who approved, and on what device, is in [docs/runs/earlier-run.md](earlier-run.md). Read from the source ledger.`);
    // "test" or "virtual" as a whole word marks a test passkey; "latest phone" does not.
    new Database(person).prepare("UPDATE passkeys SET label = 'latest phone'").run();
    expect(buildRunRecord({ env: { ...world.env, TOKENIZE_SOURCE_DB: person }, now: NOW, repo }).invoice.approval).toMatchObject({ test_passkey: false, passkey_label: null, described_in: null });
    // A proposal the source run already carried out (as P-0002 of the 7 November run was): the record says the invoice
    // was paid there, and that the token run's settlement is not that payment.
    const paid = join(world.dir, "paid.sqlite");
    writeFileSync(paid, readFileSync(world.source.file));
    new Database(paid).prepare("UPDATE proposals SET status = 'EXECUTED'").run();
    const reused = buildRunRecord({ env: { ...world.env, TOKENIZE_SOURCE_DB: paid }, now: NOW, repo });
    expect(reused.invoice.source_status).toBe("EXECUTED");
    expect(runRecordMarkdown(reused)).toContain("  - status `EXECUTED` in the source ledger: the payment this approval was given for was already carried out there. This run reuses the approval to show the token path; its settlement in test money is not the invoice's payment.");
    writeFileSync(earlier, "Another passkey: 0000-0000-0000-0000.\n");
    expect(() => buildRunRecord({ env: { ...world.env, TOKENIZE_SOURCE_DB: person, TOKENIZE_APPROVAL_RECORD: earlier }, now: NOW, repo })).toThrow(/does not name the passkey that approved this invoice/);

    // A transaction that reverted, and one without a receipt: the record says so itself.
    const copy = join(world.dir, "tokenize-copy.sqlite");
    writeFileSync(copy, readFileSync(world.env.TOKENIZE_DB!));
    const db = new Database(copy);
    db.prepare("UPDATE tokenize_txs SET status = 'reverted' WHERE key = 'accept'").run();
    db.prepare("UPDATE tokenize_txs SET status = 'signed', receipt_json = NULL WHERE key = 'settle'").run();
    db.close();
    const rough = buildRunRecord({ env: { ...world.env, TOKENIZE_DB: copy }, now: NOW, repo });
    const accept = rough.transactions.find((t) => t.key === "accept")!, settle = rough.transactions.find((t) => t.key === "settle")!;
    expect(rough.deviations.from_ledger).toEqual([
      `Financier accepts: advance to the creditor: transaction ${accept.hash} reverted on chain.`,
      `Debtor settles: face value to the holder, token burned: transaction ${settle.hash} was signed and recorded, and has no receipt in the ledger.`,
    ]);
    const roughMd = runRecordMarkdown(rough);
    expect(roughMd).toContain(`| Financier accepts: advance to the creditor | [\`${accept.hash}\`](${EXPLORER_TX}${accept.hash}) | reverted on chain`);
    expect(roughMd).toContain(`| [\`${settle.hash}\`](${EXPLORER_TX}${settle.hash}) | signed, no receipt recorded |`);
    expect(roughMd).toContain(`- Financier accepts: advance to the creditor: transaction ${accept.hash} reverted on chain.`);
  });

  it("refuses to record nothing, another invoice, or without its files; and records only what ran", async () => {
    expect(recordRefusals({}).join("\n")).toMatch(/TOKENIZE_DB[\s\S]*TOKENIZE_CALL_LOG[\s\S]*TOKENIZE_SOURCE_DB[\s\S]*TOKENIZE_PROPOSAL/);
    expect(recordRefusals(world.env)).toEqual([]);
    expect(recordRefusals({ ...world.env, TOKENIZE_DEVIATIONS: join(world.dir, "no-such.txt") })).toEqual(["TOKENIZE_DEVIATIONS names no file"]);
    // A run that only got as far as the mint: the record says what was not sent, and claims nothing more.
    const w = await liveWorld();
    await w.upTo("finance");
    const part = buildRunRecord({ env: w.env, now: NOW, repo });
    expect(part.transactions.map((t) => t.key)).toEqual(["fund-issuer", "fund-creditor", "fund-financier", "fund-payer", "deploy", "mint"]);
    expect(part).toMatchObject({ discount: null, verify: null, received: { creditor: null, holder: null } });
    const md = runRecordMarkdown(part);
    for (const what of ["Offer to the financier", "Financier approves the price", "Financier accepts: advance to the creditor", "Debtor approves the face value", "Debtor settles: face value to the holder, token burned"]) expect(md).toContain(`| ${what} | not sent | |`);
    expect(md).toContain("- `verify`: not run.");
    expect(md).toContain("- The token was not financed; it was not settled.");
    expect(md).toContain("- **Discount:** the token was not offered");
    // Before anything was sent there is nothing to record.
    const fresh = await liveWorld();
    await fresh.run("preflight");
    expect(() => buildRunRecord({ env: fresh.env, now: NOW, repo })).toThrow(/holds no transaction: nothing ran/);
    // Another call log than the one the run's ledger counted against, or a shorter one: it would under-report the calls.
    expect(() => buildRunRecord({ env: { ...w.env, TOKENIZE_CALL_LOG: world.env.TOKENIZE_CALL_LOG }, now: NOW, repo })).toThrow(/TOKENIZE_CALL_LOG names another file than the call log this run's ledger started with/);
    const whole = readFileSync(w.env.TOKENIZE_CALL_LOG!, "utf8");
    writeFileSync(w.env.TOKENIZE_CALL_LOG!, whole.split("\n").slice(0, 5).join("\n") + "\n");
    expect(() => buildRunRecord({ env: w.env, now: NOW, repo })).toThrow(/TOKENIZE_CALL_LOG holds 5 calls and this run's ledger counted 22: it is not this run's whole call log/);
    writeFileSync(w.env.TOKENIZE_CALL_LOG!, whole);
    // Another proposal than the one this ledger minted.
    const other = join(world.dir, "other.sqlite");
    writeFileSync(other, readFileSync(world.source.file));
    const odb = new Database(other);
    odb.pragma("foreign_keys = OFF");
    for (const t of ["proposals", "approvals", "passkey_assertions"]) odb.prepare(`UPDATE ${t} SET proposal_id = 'P-0009' WHERE proposal_id = ?`).run(world.source.proposalId);
    expect(() => buildRunRecord({ env: { ...world.env, TOKENIZE_SOURCE_DB: other, TOKENIZE_PROPOSAL: "P-0009" }, now: NOW, repo })).toThrow(/do not hash to its terms hash|not the one this run's ledger minted/);
  }, 120_000);
});

describe("/metal: the invoice-token block, only with a run record", () => {
  const run = agentRun();
  const FILE = "docs/runs/2026-11-12-tokenize.json";
  /** The run of 12 November as the record of a person's approval on 7 November would have it, with the earlier record linked. */
  const person = (): TokenizeRunRecord => ({ ...rec, date: "2026-11-12", invoice: { ...rec.invoice, approval: { ...rec.invoice.approval, approved_at: "2026-11-07T12:12:20.000Z", test_passkey: false, passkey_label: null, described_in: "docs/runs/2026-11-07-awx-1.md" } } });
  const withRecord = () => metalPage(run, { file: FILE, rec });
  const without = () => metalPage(run, null);

  it("without a record the page is unchanged, byte for byte, and says nothing about a token", () => {
    expect(without()).not.toMatch(/Invoice token|invoice-token|tokeniz/i);
    expect(tokenizeRunBlock(null)).toBe("");
    // The page with the block, less the block, is the page without it: the block is the only difference.
    const block = tokenizeRunBlock({ file: FILE, rec });
    expect(withRecord().split(block)).toHaveLength(2);
    expect(withRecord().replace(`\n  ${block}`, "")).toBe(without());
    // The stylesheet is the same one: the block brings no style of its own.
    const style = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1];
    expect(style(withRecord())).toBe(style(without()));
    // No record is committed until a live run is recorded: the page the site serves is the one without.
    if (!tokenizeRunFile()) { expect(tokenizeRun()).toBeNull(); expect(METAL_PAGE).toBe(without()); }
    else expect(METAL_PAGE).toBe(metalPage(run, tokenizeRun()));
    // 275 without the block since the jury panel of 12 Nov (the four mandates in one table; test/site-v4.test.ts). +50, 12 Nov wire-in: "Face ID signs on chain".
    expect(visibleWords(without())).toBeLessThanOrEqual(445); // +15, the final review 13 Nov (FACEID_SEPARATE_RUN, the recorded snapshot); +95 (owner's redesign, 13 Nov: one picture of a paid and a refused payment, three charts with their direct labels, four mandate cards and the replace in three steps; the table of the four mandates moved into a fold); +5, jury check 12 Nov: "Since 12 Nov it does"; +5, jury 13 Nov: "the cap at the time" (333 as built)
  });

  it("with a record it shows one short block: the title, one sentence from the record, the verify badge, and the transactions folded", () => {
    const html = withRecord();
    expect(html.split(TOKENIZE_RUN_TITLE)).toHaveLength(2);
    const block = tokenizeRunBlock({ file: FILE, rec });
    expect(textOf(block)).toBe(`Prototype Invoice token (prototype) ${day(rec.date)}, a separate Metal testnet run. An invoice approved with a labelled test passkey${onDay(rec)} became a token. A simulated financier bought it for 2.35 test USD; the debtor paid its holder 2.40. Amounts are scaled down 100× for testnet. Chain record verified 7 transactions ${rec.transactions.slice(4).map((t) => `${t.what} ${t.hash.slice(0, 6)}…${t.hash.slice(-4)} ↗`).join(" ")} Prototype · test money · ${rec.calls.used} requests to Metal testnet of a budget of 200 · run record ↗`);
    // One word for the paying party, in sight and in the fold: the debtor.
    expect(textOf(block)).not.toMatch(/\bpayer\b|RPC/);
    // It sits after the main run's proof, before the link to all the proof.
    expect(html.indexOf('<div class="folds card">')).toBeLessThan(html.indexOf('id="invoice-token"'));
    expect(html.indexOf('id="invoice-token"')).toBeLessThan(html.indexOf(">All the proof "));
    // Short: at most 50 words in sight, and the page within its budget with the block (325; 275 without, since the jury
    // panel of 12 Nov; +50 each, 12 Nov wire-in: "Face ID signs on chain", 49 words as built).
    // 55 since 12 Nov (review): "Amounts are scaled down 100× for testnet" says it in plain words (2 more).
    expect(visibleWords(html) - visibleWords(without())).toBeLessThanOrEqual(55);
    expect(visibleWords(html)).toBeLessThanOrEqual(495); // +15, the final review 13 Nov (FACEID_SEPARATE_RUN, the recorded snapshot); +95 (owner's redesign, 13 Nov: one picture of a paid and a refused payment, three charts with their direct labels, four mandate cards and the replace in three steps; the table of the four mandates moved into a fold); +5, jury 13 Nov: "the cap at the time"
    // The longest form of the block (a person's approval on an earlier day, named) stays within both budgets too.
    const longest = metalPage(run, { file: FILE, rec: person() });
    expect(visibleWords(longest) - visibleWords(without())).toBeLessThanOrEqual(55); // 55 since 12 Nov (review): the scaling said in plain words
    expect(visibleWords(longest)).toBeLessThanOrEqual(500); // +15, the final review 13 Nov (FACEID_SEPARATE_RUN, the recorded snapshot); +95 (owner's redesign, 13 Nov: one picture of a paid and a refused payment, three charts with their direct labels, four mandate cards and the replace in three steps; the table of the four mandates moved into a fold); +5, 12 Nov review: the scaling in plain words
    // Every label a public mention of the run carries.
    const sight = textOf(block.replace(/<details[\s\S]*<\/details>/, ""));
    for (const label of [/\(prototype\)/, /Metal testnet/, /simulated financier/, /Amounts are scaled down 100× for testnet/, /test USD/, /a separate Metal testnet run/]) expect(sight).toMatch(label);
    // One design system: only classes the partner pages already style.
    const classes = new Set([...block.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(" ")));
    expect([...classes].sort()).toEqual(["awc", "awm", "awrb", "card", "fold", "i", "ok", "pf", "src", "vh"]);
    // No heading skips a level: the page's h1, a hidden h2, then the block's h3.
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels.filter((l, i) => i > 0 && l > levels[i - 1]! + 1)).toEqual([]);
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    for (const c of classes) expect({ c, styled: new RegExp(`\\.${c}(?![\\w-])`).test(css) }).toEqual({ c, styled: true });
    expect(block).not.toMatch(/style=|<script|<img/);
  });

  it("reads every number and every link from the record", () => {
    const block = tokenizeRunBlock({ file: FILE, rec });
    // Links: each transaction's explorer link as the record has it, and the run record on GitHub; nothing else.
    const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([...rec.transactions.slice(4).map((t) => t.explorer), `${REPO_BLOB}docs/runs/2026-11-12-tokenize.md`]);
    for (const h of hrefs.slice(0, -1)) expect(h).toMatch(/^https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/);
    // Numbers: change them in the record and the block changes with them; none is written in the page's code.
    const other: TokenizeRunRecord = { ...rec, date: "2026-12-03", labels: { ...rec.labels, face_value_scaled_by: 50 }, received: { ...rec.received, creditor: "4.70", holder: "4.80" }, calls: { ...rec.calls, used: 41, budget_total: 45 } };
    const changed = textOf(tokenizeRunBlock({ file: "docs/runs/2026-12-03-tokenize.json", rec: other }));
    expect(changed).toContain("3 December, a separate Metal testnet run.");
    expect(changed).toContain("bought it for 4.70 test USD; the debtor paid its holder 4.80. Amounts are scaled down 50× for testnet.");
    expect(changed).toContain("41 requests to Metal testnet of a budget of 45");
    expect(changed).not.toMatch(/2\.35|2\.40|scaled down 100×/);
    expect(changed).not.toContain(`${day(rec.date)}, a separate`);
    // Every figure in sight is one of the record's.
    const sight = textOf(block.replace(/<details[\s\S]*<\/details>/, ""));
    const known = new Set([String(Number(rec.date.slice(8, 10))), String(Number(rec.invoice.approval.approved_at.slice(8, 10))), rec.received.creditor!, rec.received.holder!, String(rec.labels.face_value_scaled_by)]);
    for (const n of sight.match(/\d+(?:\.\d+)?/g) ?? []) expect({ n, fromRecord: known.has(n) }).toEqual({ n, fromRecord: true });
    expect(textOf(block)).toContain(`verified ${rec.transactions.filter((t) => !t.key.startsWith("fund-")).length} transactions`);
  });

  it("follows what the record says ran, and shows nothing for a record it may not show", () => {
    const drop = (keys: string[]): TokenizeRunRecord => ({ ...rec, transactions: rec.transactions.filter((t) => !keys.includes(t.key)) });
    const unsettled: TokenizeRunRecord = { ...drop(["payer-approve", "settle"]), received: { ...rec.received, holder: null, holder_address: null }, verify: null };
    const start = `${day(rec.date)}, a separate Metal testnet run. An invoice approved with a labelled test passkey${onDay(rec)} became a token.`;
    expect(tokenizeRunSentence(unsettled)).toBe(`${start} A simulated financier bought it for 2.35 test USD. Amounts are scaled down 100× for testnet.`);
    expect(tokenizeRunBlock({ file: FILE, rec: unsettled })).not.toContain("Chain record verified");
    const mintedOnly: TokenizeRunRecord = { ...drop(["offer", "financier-approve", "accept", "payer-approve", "settle"]), received: { creditor: null, creditor_address: null, holder: null, holder_address: null }, verify: null };
    expect(tokenizeRunSentence(mintedOnly)).toBe(`${start} Its face value is 2.40 test USD. Amounts are scaled down 100× for testnet.`);
    expect(textOf(tokenizeRunBlock({ file: FILE, rec: mintedOnly }))).toContain(" 2 transactions ");
    // Settled without a financier: the debtor paid the holder.
    const direct: TokenizeRunRecord = { ...drop(["offer", "financier-approve", "accept"]), received: { ...rec.received, creditor: null, creditor_address: null } };
    expect(tokenizeRunSentence(direct)).toBe(`${start} The debtor paid its holder 2.40 test USD. Amounts are scaled down 100× for testnet.`);
    // "The CFO approved" only when the record links a committed run record that names the approving passkey; the
    // approval's own day is named when it is not the day of the run.
    expect(tokenizeRunSentence(person())).toBe("12 November, a separate Metal testnet run. An invoice the CFO approved with a passkey on 7 November became a token. A simulated financier bought it for 2.35 test USD; the debtor paid its holder 2.40. Amounts are scaled down 100× for testnet.");
    // A passkey with no test label and no such record proves no person: neutral words.
    const unnamed: TokenizeRunRecord = { ...person(), invoice: { ...person().invoice, approval: { ...person().invoice.approval, described_in: null } } };
    expect(tokenizeRunSentence(unnamed)).toContain("An invoice approved with a passkey on 7 November became a token.");
    expect(tokenizeRunSentence(unnamed)).not.toMatch(/CFO/);
    // Approved on the day of the run: no second date.
    const sameDay: TokenizeRunRecord = { ...person(), date: "2026-11-07" };
    expect(tokenizeRunSentence(sameDay)).toContain("7 November, a separate Metal testnet run. An invoice the CFO approved with a passkey became a token.");
    // A failed verify gets no badge.
    expect(tokenizeRunBlock({ file: FILE, rec: { ...rec, verify: { ...rec.verify!, ok: false } } })).not.toContain("Chain record verified");
    // Not showable: no mint, a mint that did not land, a label missing, or a link that is not Metal's explorer.
    expect(showable(rec)).toBe(true);
    expect(showable(drop(["mint"]))).toBe(false);
    expect(showable({ ...rec, transactions: rec.transactions.map((t) => (t.key === "mint" ? { ...t, status: "reverted" as const } : t)) })).toBe(false);
    expect(showable({ ...rec, labels: { ...rec.labels, prototype: false as unknown as true } })).toBe(false);
    expect(showable({ ...rec, labels: { ...rec.labels, financier: "real" as unknown as "simulated" } })).toBe(false);
    expect(showable({ ...rec, transactions: rec.transactions.map((t) => (t.key === "mint" ? { ...t, explorer: `https://testnet.metalntwx.com.evil.test/tx/${t.hash}` } : t)) })).toBe(false);
    // A look-alike link on another transaction is left out, never linked.
    const odd = tokenizeRunBlock({ file: FILE, rec: { ...rec, transactions: rec.transactions.map((t) => (t.key === "offer" ? { ...t, explorer: `https://evil.test/tx/${t.hash}` } : t)) } });
    expect(odd).not.toContain("evil.test");
    expect(textOf(odd)).toContain(" 6 transactions ");
    expect(textOf(tokenizeRunBlock({ file: FILE, rec: { ...rec, transactions: rec.transactions.filter((t) => t.key === "mint") } }))).toContain(" 1 transaction ");
  });

  it("finds the newest record by its name, and nothing else in docs/runs", () => {
    expect(tokenizeRunFile(["2026-11-10-metal-extra.md", "passkey-owners.json", "README.md"])).toBeNull();
    expect(tokenizeRunFile(["2026-11-12-tokenize.md", "2026-11-12-tokenize.json", "2026-11-13-tokenize.json", "x-2026-11-14-tokenize.json", "2026-11-12-tokenize.json.bak"])).toBe("docs/runs/2026-11-13-tokenize.json");
  });

  it("the docs say nothing has run live exactly as long as no run record is committed", () => {
    const file = tokenizeRunFile();
    const doc = readFileSync(join(ROOT, "docs/tokenize.md"), "utf8"), runbook = readFileSync(join(ROOT, "docs/runs/driver/tokenize-runbook.md"), "utf8");
    // Without a record both say so; once a record is committed, the same commit must change both to point at it.
    expect({ record: file, docSaysNothingRan: /Nothing has run on Metal testnet yet/.test(doc) }).toEqual({ record: file, docSaysNothingRan: file === null });
    expect({ record: file, runbookSaysNothingRan: /Nothing here has run live yet/.test(runbook) }).toEqual({ record: file, runbookSaysNothingRan: file === null });
    if (file) {
      const md = file.replace(/^docs\//, "").replace(/\.json$/, ".md");
      expect(doc).toContain(`](${md})`);
      expect(runbook).toContain(`](../${md.replace(/^runs\//, "")})`);
    }
  });

  it("the sample record the browser check shows is made by the same code", async () => {
    const s = await sampleRunRecord();
    expect(s.file).toMatch(/^docs\/runs\/\d{4}-\d\d-\d\d-tokenize\.json$/);
    expect(showable(s.record)).toBe(true);
    expect(Object.keys(s.record).sort()).toEqual(Object.keys(rec).sort());
  }, 60_000);
});
