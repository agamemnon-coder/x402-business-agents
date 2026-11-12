// npm run tokenize -- stand-in: the whole flow on the in-memory chain (src/tokenize/localChain.ts) with a *USDZ
// stand-in token and a labelled virtual test passkey: mint, finance at a discount, settle, verify, then five refusals.
// The same contract bytecode, the same locally signed transactions and the same requests as a live run (estimates
// included), with zero network. Loaded only by the stand-in command: it is the one place the CLI imports the chain.

import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { CHAIN_ID } from "../metal/network.js";
import { centsToBaseUnits, fromCents } from "../lib/money.js";
import { invoiceTokenCalls, standInTokenCalls, txClient } from "./client.js";
import { discountedPrice, financeToken, mintToken, settleToken, type Step } from "./flow.js";
import { usdzText } from "./live.js";
import { localChain } from "./localChain.js";
import { approvedInvoice, mintRecord, testnetFaceValue, verifyRecord } from "./record.js";
import { standInLedger, STAND_IN_PASSKEY_LABEL } from "./standIn.js";

export async function standInRun(say: (line: string) => void, o: { debtor?: string; divisor?: number; discountBps?: number } = {}): Promise<boolean> {
  const debtor = o.debtor ?? process.env.TOKENIZE_DEBTOR ?? "Northwind Outdoor";
  const divisor = o.divisor ?? Number(process.env.TOKENIZE_DIVISOR ?? "100");
  const discountBps = o.discountBps ?? Number(process.env.TOKENIZE_DISCOUNT_BPS ?? "200");
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
  const faceValue = testnetFaceValue(inv.amountCents, divisor);
  const salt = randomBytes(32);
  const record = mintRecord(inv, { document, creditor: creditor!.address, payer: payer!.address, salt, debtorName: debtor, faceValue });
  const { tokenId } = await mintToken(calls, issuer!, contract, creditor!.address, record, show);
  const price = discountedPrice(faceValue, discountBps);
  const b0 = await calls.balanceOf(settlement, creditor!.address);
  await financeToken(calls, { creditor: creditor!, financier: financier! }, contract, settlement, tokenId, price, show);
  const advance = (await calls.balanceOf(settlement, creditor!.address)) - b0;
  say(`FINANCE  face value ${usdzText(faceValue)}, price ${usdzText(price)} (${discountBps / 100}% discount): the creditor received ${usdzText(advance)}; holder is now the financier: ${(await calls.ownerOf(contract, tokenId)) === financier!.address}`);
  const f0 = await calls.balanceOf(settlement, financier!.address);
  await settleToken(calls, payer!, contract, settlement, tokenId, faceValue, show);
  say(`SETTLE   the holder (financier) received ${usdzText((await calls.balanceOf(settlement, financier!.address)) - f0)}; token burned`);
  const mismatches = verifyRecord(await calls.invoiceOf(contract, tokenId), mintRecord(inv, { document, creditor: creditor!.address, payer: payer!.address, salt, debtorName: debtor, faceValue }));
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
  try { mintRecord(inv, { document: document.replace("EUR 240.00", "EUR 2400.00"), creditor: creditor!.address, payer: payer!.address, salt, debtorName: debtor, faceValue }); } catch (e) { tampered = (e as Error).message; }
  say(`REFUSED  mint from a changed document: ${tampered || "NOT REFUSED"}`);
  const ok = mismatches.length === 0 && advance === price && refusals.every(Boolean) && unapproved.startsWith("not tokenized") && tampered.startsWith("not tokenized");
  say(`\nSTAND-IN ${ok ? "OK" : "FAILED"}: ${chain.calls.length} RPC requests on the in-memory chain`);
  return ok;
}
