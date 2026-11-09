// A throwaway platform signing key for tests (red team 6): Purser Cloud signs a company's binding to its own connected
// account with it, the runner checks it with the public half (PURSER_PLATFORM_PUBLIC_KEY) and its own tenant id
// (PURSER_TENANT_ID). Generated per test process; never a real key.
import { generateKeyPairSync } from "node:crypto";
import { signBinding } from "../../cloud/src/awxPlatform.js";
import { BINDING_TTL_MS, type AccountBinding, type PlatformStatus } from "../../src/airwallex/platform.js";
import { storeBinding } from "../../src/airwallex/binding.js";
import type { DB } from "../../src/db/open.js";

const pair = generateKeyPairSync("ed25519");
export const PLATFORM_PRIVATE_KEY = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
export const PLATFORM_PUBLIC_KEY = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
export const TENANT = "t_northwind01";
export const PURSER_FEE_ACCOUNT = "acct_purser_platform";

/** The environment a runner of TENANT needs to check bindings. */
export const BINDING_ENV = { PURSER_PLATFORM_PUBLIC_KEY: PLATFORM_PUBLIC_KEY, PURSER_TENANT_ID: TENANT };

export function binding(over: Partial<AccountBinding> = {}, now = new Date()): AccountBinding {
  return { v: 1, tenant: TENANT, account_id: "acct_northwind", status: "active" as PlatformStatus, name: "Northwind Outdoor B.V.", fee_account: PURSER_FEE_ACCOUNT,
    issued_at: now.getTime(), expires_at: now.getTime() + BINDING_TTL_MS, ...over };
}

/** Signs a binding with the test platform key (or another key) and stores it as the cloud sync would. */
export async function bind(db: DB, over: Partial<AccountBinding> = {}, opts: { now?: Date; key?: string } = {}): Promise<string> {
  const token = await signBinding(opts.key ?? PLATFORM_PRIVATE_KEY, binding(over, opts.now));
  storeBinding(db, token, opts.now ?? new Date());
  return token;
}
