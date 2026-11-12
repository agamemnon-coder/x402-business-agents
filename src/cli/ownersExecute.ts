// npm run owners -- preflight | setup | propose | propose-revoke | pay | status
// (block 1, "Face ID signs on chain", behind KIT11_PASSKEY_OWNERS=on; Metal testnet, test money)
//   preflight       checks the settings, makes at most three reads and prints the plan of a live run: each step, its
//                   transactions, its calls, and what the owner does on the phone. Sends nothing
//   setup           a business account whose only owners are the two enrolled passkeys (CFO and controller), threshold 2,
//                   with OpenZeppelin's WebAuthn verifier; the gas sponsor creates it. Needs no bootstrapped world
//   propose         an owners_execute: bind a Sourcing mandate on that account (cap 0.05, budget 0.50, Stockline only).
//                   The phone shows the terms and both passkeys sign the account's Execute digest; the runner relays it
//   propose-revoke  an owners_execute that revokes the mandate this world bound
//   pay             the Sourcing agent's mandate key pays 0.05 inside the mandate; one cent over the cap is refused by
//                   Metal and the refusal recorded on chain
//   status          the mandate as the chain has it
// No server key is an owner: the sponsor (passkey-sponsor.key.json) only pays gas and relays.
//
// Every command calls Metal testnet, so every command needs the owner's go and a call budget: OWNERS_GO=yes,
// OWNERS_CALL_BUDGET (a whole number for this world, counted across commands and the runner) and OWNERS_CALL_LOG (a
// JSONL file each call is appended to before it is sent). OWNERS_DONOR_KEY (a key file) funds the gas sponsor and the
// account with one transfer each; without it the faucet (or KIT11_RECYCLE=on) funds the sponsor. The logic is in
// src/metal/ownersFlow.ts.

import { openDb } from "../db/open.js";
import { redactSecrets } from "../lib/redact.js";
import { metalAgent } from "../metal/agentCli.js";
import { OwnersBudgetSpent, OwnersGuardRefused, ownersBudget } from "../metal/ownersBudget.js";
import { ownersChain, RECEIPT_POLLS } from "../metal/ownersChain.js";
import { callsLine, countedCli, pay, preflight, preflightRefusals, propose, proposeRevoke, setup, status, type OwnersWorld } from "../metal/ownersFlow.js";
import { approvalHint } from "./hint.js";

const COMMANDS = ["preflight", "setup", "propose", "propose-revoke", "pay", "status"] as const;
const cmd = process.argv[2] ?? "status";
const say = (s: string) => console.log(redactSecrets(s));
if (!(COMMANDS as readonly string[]).includes(cmd)) {
  console.error(`usage: npm run owners -- ${COMMANDS.join(" | ")}`);
  process.exit(2);
}

// The guard first: without the owner's go, a budget and a log, nothing is opened and nothing is called.
if (cmd === "preflight") {
  const missing = preflightRefusals(process.env);
  if (missing.length) {
    for (const m of missing) console.error(`MISSING          ${redactSecrets(m)}`);
    console.error("REFUSED          preflight made no call. Set what is missing and run it again.");
    process.exit(2);
  }
}
let world: OwnersWorld;
try {
  const chain = ownersChain({ budget: ownersBudget(process.env) });
  world = {
    db: openDb(), chain, env: process.env, say, now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    cli: countedCli(chain, metalAgent),
    cliOffline: (args) => metalAgent(args),
  };
} catch (e) {
  if (!(e instanceof OwnersGuardRefused)) throw e;
  console.error(e.message);
  process.exit(2);
}

const before = world.chain.budget.used();
let code = 0;
try {
  if (cmd === "preflight") code = (await preflight(world, RECEIPT_POLLS)).ok ? 0 : 1;
  else if (cmd === "setup") await setup(world);
  else if (cmd === "propose" || cmd === "propose-revoke") {
    const { proposal, terms } = await (cmd === "propose" ? propose(world) : proposeRevoke(world));
    say(`                 both passkeys sign the account's Execute digest ${terms.onchain_digest.slice(0, 18)}…; ${approvalHint(world.db, proposal.proposal_id, proposal.terms_sha256.slice(0, 8))}`);
  } else if (cmd === "pay") await pay(world);
  else await status(world);
} catch (e) {
  // A stop by the budget is the budget working: said plainly, with nothing of the error's inner text (it can quote the endpoint).
  console.error(redactSecrets(e instanceof OwnersBudgetSpent ? `STOPPED          ${e.message}` : `FAILED           ${(e as Error).message}`));
  code = e instanceof OwnersBudgetSpent ? 3 : 1;
}
say(callsLine(world, before));
process.exit(code);
