// `npm run tokenize` itself, as the operator will run it for the live run: each command a process of its own
// (src/cli/tokenize.ts), reading its settings from the environment, reaching "Metal" at METAL_RPC_URL. Here that URL is
// a JSON-RPC server on this machine in front of the in-memory chain, with the *USDZ stand-in at Metal's own *USDZ
// address, so the command line runs unmodified, in the runbook's order, to a written run record. Every live command
// runs under a preload that refuses the in-memory chain's packages (test/support/no-ethereumjs.mjs): the live commands
// never load them. No request leaves this machine.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { standInTokenCalls, txClient } from "../src/tokenize/client.js";
import { localChain, type LocalChain } from "../src/tokenize/localChain.js";
import { STAND_IN_FIXTURE } from "../src/tokenize/standIn.js";
import type { TokenizeRunRecord } from "../src/tokenize/runRecord.js";
import { centsToBaseUnits } from "../src/lib/money.js";
import { CHAIN_ID, USDZ } from "../src/metal/network.js";
import { ROOT, sourceLedger } from "./support/tokenizeWorld.js";

/** The part of the test server's address that stands for the credential in a real RPC URL (built here, not a literal). */
const SECRET = ["rpc", "endpoint", "part", "0123456789abcdef"].join("-");
const NO_CHAIN = pathToFileURL(join(ROOT, "test/support/no-ethereumjs.mjs")).href;

let chain: LocalChain, server: Server, dir: string, env: Record<string, string>;
const wire: string[] = [];
let failOnce: string | null = null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tokenize-cli-"));
  chain = await localChain();
  // The *USDZ stand-in's code at Metal's *USDZ address, and a donor that holds test money there.
  const setup = txClient({ request: chain.request, chainId: CHAIN_ID, sleep: async () => {} });
  const minter = privateKeyToAccount(generatePrivateKey());
  await chain.cloneCode(await standInTokenCalls(setup).deploy(minter), USDZ);
  const donorKey = generatePrivateKey();
  writeFileSync(join(dir, "donor.key.json"), JSON.stringify({ address: privateKeyToAccount(donorKey).address, privateKey: donorKey }), { mode: 0o600 });
  await standInTokenCalls(setup).mint(minter, USDZ, privateKeyToAccount(donorKey).address, centsToBaseUnits(10_000));

  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => {
      void (async () => {
        const { id, method, params } = JSON.parse(body) as { id: number; method: string; params?: unknown[] };
        wire.push(method);
        if (failOnce === method) { failOnce = null; res.statusCode = 500; res.end("upstream unavailable"); return; }
        res.setHeader("content-type", "application/json");
        try { res.end(JSON.stringify({ jsonrpc: "2.0", id, result: await chain.request({ method, params: params ?? [] }) })); } catch (e) {
          const err = e as Error & { code?: number; data?: string };
          res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: err.code ?? -32000, message: err.message, ...(err.data ? { data: err.data } : {}) } }));
        }
      })();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const src = await sourceLedger();
  mkdirSync(join(dir, "repo/docs/runs"), { recursive: true });
  env = {
    TOKENIZE_GO: "yes", TOKENIZE_CALL_BUDGET: "20", TOKENIZE_CALL_BUDGET_TOTAL: "60", TOKENIZE_CALL_LOG: join(dir, "calls.log"), TOKENIZE_DB: join(dir, "tokenize-cli.sqlite"),
    METAL_RPC_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/${SECRET}`, KIT11_KEYS_DIR: join(dir, "keys"),
    TOKENIZE_SOURCE_DB: src.file, TOKENIZE_PROPOSAL: src.proposalId, TOKENIZE_DOCUMENT: join(ROOT, "fixtures", STAND_IN_FIXTURE), TOKENIZE_DONOR_KEY: join(dir, "donor.key.json"),
    TOKENIZE_POLL_MS: "0", TOKENIZE_RECORD_REPO: join(dir, "repo"),
  };
}, 60_000);
afterAll(() => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }));

/** One command as its own process. `chain: false` runs it under the preload that refuses the in-memory chain's packages. */
function cli(cmd: string, over: Record<string, string | undefined> = {}, o: { chain?: boolean } = {}): Promise<{ code: number; out: string; requests: string[] }> {
  const before = wire.length;
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env, ...over };
  delete childEnv.NODE_USE_ENV_PROXY;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...(o.chain ? [] : ["--import", NO_CHAIN]), join(ROOT, "src/cli/tokenize.ts"), cmd], { cwd: ROOT, env: childEnv as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { out += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, out, requests: wire.slice(before) }));
  });
}

describe("npm run tokenize, each command its own process", () => {
  it("runs the runbook's order to a written record, without ever loading the in-memory chain, and never prints the RPC URL", async () => {
    const all: string[] = [];
    const step = async (cmd: string, code: number, last: RegExp, over: Record<string, string | undefined> = {}) => {
      const o = await cli(cmd, over);
      all.push(o.out);
      expect({ cmd, code: o.code, out: o.out }).toMatchObject({ cmd, code });
      expect(o.out).toMatch(last);
      return o;
    };
    // Without Max's go: refused, no request, no ledger.
    const noGo = await step("deploy", 2, /REFUSED {2}TOKENIZE_GO=yes \(Max's go\)/, { TOKENIZE_GO: undefined });
    expect(noGo.requests).toEqual([]);
    expect(existsSync(env.TOKENIZE_DB!)).toBe(false);

    expect((await step("preflight", 1, /NOT READY {2}no key yet for issuer, creditor, financier, payer; run `npm run tokenize -- fund`/)).requests).toEqual(["eth_chainId", "eth_call"]);
    expect((await step("fund", 0, /FUNDED {3}issuer 0x[0-9a-fA-F]{40}, creditor 0x[0-9a-fA-F]{40}, financier \(simulated\) 0x[0-9a-fA-F]{40}, payer 0x[0-9a-fA-F]{40}\n\(14 Metal RPC calls in this command; 16 of 60 in the call log\)/)).requests).toHaveLength(14);
    expect((await step("preflight", 0, /READY {4}the four roles hold what they need and the budget covers the steps still to run; nothing was sent/)).requests).toHaveLength(5);
    expect((await step("deploy", 0, /DEPLOYED PurserInvoiceToken 0x[0-9a-fA-F]{40} {2}https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64} {2}\(issuer 0x[0-9a-fA-F]{40}, settles in \*USDZ\)\n\(4 Metal RPC calls in this command; 25 of 60 in the call log\)/)).requests).toHaveLength(4);
    expect((await step("mint", 0, /MINTED {3}token 0x[0-9a-f]{64} to the creditor 0x[0-9a-fA-F]{40}; face value 2\.40 \*USDZ \(test money, invoice amount ÷ 100\)/)).requests).toHaveLength(4);
    expect((await step("finance", 0, /FINANCED the simulated financier 0x[0-9a-fA-F]{40} paid 2\.35 \*USDZ to the creditor 0x[0-9a-fA-F]{40} and holds the token/)).requests).toHaveLength(10);
    expect((await step("settle", 0, /SETTLED {2}the debtor's wallet paid 2\.40 \*USDZ to the holder 0x[0-9a-fA-F]{40}; token burned/)).requests).toHaveLength(6);
    // The node fails once during verify: the command stops with exit 3, and the next run finishes it.
    failOnce = "eth_call";
    await step("verify", 3, /STOPPED {2}a request to the RPC failed \(.*\)\. Run the command again: it continues from the journal/);
    expect((await step("verify", 0, /VERIFIED token id = document hash; the chain record matches the ledger and the document; the chain marks it settled\n\(1 Metal RPC calls in this command; 47 of 60 in the call log\)/)).requests).toEqual(["eth_call"]);
    // A command run again sends nothing.
    const again = await step("finance", 0, /finished earlier; nothing sent/);
    expect(again.requests).toEqual([]);
    expect(chain.mined.length).toBe(2 + 11); // the setup's two (the stand-in token and the donor's money), then the run's eleven

    // facts: the run's ledger, without its signed bytes or its salt.
    const facts = await cli("facts");
    const f = JSON.parse(facts.out) as { state: Record<string, string>; transactions: { key: string; status: string }[] };
    expect(f.transactions.map((t) => [t.key, t.status])).toEqual(["fund-issuer", "fund-creditor", "fund-financier", "fund-payer", "deploy", "mint", "offer", "financier-approve", "accept", "payer-approve", "settle"].map((k) => [k, "success"]));
    expect(Object.keys(f.state)).not.toContain("ref_salt");
    expect(facts.out).not.toMatch(/"raw"/);

    // record: the run record, written from the ledger and the call log with no request.
    const notes = join(dir, "notes.txt");
    writeFileSync(notes, "verify stopped once on an HTTP 500 and was run again.\n");
    const rec = await step("record", 0, /RECORDED .*docs\/runs\/\d{4}-\d\d-\d\d-tokenize\.md\n {9}.*-tokenize\.json\n {9}11 transactions, 47 calls of 60; no request was made/, { TOKENIZE_DEVIATIONS: notes, TOKENIZE_GO_NOTE: "given in the test" });
    expect(rec.requests).toEqual([]);
    const date = /(\d{4}-\d\d-\d\d)-tokenize\.md/.exec(rec.out)![1];
    const record = JSON.parse(readFileSync(join(dir, "repo/docs/runs", `${date}-tokenize.json`), "utf8")) as TokenizeRunRecord;
    expect(record).toMatchObject({ go: "given in the test", calls: { used: 47, budget_total: 60, by_command: { preflight: 7, fund: 14, deploy: 4, mint: 4, finance: 10, settle: 6, verify: 2 } }, verify: { ok: true }, deviations: { from_ledger: [], notes: "verify stopped once on an HTTP 500 and was run again." } });
    expect(readFileSync(join(dir, "repo/docs/runs", `${date}-tokenize.md`), "utf8")).toContain("- Calls used: 47 of 60 (from `TOKENIZE_CALL_LOG`)");
    // Nothing was written into this checkout's docs.
    expect(existsSync(join(ROOT, "docs/runs", `${date}-tokenize.json`)) && readFileSync(join(ROOT, "docs/runs", `${date}-tokenize.json`), "utf8").includes("given in the test")).toBe(false);

    // The RPC URL is a credential: no line of any command carried its endpoint part, or a private key.
    const everything = all.join("\n") + facts.out;
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toMatch(/privateKey/);
    expect(readFileSync(env.TOKENIZE_CALL_LOG!, "utf8")).not.toContain(SECRET);
  }, 240_000);

  it("the stand-in is the one command that loads the in-memory chain (the preload stops it; without the preload it passes)", async () => {
    const blocked = await cli("stand-in");
    expect(blocked.code).not.toBe(0);
    expect(blocked.out).toMatch(/the in-memory chain was loaded: @ethereumjs\//);
    const ok = await cli("stand-in", {}, { chain: true });
    expect({ code: ok.code, out: ok.out }).toMatchObject({ code: 0 });
    expect(ok.out).toMatch(/STAND-IN OK: \d+ RPC requests on the in-memory chain/);
    expect(ok.requests).toEqual([]); // nothing reached even this machine's server
  }, 120_000);
});
