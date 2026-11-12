// npm run vault -- build [--dry-run] [--lang en]           file everything new into the local vault (data/vault)
// npm run vault -- sync --to local|gdrive|onedrive [--dry-run] [--lang en]
// npm run vault -- verify [--to local|gdrive|onedrive] [--year 2026]   re-hash every file against index.json
// npm run vault -- serve [--port 4600]                      browse the local vault, read-only, on 127.0.0.1
// Google Drive: KIT11_GDRIVE_TOKEN and KIT11_GDRIVE_FOLDER_ID. OneDrive/SharePoint: KIT11_GRAPH_TOKEN and
// KIT11_GRAPH_DRIVE_ID. Tokens only from the environment; nothing here prints them. Test money only (the sandbox).

import { COMPANY } from "../config/brand.js";
import { openDb } from "../db/open.js";
import { syncVault, verifyVault } from "../vault/build.js";
import { GoogleDriveSink } from "../vault/gdrive.js";
import { OneDriveSink } from "../vault/onedrive.js";
import { vaultApp } from "../vault/page.js";
import type { Lang } from "../vault/pdf.js";
import { LocalSink, type VaultSink } from "../vault/sink.js";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const env = process.env;
const dir = env.KIT11_VAULT_DIR ?? "data/vault";
const company = env.KIT11_COMPANY ?? COMPANY;

function sinkFor(to: string): VaultSink {
  if (to === "local") return new LocalSink(dir);
  if (to === "gdrive") return new GoogleDriveSink({ token: env.KIT11_GDRIVE_TOKEN ?? "", rootFolderId: env.KIT11_GDRIVE_FOLDER_ID ?? "" });
  if (to === "onedrive") return new OneDriveSink({ token: env.KIT11_GRAPH_TOKEN ?? "", driveId: env.KIT11_GRAPH_DRIVE_ID ?? "" });
  throw new Error(`unknown destination ${to}: local, gdrive or onedrive`);
}

async function main() {
  const cmd = args[0] ?? "build";
  if (cmd === "serve") {
    const port = Number(flag("port") ?? env.KIT11_VAULT_PORT ?? 4600);
    vaultApp(dir).listen(port, "127.0.0.1", () => console.log(`the vault (read-only): http://127.0.0.1:${port}/  (${dir})`));
    return;
  }
  const db = openDb();
  if (cmd === "build" || cmd === "sync") {
    const to = cmd === "build" ? "local" : flag("to") ?? "local";
    const dryRun = args.includes("--dry-run");
    const r = await syncVault(db, sinkFor(to), { company, dryRun, lang: (flag("lang") === "en" ? "en" : "nl") as Lang });
    for (const a of r.added) console.log(`${dryRun ? "would add" : "added"}  ${a.path}${a.correction ? "  (correction)" : ""}`);
    console.log(`${r.added.length} ${dryRun ? "to add" : "added"}, ${r.unchanged} already in the vault (${to}${to === "local" ? `: ${dir}` : ""})`);
  } else if (cmd === "verify") {
    const years = flag("year") ? [Number(flag("year"))] : Array.from({ length: 6 }, (_, i) => new Date().getUTCFullYear() - i);
    const v = await verifyVault(sinkFor(flag("to") ?? "local"), company, years);
    for (const b of v.bad) console.log(`BAD  ${b.path}: ${b.problem}`);
    console.log(v.bad.length ? `${v.bad.length} of ${v.checked} files do not match index.json` : `all ${v.checked} files match index.json`);
    if (v.bad.length) process.exitCode = 1;
  } else {
    throw new Error(`unknown command ${cmd}; see the top of src/cli/vault.ts`);
  }
  db.close();
}

main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
