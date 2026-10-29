// npm run health: is every outside system we depend on reachable and what we expect?
// Prints one line per check. Exit code 1 if any required check fails.

import { Airwallex, fromEnv } from "../airwallex/client.js";
import { CHAIN_ID, FACILITATOR_ROOT, rpc, type ConsensusStatus } from "../metal/network.js";

type Check = { name: string; run: () => Promise<string>; required: boolean };

const checks: Check[] = [
  {
    name: "metal chain id",
    required: true,
    run: async () => {
      const id = parseInt(await rpc<string>("eth_chainId"), 16);
      if (id !== CHAIN_ID) throw new Error(`expected ${CHAIN_ID}, got ${id}`);
      return String(id);
    },
  },
  {
    name: "metal finality",
    required: true,
    run: async () => {
      const s = await rpc<ConsensusStatus>("consensus_status");
      return `head ${s.head.number}, finalized ${s.finalized.number}`;
    },
  },
  {
    name: "x402 facilitator",
    required: true,
    run: async () => {
      const res = await fetch(`${FACILITATOR_ROOT}/readyz`);
      const body = (await res.json()) as { ok?: boolean };
      if (!res.ok || !body.ok) throw new Error(`readyz ${res.status}`);
      return "ready";
    },
  },
  {
    name: "airwallex sandbox",
    required: false,
    run: async () => {
      const cfg = fromEnv();
      if (!cfg) throw new Error("AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY not set");
      const balances = await new Airwallex(cfg).call<{ currency: string; available_amount: number }[]>("GET", "/balances/current");
      return balances.map((b) => `${b.currency} ${b.available_amount}`).join(", ") || "no balances";
    },
  },
  {
    name: "claude api key",
    required: false,
    run: async () => {
      if (!process.env.KIT11_ANTHROPIC_API_KEY) throw new Error("KIT11_ANTHROPIC_API_KEY not set; deterministic fallback will be used");
      return "set";
    },
  },
];

let failed = false;
for (const c of checks) {
  try {
    console.log(`ok    ${c.name}: ${await c.run()}`);
  } catch (err) {
    if (c.required) failed = true;
    console.log(`${c.required ? "FAIL" : "skip"}  ${c.name}: ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
