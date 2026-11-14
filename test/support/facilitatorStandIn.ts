// Alta's x402 facilitator, stood in for the tests that build the seller or a supplier (src/servers/*.ts). Their x402
// middleware asks the facilitator's GET /supported when the app is built; offline, it gets this answer instead: the two
// kinds Purser's routes accept on Alta testnet (exact for x402, bajillion for clearing; src/servers/seller.ts), in the
// shape the facilitator's /supported uses (test/contract/metal-facilitator.test.ts). No test here depends on more.
// Use in a test file: vi.mock("@x402/core/server", async (orig) => (await import("./support/facilitatorStandIn.js")).standInServer(await orig()));

export const STAND_IN_SUPPORTED = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: "eip155:63825" },
    { x402Version: 2, scheme: "bajillion", network: "eip155:63825" },
  ],
  extensions: [] as string[],
  signers: {} as Record<string, string[]>,
};

export function standInServer<T extends { HTTPFacilitatorClient: new (...a: never[]) => object }>(real: T): T {
  class StandInFacilitator extends (real.HTTPFacilitatorClient as unknown as new (...a: unknown[]) => object) {
    async getSupported() { return structuredClone(STAND_IN_SUPPORTED); }
  }
  return { ...real, HTTPFacilitatorClient: StandInFacilitator };
}
