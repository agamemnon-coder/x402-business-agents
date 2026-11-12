// Invoice tokenization (docs/tokenize.md): the contract compiles to the committed artifact, and on an in-memory EVM
// (the same signed transactions a live run sends) mint, finance, settle and verify behave, and every refusal holds.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { encodeDeployData, parseTransaction, stringToHex, toHex, type Hex } from "viem";
import { compileContract, loadContract } from "../src/tokenize/compile.js";
import { intrinsicGas, localChain, type LocalChain } from "../src/tokenize/localChain.js";
import { budgeted, BudgetReached, ESTIMATE_MARGIN, GAS, invoiceTokenCalls, standInTokenCalls, tokenIdOf, txClient, TxReverted, WouldRevert, type OnChainInvoice } from "../src/tokenize/client.js";
import { approvedInvoice, dueDateFromDocument, mintRecord, MintRefused, partyRef, sha256Bytes, testnetFaceValue, verifyRecord, type ApprovedInvoice } from "../src/tokenize/record.js";
import { discountedPrice, financeToken, mintToken, settleToken } from "../src/tokenize/flow.js";
import { liveRefusals } from "../src/tokenize/guard.js";
import { standInLedger } from "../src/tokenize/standIn.js";
import { centsToBaseUnits } from "../src/lib/money.js";
import { CHAIN_ID } from "../src/metal/network.js";

const acct = () => privateKeyToAccount(generatePrivateKey());

async function world(o: { estimate?: boolean } = {}) {
  const chain = await localChain();
  const c = txClient({ request: chain.request, chainId: CHAIN_ID, sleep: async () => {}, ...o });
  const calls = invoiceTokenCalls(c);
  const [issuer, creditor, financier, payer, stranger] = [acct(), acct(), acct(), acct(), acct()] as PrivateKeyAccount[];
  const usd = standInTokenCalls(c);
  const settlement = await usd.deploy(issuer!);
  for (const who of [financier!, payer!, stranger!]) await usd.mint(issuer!, settlement, who.address, centsToBaseUnits(10_000));
  const { address: contract } = await calls.deploy(issuer!, settlement);
  return { chain, c, calls, issuer: issuer!, creditor: creditor!, financier: financier!, payer: payer!, stranger: stranger!, settlement, contract };
}

describe("PurserInvoiceToken contract", () => {
  it("compiles from its source to the committed bytecode (and the in-memory *USDZ stand-in too)", () => {
    for (const n of ["PurserInvoiceToken", "TestUsdStandIn"] as const) {
      const fresh = compileContract(n);
      const committed = loadContract(n);
      expect(committed.source_sha256).toBe(createHash("sha256").update(readFileSync(new URL(`../contracts/${n}.sol`, import.meta.url), "utf8")).digest("hex"));
      expect(fresh.bytecode).toBe(committed.bytecode);
      expect(committed.compiler).toMatch(/^solc 0\.8\.36\+/);
      expect(committed.openzeppelin).toBe("5.6.1");
    }
  }, 120_000);

  it("has only the token's own ways to move value: mint (issuer), offer/accept, settle (payer), and ERC-721 transfers", () => {
    const fns = loadContract("PurserInvoiceToken").abi
      .filter((x) => x.type === "function" && !["view", "pure"].includes((x as { stateMutability: string }).stateMutability))
      .map((x) => (x as { name: string }).name).sort();
    expect(fns).toEqual(["acceptFinancing", "approve", "mint", "offerFinancing", "safeTransferFrom", "safeTransferFrom", "setApprovalForAll", "settle", "transferFrom"]);
  });
});

describe("tokenize: ledger checks before a mint", () => {
  let approved: { db: Awaited<ReturnType<typeof standInLedger>>["db"]; proposalId: string; document: string };
  beforeAll(async () => { approved = await standInLedger(); }, 60_000);

  it("refuses an invoice nobody approved, and one approved by any method but a passkey", async () => {
    const none = await standInLedger({ approve: false });
    expect(() => approvedInvoice(none.db, none.proposalId)).toThrow(MintRefused);
    expect(() => approvedInvoice(none.db, none.proposalId)).toThrow(/has no approval/);
    const cli = await standInLedger();
    cli.db.prepare("UPDATE approvals SET method = 'cli' WHERE proposal_id = ?").run(cli.proposalId);
    expect(() => approvedInvoice(cli.db, cli.proposalId)).toThrow(/approved by cli, not by a passkey/);
    expect(() => approvedInvoice(cli.db, "P-9999")).toThrow(/no proposal P-9999/);
  }, 60_000);

  it("refuses when the passkey signed other terms, or the stored terms were changed afterwards", async () => {
    const other = await standInLedger();
    other.db.prepare("UPDATE approvals SET approved_sha256 = ? WHERE proposal_id = ?").run("ab".repeat(32), other.proposalId);
    expect(() => approvedInvoice(other.db, other.proposalId)).toThrow(/not these terms/);
    const edited = await standInLedger();
    const row = edited.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(edited.proposalId) as { terms_json: string };
    edited.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(row.terms_json.replace('"240.00"', '"2400.00"'), edited.proposalId);
    expect(() => approvedInvoice(edited.db, edited.proposalId)).toThrow(/do not hash to its terms hash/);
  }, 60_000);

  it("puts the document's and the signed terms' own hashes on chain, and refuses a changed document", () => {
    const inv = approvedInvoice(approved.db, approved.proposalId);
    const salt = Buffer.alloc(32, 7);
    const r = mintRecord(inv, { document: approved.document, creditor: acct().address, payer: acct().address, salt, debtorName: "Northwind Outdoor", faceValue: testnetFaceValue(inv.amountCents, 100) });
    expect(r.documentHash).toBe(`0x${sha256Bytes(approved.document)}`);
    expect(r.termsHash).toBe(`0x${(approved.db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(approved.proposalId) as { terms_sha256: string }).terms_sha256}`);
    expect(r.amountMinor).toBe(24_000n);
    expect(r.currency).toBe(stringToHex("EUR", { size: 3 }));
    expect(r.faceValue).toBe(centsToBaseUnits(240));
    expect(r.dueDate).toBe(BigInt(Date.UTC(2026, 10, 15) / 1000));
    expect(r.debtorRef).toBe(partyRef(salt, "debtor", "Northwind Outdoor"));
    expect(r.creditorRef).toBe(partyRef(salt, "creditor", "Stockline Data GmbH"));
    expect(() => mintRecord(inv, { document: approved.document.replace("EUR 240.00", "EUR 2400.00"), creditor: acct().address, payer: acct().address, salt, debtorName: "x", faceValue: 1n }))
      .toThrow(/not the one the CFO approved/);
  });

  it("keeps the party references unguessable without the salt, and the due date and face value exact", () => {
    const a = partyRef(Buffer.alloc(32, 1), "debtor", "Northwind Outdoor");
    expect(a).toBe(partyRef(Buffer.alloc(32, 1), "debtor", "  northwind outdoor "));
    expect(a).not.toBe(partyRef(Buffer.alloc(32, 2), "debtor", "Northwind Outdoor"));
    expect(a).not.toBe(`0x${createHash("sha256").update("Northwind Outdoor").digest("hex")}`);
    expect(() => partyRef(Buffer.alloc(8), "debtor", "x")).toThrow(/16 bytes/);
    expect(() => dueDateFromDocument("no date here")).toThrow(/no due date/);
    expect(dueDateFromDocument("Due date: 1 March 2027")).toBe(BigInt(Date.UTC(2027, 2, 1) / 1000));
    expect(() => testnetFaceValue(24_001, 100)).toThrow(/not divisible/);
    expect(discountedPrice(centsToBaseUnits(240), 200)).toBe(centsToBaseUnits(235));
    expect(() => discountedPrice(1n, 0)).toThrow();
  });
});

describe("tokenize on an in-memory EVM: mint, finance, settle, verify", () => {
  let w: Awaited<ReturnType<typeof world>>;
  let inv: ApprovedInvoice;
  let record: OnChainInvoice;
  let tokenId: bigint;
  const salt = Buffer.alloc(32, 9);
  let document: string;

  beforeAll(async () => {
    w = await world();
    const l = await standInLedger();
    document = l.document;
    inv = approvedInvoice(l.db, l.proposalId);
    record = mintRecord(inv, { document, creditor: w.creditor.address, payer: w.payer.address, salt, debtorName: "Northwind Outdoor", faceValue: testnetFaceValue(inv.amountCents, 100) });
    tokenId = (await mintToken(w.calls, w.issuer, w.contract, w.creditor.address, record)).tokenId;
  }, 120_000);

  it("mints one token per invoice to the creditor, with the record readable on chain", async () => {
    expect(tokenId).toBe(tokenIdOf(record.documentHash));
    expect(await w.calls.ownerOf(w.contract, tokenId)).toBe(w.creditor.address);
    expect(verifyRecord(await w.calls.invoiceOf(w.contract, tokenId), record)).toEqual([]);
    expect(await w.calls.simulate(w.issuer.address, w.contract, w.calls.mintData(w.creditor.address, record))).toBe("AlreadyTokenized");
    const sameTerms = { ...record, documentHash: `0x${"33".repeat(32)}` as Hex };
    expect(await w.calls.simulate(w.issuer.address, w.contract, w.calls.mintData(w.creditor.address, sameTerms))).toBe("TermsAlreadyUsed");
    const fresh = { ...record, documentHash: `0x${"44".repeat(32)}` as Hex, termsHash: `0x${"55".repeat(32)}` as Hex };
    expect(await w.calls.simulate(w.stranger.address, w.contract, w.calls.mintData(w.stranger.address, fresh))).toBe("NotIssuer");
    expect(await w.calls.simulate(w.issuer.address, w.contract, w.calls.mintData(w.creditor.address, { ...fresh, faceValue: 0n }))).toBe("BadInvoice");
  });

  it("puts no personal data in the mint's calldata: no names, invoice number, IBAN or address line", () => {
    const data = w.calls.mintData(w.creditor.address, record).toLowerCase();
    for (const s of ["Stockline", "Northwind", "SLL-2026-11B", "DE02", "1203 0000", "BYLADEM1001", "Datenallee", "Berlin", "stockline data gmbh"]) {
      expect(data.includes(toHex(s).slice(2).toLowerCase())).toBe(false);
      expect(data.includes(toHex(s.toLowerCase()).slice(2))).toBe(false);
    }
  });

  it("refuses an offer by anyone but the holder, a price above face value, and an accept at a changed price", async () => {
    const price = discountedPrice(record.faceValue, 200);
    expect(await w.calls.simulate(w.stranger.address, w.contract, w.calls.offerData(tokenId, w.financier.address, price))).toBe("NotHolder");
    expect(await w.calls.simulate(w.creditor.address, w.contract, w.calls.offerData(tokenId, w.financier.address, record.faceValue + 1n))).toBe("BadOffer");
    expect(await w.calls.simulate(w.financier.address, w.contract, w.calls.acceptData(tokenId, price))).toBe("NoOffer");
    await w.calls.offer(w.creditor, w.contract, tokenId, w.financier.address, price);
    expect(await w.calls.simulate(w.financier.address, w.contract, w.calls.acceptData(tokenId, price - 1n))).toBe("PriceChanged");
    expect(await w.calls.simulate(w.stranger.address, w.contract, w.calls.acceptData(tokenId, price))).toBe("BadOffer");
  });

  it("finance pays the creditor the discounted price and hands the token to the financier", async () => {
    const price = discountedPrice(record.faceValue, 200);
    const c0 = await w.calls.balanceOf(w.settlement, w.creditor.address);
    const f0 = await w.calls.balanceOf(w.settlement, w.financier.address);
    const steps = await financeToken(w.calls, { creditor: w.creditor, financier: w.financier }, w.contract, w.settlement, tokenId, price);
    expect(steps.map((s) => s.step)).toHaveLength(3);
    expect((await w.calls.balanceOf(w.settlement, w.creditor.address)) - c0).toBe(price);
    expect(f0 - (await w.calls.balanceOf(w.settlement, w.financier.address))).toBe(price);
    expect(await w.calls.ownerOf(w.contract, tokenId)).toBe(w.financier.address);
  });

  it("refuses settlement by a stranger before anything is signed, then pays the face value to the holder once and burns the token", async () => {
    expect(await w.calls.simulate(w.stranger.address, w.contract, w.calls.settleData(tokenId))).toBe("NotPayer");
    // The node's own estimate names the refusal: nothing is signed, nothing reaches the chain.
    const before = w.chain.mined.length;
    await expect(w.calls.settle(w.stranger, w.contract, tokenId)).rejects.toThrow(WouldRevert);
    await expect(w.calls.settle(w.stranger, w.contract, tokenId)).rejects.toThrow(/NotPayer.*nothing signed, nothing sent/);
    expect(w.chain.mined.length).toBe(before);
    const h0 = await w.calls.balanceOf(w.settlement, w.financier.address);
    const p0 = await w.calls.balanceOf(w.settlement, w.payer.address);
    await settleToken(w.calls, w.payer, w.contract, w.settlement, tokenId, record.faceValue);
    expect((await w.calls.balanceOf(w.settlement, w.financier.address)) - h0).toBe(record.faceValue);
    expect(p0 - (await w.calls.balanceOf(w.settlement, w.payer.address))).toBe(record.faceValue);
    await expect(w.calls.ownerOf(w.contract, tokenId)).rejects.toThrow();
    expect((await w.calls.invoiceOf(w.contract, tokenId)).settled).toBe(true);
    expect(await w.calls.simulate(w.payer.address, w.contract, w.calls.settleData(tokenId))).toBe("AlreadySettled");
    await w.calls.approve(w.payer, w.settlement, w.contract, record.faceValue, { key: "approve-again", label: "approve again" });
    await expect(w.calls.settle(w.payer, w.contract, tokenId)).rejects.toThrow(/AlreadySettled/);
    expect(await w.calls.simulate(w.issuer.address, w.contract, w.calls.mintData(w.creditor.address, record))).toBe("AlreadyTokenized");
  });

  it("with fixed gas limits (no estimate) a refused call lands as a reverted transaction and is reported as one", async () => {
    const fixed = await world({ estimate: false });
    const l = await standInLedger();
    const r = mintRecord(approvedInvoice(l.db, l.proposalId), { document: l.document, creditor: fixed.creditor.address, payer: fixed.payer.address, salt, debtorName: "N", faceValue: centsToBaseUnits(240) });
    await fixed.calls.mint(fixed.issuer, fixed.contract, fixed.creditor.address, r);
    const before = fixed.chain.mined.length;
    await expect(fixed.calls.settle(fixed.stranger, fixed.contract, tokenIdOf(r.documentHash))).rejects.toBeInstanceOf(TxReverted);
    expect(fixed.chain.mined.length).toBe(before + 1);
    expect(fixed.chain.calls.filter((m) => m === "eth_estimateGas")).toEqual([]);
  }, 60_000);

  it("verify catches a changed document, a changed amount and a different salt against the chain record", async () => {
    const onChain = await w.calls.invoiceOf(w.contract, tokenId);
    expect(verifyRecord(onChain, record)).toEqual([]);
    const tamperedDoc = { ...record, documentHash: `0x${sha256Bytes(document.replace("15 November", "15 December"))}` as Hex };
    expect(verifyRecord(onChain, tamperedDoc).join()).toMatch(/^documentHash/);
    expect(verifyRecord(onChain, { ...record, amountMinor: 24_001n }).join()).toMatch(/amountMinor/);
    const otherSalt = mintRecord(inv, { document, creditor: w.creditor.address, payer: w.payer.address, salt: Buffer.alloc(32, 1), debtorName: "Northwind Outdoor", faceValue: record.faceValue });
    expect(verifyRecord(onChain, otherSalt).map((m) => m.split(":")[0])).toEqual(["debtorRef", "creditorRef"]);
  });

  it("each gas floor or fixed limit is at least twice what its transaction used here (intrinsic gas included), the deploy and a funding transfer too", async () => {
    const fresh = await world();
    const l = await standInLedger();
    const r = mintRecord(approvedInvoice(l.db, l.proposalId), { document: l.document, creditor: fresh.creditor.address, payer: fresh.payer.address, salt, debtorName: "N", faceValue: centsToBaseUnits(240) });
    const id = tokenIdOf(r.documentHash);
    const price = centsToBaseUnits(235);
    const used = async (k: keyof typeof GAS, f: () => Promise<{ receipt: { gasUsed: Hex } }>) => ({ k, gas: BigInt((await f()).receipt.gasUsed) });
    const all = [
      await used("transfer", () => fresh.calls.transfer(fresh.stranger, fresh.settlement, fresh.creditor.address, centsToBaseUnits(1), { key: "fund-creditor", label: "fund" })),
      await used("mint", () => fresh.calls.mint(fresh.issuer, fresh.contract, fresh.creditor.address, r)),
      await used("offer", () => fresh.calls.offer(fresh.creditor, fresh.contract, id, fresh.financier.address, price)),
      await used("approve", () => fresh.calls.approve(fresh.financier, fresh.settlement, fresh.contract, price, { key: "financier-approve", label: "a" })),
      await used("accept", () => fresh.calls.accept(fresh.financier, fresh.contract, id, price)),
      await used("approve", () => fresh.calls.approve(fresh.payer, fresh.settlement, fresh.contract, r.faceValue, { key: "payer-approve", label: "b" })),
      await used("settle", () => fresh.calls.settle(fresh.payer, fresh.contract, id)),
    ];
    for (const t of all) expect({ k: t.k, ok: GAS[t.k] >= 2n * t.gas, used: t.gas }).toMatchObject({ k: t.k, ok: true });
    // The token contract's own deployment: the transaction whose receipt names the contract.
    const deployData = encodeDeployData({ abi: loadContract("PurserInvoiceToken").abi, bytecode: loadContract("PurserInvoiceToken").bytecode, args: [fresh.settlement, fresh.issuer.address] });
    let deployGas = 0n;
    for (const h of fresh.chain.mined) {
      const rc = (await fresh.chain.request({ method: "eth_getTransactionReceipt", params: [h] })) as { contractAddress: string | null };
      if (rc.contractAddress?.toLowerCase() === fresh.contract.toLowerCase()) deployGas = fresh.chain.gas.get(h)! + intrinsicGas(deployData, true);
    }
    expect(deployGas).toBeGreaterThan(500_000n);
    expect(GAS.deploy).toBeGreaterThanOrEqual(2n * deployGas);
  }, 120_000);

  it("a call to Purser's own contract is sent with the node's estimate plus half, never below its floor; a direct token call with its fixed limit and no estimate", async () => {
    const chain = await localChain();
    const limits: { to: string | null; gas: bigint }[] = [];
    const estimates: bigint[] = [];
    const c = txClient({ chainId: CHAIN_ID, sleep: async () => {}, request: async (a) => {
      const out = await chain.request(a);
      if (a.method === "eth_estimateGas") estimates.push(BigInt(out as string));
      if (a.method === "eth_sendRawTransaction") { const tx = parseTransaction(a.params![0] as `0x02${string}`); limits.push({ to: tx.to ?? null, gas: tx.gas! }); }
      return out;
    } });
    const calls = invoiceTokenCalls(c);
    const issuer = acct();
    const settlement = await standInTokenCalls(c).deploy(issuer);
    expect(estimates).toEqual([]); // the stand-in token's own deployment asks no estimate
    await calls.deploy(issuer, settlement);
    expect(estimates).toHaveLength(1);
    // The deployment's floor is above estimate × 3/2 here: the floor is sent.
    expect((estimates[0]! * ESTIMATE_MARGIN.num) / ESTIMATE_MARGIN.den).toBeLessThan(GAS.deploy);
    expect(limits.at(-1)!.gas).toBe(GAS.deploy);
    await calls.approve(issuer, settlement, acct().address, 1n, { key: "a", label: "approve" });
    expect(estimates).toHaveLength(1);
    expect(limits.at(-1)).toEqual({ to: settlement.toLowerCase(), gas: GAS.approve });
    // A floor below the estimate: the estimate plus half is sent.
    const sent = await c.send({ key: "low-floor", label: "low floor", from: issuer, to: settlement, data: "0x095ea7b3" + "00".repeat(31) + "01" + "00".repeat(31) + "01" as Hex, gas: 30_000n, estimate: true });
    expect(sent.receipt.status).toBe("0x1");
    expect(limits.at(-1)!.gas).toBe((estimates.at(-1)! * 3n) / 2n);
    expect(limits.at(-1)!.gas).toBeGreaterThan(30_000n);
  }, 60_000);
});

describe("tokenize: the live path's guards and budget (no network)", () => {
  it("refuses every live command without Max's go, both budgets, a call log, its own ledger, the RPC and keys outside the repository", () => {
    const why = liveRefusals("mint", {}).join("\n");
    for (const name of ["TOKENIZE_GO=yes", "TOKENIZE_CALL_BUDGET ", "TOKENIZE_CALL_BUDGET_TOTAL", "TOKENIZE_CALL_LOG", "tokenize*.sqlite", "METAL_RPC_URL", "KIT11_KEYS_DIR", "TOKENIZE_SOURCE_DB", "TOKENIZE_PROPOSAL", "TOKENIZE_DOCUMENT"]) expect(why).toContain(name);
    const ok = { TOKENIZE_GO: "yes", TOKENIZE_CALL_BUDGET: "40", TOKENIZE_CALL_BUDGET_TOTAL: "45", TOKENIZE_CALL_LOG: "/tmp/x.log", TOKENIZE_DB: "/tmp/tokenize-1.sqlite", METAL_RPC_URL: "https://rpc.invalid", KIT11_KEYS_DIR: "/tmp/tokenize-keys" };
    const source = { TOKENIZE_SOURCE_DB: "/tmp/awx.sqlite", TOKENIZE_PROPOSAL: "P-0001", TOKENIZE_DOCUMENT: "x" };
    for (const cmd of ["deploy", "finance", "settle"] as const) expect(liveRefusals(cmd, ok)).toEqual([]);
    for (const cmd of ["preflight", "mint", "verify"] as const) {
      expect(liveRefusals(cmd, ok)).toHaveLength(3);
      expect(liveRefusals(cmd, { ...ok, ...source })).toEqual([]);
    }
    expect(liveRefusals("fund", { ...ok, ...source }).join()).toMatch(/TOKENIZE_DONOR_KEY/);
    expect(liveRefusals("fund", { ...ok, ...source, TOKENIZE_DONOR_KEY: "/tmp/donor.key.json" })).toEqual([]);
    expect(liveRefusals("deploy", { ...ok, TOKENIZE_DB: "/tmp/kit11.sqlite" })).toHaveLength(1);
    for (const bad of ["0", "-3", "1.5", "ten", ""]) {
      expect(liveRefusals("deploy", { ...ok, TOKENIZE_CALL_BUDGET: bad })).toHaveLength(1);
      expect(liveRefusals("deploy", { ...ok, TOKENIZE_CALL_BUDGET_TOTAL: bad })).toHaveLength(1);
    }
    expect(liveRefusals("mint", { ...ok, ...source, TOKENIZE_SOURCE_DB: "/tmp/tokenize-1.sqlite" })).toEqual(["TOKENIZE_SOURCE_DB must not be this run's own ledger"]);
    // Keys never live in the repository; verify alone needs none.
    const repo = "/work/repo";
    expect(liveRefusals("deploy", { ...ok, KIT11_KEYS_DIR: "/work/repo/keys" }, repo)).toEqual(["KIT11_KEYS_DIR must be outside the code repository"]);
    expect(liveRefusals("deploy", { ...ok, KIT11_KEYS_DIR: "/work/repo-keys" }, repo)).toEqual([]);
    expect(liveRefusals("fund", { ...ok, ...source, TOKENIZE_DONOR_KEY: "/work/repo/donor.key.json" }, repo)).toEqual(["TOKENIZE_DONOR_KEY must be outside the code repository"]);
    const { KIT11_KEYS_DIR: _none, ...noKeys } = ok;
    expect(liveRefusals("verify", { ...noKeys, ...source })).toEqual([]);
    expect(liveRefusals("deploy", { ...ok, TOKENIZE_GAS: "guess" })).toEqual(["TOKENIZE_GAS is estimate (the default) or fixed"]);
    expect(liveRefusals("deploy", { ...ok, TOKENIZE_GAS: "fixed" })).toEqual([]);
  });

  it("the budgeted transport refuses past its budget before any network request, and answers the chain id itself", async () => {
    const methods: string[] = [];
    const reached: string[] = [];
    const b = budgeted(async (a) => { reached.push(a.method); return "0x1"; }, { chainId: CHAIN_ID, max: 0, total: 100, logged: () => 0, onCall: (m) => methods.push(m) });
    expect(await b.request({ method: "eth_chainId" })).toBe(`0x${CHAIN_ID.toString(16)}`);
    await expect(b.request({ method: "eth_blockNumber" })).rejects.toThrow(/budget of 0 calls/);
    await expect(b.request({ method: "eth_blockNumber" })).rejects.toBeInstanceOf(BudgetReached);
    expect(methods).toEqual([]);
    expect(reached).toEqual([]);
    expect(b.used()).toBe(0);
    expect(b.room()).toBe(0);
  });

  it("holds every request against the whole run's budget in the call log, before the request goes out", async () => {
    const log: string[] = ["earlier command", "earlier command"]; // two requests by earlier commands
    const reached: string[] = [];
    const b = budgeted(async (a) => { reached.push(a.method); return "0x1"; }, { chainId: CHAIN_ID, max: 10, total: 4, logged: () => log.length, onCall: (m, n) => log.push(`${m} ${n.used}/${n.max} ${n.running}/${n.total}`) });
    expect(b.room()).toBe(2);
    await b.request({ method: "eth_call" });
    await b.request({ method: "eth_call" });
    expect(log.slice(2)).toEqual(["eth_call 1/10 3/4", "eth_call 2/10 4/4"]);
    expect(b.room()).toBe(0);
    await expect(b.request({ method: "eth_call" })).rejects.toThrow(/budget of 4 calls for the whole run reached \(4 in the call log\)/);
    expect(reached).toHaveLength(2);
    expect(log).toHaveLength(4);
    // Another process appended to the same log in between: it counts at once.
    const c = budgeted(async () => "0x1", { chainId: CHAIN_ID, max: 10, total: 6, logged: () => log.length, onCall: (m) => log.push(m) });
    await c.request({ method: "eth_call" });
    log.push("another command's request");
    await expect(c.request({ method: "eth_call" })).rejects.toBeInstanceOf(BudgetReached);
    // With askChainId the chain id is a real, counted request (preflight).
    const d = budgeted(async (a) => { reached.push(a.method); return "0xf951"; }, { chainId: CHAIN_ID, max: 1, total: 100, logged: () => 0, onCall: () => {}, askChainId: true });
    expect(await d.request({ method: "eth_chainId" })).toBe("0xf951");
    expect(d.used()).toBe(1);
    expect(reached.at(-1)).toBe("eth_chainId");
  });

  it("hands every transaction's hash over before it is sent, and a live run's calls are what the in-memory chain counts", async () => {
    const chain: LocalChain = await localChain();
    const seen: { label: string; hash: Hex; known: boolean }[] = [];
    const c = txClient({ request: async (a) => { if (a.method === "eth_sendRawTransaction") seen.forEach((s) => (s.known = true)); return chain.request(a); }, chainId: CHAIN_ID, sleep: async () => {}, onSigned: (label, hash) => seen.push({ label, hash, known: false }) });
    const issuer = acct();
    const addr = await standInTokenCalls(c).deploy(issuer);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.known).toBe(true);
    // A direct token call: its sender's nonce once, the send, one receipt read.
    expect(chain.calls).toEqual(["eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
    // A call to Purser's own contract adds the estimate; the nonce is not asked again.
    await invoiceTokenCalls(c).deploy(issuer, addr);
    expect(chain.calls.slice(3)).toEqual(["eth_estimateGas", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
  });
});
