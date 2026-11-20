// Purser Cloud's tenant-scoped data layer (cloud/src/tenant.ts): every read, write and delete is bound to the caller's
// company, a column must be on the table's allowlist, only a few tables ever lose rows, an empty "in" matches nothing
// (never everything), a lost race is a WriteConflict and any other failure stays what it was; and the guard that keeps
// some owner's passkey when two owners remove each other's last ones at once.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TenantDb, WriteConflict } from "../cloud/src/tenant.js";
import type { Sql } from "../cloud/src/store.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud, a: TestTenant, b: TestTenant;
beforeEach(async () => { c = testCloud(); a = await c.tenant("acme"); b = await c.tenant("bolt"); });
afterEach(() => c.close());
const db = (t: TestTenant) => new TenantDb(c.env.sql, t.id);
const iso = () => c.clock.now.toISOString();

describe("bound to one company", () => {
  it("refuses a tenant id that is not one", () => {
    for (const id of ["", "acme", "t_x", "t_acme;DROP", `t_${"a".repeat(65)}`]) expect(() => new TenantDb(c.env.sql, id)).toThrow("bad tenant id");
  });

  it("never reads, changes or deletes another company's rows", async () => {
    const hookB = { id: "wh_b", url: "https://hooks.example/b", secret: "s", created_at: iso(), created_by: "x", consecutive_failures: 0 };
    await db(b).apply([db(b).insert("webhooks", hookB)]);
    expect(await db(a).select("webhooks", { id: "wh_b" })).toEqual([]);
    expect(await db(a).count("webhooks")).toBe(0);
    expect(await db(a).change(db(a).update("webhooks", { id: "wh_b" }, { url: "https://evil.example" }))).toBe(0);
    expect(await db(a).change(db(a).delete("webhooks", { id: "wh_b" }))).toBe(0);
    expect(await db(b).one("webhooks", { id: "wh_b" })).toMatchObject({ url: "https://hooks.example/b" });
  });
});

describe("only what the allowlist names", () => {
  it("refuses a column a table does not have, in a filter, an order, an insert or an update", async () => {
    await expect(db(a).select("users", { password: "x" })).rejects.toThrow("no column password on users");
    await expect(db(a).select("users", {}, { order: ["created_at; DROP TABLE users"] })).rejects.toThrow(/^no column created_at; DROP TABLE users on users$/);
    expect(() => db(a).insert("users", { id: "u", tenant_id: "t_other123" })).toThrow("no column tenant_id on users");
    expect(() => db(a).update("users", { id: "u" }, { role: "owner", tenant_id: "t_other123" })).toThrow("no column tenant_id on users");
    expect(() => db(a).update("users", { id: "u" }, {})).toThrow("nothing to update");
  });

  it("deletes only from the few tables whose rows may go", () => {
    for (const t of ["users", "api_keys", "audit_rows", "ledger_entries", "payments"] as const) expect(() => db(a).delete(t, {})).toThrow(`rows of ${t} are never deleted`);
    for (const t of ["credentials", "webhooks", "alert_targets", "chat_hooks", "identity_links"] as const) expect(() => db(a).delete(t, {})).not.toThrow();
  });

  it("an empty 'in' matches nothing; a null is IS NULL; an operator compares", async () => {
    const users = await db(a).select<{ id: string }>("users");
    expect(users.length).toBeGreaterThan(0);
    expect(await db(a).select("users", { id: { in: [] } })).toEqual([]);
    expect(await db(a).count("users", { id: { in: [users[0]!.id, "nobody"] } })).toBe(1);
    expect(await db(a).count("users", { erased_at: null })).toBe(users.length);
    expect(await db(a).count("users", { created_at: { op: ">", v: "9999" } })).toBe(0);
    expect(await db(a).select("users", {}, { limit: -5 })).toEqual([]);
    expect(await db(a).select("users", {}, { limit: 1.9 })).toHaveLength(1);
  });
});

describe("a batch", () => {
  it("a failed constraint is a lost race (WriteConflict), and nothing of the batch stays", async () => {
    const hook = { id: "wh_1", url: "https://hooks.example/1", secret: "s", created_at: iso(), created_by: "x", consecutive_failures: 0 };
    await db(a).apply([db(a).insert("webhooks", hook)]);
    const e = await db(a).apply([db(a).insert("webhooks", { ...hook, id: "wh_2" }), db(a).insert("webhooks", hook)]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WriteConflict);
    expect((e as WriteConflict).message).toMatch(/^write conflict: /);
    expect(await db(a).count("webhooks")).toBe(1);
    await expect(db(a).apply([])).resolves.toBeUndefined();
  });

  it("any other failure stays what it was", async () => {
    const down = { batch: async () => { throw new Error("D1_ERROR: database is unavailable"); } } as unknown as Sql;
    const e = await new TenantDb(down, a.id).apply([db(a).insert("push_log", { id: "p", by_key: "k", at: iso() })]).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(WriteConflict);
    expect((e as Error).message).toBe("D1_ERROR: database is unavailable");
    const odd = { batch: async () => { throw "a string"; } } as unknown as Sql;
    await expect(new TenantDb(odd, a.id).apply([db(a).insert("push_log", { id: "p", by_key: "k", at: iso() })])).rejects.toBe("a string");
  });
});

describe("the guard that keeps an owner's passkey", () => {
  it("lets a passkey go while another owner's remains, and refuses the removal of the last one", async () => {
    const creds = await db(a).select<{ credential_id: string; user_id: string }>("credentials");
    expect(creds).toHaveLength(1);
    const last = creds[0]!;
    const e = await db(a).apply([db(a).delete("credentials", { credential_id: last.credential_id }), db(a).ownerPasskeyRemainsGuard(iso())]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WriteConflict);
    expect(await db(a).count("credentials")).toBe(1);
    // A second passkey of an owner: the first may go.
    await db(a).apply([db(a).insert("credentials", { credential_id: "cred-second", user_id: last.user_id, x: "x", y: "y", counter: 0, created_at: iso() })]);
    await db(a).apply([db(a).delete("credentials", { credential_id: last.credential_id }), db(a).ownerPasskeyRemainsGuard(iso())]);
    expect((await db(a).select<{ credential_id: string }>("credentials")).map((r) => r.credential_id)).toEqual(["cred-second"]);
  });
});
