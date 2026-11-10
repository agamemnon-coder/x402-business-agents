// npm run tokenize -- <command>: an invoice the CFO approved with a passkey becomes a token on Metal (prototype, test
// money). docs/tokenize.md.
//
//   stand-in   the whole flow on an in-memory EVM (ethereumjs) with a *USDZ stand-in: mint, finance, settle, verify,
//              and the refusals. Same contract bytecode and the same signed transactions as live; 0 network.
//   deploy     live: deploy PurserInvoiceToken with Purser's issuer key, settling in Metal's *USDZ
//   mint       live: check the ledger's passkey approval and the document, then mint the token to the creditor
//   finance    live: the creditor offers the token at a discount; the simulated financier pays and takes it
//   settle     live: the debtor's paying wallet pays the face value to the holder; the token is burned
//   verify     live (reads only): recompute the record from the ledger and the document and compare with the chain
//   facts      this run's own ledger as JSON; 0 calls
//
// Live commands need TOKENIZE_GO=yes, TOKENIZE_CALL_BUDGET, TOKENIZE_CALL_LOG, TOKENIZE_DB=…/tokenize*.sqlite and
// METAL_RPC_URL (src/tokenize/guard.ts). Keys are made in KIT11_KEYS_DIR (default ../x402-business-agents-keys/tokenize),
// outside the repo. Every transaction's hash is stored before it is sent.

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { localChain } from "../tokenize/localChain.js";
import { budgetedHttp, invoiceTokenCalls, standInTokenCalls, tokenIdOf, txClient, TxReverted, type OnChainInvoice } from "../tokenize/client.js";
import { approvedInvoice, mintRecord, MintRefused, testnetFaceValue, verifyRecord } from "../tokenize/record.js";
import { discountedPrice, financeToken, mintToken, settleToken, type Step } from "../tokenize/flow.js";
import { LIVE_COMMANDS, liveRefusals, type LiveCommand } from "../tokenize/guard.js";
import { CHAIN_ID, EXPLORER_TX, USDZ, rpcUrl } from "../metal/network.js";
import { redactSecrets } from "../lib/redact.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents } from "../lib/money.js";

const cmd = process.argv[2] ?? "stand-in";
const say = (s: string) => console.log(redactSecrets(s));
const usdz = (u: bigint) => fromCents(baseUnitsToCents(u - (u % centsToBaseUnits(1))));
const DEBTOR = process.env.TOKENIZE_DEBTOR ?? "Northwind Outdoor";
const DIVISOR = Number(process.env.TOKENIZE_DIVISOR ?? "100");
const DISCOUNT_BPS = Number(process.env.TOKENIZE_DISCOUNT_BPS ?? "200");

if (cmd === "stand-in") {
  // No live service is reachable from the stand-in: their settings are cleared and fetch refuses.
  for (const k of "AIRWALLEX_CLIENT_ID AIRWALLEX_API_KEY KIT11_ANTHROPIC_API_KEY ANTHROPIC_API_KEY METAL_RPC_URL T0_API_KEY".split(" ")) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`tokenize stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { standInLedger, STAND_IN_PASSKEY_LABEL } = await import("../tokenize/standIn.js");
  const chain = await localChain();
  const c = txClient({ request: chain.request, chainId: CHAIN_ID, sleep: async () => {} });
  const calls = invoiceTokenCalls(c);
  const [issuer, creditor, financier, payer, stranger] = Array.from({ length: 5 }, () => privateKeyToAccount(generatePrivateKey()));
  const usd = standInTokenCalls(c);
  const settlement = await usd.deploy(issuer!);
  await usd.mint(issuer!, settlement, financier!.address, centsToBaseUnits(10_000));
  await usd.mint(issuer!, settlement, payer!.address, centsToBaseUnits(10_000));
  const { address: contract } = await calls.deploy(issuer!, settlement);
  say(`IN-MEMORY CHAIN (ethereumjs, chain id ${CHAIN_ID}); *USDZ is a stand-in token here; the financier is simulated`);
  const show = (s: Step) => say(`  done     ${s.step}  ${s.hash.slice(0, 18)}…`);

  const { db, proposalId, document } = await standInLedger();
  const inv = approvedInvoice(db, proposalId);
  say(`LEDGER   ${proposalId} ${inv.invoiceNo} ${inv.currency} ${fromCents(inv.amountCents)}, approved by passkey (${STAND_IN_PASSKEY_LABEL}); terms ${inv.termsSha256.slice(0, 12)}…`);
  const faceValue = testnetFaceValue(inv.amountCents, DIVISOR);
  const salt = randomBytes(32);
  const record = mintRecord(inv, { document, creditor: creditor!.address, payer: payer!.address, salt, debtorName: DEBTOR, faceValue });
  const { tokenId } = await mintToken(calls, issuer!, contract, creditor!.address, record, show);
  const price = discountedPrice(faceValue, DISCOUNT_BPS);
  const b0 = await calls.balanceOf(settlement, creditor!.address);
  await financeToken(calls, { creditor: creditor!, financier: financier! }, contract, settlement, tokenId, price, show);
  const advance = (await calls.balanceOf(settlement, creditor!.address)) - b0;
  say(`FINANCE  face value ${usdz(faceValue)}, price ${usdz(price)} (${DISCOUNT_BPS / 100}% discount): the creditor received ${usdz(advance)}; holder is now the financier: ${(await calls.ownerOf(contract, tokenId)) === financier!.address}`);
  const f0 = await calls.balanceOf(settlement, financier!.address);
  await settleToken(calls, payer!, contract, settlement, tokenId, faceValue, show);
  say(`SETTLE   the holder (financier) received ${usdz((await calls.balanceOf(settlement, financier!.address)) - f0)}; token burned`);
  const mismatches = verifyRecord(await calls.invoiceOf(contract, tokenId), mintRecord(inv, { document, creditor: creditor!.address, payer: payer!.address, salt, debtorName: DEBTOR, faceValue }));
  say(`VERIFY   ${mismatches.length === 0 ? "the chain record matches the ledger and the document" : mismatches.join("; ")}`);

  const expectRefusal = async (what: string, from: Address, data: Hex, want: string) => {
    const got = await calls.simulate(from, contract, data);
    say(`REFUSED  ${what}: ${got ?? "NOT REFUSED"}`);
    return got === want;
  };
  const refusals = [
    await expectRefusal("settle a second time", payer!.address, calls.settleData(tokenId), "AlreadySettled"),
    await expectRefusal("mint the same invoice again", issuer!.address, calls.mintData(creditor!.address, record), "AlreadyTokenized"),
    await expectRefusal("mint by a key that is not Purser's issuer", stranger!.address, calls.mintData(stranger!.address, { ...record, documentHash: `0x${"11".repeat(32)}`, termsHash: `0x${"22".repeat(32)}` }), "NotIssuer"),
  ];
  let unapproved = "";
  try { const u = await standInLedger({ approve: false }); approvedInvoice(u.db, u.proposalId); } catch (e) { unapproved = (e as Error).message; }
  say(`REFUSED  mint an invoice nobody approved with a passkey: ${unapproved || "NOT REFUSED"}`);
  let tampered = "";
  try { mintRecord(inv, { document: document.replace("EUR 240.00", "EUR 2400.00"), creditor: creditor!.address, payer: payer!.address, salt, debtorName: DEBTOR, faceValue }); } catch (e) { tampered = (e as Error).message; }
  say(`REFUSED  mint from a changed document: ${tampered || "NOT REFUSED"}`);
  const ok = mismatches.length === 0 && advance === price && refusals.every(Boolean) && unapproved.startsWith("not tokenized") && tampered.startsWith("not tokenized");
  say(`\nSTAND-IN ${ok ? "OK" : "FAILED"}: ${chain.calls.length} RPC requests on the in-memory chain`);
  process.exitCode = ok ? 0 : 1;
} else if (cmd === "facts") {
  const path = process.env.TOKENIZE_DB;
  if (!path || !existsSync(path)) { console.error("TOKENIZE_DB names no ledger yet"); process.exit(2); }
  const db = new Database(path, { readonly: true });
  const state = Object.fromEntries((db.prepare("SELECT key, value FROM tokenize_state WHERE key != 'ref_salt'").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  console.log(JSON.stringify({ state, transactions: db.prepare("SELECT seq, step, hash, from_addr, status, at FROM tokenize_txs ORDER BY seq").all() }, null, 2));
} else if ((LIVE_COMMANDS as readonly string[]).includes(cmd)) {
  const why = liveRefusals(cmd as LiveCommand, process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const db = new Database(process.env.TOKENIZE_DB!);
  db.exec(`CREATE TABLE IF NOT EXISTS tokenize_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
           CREATE TABLE IF NOT EXISTS tokenize_txs (seq INTEGER PRIMARY KEY, step TEXT NOT NULL, hash TEXT NOT NULL, from_addr TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);`);
  const get = (k: string) => (db.prepare("SELECT value FROM tokenize_state WHERE key = ?").get(k) as { value: string } | undefined)?.value;
  const put = (k: string, v: string) => db.prepare("INSERT INTO tokenize_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
  const log = process.env.TOKENIZE_CALL_LOG!;
  const rpc = budgetedHttp(rpcUrl(), CHAIN_ID, Number(process.env.TOKENIZE_CALL_BUDGET), (m) => appendFileSync(log, `${new Date().toISOString()} ${cmd} ${m}\n`));
  const c = txClient({
    request: rpc.request, chainId: CHAIN_ID, polls: 6,
    onSigned: (label, hash, from) => { db.prepare("INSERT INTO tokenize_txs (step, hash, from_addr, status, at) VALUES (?, ?, ?, 'signed', ?)").run(label, hash, from, new Date().toISOString()); },
  });
  const settle = (hash: Hex, status: string) => db.prepare("UPDATE tokenize_txs SET status = ? WHERE hash = ?").run(status, hash);
  const calls = invoiceTokenCalls(c);
  const keysDir = resolve(process.env.KIT11_KEYS_DIR ?? resolve(import.meta.dirname, "../../../x402-business-agents-keys/tokenize"));
  if (keysDir.startsWith(resolve(import.meta.dirname, "../.."))) { console.error("KIT11_KEYS_DIR must be outside the code repo"); process.exit(2); }
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  const key = (role: string): PrivateKeyAccount => {
    const f = join(keysDir, `${role}.key.json`);
    if (!existsSync(f)) { const pk = generatePrivateKey(); writeFileSync(f, JSON.stringify({ address: privateKeyToAccount(pk).address, privateKey: pk }) + "\n", { mode: 0o600 }); }
    return privateKeyToAccount((JSON.parse(readFileSync(f, "utf8")) as { privateKey: Hex }).privateKey);
  };
  const issuer = key("issuer"), creditor = key("creditor"), financier = key("financier"), payer = key("payer");
  const show = (s: Step) => { settle(s.hash, "success"); say(`done     ${s.step}  ${EXPLORER_TX}${s.hash}`); };
  const contract = () => { const a = get("contract"); if (!a) { console.error("no contract yet: run deploy first"); process.exit(2); } return a as Address; };
  const recordNow = (): OnChainInvoice => {
    const src = new Database(process.env.TOKENIZE_SOURCE_DB!, { readonly: true, fileMustExist: true });
    const inv = approvedInvoice(src as never, process.env.TOKENIZE_PROPOSAL!);
    src.close();
    let salt = get("ref_salt");
    if (!salt) { salt = randomBytes(32).toString("hex"); put("ref_salt", salt); }
    const document = readFileSync(process.env.TOKENIZE_DOCUMENT!, "utf8");
    return mintRecord(inv, { document, creditor: creditor.address, payer: payer.address, salt: Buffer.from(salt, "hex"), debtorName: DEBTOR, faceValue: testnetFaceValue(inv.amountCents, DIVISOR) });
  };
  try {
    if (cmd === "deploy") {
      if (get("contract")) { console.error(`already deployed: ${get("contract")}; nothing is sent twice`); process.exit(2); }
      const { address, sent } = await calls.deploy(issuer, USDZ);
      settle(sent.hash, "success");
      put("contract", address);
      say(`DEPLOYED PurserInvoiceToken ${address}  ${EXPLORER_TX}${sent.hash}  (issuer ${issuer.address}, settles in *USDZ)`);
    } else if (cmd === "mint") {
      if (get("token_id")) { console.error(`already minted: token ${get("token_id")}; nothing is sent twice`); process.exit(2); }
      const record = recordNow();
      const refusal = await calls.simulate(issuer.address, contract(), calls.mintData(creditor.address, record));
      if (refusal) { console.error(`the chain would refuse the mint: ${refusal}; nothing sent`); process.exit(2); }
      const { tokenId } = await mintToken(calls, issuer, contract(), creditor.address, record, show);
      put("token_id", tokenId.toString());
      put("face_value", record.faceValue.toString());
      put("record", JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      say(`MINTED   token ${record.documentHash} to the creditor ${creditor.address}; face value ${usdz(record.faceValue)} *USDZ (test money, invoice amount ÷ ${DIVISOR})`);
    } else if (cmd === "finance") {
      if (get("financed")) { console.error("already financed; nothing is sent twice"); process.exit(2); }
      const tokenId = BigInt(get("token_id") ?? "0");
      if (!tokenId) { console.error("no token yet: run mint first"); process.exit(2); }
      const price = discountedPrice(BigInt(get("face_value")!), DISCOUNT_BPS);
      await financeToken(calls, { creditor, financier }, contract(), USDZ, tokenId, price, show);
      put("financed", price.toString());
      say(`FINANCED the simulated financier paid ${usdz(price)} *USDZ to the creditor and holds the token`);
    } else if (cmd === "settle") {
      if (get("settled")) { console.error("already settled; nothing is sent twice"); process.exit(2); }
      const tokenId = BigInt(get("token_id") ?? "0");
      if (!tokenId) { console.error("no token yet: run mint first"); process.exit(2); }
      const holder = await calls.ownerOf(contract(), tokenId);
      await settleToken(calls, payer, contract(), USDZ, tokenId, BigInt(get("face_value")!), show);
      put("settled", holder);
      say(`SETTLED  the debtor's wallet paid ${usdz(BigInt(get("face_value")!))} *USDZ to the holder ${holder}; token burned`);
    } else if (cmd === "verify") {
      const tokenId = BigInt(get("token_id") ?? "0");
      if (!tokenId) { console.error("no token yet: run mint first"); process.exit(2); }
      const mism = verifyRecord(await calls.invoiceOf(contract(), tokenId), recordNow());
      say(mism.length ? `MISMATCH ${mism.join("; ")}` : `VERIFIED token ${tokenIdOf(recordNow().documentHash) === tokenId ? "id = document hash; " : ""}the chain record matches the ledger and the document`);
      process.exitCode = mism.length ? 1 : 0;
    }
  } catch (e) {
    if (e instanceof TxReverted) settle(e.hash, "reverted");
    if (e instanceof MintRefused) { console.error(e.message); process.exit(2); }
    throw e;
  } finally {
    say(`(${rpc.used()} Metal RPC calls in this command)`);
  }
} else {
  console.error("usage: npm run tokenize -- stand-in | deploy | mint | finance | settle | verify | facts");
  process.exit(2);
}
