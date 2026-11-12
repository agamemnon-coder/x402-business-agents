// The cloud's document store without R2 (cloud/src/blobsSql.ts): the bytes kept in the cloud's own database, in parts.
// Plain run: better-sqlite3. With CLOUD_DB=d1 (npm run test:d1): a fresh local D1 database, D1 itself.
import { describe, expect, it } from "vitest";
import { sqlBlobs, BLOB_PART_BYTES } from "../cloud/src/blobsSql.js";
import { sqliteSql } from "../cloud/src/node.js";
import { d1Sql, type Sql } from "../cloud/src/store.js";

const fresh = (): Sql => (process.env.CLOUD_DB === "d1" && globalThis.__cloudD1 ? d1Sql(globalThis.__cloudD1.next()) : sqliteSql());
const bytes = (n: number, seed = 7): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
/** Byte for byte, without the element-by-element diff a deep equal makes of a megabyte. */
const same = (got: Uint8Array | null, want: Uint8Array): boolean => got !== null && Buffer.from(got).equals(Buffer.from(want));

describe("the cloud's document store in its own database (no R2)", () => {
  it("gives back the same bytes it was given, also empty and also over many parts", async () => {
    const blobs = sqlBlobs(fresh());
    const big = bytes(BLOB_PART_BYTES * 3 + 12_345);
    await blobs.put("t/a/docs/big.pdf", big);
    await blobs.put("t/a/docs/empty.pdf", new Uint8Array(0));
    await blobs.put("t/a/docs/small.pdf", bytes(10));
    expect(same(await blobs.get("t/a/docs/big.pdf"), big)).toBe(true);
    expect(await blobs.get("t/a/docs/empty.pdf")).toEqual(new Uint8Array(0));
    expect(await blobs.get("t/a/docs/small.pdf")).toEqual(bytes(10));
    expect(await blobs.get("t/a/docs/none.pdf")).toBeNull();
  });

  it("takes any view of the bytes, and keeps a part well under D1's limit on one value", async () => {
    const sql = fresh();
    const blobs = sqlBlobs(sql);
    const backing = bytes(BLOB_PART_BYTES + 100);
    await blobs.put("k/view", backing.subarray(50, 50 + BLOB_PART_BYTES));
    expect(same(await blobs.get("k/view"), backing.slice(50, 50 + BLOB_PART_BYTES))).toBe(true);
    const longest = await sql.first<{ n: number }>("SELECT MAX(LENGTH(data)) AS n FROM cloud_blob_parts");
    expect(longest!.n).toBeLessThanOrEqual(1_000_000);
  });

  it("replaces what a key held, leaving no part of the earlier bytes behind", async () => {
    const sql = fresh();
    const blobs = sqlBlobs(sql);
    await blobs.put("k/x", bytes(BLOB_PART_BYTES * 2 + 1, 1));
    await blobs.put("k/x", bytes(5, 2));
    expect(await blobs.get("k/x")).toEqual(bytes(5, 2));
    expect((await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM cloud_blob_parts WHERE key = 'k/x'"))!.n).toBe(1);
  });

  it("says what it holds, lists by prefix in order (a prefix is text, not a pattern) and deletes", async () => {
    const blobs = sqlBlobs(fresh());
    for (const k of ["t/b/vault/2.pdf", "t/b/vault/1.pdf", "t/b_x/vault/1.pdf", "t/c/vault/1.pdf", "t/b%/odd.pdf"]) await blobs.put(k, bytes(3));
    expect(await blobs.list("t/b/")).toEqual(["t/b/vault/1.pdf", "t/b/vault/2.pdf"]);
    expect(await blobs.list("t/b%")).toEqual(["t/b%/odd.pdf"]);
    expect(await blobs.list("t/b_")).toEqual(["t/b_x/vault/1.pdf"]);
    expect(await blobs.has!("t/c/vault/1.pdf")).toBe(true);
    await blobs.delete("t/c/vault/1.pdf");
    await blobs.delete("t/c/vault/never.pdf");
    expect(await blobs.has!("t/c/vault/1.pdf")).toBe(false);
    expect(await blobs.get("t/c/vault/1.pdf")).toBeNull();
    expect(await blobs.list("t/c/")).toEqual([]);
  });

  it("shows no document whose parts are not all written: a put that failed half way leaves nothing to read", async () => {
    const sql = fresh();
    const blobs = sqlBlobs(sql);
    await blobs.put("k/ok", bytes(4));
    let n = 0;
    const failing: Sql = { ...sql, run: async (s, p) => { if (s.includes("cloud_blob_parts") && s.startsWith("INSERT") && ++n === 2) throw new Error("the database went away"); return sql.run(s, p); } };
    await expect(sqlBlobs(failing).put("k/half", bytes(BLOB_PART_BYTES * 2 + 1))).rejects.toThrow("went away");
    expect(await blobs.get("k/half")).toBeNull();
    expect(await blobs.has!("k/half")).toBe(false);
    expect(await blobs.list("k/")).toEqual(["k/ok"]);
  });

  it("is one store per database: a second handle on the same database reads what the first wrote", async () => {
    const sql = fresh();
    await sqlBlobs(sql).put("k/shared", bytes(2));
    expect(await sqlBlobs(sql).get("k/shared")).toEqual(bytes(2));
  });
});
