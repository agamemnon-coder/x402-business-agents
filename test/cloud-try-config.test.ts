// cloud/wrangler.try.jsonc: the engine's deployment of its own on test money (purser-try). It is cloud/wrangler.jsonc
// with a handful of keys changed (its name, its workers.dev address, its own stores and the engine switched on), and
// nothing else: the two files are read with the parser the other tests use and compared key by key, so they cannot drift.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cloudWranglerConfig, stripJsonComments } from "./support/wranglerConfig.js";

const TRY = "cloud/wrangler.try.jsonc";
const tryText = () => readFileSync(TRY, "utf8");
const tryConfig = () => JSON.parse(stripJsonComments(tryText())) as Record<string, unknown>;

/** Every leaf of a configuration by its path (an array's items by their index). */
function leaves(value: unknown, at = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) for (const [p, x] of leaves(v, at ? `${at}.${k}` : k)) out.set(p, x);
  } else out.set(at, value);
  return out;
}

describe("the engine's deployment of its own on test money (cloud/wrangler.try.jsonc)", () => {
  it("differs from cloud/wrangler.jsonc in exactly these keys, and holds these values in them", () => {
    const base = leaves(cloudWranglerConfig());
    const mine = leaves(tryConfig());
    const changed: Record<string, [unknown, unknown]> = {};
    for (const path of new Set([...base.keys(), ...mine.keys()])) {
      if (base.get(path) !== mine.get(path)) changed[path] = [base.get(path), mine.get(path)];
    }
    expect(changed).toEqual({
      "name": ["purser-cloud", "purser-try"],
      "workers_dev": [false, true],
      "d1_databases.0.database_name": ["purser-cloud", "purser-try"],
      // No R2: the owner's decision of 12 November (R2 is not enabled on the account); the documents live in D1.
      "r2_buckets.0.binding": ["DOCS", undefined],
      "r2_buckets.0.bucket_name": ["purser-cloud-docs", undefined],
      "r2_buckets.0.jurisdiction": ["eu", undefined],
      "vars.RP_ID": [expect.any(String), "purser-try.max-31b.workers.dev"],
      "vars.ORIGIN": [expect.any(String), "https://purser-try.max-31b.workers.dev"],
      "vars.ENGINE_MODE": [undefined, "test_money"],
    });
    // Its own database (the id is filled in after wrangler d1 create), and no bucket at all.
    expect(mine.get("d1_databases.0.database_id")).toBe("SET-AFTER-wrangler-d1-create");
    expect(tryConfig()).not.toHaveProperty("r2_buckets");
    // The daily purge stays: nothing says a try deployment must keep closed companies.
    expect(mine.get("triggers.crons.0")).toBe(base.get("triggers.crons.0"));
  });

  it("says what it is, and holds no secret", () => {
    const text = tryText();
    expect(text).toMatch(/deployment of its own/);
    expect(text).toMatch(/test money/);
    expect(text).toMatch(/never .*an existing Worker/);
    expect(text).toMatch(/no secret/i);
    expect(Object.keys(tryConfig().vars as Record<string, string>).sort()).toEqual(["ENGINE_MODE", "ORIGIN", "RP_ID"]);
    // The secrets are named in the comment (set with wrangler secret put), never given a value here.
    expect(text).not.toMatch(/"(SESSION_SECRET|ADMIN_TOKEN|ADMIN_TOKEN_SHA256)"\s*:|AIRWALLEX_|ANTHROPIC_|api[_-]?key/i);
  });
});
