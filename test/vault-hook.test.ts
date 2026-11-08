// After the payables or ledger CLI changes something, the books are filed into the local vault by themselves, unless
// KIT11_VAULT=off; a vault failure never stops the CLI (it is recorded in the audit log).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileIntoLocalVault } from "../src/vault/build.js";
import { vaultWorld, type VaultWorld } from "./fakes/vaultWorld.js";

let w: VaultWorld;
beforeEach(async () => { w = await vaultWorld({ close: true }); });
afterEach(() => rmSync(w.dir, { recursive: true, force: true }));

describe("filing after a change", () => {
  it("files into the local vault folder", async () => {
    const dir = join(w.dir, "v");
    expect(await fileIntoLocalVault(w.db, { KIT11_VAULT_DIR: dir })).toMatch(/^vault: 5 new file\(s\)/);
    expect(existsSync(join(dir, "Northwind Outdoor", "2026", "index.json"))).toBe(true);
    expect(await fileIntoLocalVault(w.db, { KIT11_VAULT_DIR: dir })).toMatch(/^vault: 0 new file\(s\)/);
  });

  it("does nothing when switched off", async () => {
    expect(await fileIntoLocalVault(w.db, { KIT11_VAULT: "off", KIT11_VAULT_DIR: join(w.dir, "v") })).toMatch(/off/);
    expect(existsSync(join(w.dir, "v"))).toBe(false);
  });

  it("reports a failure and records it, without throwing", async () => {
    const blocked = join(w.dir, "file-not-folder");
    mkdirSync(w.dir, { recursive: true });
    writeFileSync(blocked, "x");
    const out = await fileIntoLocalVault(w.db, { KIT11_VAULT_DIR: blocked });
    expect(out).toMatch(/^vault: not filed/);
    expect(w.db.prepare("SELECT 1 FROM audit_log WHERE event = 'vault.failed'").get()).toBeTruthy();
  });
});
