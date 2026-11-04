// npm run clearing-load -- [payers] [payments each] [price]: a load test of Metal's pay-per-call clearing on testnet
// (enterprise item 5), over the same x402 path Purser's prepaid route uses. A local seller offers one route paid only
// by clearing (scheme bajillion, Metal's facilitator); P payer wallets, each with its own clearing deposit, pay N
// requests each, one at a time per wallet (a clearing account pays one request at a time), all wallets at once.
// Measured: throughput, latency per paid request (retries included), refusals by reason, the deposits' gas, and the
// RPC calls this process made by method (the URL is never printed). Test money only; keys in a test keys dir.
// A request whose answer was lost is sent again, as Metal's docs say. Writes docs/runs/clearing-load.json (LOAD_OUT).

import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import express from "express";
import { formatUnits, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

process.env.KIT11_KEYS_DIR ??= resolve(import.meta.dirname, "../../../x402-business-agents-keys/clearing-load");
const { keyPath, metalAgent } = await import("../metal/agentCli.js");
const { publicClient, readKeyFile, usdzBalance } = await import("../metal/chain.js");
const { rpcUrl, FACILITATOR_URL } = await import("../metal/network.js");
const { NETWORK, CHAIN_ID, betweenEpochs, clearingDeployment, outcomeUnknown } = await import("../metal/clearing.js");
const { centsToBaseUnits } = await import("../lib/money.js");
const { redactSecrets } = await import("../lib/redact.js");
const { ClearingServerScheme, clearingSpendable, createClearingClient, depositToClearing, registerClearingClient } = await import("@metalntwx/metal-pay");
const { openClearingWallet } = await import("@metalntwx/metal-pay/node");
const { HTTPFacilitatorClient, x402ResourceServer } = await import("@x402/core/server");
const { paymentMiddleware } = await import("@x402/express");
const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");

const [P, N, PRICE] = [Number(process.argv[2] ?? 16), Number(process.argv[3] ?? 125), process.argv[4] ?? "0.001"];
const say = (s: string) => console.log(redactSecrets(s));

// Count this process's calls to the Metal RPC and to the facilitator, by method; never their URLs.
const RPC = rpcUrl();
const rpcCalls: Record<string, number> = {};
let facilitatorCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === RPC && typeof init?.body === "string") {
    try {
      const b = JSON.parse(init.body) as { method?: string } | { method?: string }[];
      for (const m of Array.isArray(b) ? b : [b]) rpcCalls[m.method ?? "?"] = (rpcCalls[m.method ?? "?"] ?? 0) + 1;
    } catch { rpcCalls["?"] = (rpcCalls["?"] ?? 0) + 1; }
  } else if (url.startsWith(FACILITATOR_URL)) facilitatorCalls++;
  return realFetch(input, init);
}) as typeof fetch;

const d = await clearingDeployment();
if (!d) throw new Error("Metal's facilitator offers no clearing deployment on testnet");

// 0. A funder key with test USD from the faucet; the seller's and the payers' clearing wallets.
if (!(await import("node:fs")).existsSync(keyPath("funder.key.json"))) metalAgent(["key", "create", "--out", keyPath("funder.key.json")]);
const funder = privateKeyToAccount(readKeyFile(keyPath("funder.key.json")).privateKey);
const priceUnits = parseUnits(PRICE, 18);
const perWallet = priceUnits * BigInt(N) + centsToBaseUnits(5);
if ((await usdzBalance(funder.address)) < perWallet * BigInt(P) + centsToBaseUnits(300)) { metalAgent(["fund", funder.address]); say("funder topped up from the faucet"); }
const seller = await openClearingWallet(keyPath("clearing-seller"));
const payers = await Promise.all(Array.from({ length: P }, (_, i) => openClearingWallet(keyPath(`clearing-payer-${String(i + 1).padStart(2, "0")}`))));

// 1. The deposits, one per payer wallet: each wallet pays from its own prepaid budget.
const deposits: { tx: Hex; gasUsed: bigint }[] = [];
const pc = publicClient();
const tDeposit = Date.now();
for (const w of payers) {
  const have = await clearingSpendable({ rpcUrl: RPC, settlement: d.settlement, serviceUrl: d.serviceUrl, account: w.signer.publicKey }).catch(() => 0n);
  if (have >= perWallet) continue;
  const r = await depositToClearing({ rpcUrl: RPC, chainId: CHAIN_ID, from: funder, settlement: d.settlement, asset: d.asset, account: w.signer.publicKey, amount: perWallet - have });
  for (const tx of [r.approveTx, r.depositTx].filter((x): x is Hex => !!x)) deposits.push({ tx, gasUsed: (await pc.getTransactionReceipt({ hash: tx })).gasUsed });
}
say(`deposits: ${deposits.length} transactions for ${P} wallets in ${((Date.now() - tDeposit) / 1000).toFixed(0)} s`);
// A deposit is spendable after about 10 seconds (docs/runs/2026-10-29-clearing.md).
await new Promise((r) => setTimeout(r, 15_000));
const sellerBefore = await clearingSpendable({ rpcUrl: RPC, settlement: d.settlement, serviceUrl: d.serviceUrl, account: seller.signer.publicKey }).catch(() => 0n);

// 2. The seller: one route, paid only by clearing, settled through Metal's facilitator.
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL }));
server.register(NETWORK, new ClearingServerScheme(NETWORK));
let delivered = 0;
const app = express();
app.use(paymentMiddleware({ "GET /v1/load": { accepts: { scheme: "bajillion", network: NETWORK, payTo: seller.signer.publicKey, price: () => PRICE }, description: "load test: one tiny paid response" } }, server));
app.get("/v1/load", (_req, res) => { delivered++; res.json({ ok: true, at: Date.now() }); });
const http = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

// 3. The load: every wallet at once, each paying its requests one at a time.
type Result = { ok: boolean; ms: number; retries: number; reason: string | null };
const results: Result[] = [];
const t0 = Date.now();
await Promise.all(payers.map(async (w) => {
  const clearing = createClearingClient({ serviceUrl: d.serviceUrl, rpcUrl: RPC, network: NETWORK, settlement: d.settlement, asset: d.asset, signer: w.signer, store: w.store, maxAmount: 10n ** 16n });
  // x402's default spend controls allow only well-known assets; *USDZ is Metal's. Each payment stays capped by the
  // clearing client's maxAmount (0.01), as in metal-pay's own tests.
  const client = new x402Client().setSpendControls({ allowedAssets: true });
  registerClearingClient(client, NETWORK, clearing);
  const pay = wrapFetchWithPayment(fetch, client);
  for (let i = 0; i < N; i++) {
    const start = Date.now();
    let retries = 0;
    let resends = 0;
    for (;;) {
      try {
        const res = await pay(`${base}/v1/load?i=${i}`, { signal: AbortSignal.timeout(60_000) });
        await res.text();
        results.push({ ok: res.ok, ms: Date.now() - start, retries, reason: res.ok ? null : `HTTP ${res.status}` });
        break;
      } catch (e) {
        if (betweenEpochs(e) && retries < 10) { retries++; await new Promise((r) => setTimeout(r, 3000)); continue; }
        // A lost answer holds the wallet until the same request is sent again (Metal's documented behaviour): resend it.
        if (outcomeUnknown(e) && resends < 5) { resends++; retries++; await new Promise((r) => setTimeout(r, 3000)); continue; }
        results.push({ ok: false, ms: Date.now() - start, retries, reason: redactSecrets(((e as { reason?: string }).reason ?? (e as Error).message).split("\n")[0]!.slice(0, 100)) });
        break;
      }
    }
  }
}));
const seconds = (Date.now() - t0) / 1000;
http.close();

// 4. The numbers.
await new Promise((r) => setTimeout(r, 10_000));
const sellerAfter = await clearingSpendable({ rpcUrl: RPC, settlement: d.settlement, serviceUrl: d.serviceUrl, account: seller.signer.publicKey }).catch(() => sellerBefore);
const okMs = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => okMs.length ? okMs[Math.min(okMs.length - 1, Math.floor((p / 100) * okMs.length))]! : null;
const reasons: Record<string, number> = {};
for (const r of results.filter((x) => !x.ok)) reasons[r.reason ?? "?"] = (reasons[r.reason ?? "?"] ?? 0) + 1;
const depositGas = deposits.reduce((a, b) => a + b.gasUsed, 0n);
const paid = results.filter((r) => r.ok).length;
const rpcTotal = Object.values(rpcCalls).reduce((a, b) => a + b, 0);
const out = {
  ran_at: new Date().toISOString(), network: "Metal testnet", scheme: "bajillion (Offer Pay-per-Call Clearing)", payers: P, payments_each: N, price: PRICE,
  attempted: results.length, paid, failed: results.length - paid, delivered, failures_by_reason: reasons,
  seconds: Number(seconds.toFixed(1)), throughput_per_second: Number((paid / seconds).toFixed(2)),
  latency_ms: { p50: pct(50), p95: pct(95), p99: pct(99), max: okMs.at(-1) ?? null },
  between_epochs_retries: results.reduce((a, r) => a + r.retries, 0),
  seller_spendable_delta: formatUnits(sellerAfter - sellerBefore, 18), expected_earnings: formatUnits(priceUnits * BigInt(paid), 18),
  deposits: { transactions: deposits.length, gas_used: depositGas.toString(), gas_cost_test_usd: formatUnits(depositGas, 18), txs: deposits.map((x) => x.tx) },
  rpc_calls_this_process: { total: rpcTotal, per_paid_payment: paid ? Number((rpcTotal / paid).toFixed(2)) : null, by_method: rpcCalls },
  facilitator_calls_this_process: facilitatorCalls,
};
mkdirSync(resolve(import.meta.dirname, "../../docs/runs"), { recursive: true });
writeFileSync(resolve(import.meta.dirname, `../../docs/runs/${process.env.LOAD_OUT ?? "clearing-load"}.json`), JSON.stringify(out, null, 2) + "\n");
say(JSON.stringify({ ...out, deposits: { ...out.deposits, txs: `${deposits.length} txs` } }, null, 1));
await Promise.all([seller, ...payers].map((w) => w.close()));
process.exit(0);
