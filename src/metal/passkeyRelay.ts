// Block 1: the gas sponsor that relays an owners_execute. Its key (passkey-sponsor.key.json in the world's keys dir)
// pays gas and nothing else: it is no owner of the passkey account, so it cannot move a cent of it.
// It relays behind the owners call budget (src/metal/ownersBudget.ts), in the runner as in the CLI: the transaction is
// signed here, its hash handed over before it leaves (the executor records it first), and nothing is sent that the
// chain would revert.

import type { Address, Hex, LocalAccount } from "viem";
import type { Relay } from "../executors/ownersExecute.js";
import { hasKey } from "./agentCli.js";
import { plainKey } from "./keyFiles.js";
import { ownersBudget } from "./ownersBudget.js";
import { ownersChain, type OwnersChain } from "./ownersChain.js";
import { chainStep } from "./ownersTx.js";

/** OpenZeppelin 5.6.1 ERC7913WebAuthnVerifier on Metal testnet (deployed 1 November, docs/runs/passkey-owners.json). */
export const PASSKEY_VERIFIER = "0xd4c84c2bea087053691623bc463da61b528755ab" as Address;
export const ACCOUNT_FACTORY = "0x3dbED5DebA965A639bB0Fd40BE96b97922070FA8" as Address;
export const SPONSOR_KEY = "passkey-sponsor.key.json";
/** What relaying one account call takes at least: a gas estimate, the sponsor's nonce, the send, one receipt read. */
export const RELAY_CALLS = 4;

export function passkeySponsor() {
  return plainKey(SPONSOR_KEY);
}

/** Relays account calls from the sponsor over the budgeted chain. A call the chain would revert is not sent (ChainRefused carries the reason). */
export function ownersRelay(chain: OwnersChain, sponsor: LocalAccount): Relay {
  const step = (to: Address, data: Hex) => chainStep(chain, {
    from: sponsor.address,
    gas: () => chain.gasFor(sponsor.address, to, data, "the account call"),
    sign: (as) => chain.signCall(sponsor, to, data, { nonce: as.nonce, gas: as.gas! }),
  });
  return {
    send: (to, data, onSigned = () => {}) => {
      // Asked before anything is signed: a relay that could send but not confirm would stop halfway.
      chain.budget.need(RELAY_CALLS, "relaying the account call");
      return step(to, data).send(onSigned);
    },
    wait: async (tx) => (await chain.wait(tx)).ok,
    again: (to, data, earlier) => step(to, data).again!(earlier),
    why: (to, data) => chain.why(sponsor.address, to, data),
  };
}

/**
 * The runner's relay: Metal testnet behind the owners guard and call budget. Throws OwnersGuardRefused, having called
 * nothing, unless OWNERS_GO=yes, OWNERS_CALL_BUDGET and OWNERS_CALL_LOG are set. `step` names its calls in the log.
 */
export function liveRelay(step = "execute"): Relay {
  const budget = ownersBudget();
  // The runner relays with the key setup made and funded; it never makes one (a wrong keys folder would get a new, empty key).
  if (!hasKey(SPONSOR_KEY)) throw new Error(`no gas sponsor key (${SPONSOR_KEY}) in this runner's keys folder: run npm run owners -- setup, or point KIT11_KEYS_DIR at the world's keys. Nothing was called.`);
  const chain = ownersChain({ budget });
  chain.step(step);
  return ownersRelay(chain, passkeySponsor());
}
