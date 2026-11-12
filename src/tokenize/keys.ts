// The run's four test keys, one per role: <role>.key.json with `address` and `privateKey`, mode 600, in
// KIT11_KEYS_DIR (outside the repository, src/tokenize/guard.ts). Only `npm run tokenize -- fund` creates a missing
// key; every other command refuses without it. A private key is never printed, logged or put in an error.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const ROLES = ["issuer", "creditor", "financier", "payer"] as const;
export type Role = (typeof ROLES)[number];
export type RoleKeys = Record<Role, PrivateKeyAccount>;

export const keyFile = (dir: string, role: Role) => join(dir, `${role}.key.json`);

/** A key file as metal-agent writes it ({ address, privateKey }); refused when the address is not the key's own. */
export function readKey(path: string): PrivateKeyAccount {
  let k: { address?: unknown; privateKey?: unknown };
  try { k = JSON.parse(readFileSync(path, "utf8")) as typeof k; } catch { throw new Error(`cannot read the key file ${path}`); }
  if (typeof k.privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(k.privateKey)) throw new Error(`not a key file (no private key in it): ${path}`);
  const account = privateKeyToAccount(k.privateKey as Hex);
  if (typeof k.address !== "string" || k.address.toLowerCase() !== account.address.toLowerCase()) throw new Error(`the address in ${path} is not its key's own`);
  return account;
}

/** The roles that have no key file yet. */
export const missingRoles = (dir: string): Role[] => ROLES.filter((r) => !existsSync(keyFile(dir, r)));

/** Creates the missing role keys (fund only): directory mode 700, each file mode 600, never overwriting one. */
export function createRoleKeys(dir: string): Role[] {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const made: Role[] = [];
  for (const role of missingRoles(dir)) {
    const privateKey = generatePrivateKey();
    const f = keyFile(dir, role);
    writeFileSync(f, JSON.stringify({ address: privateKeyToAccount(privateKey).address, privateKey }) + "\n", { mode: 0o600, flag: "wx" });
    chmodSync(f, 0o600);
    made.push(role);
  }
  return made;
}

/** All four role keys; throws naming the roles that have none. */
export function roleKeys(dir: string): RoleKeys {
  const missing = missingRoles(dir);
  if (missing.length) throw new Error(`no key for ${missing.join(", ")} in KIT11_KEYS_DIR`);
  return Object.fromEntries(ROLES.map((r) => [r, readKey(keyFile(dir, r))])) as RoleKeys;
}
