// Compiles contracts/PurserInvoiceToken.sol (and the in-memory *USDZ stand-in, contracts/TestUsdStandIn.sol) with the
// pinned solc (0.8.36, EVM cancun as for the passkey verifier, optimizer on) against the pinned OpenZeppelin 5.6.1 into
// contracts/<Name>.json: ABI, creation bytecode, compiler and the source's SHA-256. test/tokenize-contract.test.ts
// compiles again and must get the same bytecode, so the committed artifact is exactly what the source makes.
// Run: npx tsx src/tokenize/compile.ts

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Abi, Hex } from "viem";

const require = createRequire(import.meta.url);
export type ContractName = "PurserInvoiceToken" | "TestUsdStandIn";
const sourceUrl = (n: ContractName) => new URL(`../../contracts/${n}.sol`, import.meta.url);
export const artifactUrl = (n: ContractName) => new URL(`../../contracts/${n}.json`, import.meta.url);

export interface TokenArtifact { contract: string; compiler: string; evmVersion: string; optimizer: { enabled: boolean; runs: number }; openzeppelin: string; source_sha256: string; abi: Abi; bytecode: Hex }

export function compileContract(name: ContractName): TokenArtifact {
  const solc = require("solc") as { version: () => string; compile: (input: string, cb: { import: (p: string) => { contents: string } | { error: string } }) => string };
  const nodeModules = dirname(dirname(dirname(require.resolve("@openzeppelin/contracts/package.json"))));
  const oz = (JSON.parse(readFileSync(join(nodeModules, "@openzeppelin/contracts/package.json"), "utf8")) as { version: string }).version;
  const source = readFileSync(sourceUrl(name), "utf8");
  const settings = { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } };
  const file = `${name}.sol`;
  const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { [file]: { content: source } }, settings }), {
    import: (p) => { try { return { contents: readFileSync(join(nodeModules, p), "utf8") }; } catch { return { error: `not found: ${p}` }; } },
  })) as { errors?: { severity: string; formattedMessage: string }[]; contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>> };
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts[file]![name]!;
  return {
    contract: name, compiler: `solc ${solc.version()}`, evmVersion: settings.evmVersion, optimizer: settings.optimizer, openzeppelin: oz,
    source_sha256: createHash("sha256").update(source, "utf8").digest("hex"), abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` as Hex,
  };
}

export const loadContract = (name: ContractName): TokenArtifact => JSON.parse(readFileSync(artifactUrl(name), "utf8")) as TokenArtifact;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  for (const n of ["PurserInvoiceToken", "TestUsdStandIn"] as const) {
    const a = compileContract(n);
    writeFileSync(artifactUrl(n), JSON.stringify(a, null, 2) + "\n");
    console.log(`contracts/${n}.json: ${a.compiler}, OpenZeppelin ${a.openzeppelin}, ${(a.bytecode.length - 2) / 2} bytes`);
  }
}
