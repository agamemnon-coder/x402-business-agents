// npm run peppol:examples: downloads the official Peppol BIS Billing 3.0 example files named in
// fixtures/peppol/official-examples.json into fixtures/peppol/official/ (git-ignored: the Peppol BIS may not be
// redistributed without OpenPeppol AISBL's consent, so they are not committed), and checks each against its SHA-256.
// test/peppol.test.ts then reads them with Purser's Peppol reader (src/ap/peppol.ts); without them that part is skipped.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "fixtures/peppol/official-examples.json"), "utf8")) as { files: { name: string; url: string; sha256: string }[] };
const out = resolve(ROOT, "fixtures/peppol/official");
mkdirSync(out, { recursive: true });
let bad = 0;
for (const f of manifest.files) {
  if (!/^[A-Za-z0-9._-]+\.xml$/.test(f.name) || !f.url.startsWith("https://raw.githubusercontent.com/OpenPEPPOL/")) throw new Error(`refusing manifest entry ${f.name}`);
  const res = await fetch(f.url, { redirect: "error" });
  if (!res.ok) { console.error(`${f.name}: HTTP ${res.status}`); bad++; continue; }
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== f.sha256) { console.error(`${f.name}: SHA-256 ${sha}, the manifest says ${f.sha256} (the upstream file changed); not saved`); bad++; continue; }
  writeFileSync(resolve(out, f.name), bytes);
  console.log(`${f.name}: ${bytes.length} bytes, SHA-256 matches`);
}
if (bad) process.exitCode = 1;
