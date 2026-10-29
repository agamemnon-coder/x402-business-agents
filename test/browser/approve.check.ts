// Browser check of the phone pages (not part of npm test; needs Playwright with Chromium):
//   npx tsx test/browser/approve.check.ts [screenshot dir] [--live]
// --live runs against the deployed relay Worker (relay config from the environment) instead of a local relay.
// Either way the world is a throwaway copy and the executor a fake: a dev test, never an approval of anything real.
// A copy of the rehearsal-2 ledger gets two fresh price options and a refund batch; the local relay serves the
// pages; Chromium's virtual authenticator (WebAuthn over CDP, user verification on) plays the phone's passkey.
// It enrols, opens the options, checks the confirm screen and its arming delay, backs out (nothing signed), then
// approves option B, and checks the runner's verdict, the ledger and the offline re-verification. A fake executor
// stands in for the real one, so nothing moves on chain or in Airwallex.

import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "../../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../../src/lib/terms.js";
import { openEnrolment } from "../../src/passkey/ledger.js";
import { reverifyPasskeyApprovals } from "../../src/passkey/webauthn.js";
import { createProposal, nextProposalId } from "../../src/policy/approvals.js";
import { relayConfig } from "../../src/relay/config.js";
import { startLocalRelay } from "../../src/relay/local.js";
import { RelayRunner } from "../../src/relay/runner.js";
import { executePolicyChange } from "../../src/executors/policyChange.js";
import { policyValue } from "../../src/policy/rules.js";

const live = process.argv.includes("--live");
const shots = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "docs");
const ledger = process.env.KIT11_CHECK_LEDGER ?? resolve(import.meta.dirname, "../../../rewardssystem/entries/airwallex/rehearsal-2-ledger.sqlite");
const dir = mkdtempSync(join(tmpdir(), "kit11-browser-"));
copyFileSync(ledger, join(dir, "world.sqlite"));
const db = openDb(join(dir, "world.sqlite"));
const now = new Date();
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// Two fresh price options (cloned from the rehearsal's S1 options) and a refund batch, all waiting.
const s1 = db.prepare("SELECT terms_json FROM proposals WHERE kind = 'mandate_replace' ORDER BY proposal_id").all() as { terms_json: string }[];
const ids: string[] = [];
for (const r of s1) {
  const t = JSON.parse(r.terms_json) as Terms;
  const id = nextProposalId(db);
  ids.push(id);
  createProposal(db, { terms: { ...t, proposal_id: id, expires_at: iso(now.getTime() + 30 * 60_000), steps: (t.steps as Terms[]).map((s) => ({ ...s, replaces_credential_hash: `0xcheck${String(s.replaces_credential_hash)}` })) }, createdBy: "treasury",
    explanation: "[claude-opus-5-5] APPROVE: Both options keep the 20.00 total; B restores a 0.03 margin." }, now);
}
const refund = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE kind = 'refund_batch' ORDER BY proposal_id LIMIT 1").get() as { terms_json: string }).terms_json) as Terms;
const refundId = nextProposalId(db);
createProposal(db, { terms: { ...refund, proposal_id: refundId, expires_at: iso(now.getTime() + 30 * 60_000) }, createdBy: "support" }, now);
const [optA, optB] = ids as [string, string];

const local = live ? null : await startLocalRelay({ port: 0, token: "browser-check" });
const cfg = local ? { url: local.url, origin: local.url, rpId: "localhost", token: "browser-check" } : await relayConfig();
const url = cfg.url;
const executed: string[] = [];
const runner = new RelayRunner({
  db, cfg, fetch, log: (l) => console.log(`  runner: ${l}`),
  // Fake executor (nothing moves), except that a policy change is really applied to this throwaway ledger.
  execute: async (d, id) => { executed.push(id); if (id.startsWith("C-")) executePolicyChange(d, id); },
});
const { code } = openEnrolment(db, { rpId: cfg.rpId, origin: cfg.origin }, now);
let syncing = true;
const loop = (async () => { while (syncing) { await runner.syncOnce().catch((e: Error) => console.error(e.message)); await new Promise((r) => setTimeout(r, 300)); } })();

const require = createRequire(import.meta.url);
// Playwright is not a dependency of this repo; it comes with the environment (Chromium pre-installed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const errors: string[] = [];
page.on("pageerror", (e: Error) => errors.push(e.message));
page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };
mkdirSync(shots, { recursive: true });

// Enrol.
await page.goto(`${url}/enrol`);
await page.fill("#code", code.toLowerCase());
await page.click("button.confirm");
await page.waitForSelector(".verdict.ok", { timeout: 20_000 });
check((await page.textContent(".verdict-head")) === "Passkey enrolled", "enrolment page: passkey enrolled through the runner");

// Dashboard on the phone.
await page.goto(`${url}/`);
await page.waitForSelector("#pending-body .card", { timeout: 10_000 });
await page.waitForFunction(() => document.getElementById("passkey")?.textContent?.startsWith("Approvals need Max's passkey (Face ID)"));
check(true, "dashboard: names the enrolled passkey");
await page.screenshot({ path: join(shots, "dashboard-phone-passkey.png"), fullPage: false });

// The options, side by side.
await page.goto(`${url}/approve/${optB}`);
await page.waitForSelector("button.option");
const cards = await page.$$eval("button.option .option-title", (n: Element[]) => n.map((x) => x.textContent));
check(cards.length === 2 && cards[0] === "Option A" && cards[1] === "Option B", `approval page: both options side by side (${cards.join(" | ")})`);
await page.screenshot({ path: join(shots, "approve-options.png") });

// Tap B: the summary of that one option; Confirm is not armed at once.
await page.locator("button.option").nth(1).tap();
await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
check((await page.textContent(".sheet-title")) === "Option B: sell at 0.07", "confirm screen: shows the tapped option");
check(await page.isDisabled("button.confirm"), "confirm screen: Confirm is not armed at once");
const nots = await page.$$eval(".nots li", (n: Element[]) => n.map((x) => x.textContent));
check(nots.length === 1 && nots[0] === "option A: sell at 0.05 per query (margin 0.01)", `confirm screen: names what it is not (${nots.join(" | ")})`);
const hashShown = await page.textContent(".hash strong");
const bHash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(optB) as { terms_sha256: string }).terms_sha256;
check(hashShown === bHash.slice(0, 8), "confirm screen: the hash prefix is option B's");
await page.waitForFunction(() => !(document.querySelector("button.confirm") as HTMLButtonElement).disabled, null, { timeout: 3000 });
check(true, "confirm screen: Confirm arms after the delay");
await page.screenshot({ path: join(shots, "approve-confirm.png") });

// Back signs nothing.
await page.click("button.secondary");
check(await page.isHidden("#sheet"), "Back closes the summary");
await new Promise((r) => setTimeout(r, 1000));
check((db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE method = 'passkey'").get() as { n: number }).n === 0, "Back: nothing was signed or approved");

// Confirm B with the passkey.
await page.locator("button.option").nth(1).tap();
await page.waitForFunction(() => !(document.querySelector("button.confirm") as HTMLButtonElement).disabled, null, { timeout: 3000 });
await page.click("button.confirm");
await page.waitForSelector(".verdict.ok", { timeout: 20_000 });
check((await page.textContent(".verdict-head")) === "Done" && (await page.textContent(".verdict-what")) === "Option B: sell at 0.07", "after Face ID: the runner verified, approved and executed option B");
await page.screenshot({ path: join(shots, "approve-done.png") });
const approval = db.prepare("SELECT proposal_id, method, approver FROM approvals WHERE method = 'passkey'").all() as { proposal_id: string; method: string; approver: string }[];
check(approval.length === 1 && approval[0]!.proposal_id === optB && /^max \(passkey .{8}\)$/.test(approval[0]!.approver), `ledger: ${optB} approved with the passkey (${approval[0]?.approver})`);
check(executed.join() === optB, `executor ran once, for ${optB}`);
const re = await reverifyPasskeyApprovals(db);
check(re.length === 1 && re[0]!.ok, `npm run verify check: ${re[0]?.what} ${re[0]?.detail}`);

// Option A after B: the page still lists A until the executor supersedes it; the runner refuses it.
await page.goto(`${url}/approve/${optA}`);
await page.waitForSelector("button.option");
await page.locator("button.option").first().tap();
await page.waitForFunction(() => !(document.querySelector("button.confirm") as HTMLButtonElement).disabled, null, { timeout: 3000 });
await page.click("button.confirm");
await page.waitForSelector(".verdict.bad", { timeout: 20_000 });
check(/another option/.test((await page.textContent(".verdict-detail")) ?? ""), "the other option after B: refused by the runner");

// The CFO policy editor: lower the sourcing agent's limit, sign it with the passkey, see it applied.
await page.goto(`${url}/policy`);
await page.waitForSelector(".policy-row input");
await page.fill("#p0", "0,03"); // a phone types a decimal comma
await page.fill("#reason", "supplier prices are rising");
await page.screenshot({ path: join(shots, "policy-editor.png") });
await page.click("main > button.confirm");
await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
check((await page.textContent(".sheet-title")) === "Policy change", "policy editor: the change opens the same confirm screen");
check((await page.textContent(".sentence")) === "Change Sourcing agent: most per payment from no extra limit to 0.03. Reason: supplier prices are rising.", "policy editor: it says exactly what changes");
await page.waitForFunction(() => !(document.querySelector("#sheet button.confirm") as HTMLButtonElement).disabled, null, { timeout: 3000 });
await page.screenshot({ path: join(shots, "policy-confirm.png") });
await page.click("#sheet button.confirm");
await page.waitForSelector(".verdict.ok", { timeout: 20_000 });
check(policyValue(db, "cap.sourcing") === "0.03", "policy editor: signed with the passkey, applied by the runner (sourcing limit 0.03)");

syncing = false;
await loop;
if (local) {
// Terms changed on the way: the page refuses to offer them.
const sql = local.relay["sql"];
const state = JSON.parse((sql.exec("SELECT v FROM kv WHERE k = 'state'").toArray()[0] as { v: string }).v) as { approvals: { proposals: { proposal_id: string; canonical: string }[] } };
const r = state.approvals.proposals.find((p) => p.proposal_id === refundId)!;
r.canonical = r.canonical.replace('"total":"', '"total":"9');
sql.exec("UPDATE kv SET v = ? WHERE k = 'state'", JSON.stringify(state));
await page.goto(`${url}/approve/${refundId}`);
await page.waitForSelector("button.option");
check(await page.isDisabled("button.option"), "tampered terms: the option cannot be tapped");
check(/do not hash to the hash shown/.test((await page.textContent("button.option .alarm")) ?? ""), "tampered terms: the page says why");
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
local?.server.close();
console.log(failures === 0 ? `\nbrowser check passes (screenshots in ${shots})` : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
