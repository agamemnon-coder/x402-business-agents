// Vitest setup (vitest.config.ts setupFiles): the suite runs with no live key and no external network, whatever this
// machine holds. The live keys are removed from this worker's environment, so neither the code under test nor a CLI it
// starts can find them; the network guard refuses any request to a host that is not this machine, here and in every
// child process (NODE_OPTIONS). A test that needs a rail uses a stand-in or a stubbed fetch, as all of them do.
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const LIVE_KEYS = [
  "KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_CALL_BUDGET", "AIRWALLEX_CALL_LOG",
  "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "CLOUDFLARE_API_TOKEN", "HUB_PUSH_TOKEN",
] as const;
for (const k of LIVE_KEYS) delete process.env[k];

const guard = resolve(import.meta.dirname, "no-network.cjs");
createRequire(import.meta.url)(guard);
if (!(process.env.NODE_OPTIONS ?? "").includes(guard)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(guard)}`.trim();
