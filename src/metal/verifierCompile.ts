// Compiles OpenZeppelin's audited ERC7913WebAuthnVerifier (@openzeppelin/contracts 5.6.1, pinned) with the pinned solc
// (0.8.36, EVM cancun: OpenZeppelin uses MCOPY, which Metal testnet runs, tested 1 November) into
// contracts/ERC7913WebAuthnVerifier.json. test/passkey-verifier.test.ts compiles it again and must get the same bytecode,
// so the committed artifact is exactly OpenZeppelin's source. Run: npx tsx src/metal/verifierCompile.ts

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Abi, Hex } from "viem";

const require = createRequire(import.meta.url);
export const VERIFIER_ARTIFACT = new URL("../../contracts/ERC7913WebAuthnVerifier.json", import.meta.url);
const OZ = "@openzeppelin/contracts/utils/cryptography/verifiers/ERC7913WebAuthnVerifier.sol";

export interface VerifierArtifact { contract: string; source: string; openzeppelin: string; compiler: string; evmVersion: string; optimizer: { enabled: boolean; runs: number }; abi: Abi; bytecode: Hex; bytecode_sha256: string }

export function compileVerifier(): VerifierArtifact {
  const solc = require("solc") as { version: () => string; compile: (input: string, cb: { import: (p: string) => { contents: string } | { error: string } }) => string };
  const ozRoot = dirname(dirname(dirname(require.resolve("@openzeppelin/contracts/package.json")))); // node_modules
  const ozVersion = (JSON.parse(readFileSync(join(ozRoot, "@openzeppelin/contracts/package.json"), "utf8")) as { version: string }).version;
  const settings = { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } };
  const input = { language: "Solidity", sources: { [OZ]: { content: readFileSync(join(ozRoot, OZ), "utf8") } }, settings };
  const out = JSON.parse(solc.compile(JSON.stringify(input), {
    import: (p) => { try { return { contents: readFileSync(join(ozRoot, p), "utf8") }; } catch { return { error: `not found: ${p}` }; } },
  })) as { errors?: { severity: string; formattedMessage: string }[]; contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>> };
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts[OZ]!.ERC7913WebAuthnVerifier!;
  const bytecode = `0x${c.evm.bytecode.object}` as Hex;
  return {
    contract: "ERC7913WebAuthnVerifier", source: OZ, openzeppelin: ozVersion, compiler: `solc ${solc.version()}`, evmVersion: settings.evmVersion, optimizer: settings.optimizer,
    abi: c.abi, bytecode, bytecode_sha256: createHash("sha256").update(bytecode).digest("hex"),
  };
}

export const loadVerifier = (): VerifierArtifact => JSON.parse(readFileSync(VERIFIER_ARTIFACT, "utf8")) as VerifierArtifact;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const a = compileVerifier();
  writeFileSync(VERIFIER_ARTIFACT, JSON.stringify(a, null, 2) + "\n");
  console.log(`contracts/ERC7913WebAuthnVerifier.json: OpenZeppelin ${a.openzeppelin}, ${a.compiler}, ${(a.bytecode.length - 2) / 2} bytes`);
}
