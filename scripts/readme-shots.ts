// The README's screenshots, light theme, 1440 x 900, the first screen of each page; WebP, 960 px wide, in
// docs/assets/readme/. The README's hero is the site's link-preview card (docs/assets/social-preview.png), not a shot.
//   npm run readme:shots            a local build of this checkout (nothing from the deployed site):
//     - the site's pages, served offline by the judge server (src/cli/judge.ts, the main run's committed record);
//     - Purser Cloud's console as a guest ("Try as guest": the demo company, made-up data, test money), served on this
//       machine by its own request handler over SQLite in memory, as test/browser/console.check.ts does.
//   npm run readme:shots -- --live  the deployed site and Purser Cloud's public preview: page loads and the guest
//     button only (the demo company is read-only); nothing is filed, signed or paid.
// Needs Playwright's Chromium (pre-installed in CI and the cloud sessions) and ffmpeg for the WebP files.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, type CloudEnv } from "../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../cloud/src/node.js";
import { startJudge } from "../src/cli/judge.js";

const ROOT = resolve(import.meta.dirname, "..");
export const OUT = join(ROOT, "docs/assets/readme");
/** Each shot: its file name, the page, and what the README's tile says it is. */
export const SITE_SHOTS: { file: string; path: string; label: string }[] = [
  { file: "proof.webp", path: "/proof", label: "Proof" },
  { file: "airwallex.webp", path: "/airwallex", label: "Airwallex" },
  { file: "metal.webp", path: "/metal", label: "Metal" },
  { file: "visa.webp", path: "/visa", label: "Visa" },
  { file: "claude.webp", path: "/claude", label: "Claude" },
  { file: "books.webp", path: "/books", label: "Books" },
  { file: "security.webp", path: "/security", label: "Security" },
];
/** The deployed site and Purser Cloud's public preview, for --live. */
export const LIVE = { site: "https://kit11.max-31b.workers.dev", cloud: "https://purser-try.max-31b.workers.dev" };
export const CLOUD_SHOT = { file: "cloud-guest.webp", label: "Purser Cloud as a guest" };

const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "readme-shots-"));
const webp = (png: string, file: string) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", png, "-vf", "scale=960:-1:flags=lanczos", "-quality", "82", join(OUT, file)]);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright") as typeof import("playwright");
  const browser = await chromium.launch();
  const shoot = async (url: string, file: string, before?: (p: import("playwright").Page) => Promise<void>) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", locale: "en-GB" });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    if (before) await before(page);
    await page.waitForTimeout(400);
    const png = join(tmp, file.replace(/\.webp$/, ".png"));
    await page.screenshot({ path: png });
    webp(png, file);
    await ctx.close();
    console.log(`wrote docs/assets/readme/${file} from ${url}`);
  };

  const guest = async (p: import("playwright").Page) => {
    await p.click('button:has-text("Try as guest")');
    await p.waitForSelector('h1:text-is("Overview")', { timeout: 30_000 });
  };
  if (process.argv.includes("--live")) {
    for (const s of SITE_SHOTS) await shoot(`${LIVE.site}${s.path}`, s.file);
    await shoot(`${LIVE.cloud}/`, CLOUD_SHOT.file, guest);
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
    return;
  }

  // The site, offline, from the committed record.
  const judge = await startJudge(0);
  for (const s of SITE_SHOTS) await shoot(`${judge.url}${s.path}`, s.file);
  judge.server.close();

  // Purser Cloud on this machine; the guest opens the demo company from its committed seed (cloud/src/guest/seed.gen.ts).
  const port = 8890 + Math.floor(Math.random() * 100), origin = `http://localhost:${port}`;
  const env: CloudEnv = {
    sql: sqliteSql(":memory:"), blobs: dirBlobs(join(tmp, "blobs")), sessionSecret: "s".repeat(48),
    adminTokenSha256: createHash("sha256").update("readme-shots-admin-not-a-secret").digest("hex"),
    rpId: "localhost", origin, mailDomain: "in.purser.test", rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
    asset: async (path) => (path === "/assets/pdfjs.mjs" ? new Response(readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")))) : null),
  };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await handle(new Request(`${origin}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  await shoot(`${origin}/`, CLOUD_SHOT.file, guest);
  server.close();
  await browser.close();

  rmSync(tmp, { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) await main();
