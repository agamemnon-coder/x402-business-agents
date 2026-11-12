// Why the Metal account refused a call, in words: the account's custom error decoded from the revert data, never
// "unknown reason". Breaks if a known error is not named, if an unknown one is passed off as known or hidden, if the
// revert data is not found inside the errors viem and a node hand back, or if the list of OpenZeppelin errors drifts
// from the pinned sources it is copied from. No network.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, encodeErrorResult, parseAbi, parseAbiParameters, toFunctionSelector, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { mandateBindingAbi } from "@metalntwx/metal-pay/mandates";
import { ACCOUNT_ERRORS, decodeRevert, OPENZEPPELIN_ERRORS, revertDataOf, whyRefused } from "../src/metal/accountErrors.js";

const oz = parseAbi(OPENZEPPELIN_ERRORS);

describe("a revert, decoded", () => {
  it("names Metal's Mandate Binding errors", () => {
    expect(decodeRevert(encodeErrorResult({ abi: mandateBindingAbi, errorName: "AlreadyRevoked" }))).toBe("AlreadyRevoked()");
    expect(decodeRevert(encodeErrorResult({ abi: mandateBindingAbi, errorName: "OnlySelf" }))).toBe("OnlySelf()");
  });

  it("names OpenZeppelin's account errors with their arguments", () => {
    expect(decodeRevert(encodeErrorResult({ abi: oz, errorName: "MultiSignerERC7913UnreachableThreshold", args: [1n, 2n] }))).toBe("MultiSignerERC7913UnreachableThreshold(signers 1, threshold 2)");
    expect(decodeRevert(encodeErrorResult({ abi: oz, errorName: "InvalidAccountNonce", args: ["0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea", 7n] }))).toBe("InvalidAccountNonce(account 0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea, currentNonce 7)");
    const signer = `0x${"ab".repeat(84)}` as Hex;
    expect(decodeRevert(encodeErrorResult({ abi: oz, errorName: "MultiSignerERC7913NonexistentSigner", args: [signer] }))).toBe(`MultiSignerERC7913NonexistentSigner(signer ${signer.slice(0, 18)}… (84 bytes))`);
  });

  it("reads a require message and a panic code", () => {
    expect(decodeRevert(`0x08c379a0${encodeAbiParameters(parseAbiParameters("string"), ["mandate: not yet"]).slice(2)}`)).toBe('revert "mandate: not yet"');
    expect(decodeRevert(`0x4e487b71${encodeAbiParameters(parseAbiParameters("uint256"), [0x11n]).slice(2)}`)).toBe("panic 0x11 (arithmetic overflow or underflow)");
  });

  it("shows an error it does not know by its selector, and says it does not know it", () => {
    expect(decodeRevert("0xdeadbeef000000000000000000000000000000000000000000000000000000000000002a")).toBe("custom error 0xdeadbeef with 32 bytes of arguments (not in Purser's error lists for the Metal account)");
    expect(decodeRevert("0xdeadbeef")).toBe("custom error 0xdeadbeef (not in Purser's error lists for the Metal account)");
  });

  it("says so when the chain gave no revert data at all", () => {
    for (const none of [null, undefined, "0x"] as const) expect(decodeRevert(none)).toBe("reverted without revert data (the account gave no reason)");
  });

  it("finds the revert data inside the errors a node and viem hand back", () => {
    const data = encodeErrorResult({ abi: mandateBindingAbi, errorName: "UnknownMandate" });
    expect(revertDataOf(Object.assign(new Error("execution reverted"), { code: 3, data }))).toBe(data);
    expect(revertDataOf(Object.assign(new Error("call failed"), { cause: Object.assign(new Error("reverted"), { cause: Object.assign(new Error("rpc"), { data }) }) }))).toBe(data);
    expect(revertDataOf(Object.assign(new Error("x"), { data: { message: "execution reverted", data } }))).toBe(data);
    expect(revertDataOf(new Error("socket hang up"))).toBeNull();
    expect(revertDataOf(Object.assign(new Error("x"), { data: "not hex" }))).toBeNull();
  });
});

describe("why a call would be refused, from one read-only call", () => {
  it("is the decoded error when the call reverts, and null when it passes", async () => {
    const data = encodeErrorResult({ abi: mandateBindingAbi, errorName: "AlreadyRevoked" });
    expect(await whyRefused(async () => { throw Object.assign(new Error("execution reverted"), { code: 3, data }); })).toBe("AlreadyRevoked()");
    expect(await whyRefused(async () => "0x")).toBeNull();
  });

  it("is the node's own words for a revert with no data, and never a network failure passed off as a refusal", async () => {
    expect(await whyRefused(async () => { throw Object.assign(new Error("execution reverted: expired"), { code: 3 }); })).toBe("reverted without revert data (the account gave no reason); the node said: execution reverted: expired");
    await expect(whyRefused(async () => { throw new Error("fetch failed"); })).rejects.toThrow(/fetch failed/);
  });
});

describe("the error lists", () => {
  it("hold every Mandate Binding error of the pinned SDK, and no selector twice", () => {
    const names = ACCOUNT_ERRORS.map((e) => e.name);
    for (const e of mandateBindingAbi.filter((x) => x.type === "error")) expect(names).toContain(e.name);
    const selectors = ACCOUNT_ERRORS.map((e) => toFunctionSelector(e as never));
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it("copy each OpenZeppelin error word for word from the pinned sources (5.6.1)", () => {
    const root = join(import.meta.dirname, "../node_modules/@openzeppelin/contracts");
    expect((JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version).toBe("5.6.1");
    const sol = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? sol(p) : f.endsWith(".sol") ? [readFileSync(p, "utf8")] : []; });
    const declared = new Set(sol(root).flatMap((text) => [...text.matchAll(/^\s*(error \w+\([^)]*\));/gm)].map((m) => m[1]!.replace(/\s+/g, " "))));
    expect(OPENZEPPELIN_ERRORS.length).toBeGreaterThan(10);
    for (const e of OPENZEPPELIN_ERRORS) expect(declared, e).toContain(e);
  });
});
