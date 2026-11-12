// npm run vault:tree: writes the vault's folder tree (src/vault/treeSvg.ts) to docs/media, light and dark. `--check`
// writes nothing and fails when a committed file differs from what the code draws now (the test holds the same).
import { readFileSync, writeFileSync } from "node:fs";
import { VAULT_TREE_FILES, vaultTreeSvg } from "../vault/treeSvg.js";

const root = new URL("../../", import.meta.url);
const check = process.argv.includes("--check");
let stale = 0;
for (const theme of ["light", "dark"] as const) {
  const path = VAULT_TREE_FILES[theme], body = vaultTreeSvg(theme);
  let now = "";
  try { now = readFileSync(new URL(path, root), "utf8"); } catch { /* new */ }
  if (now === body) continue;
  if (check) { console.error(`stale: ${path}`); stale++; continue; }
  writeFileSync(new URL(path, root), body);
  console.log(`wrote ${path}`);
}
if (stale) { console.error("npm run vault:tree"); process.exit(1); }
