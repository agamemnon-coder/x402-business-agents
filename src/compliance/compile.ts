// Compiles contracts/ComplianceSendPolicy.sol with the pinned solc (0.8.36, EVM paris, optimizer on) into
// contracts/ComplianceSendPolicy.json: the ABI, the creation bytecode, the compiler and the source's SHA-256.
// test/compliance-contract.test.ts compiles it again and must get the same bytecode, so the committed artifact is
// exactly what this source makes. npm run contracts writes it.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Abi, Hex } from "viem";

const SOURCE = new URL("../../contracts/ComplianceSendPolicy.sol", import.meta.url);
export const ARTIFACT = new URL("../../contracts/ComplianceSendPolicy.json", import.meta.url);

export interface Artifact { contract: string; compiler: string; evmVersion: string; optimizer: { enabled: boolean; runs: number }; source_sha256: string; abi: Abi; bytecode: Hex }

export function compileSendPolicy(): Artifact {
  const solc = createRequire(import.meta.url)("solc") as { version: () => string; compile: (input: string) => string };
  const source = readFileSync(SOURCE, "utf8");
  const settings = { evmVersion: "paris", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } };
  const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "ComplianceSendPolicy.sol": { content: source } }, settings }))) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>;
  };
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts["ComplianceSendPolicy.sol"]!.ComplianceSendPolicy!;
  return {
    contract: "ComplianceSendPolicy", compiler: `solc ${solc.version()}`, evmVersion: settings.evmVersion, optimizer: settings.optimizer,
    source_sha256: createHash("sha256").update(source, "utf8").digest("hex"), abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` as Hex,
  };
}

export const loadArtifact = (): Artifact => JSON.parse(readFileSync(ARTIFACT, "utf8")) as Artifact;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const a = compileSendPolicy();
  writeFileSync(ARTIFACT, JSON.stringify(a, null, 2) + "\n");
  console.log(`contracts/ComplianceSendPolicy.json: ${a.compiler}, ${(a.bytecode.length - 2) / 2} bytes`);
}
