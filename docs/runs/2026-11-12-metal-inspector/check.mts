// One-off, read-only check on the Metal testnet for the mandate inspector on /metal (12 November 2026). Its answers are in
// ../2026-11-12-metal-inspector.json (made from this script's output by make-record.mjs) and its run log in
// ../2026-11-12-metal-inspector.md (made by make-md.mjs). Kept here so the check can be read and run again.
// HARD BUDGET: at most 8 JSON-RPC calls in total, across every start of this script. Each call is counted and saved
// BEFORE it is sent (calls.json in the output directory); a ninth is never sent. Only read methods are used:
// eth_getTransactionReceipt, eth_blockNumber, eth_call. Nothing is signed, nothing is sent to the chain.
// The RPC URL is a credential: it is read from the environment, never printed, and blanked out of everything saved.
//
//   npx tsx docs/runs/2026-11-12-metal-inspector/check.mts <out dir>          live: needs METAL_RPC_URL (Node's fetch
//                                                                              through a proxy needs NODE_USE_ENV_PROXY=1)
//   npx tsx docs/runs/2026-11-12-metal-inspector/check.mts <out dir> --stub   rehearsal against a local stand-in (no network)
// The budget is kept in <out dir>/calls.json: a second start in the same directory sends nothing once 8 calls are used.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const req = createRequire(`${REPO}/package.json`);
const viem = await import(req.resolve("viem")) as typeof import("viem");
const sdk = await import(req.resolve("@metalntwx/metal-pay/mandates")) as any;
const abi = sdk.mandateBindingAbi as import("viem").Abi;

const OUT = process.argv[2];
if (!OUT) { console.log("usage: check.mts <out dir> [--stub]"); process.exit(2); }
const STUB = process.argv.includes("--stub");
mkdirSync(OUT, { recursive: true });
const CAP = 8;

// ── What the records say (checked against the repository's files below, so nothing here is a guess) ──
const record = JSON.parse(readFileSync(`${REPO}/docs/demo/main-run.json`, "utf8"));
const trace = JSON.parse(readFileSync(`${REPO}/docs/demo/main-run-trace.json`, "utf8")) as { mandates: { event: string; agent: string; cap: string; budget: string; tx: string; mandate_hash: string | null }[] };
const BUSINESS = record.snapshot.world.business as `0x${string}`;
const onChainRefusal = record.ledger.events.find((e: any) => e.event === "upstream.refused_on_chain");
const TX_REFUSAL_24 = onChainRefusal.payload.tx as `0x${string}`;
const OLD_SOURCING_REF = onChainRefusal.payload.mandate as `0x${string}`;
const of = (event: string, agent: string) => trace.mandates.find((m) => m.event === event && m.agent === agent)!;
const TX_TREASURY_REPLACE = of("mandate.replaced", "treasury").tx as `0x${string}`;
const TX_SOURCING_REPLACE = of("mandate.replaced", "sourcing").tx as `0x${string}`;
const TX_SUPPORT_BIND = of("mandate.bound", "support").tx as `0x${string}`;
const HASHC_TREASURY = of("mandate.replaced", "treasury").mandate_hash as `0x${string}`;
const HASHC_SOURCING = of("mandate.replaced", "sourcing").mandate_hash as `0x${string}`;
// The revoked-credential refusal recorded on chain in the four-eyes world, 30 October (docs/metal-qa-2026-11-01-week.md).
const TX_REFUSAL_OCT30 = "0xf97bcade4a83d7a23198660bee37e1c84d72d6da153eaf6d49f39cd8f542f98d" as `0x${string}`;
if (!readFileSync(`${REPO}/docs/metal-qa-2026-11-01-week.md`, "utf8").includes(TX_REFUSAL_OCT30)) throw new Error("the 30 October refusal tx is not in the QA record");
for (const [name, v] of Object.entries({ BUSINESS, TX_REFUSAL_24, OLD_SOURCING_REF, TX_TREASURY_REPLACE, TX_SOURCING_REPLACE, TX_SUPPORT_BIND, HASHC_TREASURY, HASHC_SOURCING })) if (!/^0x[0-9a-fA-F]{40}$|^0x[0-9a-f]{64}$/.test(String(v))) throw new Error(`record value ${name} is not what was expected`);

// ── The budget and the transport ──
const callsFile = `${OUT}/calls.json`;
const state: { cap: number; calls: any[] } = existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, "utf8")) : { cap: CAP, calls: [] };
let secretParts: string[] = [];
const blank = (text: string) => { let t = text; for (const p of secretParts) t = t.split(p).join("[redacted]"); return t; };
const save = () => writeFileSync(callsFile, blank(JSON.stringify(state, null, 1)));

let url = "";
let stubServer: ReturnType<typeof createServer> | null = null;
if (STUB) {
  const stub = makeStub();
  stubServer = createServer((q, s) => { let body = ""; q.on("data", (c) => { body += c; }); q.on("end", () => { const r = JSON.parse(body); s.setHeader("content-type", "application/json"); s.end(JSON.stringify({ jsonrpc: "2.0", id: r.id, ...stub(r.method, r.params) })); }); });
  await new Promise<void>((ok) => stubServer!.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(stubServer.address() as { port: number }).port}/`;
} else {
  url = process.env.METAL_RPC_URL ?? "";
  if (!url) { console.log("METAL_RPC_URL is not set: nothing was sent"); process.exit(2); }
  try { const u = new URL(url); secretParts = [url, u.host + u.pathname + u.search, u.pathname + u.search, u.host, ...u.pathname.split("/").filter((x) => x.length >= 8), ...u.search.slice(1).split("&").flatMap((kv) => kv.split("=").slice(1)).filter((x) => x.length >= 6), u.username, u.password].filter((x) => x && x.length >= 4 && x !== "/"); }
  catch { secretParts = [url]; }
}

async function rpc(purpose: string, method: "eth_getTransactionReceipt" | "eth_blockNumber" | "eth_call", params: unknown[]): Promise<any> {
  if (state.calls.length >= CAP) throw new Error(`the budget of ${CAP} calls is used: ${method} was not sent`);
  const entry: any = { n: state.calls.length + 1, purpose, sent_at: new Date().toISOString(), request: { jsonrpc: "2.0", id: state.calls.length + 1, method, params }, ms: null, http: null, response: null, error: null };
  state.calls.push(entry); save(); // counted before it is sent
  const t0 = Date.now();
  let res: Response;
  try { res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry.request), signal: AbortSignal.timeout(25_000) }); }
  catch { entry.ms = Date.now() - t0; entry.error = "RPC unreachable"; save(); throw new Error(`${method}: RPC unreachable`); }
  entry.ms = Date.now() - t0; entry.http = res.status;
  if (!res.ok) { entry.error = `HTTP ${res.status}`; save(); throw new Error(`${method}: HTTP ${res.status}`); }
  let body: any;
  try { body = JSON.parse(await res.text()); } catch { entry.error = "the answer is not JSON"; save(); throw new Error(`${method}: the answer is not JSON`); }
  entry.response = body; save();
  if (body.error) { entry.error = `RPC error ${String(body.error.code)}`; save(); throw new Error(`${method}: RPC error ${String(body.error.code)}`); }
  if (body.result === null || body.result === undefined) { entry.error = "null result"; save(); throw new Error(`${method}: null result`); }
  return body.result;
}

// ── Decoding (offline) ──
const topic0 = (name: string) => viem.toEventSelector(viem.getAbiItem({ abi, name }) as any);
const T = { bound: topic0("MandateBound"), refused: topic0("MandateRefused"), replaced: topic0("MandateReplaced"), revoked: topic0("MandateRevoked"), payment: topic0("MandatePayment") };
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => typeof x === "bigint" ? x.toString() : x));
function eventsOf(receipt: any, t: string) {
  return (receipt.logs as any[]).filter((l) => l.topics?.[0] === t).map((l) => ({ raw: { address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex, blockNumber: l.blockNumber, transactionHash: l.transactionHash }, decoded: json(viem.decodeEventLog({ abi, data: l.data, topics: l.topics }) ) }));
}
const receiptFacts = (r: any) => ({ status: r.status, blockNumber: Number(BigInt(r.blockNumber)), from: r.from, to: r.to, gasUsed: Number(BigInt(r.gasUsed)), logs: r.logs.length });
const MANDATES_SELECTOR = viem.toFunctionSelector(viem.getAbiItem({ abi, name: "mandates" }) as any);
const callData = (ref: string) => `${MANDATES_SELECTOR}${ref.slice(2)}`;
const usd = (units: string) => viem.formatUnits(BigInt(units), 18);

const summary: any = { what: "Read-only verification for the mandate inspector", network: "Metal testnet", cap: CAP, started_at: new Date().toISOString(), stub: STUB, business_account: BUSINESS, abi: { mandates: "mandates(bytes32 ref) view returns (address principal, bool revoked, bytes32 agentX, bytes32 agentY, string kid, bytes32 openSdHash, uint64 boundBlock, uint64 occurrences, uint128 spent)", selector: MANDATES_SELECTOR, MandateRefused: "MandateRefused(bytes32 indexed ref, address indexed to, bytes20 l3aDigest, bytes agentKey, uint256 amount, uint8 reason)", topic0: T, reasons: sdk.REASONS }, notes: [] as string[] };
const CALLS_AT_START = state.calls.length;
const finish = (code: number) => { summary.finished_at = new Date().toISOString(); summary.calls_used = state.calls.length; summary.calls_this_start = state.calls.length - CALLS_AT_START; if (summary.calls_this_start > 0 || !existsSync(`${OUT}/summary.json`)) writeFileSync(`${OUT}/summary.json`, blank(JSON.stringify(summary, null, 1))); console.log(`calls used: ${state.calls.length} of ${CAP}`); for (const n of summary.notes) console.log(`note: ${blank(n)}`); stubServer?.close(); process.exit(code); };

class Transport extends Error {}
/** One step: a JSON-RPC level error or an empty answer is recorded and the flow goes on; a transport failure stops everything. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try { return await run(); }
  catch (e) {
    const why = blank(e instanceof Error ? e.message : "failed");
    summary.notes.push(`${name}: ${why}`);
    if (/RPC unreachable|HTTP \d+|not JSON|budget of/.test(why)) throw new Transport(why);
    return null;
  }
}
/** The new mandate's reference from a bind or replace receipt: the MandateBound event's ref, else MandateReplaced's successor. */
function refOfBinding(receipt: any): { ref: `0x${string}`; bound: any[]; replaced: any[] } | null {
  const bound = eventsOf(receipt, T.bound), replaced = eventsOf(receipt, T.replaced);
  const ref = bound.length === 1 ? bound[0]!.raw.topics[1] : replaced.length === 1 ? replaced[0]!.raw.topics[2] : null;
  return ref ? { ref, bound, replaced } : null;
}

try {
  const refs: Partial<Record<"sourcing" | "support" | "treasury", `0x${string}`>> = {};

  // A. The refusal the main run recorded on chain (#24): the decoded event, and the Sourcing agent's key.
  let sourcingKey: unknown = null;
  await step("the #24 refusal receipt", async () => {
    const r24 = await rpc("receipt of the refusal recorded on chain in the main run (purchase #24)", "eth_getTransactionReceipt", [TX_REFUSAL_24]);
    const refused24 = eventsOf(r24, T.refused);
    summary.refusal_main_run = { tx: TX_REFUSAL_24, receipt: receiptFacts(r24), events: refused24 };
    if (refused24.length !== 1) throw new Error(`expected one MandateRefused, found ${refused24.length}`);
    const e24 = refused24[0]!;
    summary.refusal_main_run.checks = { ref_is_the_recorded_mandate: e24.decoded.args.ref === OLD_SOURCING_REF, emitted_by_the_business_account: viem.isAddressEqual(e24.raw.address, BUSINESS), amount: usd(e24.decoded.args.amount), reason: sdk.REASONS[e24.decoded.args.reason] };
    sourcingKey = sdk.decodeAgentKey(e24.decoded.args.agentKey);
  });

  // B. Treasury's replace: the new mandate's reference and terms; it also checks how a reference is derived.
  let methodHolds = false;
  await step("Treasury's replace receipt", async () => {
    const rTre = await rpc("receipt of Treasury's mandate replace (P-0002): the new mandate's reference and terms", "eth_getTransactionReceipt", [TX_TREASURY_REPLACE]);
    const b = refOfBinding(rTre);
    summary.treasury_replace = { tx: TX_TREASURY_REPLACE, receipt: receiptFacts(rTre), bound: b?.bound ?? [], replaced: b?.replaced ?? [], revoked: eventsOf(rTre, T.revoked) };
    if (!b) throw new Error("no MandateBound or MandateReplaced event found");
    refs.treasury = b.ref;
    const bt = b.bound[0];
    if (bt) {
      const derived = sdk.mandateReference(BUSINESS, sdk.decodeAgentKey(bt.decoded.args.agentKey), bt.decoded.args.hashC);
      methodHolds = derived.toLowerCase() === b.ref.toLowerCase() && String(bt.decoded.args.hashC).toLowerCase() === HASHC_TREASURY.toLowerCase();
      summary.reference_derivation = { rule: "keccak256(principal ‖ typed agent key ‖ hash of the credential), as Metal's SDK computes it", principal: BUSINESS, derived_for_treasury: derived, on_chain: b.ref, ledger_credential_hash: HASHC_TREASURY, event_hashC: bt.decoded.args.hashC, emitted_by: bt.raw.address, holds: methodHolds };
    }
  });

  // C. Support's bind: its reference and terms.
  await step("Support's bind receipt", async () => {
    const rSup = await rpc("receipt of Support's mandate bind: the mandate's reference and terms", "eth_getTransactionReceipt", [TX_SUPPORT_BIND]);
    const b = refOfBinding(rSup);
    summary.support_bind = { tx: TX_SUPPORT_BIND, receipt: receiptFacts(rSup), bound: b?.bound ?? [] };
    if (!b) throw new Error("no MandateBound event found");
    refs.support = b.ref;
  });

  // D. Sourcing's new reference: derived (the same agent key as the old mandate, the ledger's credential hash), else read from its replace receipt.
  if (methodHolds && sourcingKey) {
    refs.sourcing = sdk.mandateReference(BUSINESS, sourcingKey, HASHC_SOURCING);
    summary.sourcing_reference = { how: "derived from the agent key in the #24 refusal event and the replace's credential hash in the ledger; the read below confirms it is bound", ref: refs.sourcing };
  } else {
    summary.notes.push("Sourcing's reference could not be derived, so its replace receipt is read; the 30 October refusal receipt is then read only if a call is left");
    await step("Sourcing's replace receipt", async () => {
      const rSrc = await rpc("receipt of Sourcing's mandate replace (P-0002): the new mandate's reference and terms", "eth_getTransactionReceipt", [TX_SOURCING_REPLACE]);
      const b = refOfBinding(rSrc);
      summary.sourcing_replace = { tx: TX_SOURCING_REPLACE, receipt: receiptFacts(rSrc), bound: b?.bound ?? [], replaced: b?.replaced ?? [] };
      if (!b) throw new Error("no MandateBound or MandateReplaced event found");
      refs.sourcing = b.ref;
      summary.sourcing_reference = { how: "read from the events of its replace transaction", ref: b.ref };
    });
  }

  // E. The mandates' running state, all at one block.
  await step("the mandate reads", async () => {
    const known = (["sourcing", "support", "treasury"] as const).filter((a) => refs[a]);
    if (!known.length) throw new Error("no reference is known");
    const blockHex = await rpc("the chain's latest block number", "eth_blockNumber", []);
    const block = Number(BigInt(blockHex));
    summary.read = { block, block_hex: blockHex, read_at: new Date().toISOString(), mandates: [] as any[] };
    for (const agent of known) {
      const ref = refs[agent]!;
      await step(`mandates(ref) for ${agent}`, async () => {
        const data = await rpc(`mandates(ref) for the ${agent} mandate at block ${block}`, "eth_call", [{ to: BUSINESS, data: callData(ref) }, blockHex]);
        const m = json(viem.decodeFunctionResult({ abi, functionName: "mandates", data })) as any;
        summary.read.mandates.push({ agent, ref, call: { to: BUSINESS, data: callData(ref), block: blockHex }, result_hex: data, decoded: m, bound: viem.isAddressEqual(m.principal, BUSINESS), revoked: m.revoked, spent_units: m.spent, spent: usd(m.spent), occurrences: m.occurrences, bound_block: m.boundBlock });
      });
    }
  });

  // F. The second refusal as a decoded event: the revoked-credential refusal of 30 October (a separate run), if a call is left.
  if (state.calls.length < CAP) {
    await step("the 30 October refusal receipt", async () => {
      const rOct = await rpc("receipt of the revoked-credential refusal recorded on chain on 30 October (four-eyes world, a separate run)", "eth_getTransactionReceipt", [TX_REFUSAL_OCT30]);
      const refusedOct = eventsOf(rOct, T.refused);
      summary.refusal_oct30 = { tx: TX_REFUSAL_OCT30, receipt: receiptFacts(rOct), events: refusedOct, checks: refusedOct.length ? { amount: usd(refusedOct[0]!.decoded.args.amount), reason: sdk.REASONS[refusedOct[0]!.decoded.args.reason] } : null };
    });
  } else summary.notes.push("no call was left for the 30 October refusal receipt");
  finish(0);
} catch (e) {
  summary.stopped = blank(e instanceof Error ? e.message : "stopped");
  console.log(`stopped: ${summary.stopped}`);
  finish(1);
}

// ── The local stand-in for the rehearsal: answers built with the same ABI, so every decoding path is exercised ──
function makeStub() {
  const key = { x: `0x${"11".repeat(32)}`, y: `0x${"22".repeat(32)}` };
  const keyT = { x: `0x${"33".repeat(32)}`, y: `0x${"44".repeat(32)}` };
  const agentKey = sdk.encodeAgentKey(key), agentKeyT = sdk.encodeAgentKey(keyT);
  const refT = sdk.mandateReference(BUSINESS, keyT, HASHC_TREASURY);
  const refS = sdk.mandateReference(BUSINESS, key, HASHC_SOURCING);
  const refSup = `0x${"ab".repeat(32)}`;
  const log = (name: string, args: any) => {
    const item = viem.getAbiItem({ abi, name }) as any;
    const topics = viem.encodeEventTopics({ abi, eventName: name, args } as any);
    const data = viem.encodeAbiParameters(item.inputs.filter((i: any) => !i.indexed), item.inputs.filter((i: any) => !i.indexed).map((i: any) => args[i.name]));
    return { address: BUSINESS.toLowerCase(), topics, data, logIndex: "0x0", blockNumber: "0xd7f6a0", transactionHash: `0x${"00".repeat(32)}` };
  };
  const constraints = (cap: bigint, budget: bigint) => ({ token: "0x000000000000000000000000000000000000B5d5", perPaymentCap: cap, budget, expiry: 1797120000n, recurrenceStart: 0n, recurrenceEnd: 0n, maxOccurrences: 0n });
  const terms = { kid: "kid-1", instrument: "x402", currency: "USD", unitsPerMinor: 10n ** 16n, payees: [{ account: "0x00000000000000000000000000000000000000aa", sdHash: `0x${"00".repeat(32)}`, object: "payee" }], openSdHash: `0x${"00".repeat(32)}` };
  const receipt = (logs: any[]) => ({ result: { status: "0x1", blockNumber: "0xd7f6a0", from: "0x00000000000000000000000000000000000000f1", to: BUSINESS, gasUsed: "0x5208", logs } });
  const state = (spent: bigint, revoked = false) => ({ result: viem.encodeFunctionResult({ abi, functionName: "mandates", result: { principal: BUSINESS, revoked, agentX: key.x, agentY: key.y, kid: "kid-1", openSdHash: `0x${"00".repeat(32)}`, boundBlock: 14153000n, occurrences: 18n, spent } as any }) });
  const variant = process.env.STUB_VARIANT ?? "";
  return (method: string, params: any[]): { result?: unknown; error?: unknown } => {
    if (method === "eth_blockNumber") return { result: "0xdf0000" };
    if (variant === "null-support" && method === "eth_getTransactionReceipt" && params[0] === TX_SUPPORT_BIND) return { result: null };
    if (variant === "bad-derivation" && method === "eth_getTransactionReceipt" && params[0] === TX_TREASURY_REPLACE) return receipt([log("MandateBound", { ref: `0x${"77".repeat(32)}`, hashC: HASHC_TREASURY, issuerKey: `0x${"09".repeat(32)}`, agentKey: agentKeyT, constraints: constraints(2n * 10n ** 18n, 2n * 10n ** 18n), terms })]);
    if (variant === "bad-derivation" && method === "eth_call" && String(params[0].data) === callData(`0x${"77".repeat(32)}`)) return state(69n * 10n ** 16n);
    if (method === "eth_getTransactionReceipt") {
      const tx = params[0];
      if (tx === TX_REFUSAL_24) return receipt([log("MandateRefused", { ref: OLD_SOURCING_REF, to: "0x00000000000000000000000000000000000000aa", l3aDigest: `0x${"cd".repeat(20)}`, agentKey, amount: 4n * 10n ** 16n, reason: 8 })]);
      if (tx === TX_REFUSAL_OCT30) return receipt([log("MandateRefused", { ref: `0x${"ef".repeat(32)}`, to: "0x00000000000000000000000000000000000000bb", l3aDigest: `0x${"ce".repeat(20)}`, agentKey, amount: 10n ** 16n, reason: 2 })]);
      if (tx === TX_TREASURY_REPLACE) return receipt([log("MandateBound", { ref: refT, hashC: HASHC_TREASURY, issuerKey: `0x${"09".repeat(32)}`, agentKey: agentKeyT, constraints: constraints(2n * 10n ** 18n, 2n * 10n ** 18n), terms }), log("MandateReplaced", { predecessor: `0x${"01".repeat(32)}`, successor: refT })]);
      if (tx === TX_SUPPORT_BIND) return receipt([log("MandateBound", { ref: refSup, hashC: `0x${"07".repeat(32)}`, issuerKey: `0x${"09".repeat(32)}`, agentKey, constraints: constraints(10n ** 17n, 4n * 10n ** 18n), terms })]);
      if (tx === TX_SOURCING_REPLACE) return receipt([log("MandateBound", { ref: refS, hashC: HASHC_SOURCING, issuerKey: `0x${"09".repeat(32)}`, agentKey, constraints: constraints(4n * 10n ** 16n, 14n * 10n ** 18n), terms })]);
      return { result: null };
    }
    if (method === "eth_call") {
      const data = String(params[0].data);
      if (data === callData(refS)) return state(72n * 10n ** 16n);
      if (data === callData(refSup)) return state(15n * 10n ** 16n);
      if (data === callData(refT)) return state(69n * 10n ** 16n);
      return { error: { code: -32000, message: "execution reverted" } };
    }
    return { error: { code: -32601, message: "method not found" } };
  };
}
