// The committed verifier artifact is exactly OpenZeppelin 5.6.1's ERC7913WebAuthnVerifier with the pinned solc: breaks
// if the artifact was edited by hand or the dependency moved.
import { describe, expect, it } from "vitest";
import { compileVerifier, loadVerifier } from "../src/metal/verifierCompile.js";

describe("the WebAuthn verifier artifact", () => {
  it("compiles from the pinned OpenZeppelin source to the committed bytecode", () => {
    const fresh = compileVerifier();
    const committed = loadVerifier();
    expect(committed.openzeppelin).toBe("5.6.1");
    expect(fresh.bytecode).toBe(committed.bytecode);
    expect(fresh.bytecode_sha256).toBe(committed.bytecode_sha256);
  }, 120_000);
});
