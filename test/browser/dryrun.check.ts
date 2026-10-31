// The live-run runbook (docs/runs/draaiboek-live-run.md) as a dry run, end to end, in a throwaway test world:
//   KIT11_DB=data/dry-2.sqlite KIT11_KEYS_DIR=../x402-business-agents-keys/dry-2 npx tsx test/browser/dryrun.check.ts [out dir]
// Not part of npm test. Live: Metal testnet, the Airwallex sandbox and Claude, with test money. The real runner
// (npm run relay -- --local) serves the phone pages on localhost and runs the real executors. Two Chromium contexts,
// each with its own virtual authenticator, stand in for the two phones: "test-cfo" and "test-controller". They are
// test identities in a test world, never Max or the controller; nothing here touches another world. Refuses any
// ledger that is not a dry-* world. Writes a step log with timings to the out dir (default: the scratchpad's qa/).

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { openDb } from "../../src/db/open.js";
import { redactSecrets } from "../../src/lib/redact.js";
import { activePasskey, confirmPasskey, openEnrolment, pendingPasskeys } from "../../src/passkey/ledger.js";
import { FOUR_EYES_KEY } from "../../src/policy/fourEyes.js";
import { policyValue } from "../../src/policy/rules.js";

const ledger = process.env.KIT11_DB ?? "";
const keys = process.env.KIT11_KEYS_DIR ?? "";
if (!/(^|\/)dry-\d+\.sqlite$/.test(ledger) || !/(^|\/)dry-\d+$/.test(keys)) {
  console.error("refused: set KIT11_DB=data/dry-N.sqlite and KIT11_KEYS_DIR=…/dry-N (a throwaway test world only)");
  process.exit(2);
}
if (existsSync(ledger)) { console.error(`refused: ${ledger} exists; a dry run starts from a fresh world`); process.exit(2); }
const out = resolve(process.argv[2] ?? "out/dryrun");
mkdirSync(out, { recursive: true });
mkdirSync(keys, { recursive: true });
const PORT = Number(process.env.KIT11_RELAY_PORT ?? 4466);
const url = `http://localhost:${PORT}`;
const env = { ...process.env, KIT11_APPROVER: "test-cfo", KIT11_RELAY_PORT: String(PORT) };
const repo = resolve(import.meta.dirname, "../..");

const log = createWriteStream(join(out, "dryrun.log"));
const say = (s: string) => { const line = redactSecrets(s).replace(/#view=[^\s"]+/g, "#view=…"); console.log(line); log.write(line + "\n"); };
const timings: { step: string; seconds: number; ok: boolean; note: string }[] = [];
let failures = 0;
const check = (ok: boolean, what: string) => { say(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; return ok; };
async function timed<T>(step: string, f: () => Promise<T>, note = ""): Promise<T | undefined> {
  const t0 = Date.now();
  say(`\n=== ${step}`);
  try {
    const r = await f();
    timings.push({ step, seconds: Math.round((Date.now() - t0) / 1000), ok: true, note });
    return r;
  } catch (e) {
    failures++;
    timings.push({ step, seconds: Math.round((Date.now() - t0) / 1000), ok: false, note: (e as Error).message.slice(0, 160) });
    say(`FAIL  ${step}: ${(e as Error).message}`);
    return undefined;
  }
}

/** One CLI step of the runbook, as Claude types it tomorrow; its output is redacted into the log. */
function cli(script: string, ...args: string[]): string {
  const r = spawnSync("npx", ["tsx", `src/cli/${script}`, ...args], { cwd: repo, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).join("\n");
  for (const l of text.split("\n").slice(-40)) if (l.trim()) say(`  ${l}`);
  if (r.status !== 0) throw new Error(`${script} ${args.join(" ")} exited ${r.status}`);
  return text;
}

// The runner, as npm run relay -- --local: real executors, the phone pages on localhost.
let runner: ChildProcess | null = null;
let viewer = "";
function startRunner(): Promise<void> {
  return new Promise((ok, fail) => {
    // Its own process group, so a kill reaches the runner itself, not only the npx wrapper around it.
    const p = spawn("npx", ["tsx", "src/cli/relay.ts", "--local"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    runner = p;
    const runLog = createWriteStream(join(out, "runner.log"), { flags: "a" });
    let buf = "";
    const onData = (d: Buffer) => {
      const s = d.toString();
      runLog.write(redactSecrets(s).replace(/#view=[^\s"]+/g, "#view=…"));
      buf += s;
      const m = /viewer\s+(\S+#view=\S+)/.exec(buf);
      if (m && !viewer) viewer = m[1]!;
      if (m) ok();
    };
    p.stdout!.on("data", onData);
    p.stderr!.on("data", (d: Buffer) => runLog.write(redactSecrets(d.toString())));
    p.on("exit", (code) => { if (!viewer) fail(new Error(`runner exited ${code}`)); });
    setTimeout(() => fail(new Error("runner did not start in 60 s")), 60_000);
  });
}
async function killRunner(signal: NodeJS.Signals): Promise<void> {
  const p = runner;
  if (!p) return;
  await new Promise<void>((ok) => { p.once("exit", () => ok()); process.kill(-p.pid!, signal); });
  // The port is free again only once every process of the group is gone.
  await until("the runner's port to be free", () => spawnSync("bash", ["-c", `! (exec 3<>/dev/tcp/127.0.0.1/${PORT}) 2>/dev/null`]).status === 0, 30_000);
  runner = null;
}

const db = () => openDb(ledger);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined | null | false, ms = 600_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}
const status = (id: string) => (db().prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string } | undefined)?.status;
const latest = (kind: string, where = "1=1") => (db().prepare(`SELECT proposal_id FROM proposals WHERE kind = ? AND ${where} ORDER BY rowid DESC LIMIT 1`).get(kind) as { proposal_id: string } | undefined)?.proposal_id;
const executed = (id: string) => until(`${id} executed`, () => { const s = status(id); if (s === "FAILED" || s === "REJECTED" || s === "EXPIRED") throw new Error(`${id} is ${s}`); return s === "EXECUTED" ? s : undefined; });

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
const browser = await chromium.launch();
const errors: string[] = [];
/** A phone: its own context (a private tab), its own virtual authenticator with user verification. */
async function phone(name: string): Promise<{ page: Page; setVerified: (v: boolean) => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e: Error) => errors.push(`${name}: ${e.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { page, setVerified: (v: boolean) => cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: v }) };
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });

/** Enrols a phone's passkey (the window opened here, as the runbook's enrol command does) and confirms its fingerprint. */
async function enrol(p: { page: Page }, person: string | null): Promise<void> {
  const { code } = openEnrolment(db(), { rpId: "localhost", origin: url, ...(person ? { addPerson: person } : {}) });
  // The runner takes a new enrolment window to the relay at its next sync: type the code once that has happened.
  await sleep(10_000);
  await p.page.goto(viewer);
  await p.page.goto(`${url}/enrol`);
  await p.page.fill("#code", code.toLowerCase());
  await p.page.click("button.confirm");
  try {
    await p.page.waitForFunction(() => document.querySelector(".verdict-head")?.textContent === "Confirm on the runner", null, { timeout: 60_000 });
  } catch (e) {
    await shot(p.page, `enrol-${person ?? "test-cfo"}-failed`);
    say(`  the enrol page shows: ${((await p.page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
    throw e;
  }
  const shown = /Fingerprint ([0-9A-F]{4}(?:-[0-9A-F]{4}){3})/.exec((await p.page.textContent(".verdict-what")) ?? "")?.[1] ?? "";
  check(pendingPasskeys(db()).some((x) => x.fingerprint === shown), `enrol ${person ?? "test-cfo"}: the phone's fingerprint ${shown} waits on the runner`);
  confirmPasskey(db(), shown);
}

/** Opens a proposal on a phone, picks an option (or the one shown), and signs with the passkey; returns the verdict. */
async function sign(p: { page: Page }, id: string, o: { option?: "A" | "B"; tag: string; reject?: boolean; expectNoVerdict?: boolean; beforeConfirm?: () => Promise<void> }): Promise<string> {
  const page = p.page;
  await page.goto(`${url}/approve/${id}`);
  await page.waitForSelector(o.reject ? "button.reject-btn" : "button.option", { timeout: 60_000 });
  if (o.reject) await page.click("button.reject-btn");
  else if (o.option) await page.locator("button.option", { hasText: `Option ${o.option}` }).first().tap();
  else await page.locator("button.option").first().tap();
  await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
  await page.waitForFunction(() => !(document.querySelector("#sheet button.confirm") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  await shot(page, `${o.tag}-confirm`);
  if (o.beforeConfirm) await o.beforeConfirm();
  await page.click("#sheet button.confirm");
  if (o.expectNoVerdict) {
    // The approval cannot reach the runner (no network, or the passkey refused): give the page time, then report.
    await page.waitForTimeout(8000);
    await shot(page, `${o.tag}-verdict`);
    return ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 200);
  }
  // A verdict the runner has given: approved (and executing), done, 1 of 2, rejected, refused or too late.
  const FINAL = ["Approved", "Done", "1 of 2 approvals", "Rejected", "Refused", "Too late", "Already decided", "Approved, but execution stopped"];
  await page.waitForFunction((f: string[]) => f.includes(document.querySelector(".verdict-head")?.textContent ?? ""), FINAL, { timeout: 180_000 });
  await shot(page, `${o.tag}-verdict`);
  return (await page.textContent(".verdict-head")) ?? "";
}

const started = Date.now();
const cfo = await phone("test-cfo");
const controller = await phone("test-controller");

await timed("0 Health", async () => { cli("health.ts"); });
await timed("Runner (local relay, real executors)", startRunner);
await timed("Enrol: test-cfo and test-controller, each on their own phone", async () => {
  await enrol(cfo, null);
  await enrol(controller, "test-controller");
  check(activePasskey(db()) !== null && (db().prepare("SELECT COUNT(*) AS n FROM passkeys WHERE status = 'ACTIVE'").get() as { n: number }).n === 2, "two active passkeys, two people");
  cli("policy.ts", "set", "approval.four_eyes_eur", "1000.00", "--reason", "dry run: four eyes above EUR 1,000");
  // Setting a policy only proposes it: four eyes counts once the CFO approved it with the passkey (dry-6 found this).
  const pc = db().prepare("SELECT proposal_id AS id FROM proposals WHERE kind = 'policy_change' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
  check(!!pc, "the four-eyes policy waits as a proposal");
  if (pc) {
    const v = await sign(cfo, pc.id, { tag: "policy-four-eyes" });
    check(v === "Approved" || v === "Done", `the CFO approved the four-eyes policy (${v})`);
    await until("the four-eyes policy in force", () => policyValue(db(), FOUR_EYES_KEY) === "1000.00", 60_000).catch(() => undefined);
  }
  check(policyValue(db(), FOUR_EYES_KEY) === "1000.00", "four eyes is on above EUR 1,000 before any mandate change");
});
if (process.env.DRYRUN_ONLY_ENROL) {
  await killRunner("SIGTERM");
  await browser.close();
  say(failures === 0 ? "enrol passes" : "enrol failed");
  process.exit(failures === 0 ? 0 : 1);
}
await timed("S0 Bootstrap", async () => { cli("bootstrap.ts"); });
await timed("1 Sales per query (0.05, upstream 0.02): stock checks 1-40", async () => { cli("trade.ts", "1", "40"); });
let optA = "", optB = "";
await timed("2-4 Price rise, refusal on chain, two options with Opus's advice", async () => {
  const outS1 = cli("s1.ts", "raise");
  check(/mandate_cap_exceeded/.test(outS1), "the purchase at 0.04 was refused against the 0.03 mandate");
  const ids = (db().prepare("SELECT proposal_id, terms_json FROM proposals WHERE kind = 'mandate_replace' ORDER BY proposal_id").all() as { proposal_id: string; terms_json: string }[]);
  optA = ids.find((r) => (JSON.parse(r.terms_json) as { option?: string }).option === "A")!.proposal_id;
  optB = ids.find((r) => (JSON.parse(r.terms_json) as { option?: string }).option === "B")!.proposal_id;
  check(!!optA && !!optB, `options A (${optA}) and B (${optB}) proposed`);
});
await timed("5 Four eyes on chain (2-of-2 account in this world)", async () => {
  const r = spawnSync("npx", ["tsx", "src/cli/fourEyes.ts"], { cwd: repo, env: { ...env, KIT11_KEYS_DIR: `${keys}/four-eyes`, RUN_OUT: `dry-run-four-eyes` }, encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  check(/reverted.*CFO alone/.test(text.replace(/\n/g, " ")) || /reverted/.test(text), "the CFO's signature alone reverted on chain");
  check(r.status === 0, "four-eyes run finished");
});
await timed("Mis-tap: A tapped by mistake, then Back; nothing signed", async () => {
  const page = cfo.page;
  await page.goto(`${url}/approve/${optB}`);
  await page.waitForSelector("button.option");
  await page.locator("button.option", { hasText: "Option A" }).first().tap();
  await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
  check(/Option A/.test((await page.textContent(".sheet-title")) ?? ""), "the summary names the option tapped (A)");
  await page.click("#sheet button.secondary");
  check(await page.isHidden("#sheet"), "Back closes it");
  check((db().prepare("SELECT COUNT(*) AS n FROM cosignatures").get() as { n: number }).n === 0, "nothing was signed");
});
await timed("6 Mandates replaced: option B, test-cfo then test-controller", async () => {
  const first = await sign(cfo, optB, { option: "B", tag: "s1-cfo" });
  check(first === "1 of 2 approvals", `after the first passkey: "${first}"`);
  check(status(optB) === "PENDING_APPROVAL", "still waiting for the second person");
  const second = await sign(controller, optB, { option: "B", tag: "s1-controller" });
  check(second === "Done" || second === "Approved", `after the second passkey: "${second}"`);
  await executed(optB);
  check(status(optA) !== "EXECUTED", "option A was not executed");
});
await timed("1b Sales resume (41-50)", async () => { cli("s1.ts", "resume"); });
await timed("7 Dispute on signed orders; 'refund all 12' rejected (Opus advises it)", async () => {
  cli("s2.ts");
  const all = latest("refund_batch", "status = 'PENDING_APPROVAL'");
  check(!!all, `"refund all 12" waits for the CFO (${all})`);
  const page = cfo.page;
  await page.goto(`${url}/approve/${all}`);
  await page.waitForSelector("button.option");
  await page.click("button.option");
  await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
  check((await page.textContent("#sheet .eyebrow")) === "You are approving" && (await page.textContent("#sheet button.confirm.against")) === "Approve anyway with Face ID", "a tap on 'refund all 12': warned, 'Approve anyway', armed after 3 s");
  await shot(page, "refund-all-warning");
  await page.click("#sheet button.instead");
  await page.waitForFunction(() => !(document.querySelector("#sheet button.confirm") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  check((await page.textContent("#sheet .eyebrow")) === "You are rejecting", "'Reject instead' turns it into a rejection");
  await page.click("#sheet button.confirm");
  await page.waitForFunction(() => document.querySelector(".verdict-head")?.textContent === "Rejected", null, { timeout: 60_000 });
  check(status(all!) === "REJECTED", `${all} rejected with the passkey`);
});
await timed("8 Receive policy, then the sweep once final", async () => { cli("receivePolicy.ts", "setup"); });
let bergtex = "";
await timed("9 Bergtex EUR 1,850.00 proposed (sweep first)", async () => {
  cli("s3.ts");
  bergtex = latest("invoice_payment", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!bergtex, `Bergtex proposal ${bergtex}`);
});
await timed("Expiry: the countdown on both phones, then the proposal runs out and a fresh quote needs a new approval", async () => {
  const exp = (db().prepare("SELECT expires_at FROM proposals WHERE proposal_id = ?").get(bergtex) as { expires_at: string }).expires_at;
  for (const [who, p] of [["test-cfo", cfo], ["test-controller", controller]] as const) {
    await p.page.goto(`${url}/approve/${bergtex}`);
    await p.page.waitForSelector(".countdown");
    const shown = (await p.page.textContent(".countdown")) ?? "";
    const m = /expires in (?:(\d+)h )?(\d+)m (\d+)s/.exec(shown);
    const secs = m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : -1;
    const real = Math.round((Date.parse(exp) - Date.now()) / 1000);
    check(Math.abs(secs - real) <= 5, `${who}: the countdown says ${shown.trim()}, the terms expire in ${real} s`);
  }
  say(`  waiting for ${bergtex} to run out (${exp})`);
  await until(`${bergtex} past its expiry`, () => Date.now() > Date.parse(exp) + 5000, 15 * 60_000);
  const late = await sign(cfo, bergtex, { tag: "bergtex-late" }).catch((e: Error) => `error: ${e.message}`);
  check(/too late|expired|Expired|ran out/i.test(late) || status(bergtex) === "EXPIRED", `approving after expiry signs nothing (${late}; ${status(bergtex)})`);
  check((db().prepare("SELECT COUNT(*) AS n FROM transfers WHERE invoice_no = 'BTX-2026-11'").get() as { n: number }).n === 0, "no transfer for Bergtex yet");
  cli("s3.ts");
  const fresh = latest("invoice_payment", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!fresh && fresh !== bergtex, `a fresh proposal with a fresh quote (${fresh})`);
  bergtex = fresh;
});
await timed("9b Bergtex paid: test-cfo and test-controller (four eyes above EUR 1,000)", async () => {
  check((await sign(cfo, bergtex, { tag: "bergtex-cfo" })) === "1 of 2 approvals", "first passkey: 1 of 2");
  await sign(controller, bergtex, { tag: "bergtex-controller" });
  await executed(bergtex);
});
await timed("10 Licence EUR 240.00 (FX + SWIFT); the runner is killed right after the approval and restarted", async () => {
  cli("licence.ts");
  const lic = latest("invoice_payment", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!lic, `licence proposal ${lic}`);
  // Network away: the approval cannot be sent; the page says so and nothing is signed on the runner.
  // The page is open and the sheet armed; then the network goes, and Face ID is pressed.
  const offline = await sign(cfo, lic, { tag: "licence-offline", expectNoVerdict: true, beforeConfirm: () => cfo.page.route("**/api/**", (r: { abort: () => void }) => r.abort()) })
    .catch((e: Error) => `error: ${e.message.slice(0, 80)}`);
  check(status(lic) === "PENDING_APPROVAL", `network away: nothing approved (${offline})`);
  await cfo.page.unroute("**/api/**");
  // The phone locked during Face ID: the passkey refuses, the page says so, nothing is signed.
  await cfo.setVerified(false);
  const locked = await sign(cfo, lic, { tag: "licence-locked", expectNoVerdict: true }).catch((e: Error) => `error: ${e.message.slice(0, 80)}`);
  check(status(lic) === "PENDING_APPROVAL", `Face ID failed: nothing approved (${locked})`);
  await cfo.setVerified(true);
  const page = cfo.page;
  await page.goto(`${url}/approve/${lic}`);
  await page.waitForSelector("button.option");
  await page.locator("button.option").first().tap();
  await page.waitForFunction(() => !(document.querySelector("#sheet button.confirm") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  await page.click("#sheet button.confirm");
  await until(`${lic} approved`, () => { const s = status(lic); return s && s !== "PENDING_APPROVAL" ? s : undefined; }, 120_000);
  await killRunner("SIGKILL");
  say(`  runner killed with ${lic} at ${status(lic)}`);
  await startRunner();
  await executed(lic);
  const n = (db().prepare("SELECT COUNT(*) AS n FROM transfers WHERE invoice_no = 'SLL-2026-11'").get() as { n: number }).n;
  check(n === 1, `one transfer for the licence after the restart (${n})`);
});
let raise = "";
await timed("11 Cards: EUR 19.99 approved, EUR 45.00 declined, raise EUR 30 → 50", async () => {
  cli("cards.ts", "setup");
  cli("cards.ts", "scenario");
  raise = latest("policy_change", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!raise, `raise proposal ${raise}`);
  await sign(cfo, raise, { tag: "card-raise" });
  await executed(raise);
  cli("cards.ts", "sync");
  const buy = cli("cards.ts", "buy", "packwise-pro");
  check(/APPROVED|approved/.test(buy), "the same EUR 45.00 is approved after the raise");
});
await timed("12 Emergency stop on, a card charge declined, stop off", async () => {
  const page = cfo.page;
  await page.goto(`${url}/`);
  await page.waitForSelector("#stop:not([hidden])", { timeout: 30_000 });
  await page.click("#stop");
  await page.waitForSelector("#stop-sheet[open]");
  await page.click("#stop-go");
  await page.waitForSelector("main > button.confirm");
  await page.click("main > button.confirm");
  await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
  await page.waitForFunction(() => !(document.querySelector("#sheet button.confirm") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  await page.click("#sheet button.confirm");
  await page.waitForSelector(".verdict.ok", { timeout: 60_000 });
  await until("freeze on", () => (db().prepare("SELECT value FROM settings WHERE key = 'freeze'").get() as { value: string } | undefined)?.value === "on", 60_000);
  await sleep(8000); // the runner syncs the frozen cards to Airwallex
  const frozenBuy = (() => { try { return cli("cards.ts", "buy", "packwise-starter"); } catch (e) { return (e as Error).message; } })();
  check(/declined|INACTIVE|frozen|refused|stop/i.test(frozenBuy), "a card charge while stopped is refused");
  cli("policy.ts", "set", "freeze", "off", "--reason", "dry run: lift the stop");
  const lift = latest("policy_change", "status = 'PENDING_APPROVAL'") ?? "";
  await sign(cfo, lift, { tag: "stop-off" });
  await executed(lift);
});
await timed("13 Bank change for Bergtex in three steps (test identities)", async () => {
  const req = cli("payee.ts", "request", "Bergtex Textil GmbH", "GB29NWBK60161331926819", "NWBKGB2LXXX");
  const id = /(B-\d{4})/.exec(req)?.[1] ?? "";
  cli("payee.ts", "verified", id, "--by", "test-controller", "--how", "dry run: no call made (test world)");
  cli("payee.ts", "propose", id);
  const p = latest("payee_change", "status = 'PENDING_APPROVAL'") ?? "";
  check((await sign(cfo, p, { tag: "payee-cfo" })) === "1 of 2 approvals", "bank change: first passkey 1 of 2");
  await sign(controller, p, { tag: "payee-controller" });
  await executed(p);
});
await timed("14 Agent recognition (dev test)", async () => {
  cli("visa.ts", "setup");
  const r = spawnSync("npx", ["tsx", "src/cli/visa.ts", "run"], { cwd: repo, env: { ...env, RUN_OUT: "dry-run-visa" }, encoding: "utf8" });
  check(/approved by Airwallex/.test(r.stdout) && /LIMIT_EXCEEDED/.test(r.stdout), "recognised and approved; over the limit declined by Airwallex");
});
await timed("Links: a private tab twice, and a phone that pinned another runner", async () => {
  for (const n of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(viewer);
    await page.waitForSelector("#pending, #dash, main", { timeout: 20_000 });
    const text = (await page.textContent("body")) ?? "";
    check(!/another runner key/.test(text), `private tab ${n}: the dashboard opens, no key conflict`);
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem("kit11.runner", "AAAAold-runner-key"));
  await page.goto(viewer);
  await page.waitForTimeout(2000);
  check(/another runner key/.test((await page.textContent("body")) ?? ""), "a phone that pinned another runner is told so, and the link is not accepted");
  await shot(page, "pinned-conflict");
  await ctx.close();
});
await timed("Verify: chain, ledger, audit log; nothing paid twice", async () => {
  cli("verify.ts");
  const dup = db().prepare("SELECT invoice_no, COUNT(*) AS n FROM transfers GROUP BY invoice_no HAVING n > 1").all();
  check(dup.length === 0, `one transfer per invoice (${JSON.stringify(dup)})`);
  const dupApprovals = db().prepare("SELECT proposal_id, COUNT(*) AS n FROM approvals GROUP BY proposal_id HAVING n > 1").all();
  check(dupApprovals.length === 0, "one decision per proposal");
});

await killRunner("SIGTERM");
await browser.close();
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
const total = Math.round((Date.now() - started) / 60_000);
writeFileSync(join(out, "timings.json"), JSON.stringify({ total_minutes: total, failures, timings }, null, 2));
say(`\n${failures === 0 ? "dry run passes" : `${failures} check(s) failed`}: ${total} minutes; timings in ${join(out, "timings.json")}`);
process.exit(failures === 0 ? 0 : 1);
