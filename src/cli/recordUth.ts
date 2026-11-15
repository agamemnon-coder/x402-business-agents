// npm run record-uth [-- --url <origin>]: "Purser, under the hood" (15 Nov), the live /try walk the film shows, recorded
// by code at 1920x1080 (headless Chromium, light): ONE test company (deleted after 24 hours), the passkey a CDP virtual
// authenticator (a virtual test passkey, never a person's Face ID), test money on the page's simulated bank. It makes
// no write but the page's own steps. Beside the frames it keeps what the film puts on screen, from the wire as the page
// sent and received it, never typed in: the signed terms (canonical JSON and SHA-256), the passkey's assertion
// (clientDataJSON and authenticatorData, decoded), the one-cent refusal (both hashes, transfers before and after), the
// replay of the paid terms, and the Airwallex notes (the FX quote, the sandbox transfer) when the deployment has them.
// Writes docs/film/under-the-hood/record.json and out/video/uth/try-walk.mp4 with its marks; frames are deleted.
// --cloud: only the Purser Cloud clip (the demo company's Agents tab as a guest), out/video/uth/cloud-agents.mp4.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { APPROVE, BOOKS, PAY, TAMPER, WORK } from "../../cloud/src/tryCopy.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video/uth");
const argv = process.argv.slice(2);
const ORIGIN = argv.includes("--url") ? argv[argv.indexOf("--url") + 1]! : "https://purser-try.max-31b.workers.dev";

interface Frame { t: number; file: string }
const frames: Frame[] = [];
const marks: Record<string, number> = {};
const wire: { method: string; path: string; status: number; sent: unknown; got: unknown }[] = [];
const now = () => Date.now() / 1000;
const b64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const json = (s: string | null | undefined): unknown => { try { return s ? JSON.parse(s) : null; } catch { return s; } };

async function mark(page: Page, name: string): Promise<void> {
  marks[name] = now();
  console.log(`${name} at +${(marks[name]! - (marks.start ?? marks[name]!)).toFixed(1)} s`);
  void page;
}

/** WebAuthn's authenticatorData: the RP id's hash, the flags (UP, UV, BE, BS, AT, ED) and the signature counter. */
function authData(b: Buffer) {
  const f = b[32]!;
  return { rp_id_hash: b.subarray(0, 32).toString("hex"), flags_byte: `0x${f.toString(16).padStart(2, "0")}`, user_present: !!(f & 0x01), user_verified: !!(f & 0x04), sign_count: b.readUInt32BE(33) };
}

async function main(): Promise<void> {
  if (argv.includes("--cloud")) { await (await import("./recordUthCloud.js")).recordCloudAgents(); return; }
  const raw = resolve(out, "frames");
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light", locale: "en-GB" });
  const page = await ctx.newPage();
  page.on("response", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/v1/engine/") || u.pathname.includes("/events") || r.request().method() === "OPTIONS") return;
    if (u.pathname.endsWith(".pdf") || u.pathname.includes("/vault/file")) return;
    wire.push({ method: r.request().method(), path: u.pathname, status: r.status(), sent: json(r.request().postData()), got: json(await r.text().catch(() => "")) });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  let n = 0;
  cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    const file = resolve(raw, `${String(n++).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ t: f.metadata.timestamp ?? now(), file });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  const hold = (s: number) => page.waitForTimeout(s * 1000);
  const bodyText = async () => (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
  try {
    await page.goto(`${ORIGIN}/try`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "html{scrollbar-width:none}::-webkit-scrollbar{display:none}*{caret-color:transparent!important}" }).catch(() => undefined);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    await hold(0.5);
    await mark(page, "start");
    await hold(1.5);
    await page.getByRole("button", { name: /Start with a test company/ }).click();
    await page.locator(".samples .btn:not(.skel)").first().waitFor({ timeout: 60_000 });
    await mark(page, "inbox");
    await hold(2);
    await page.getByRole("button", { name: "A supplier's invoice", exact: true }).click().catch(async () => { await page.locator(".samples .btn").first().click(); });
    await hold(0.6);
    await page.getByRole("button", { name: "File this invoice" }).click();
    await page.locator(".result .btn.primary").waitFor({ timeout: 120_000 });
    await mark(page, "checked");
    await hold(2.5);
    await page.getByRole("button", { name: WORK.pay }).click();
    await page.getByRole("button", { name: APPROVE.create }).waitFor({ timeout: 90_000 });
    await mark(page, "sheet");
    await hold(3);
    await page.locator("section.awx").scrollIntoViewIfNeeded().catch(() => undefined);
    await hold(3);
    await mark(page, "sheet-held");
    await page.getByRole("button", { name: APPROVE.create }).click();
    const approve = page.getByRole("button", { name: /^Approve EUR [\d,.]+ with/ });
    await approve.waitFor({ timeout: 60_000 });
    await hold(0.8);
    await mark(page, "sign");
    await approve.click();
    await page.locator(".paidstamp").waitFor({ timeout: 90_000 });
    await page.locator(".blk.booked:not(.sk-blk)").waitFor({ timeout: 30_000 }).catch(() => undefined);
    await mark(page, "paid");
    await hold(4);
    await mark(page, "paid-held");
    await page.getByRole("link", { name: BOOKS.cheat }).or(page.getByRole("button", { name: BOOKS.cheat })).first().click();
    await page.getByRole("button", { name: PAY.button }).waitFor({ timeout: 60_000 });
    await mark(page, "cheat");
    await hold(1.2);
    const amount = page.getByLabel(/Amount/).first();
    await amount.click();
    await amount.fill("");
    await amount.pressSequentially("1850.01", { delay: 70 });
    await hold(1);
    await page.getByRole("button", { name: PAY.button }).click();
    await page.getByText(TAMPER.head).first().waitFor({ timeout: 60_000 });
    await mark(page, "refused");
    await hold(4);
    await mark(page, "refused-held");
    // The replay: the signed terms put back and sent again: paid once, never twice.
    await page.getByRole("button", { name: PAY.putBack }).or(page.getByRole("link", { name: PAY.putBack })).first().click();
    await hold(1);
    await page.getByRole("button", { name: PAY.button }).click();
    await page.getByText(PAY.paidOnce).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    await mark(page, "replay");
    await hold(3);
    await mark(page, "replay-held");
    await cdp.send("Page.stopScreencast");
    console.log(`page at the end: ${(await bodyText()).slice(0, 200)}`);
  } finally {
    await page.screenshot({ path: resolve(out, "last.png") }).catch(() => undefined);
    await browser.close();
  }
  const walk = resolve(out, "try-walk.mp4");
  const end = marks["replay-held"] ?? frames.at(-1)!.t;
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(1 / 60, (frames[i + 1]?.t ?? end) - f.t).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`;
  writeFileSync(resolve(out, "frames.txt"), list);
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", resolve(out, "frames.txt"), "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", walk]);
  rmSync(raw, { recursive: true, force: true });
  const t0 = frames[0]!.t;
  const at: Record<string, number> = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(Math.max(0, v - t0)).toFixed(3)]));

  // What the film shows, from the wire.
  const find = (re: RegExp, method = "POST") => wire.filter((w) => w.method === method && re.test(w.path));
  const terms = find(/\/proposals\/[^/]+\/terms$/, "GET").at(-1)?.got as { terms: Record<string, unknown>; canonical: string; terms_sha256: string; fx_quote?: unknown } | undefined;
  const approveCall = find(/\/proposals\/[^/]+\/approve$/).at(-1);
  const cred = (approveCall?.sent as { credential?: { response?: { clientDataJSON: string; authenticatorData: string; signature: string } } } | undefined)?.credential;
  const client = cred?.response ? JSON.parse(b64u(cred.response.clientDataJSON).toString("utf8")) as { type: string; challenge: string; origin: string } : null;
  const ad = cred?.response ? authData(b64u(cred.response.authenticatorData)) : null;
  const pays = find(/\/proposals\/[^/]+\/pay$/);
  const record = {
    recorded_at: new Date().toISOString(), origin: ORIGIN, page: `${ORIGIN}/try`, browser: "headless Chromium (Playwright), 1920x1080, light",
    passkey: "a CDP virtual authenticator: a virtual test passkey with user verification, not a person's Face ID",
    money: "test money on the page's simulated bank; the test company is deleted after 24 hours",
    marks: at,
    terms: terms ? { terms_sha256: terms.terms_sha256, sha256_of_canonical: createHash("sha256").update(terms.canonical).digest("hex"), canonical: terms.canonical, fx_quote: terms.fx_quote ?? null } : null,
    assertion: client && ad ? { client_data: client, challenge_hex: b64u(client.challenge).toString("hex"), authenticator_data: ad, rp_id_hash_of: createHash("sha256").update(new URL(ORIGIN).hostname).digest("hex") } : null,
    approve: approveCall ? { status: approveCall.status, answer: approveCall.got } : null,
    pays: pays.map((p) => ({ status: p.status, answer: p.got })),
  };
  mkdirSync(resolve(root, "docs/film/under-the-hood"), { recursive: true });
  writeFileSync(resolve(root, "docs/film/under-the-hood/record.json"), JSON.stringify(record, null, 2) + "\n");
  writeFileSync(resolve(out, "wire.json"), JSON.stringify(wire, null, 2));
  console.log(`walk ${end - t0 > 0 ? (end - t0).toFixed(1) : "?"} s; record in docs/film/under-the-hood/record.json`);
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exit(1); });
