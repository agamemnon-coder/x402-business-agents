// npm run bootstrap (scenario S0). Idempotent: every step checks what already exists and skips it.
// Creates the business account B and the customer account C, the supplier and sweep addresses,
// moves exactly 20.00 *USDZ into B, then issues and binds the four mandates.
// Keys stay in KIT11_KEYS_DIR; nothing secret is printed.

import { existsSync } from "node:fs";
import type { Address } from "viem";
import { audit } from "../audit/log.js";
import { CUSTOMER_MANDATE, INITIAL_MANDATES, MANDATE_EXPIRES_IN_SECONDS, TOTAL_BUDGET_CENTS } from "../config/policy.js";
import { openDb } from "../db/open.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents } from "../lib/money.js";
import { field, keyPath, metalAgent, type CliResult } from "../metal/agentCli.js";
import { readKeyFile, transferUsdz, usdzBalance } from "../metal/chain.js";
import { EXPLORER_TX } from "../metal/network.js";
import { autonomyOn } from "../config/agents.js";
import { SUPPLIERS } from "../config/suppliers.js";

const db = openDb();
const say = (line: string) => console.log(line);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The faucet allows one grant a minute; wait and retry when it says so. */
async function withFaucetRetry(run: () => CliResult): Promise<CliResult> {
  for (let i = 0; ; i++) {
    try {
      return run();
    } catch (err) {
      if (i < 3 && /rate.?limit|try again|retry/i.test((err as Error).message)) {
        say("  faucet asks us to wait; retrying in 65 s");
        await sleep(65_000);
        continue;
      }
      throw err;
    }
  }
}

async function account(file: string, role: "business" | "customer"): Promise<Address> {
  const exists = existsSync(keyPath(file));
  const r = await withFaucetRetry(() => metalAgent(["account", "create", exists ? "--key" : "--out", keyPath(file)]));
  const address = field(r, "account") as Address;
  const tx = r.fields.get("transaction")?.[0] ?? null;
  db.prepare("INSERT OR IGNORE INTO metal_accounts (address, role, created_tx) VALUES (?, ?, ?)").run(address, role, tx);
  db.prepare("INSERT OR IGNORE INTO metal_accounts (address, role) VALUES (?, ?)").run(field(r, "owner"), role === "business" ? "owner" : "customer_owner");
  say(`${role} account ${address}${tx ? ` (created ${EXPLORER_TX}${tx})` : " (exists)"}`);
  return address;
}

function plainKey(file: string, role: "supplier" | "sweep" | "ridgeline"): Address {
  if (!existsSync(keyPath(file))) metalAgent(["key", "create", "--out", keyPath(file)]);
  const { address } = readKeyFile(keyPath(file));
  db.prepare("INSERT OR IGNORE INTO metal_accounts (address, role) VALUES (?, ?)").run(address, role);
  say(`${role} address ${address}`);
  return address;
}

interface MandateSpec {
  agent: string;
  ownerFile: string;
  principal: Address;
  capCents: number;
  budgetCents: number;
  payee: Address;
  payeeName: string;
  /** More payees (D19: with the autonomous agents, the Sourcing mandate may pay Ridgeline Data too). */
  extra?: { address: Address; name: string }[];
}

function mandate(spec: MandateSpec): void {
  const cred = keyPath(`${spec.agent}.credential.json`);
  if (!existsSync(cred)) {
    metalAgent([
      "mandate", "credential", "create",
      "--principal", spec.principal,
      "--cap", fromCents(spec.capCents), "--budget", fromCents(spec.budgetCents),
      "--payee", `${spec.payee},${spec.payeeName}`,
      ...(spec.extra ?? []).flatMap((p) => ["--payee", `${p.address},${p.name}`]),
      "--expires-in", String(MANDATE_EXPIRES_IN_SECONDS),
      "--description", `kit11 P-0000 initial ${spec.agent}`,
      "--key", keyPath(spec.ownerFile), "--out", cred,
    ]);
  }
  const status = metalAgent(["mandate", "status", "--credential", cred]);
  if (status.fields.get("bound")?.[0] === "yes") {
    say(`${spec.agent} mandate already bound: ${status.fields.get("spent")?.[0] ?? ""}`);
    return;
  }
  const r = metalAgent(["mandate", "bind", "--credential", cred, "--key", keyPath(spec.ownerFile)]);
  const tx = r.fields.get("transaction")?.[0];
  audit(db, "owner-signer", "mandate.bound", spec.agent, { principal: spec.principal, cap: fromCents(spec.capCents), budget: fromCents(spec.budgetCents), payee: spec.payee, ...(spec.extra?.length ? { also_payees: spec.extra.map((p) => p.address) } : {}), tx: tx ?? null });
  say(`${spec.agent} mandate bound${tx ? `: ${EXPLORER_TX}${tx}` : ""}`);
}

const B = await account("owner-business.key.json", "business");
const C = await account("owner-customer.key.json", "customer");
const S = plainKey("supplier.key.json", "supplier");
const W = plainKey("sweep.key.json", "sweep");

// C pays for queries from its own balance; the faucet tops it up to 100.
if ((await usdzBalance(C)) < centsToBaseUnits(CUSTOMER_MANDATE.budgetCents)) {
  await withFaucetRetry(() => metalAgent(["fund", C]));
  say(`funded customer account from the faucet`);
}

// B holds exactly the 20.00 the mandates may spend in total, moved from its owner's key.
const bBalance = await usdzBalance(B);
const target = centsToBaseUnits(TOTAL_BUDGET_CENTS);
if (bBalance < target) {
  const tx = await transferUsdz(keyPath("owner-business.key.json"), B, target - bBalance);
  audit(db, "owner-signer", "business.funded", B, { amount: fromCents(baseUnitsToCents(target - bBalance)), tx, origin: { actor: "code", rule: "fund a fresh test world from the Metal testnet faucet (npm run bootstrap)" } });
  say(`moved ${fromCents(baseUnitsToCents(target - bBalance))} *USDZ owner -> business: ${EXPLORER_TX}${tx}`);
}
say(`business account holds ${fromCents(baseUnitsToCents(await usdzBalance(B)))} *USDZ`);

const owner = "owner-business.key.json";
// D19: with the autonomous agents on, a second supplier, so the Sourcing agent has a real choice of whom to pay.
const R = autonomyOn() ? plainKey(SUPPLIERS.ridgeline.keyFile, "ridgeline") : null;
mandate({ agent: "sourcing", ownerFile: owner, principal: B, ...INITIAL_MANDATES.sourcing, payee: S, payeeName: "Stockline", ...(R ? { extra: [{ address: R, name: SUPPLIERS.ridgeline.name }] } : {}) });
mandate({ agent: "support", ownerFile: owner, principal: B, ...INITIAL_MANDATES.support, payee: C, payeeName: "Summit Outfitters" });
mandate({ agent: "treasury", ownerFile: owner, principal: B, ...INITIAL_MANDATES.treasury, payee: W, payeeName: "Northwind sweep" });
mandate({ agent: "customer", ownerFile: "owner-customer.key.json", principal: C, ...CUSTOMER_MANDATE, payee: B, payeeName: "Northwind Outdoor" });
say("bootstrap done");
