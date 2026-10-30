// The committed contract artifact is exactly what the source compiles to (pinned solc 0.8.36, EVM paris), and the
// contract's decision type is the one Purser signs. The live run on testnet: docs/runs/2026-10-30-compliance-policy.md.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileSendPolicy, loadArtifact } from "../src/compliance/compile.js";

describe("ComplianceSendPolicy", () => {
  it("compiles from its source to the committed bytecode", () => {
    const fresh = compileSendPolicy();
    const committed = loadArtifact();
    expect(committed.source_sha256).toBe(createHash("sha256").update(readFileSync(new URL("../contracts/ComplianceSendPolicy.sol", import.meta.url), "utf8")).digest("hex"));
    expect(fresh.bytecode).toBe(committed.bytecode);
    expect(committed.compiler).toMatch(/^solc 0\.8\.36\+/);
  }, 60_000);

  it("has one way out for the funds, send, and checks a decision of exactly the type Purser signs", () => {
    const src = readFileSync(new URL("../contracts/ComplianceSendPolicy.sol", import.meta.url), "utf8");
    const fns = loadArtifact().abi.filter((x) => x.type === "function" && !["view", "pure"].includes((x as { stateMutability: string }).stateMutability)).map((x) => (x as { name: string }).name);
    expect(fns).toEqual(["send"]);
    expect(src).toContain('keccak256("Decision(bytes32 paymentId,address to,uint256 amount,uint64 validUntil,bytes32 screeningRef)")');
    expect(src).toContain('keccak256("PurserComplianceSendPolicy"), keccak256("1")');
  });
});
