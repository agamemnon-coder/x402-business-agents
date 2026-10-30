// Four eyes on chain (enterprise item 1): what Purser builds for a 2-of-2 Metal account must be exactly what Metal's
// own code builds, so the account judges the signatures and not our encoding. The live proof (one signature reverts,
// two pass) is docs/runs/2026-10-31-four-eyes.md.
import { decodeFunctionData, encodeFunctionData, erc20Abi, recoverAddress, decodeAbiParameters, parseAbiParameters, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { authorizeMandateCall, metalAccountCode } from "@metalntwx/metal-pay/mandates";
import { accountAbi, accountConfig, executeDigest, executionData, quorumSignature, signedExecution, sortedOwners } from "../src/metal/fourEyes.js";

const cfo = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
const controller = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const stranger = privateKeyToAccount("0x3333333333333333333333333333333333333333333333333333333333333333");
const ACCOUNT = "0x00000000000000000000000000000000000000aa" as Address;
const FACTORY = "0x3dbED5DebA965A639bB0Fd40BE96b97922070FA8" as Address;
const IMPL = "0x00000000000000000000000000000000000000ff" as Address;
const CHAIN = 63825;

describe("a 2-of-2 account for the CFO and the controller", () => {
  it("orders the owners by address, refuses one twice, and a threshold above the owners", () => {
    const owners = [controller.address, cfo.address];
    expect(sortedOwners(owners)).toEqual([...owners].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    expect(() => sortedOwners([cfo.address, cfo.address])).toThrow(/twice/);
    expect(accountConfig(owners, 2)[2]).toBe(2n);
    expect(() => accountConfig(owners, 3)).toThrow(/threshold/);
    expect(() => accountConfig(owners, 0)).toThrow(/threshold/);
  });

  it("signs the digest with each owner's own key, so each signature recovers to its owner", async () => {
    const digest = executeDigest({ chainId: CHAIN, account: ACCOUNT, data: executionData([]), nonce: 7n, validUntil: 1_900_000_000n });
    const [signers, sigs] = decodeAbiParameters(parseAbiParameters("bytes[], bytes[]"), await quorumSignature(digest, [controller, cfo]));
    expect(signers.length).toBe(2);
    for (let i = 0; i < 2; i++) expect((await recoverAddress({ hash: digest, signature: sigs[i]! })).toLowerCase()).toBe(signers[i]!.toLowerCase());
    await expect(quorumSignature(digest, [cfo, cfo])).rejects.toThrow(/twice/);
  });

  it("builds exactly the executeSigned Metal's own authorizeMandateCall builds for the same call, nonce and keys", async () => {
    const selfCall = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [stranger.address, 0n] });
    const client = {
      chain: { id: CHAIN },
      getCode: async () => metalAccountCode(IMPL),
      readContract: async (a: { functionName: string }) => (a.functionName === "implementation" ? IMPL : 0n),
    } as unknown as PublicClient;
    const validUntil = 1_900_000_000n;
    const theirs = await authorizeMandateCall(client, FACTORY, { to: ACCOUNT, data: selfCall, gas: 100_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n }, validUntil,
      (digest) => quorumSignature(digest, [cfo, controller]));
    const args = decodeFunctionData({ abi: accountAbi, data: theirs.data }).args as readonly [Hex, Hex, bigint, bigint, Hex];
    const ours = await signedExecution({ chainId: CHAIN, account: ACCOUNT, calls: [{ target: ACCOUNT, value: 0n, callData: selfCall }], nonce: args[2], validUntil, signers: [cfo, controller] });
    expect(ours).toBe(theirs.data);
  });
});
