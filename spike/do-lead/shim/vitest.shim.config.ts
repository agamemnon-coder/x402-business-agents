// SPIKE: the engine's own Node tests with every ledger handle replaced by the Durable Object shim (openShim.ts).
//   npx vitest run --config spike/do-lead/shim/vitest.shim.config.ts --maxWorkers=2 test/ap-pay.test.ts …
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../../vitest.config.js";

const here = dirname(fileURLToPath(import.meta.url));
export default mergeConfig(base, defineConfig({
  root: resolve(here, "../../.."),
  resolve: { alias: [{ find: /^(\.\.?\/)+(src\/)?db\/open\.js$/, replacement: resolve(here, "openShim.ts") }, { find: /^\.\/open\.js$/, replacement: resolve(here, "openShim.ts") }] },
}));
