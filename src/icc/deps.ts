// The ICC rail's live dependencies, from the environment (src/icc/config.ts): the client with its keys, budget and
// log, and the owner's private file with the device and assurance data, which is opened only at the moment an
// instruction is sent. Built from the public documentation; nothing here has been sent to the service.

import { iccClientFromEnv, readAssuranceFile } from "./config.js";
import type { IccDeps } from "./purchase.js";

/** Throws, naming what is not set or not valid, unless the environment is complete for a purchase. Calls nothing. */
export function liveIccDeps(say: (line: string) => void, env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): IccDeps {
  const { client, config } = iccClientFromEnv(env, "purchase");
  return { client, passthrough: () => readAssuranceFile(config.assuranceFile ?? ""), say, env };
}
