// npm run test-funds -- <address> <usdz> --label <words>: fills one wallet of the world in KIT11_KEYS_DIR with spare test
// money from finished dry runs (src/metal/testFunds.ts, Max's rules of 1 November), up to <usdz>. For a world whose
// own code cannot recycle (the reserve world runs eff08b4): fill its owner keys, then run its bootstrap. Prints the
// address and the outcome only; every transfer is logged with its tx in docs/runs/testgeld-recycling.md.

import type { Address } from "viem";
import { getAddress } from "viem";
import { toCents } from "../lib/money.js";
import { fundTestWallet } from "../metal/testFunds.js";

const [address, usdz, ...rest] = process.argv.slice(2);
const label = rest[0] === "--label" ? rest.slice(1).join(" ") : "";
if (!address || !usdz || !label || !/^\d+(\.\d{1,2})?$/.test(usdz)) {
  console.error("usage: npm run test-funds -- <address> <usdz, e.g. 21.00> --label <what this wallet is>");
  process.exit(2);
}
process.env.KIT11_RECYCLE = "on";
const to = getAddress(address) as Address;
const how = await fundTestWallet(to, toCents(usdz), { label });
console.log(`${to}: ${how === "enough" ? `already holds ${usdz} *USDZ or more` : `filled to ${usdz} *USDZ with recycled test money`}`);
