// Thursday's world as a dry run, in the order of docs/runs/draaiboek-wereld-donderdag.md (Max, 2 November), for the
// three acceptance dry runs (docs/runs/dry-run-acceptatie.md). Not product code and not part of npm test.
//
//   KIT11_DB=data/dry-N.sqlite KIT11_KEYS_DIR=…/dry-N KIT11_AGENTS=on KIT11_AUTONOMY=on \
//     npx tsx docs/runs/driver/thursday-dry.ts <out dir>
//
// Why not test/browser/dryrun.check.ts (KIT11_WORLD=thursday): at 728c560 that harness has no `world setup`, no
// let-one-through and no packwise-pro TAP step, and it runs packwise-renewal, deposit and report-offer, which the
// runbook does not (a deposit before the licence would change the free EUR). This driver reuses its virtual-passkey
// phones (two Chromium contexts, each with its own virtual WebAuthn authenticator: "test-cfo" and "test-controller",
// test identities in a test world, never Max's passkey or the hosted relay's), and its local runner
// (`npm run relay -- --local`, real executors, phone pages on localhost).
//
// Order (runbook "Vooraf", then the table): health, bootstrap, cards setup, visa setup, world setup (cache off, free EUR
// 150.00, TAP rail on); then 1 serve every 15 s (both suppliers checked to answer) and 1b ridgeline-maintenance BEFORE
// the runner with the agents (after dry-179: agents started before the suppliers saw none and set "buy nothing"), both
// passkeys, four eyes (P-0001, test-cfo alone); then 2 price-rise 0.04 --silent once #16 is sold, 2b let-one-through right after, 3
// Treasury's options (test-cfo then test-controller, the option Treasury recommends), 4 dispute ("refund all" rejected
// as advised), 5 money-in, 6 invoice (Treasury plans; test-cfo approves), 7 packwise-pro (a card raise the Sourcing
// agent asks for is approved); a private-tab check of the viewer link. Then 8: the customer (world serve) stops, the
// checks run with the runner still up (verify, reconcile, data-qa, origins, dashboard-vs-chain, agent-summary), and
// `npm run stop -- dry-N` stops the world; the operator then checks with ps that nothing of it is left.
// The world only changes; nothing here decides for an agent. Every line written goes through redactSecrets.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { openDb } from "../../../src/db/open.js";
import { redactSecrets } from "../../../src/lib/redact.js";
import { activePasskey, confirmPasskey, openEnrolment, pendingPasskeys } from "../../../src/passkey/ledger.js";
import { FOUR_EYES_KEY } from "../../../src/policy/fourEyes.js";
import { policyValue } from "../../../src/policy/rules.js";
import { SECOND_APPROVER } from "../../../src/config/brand.js";

const ledger = process.env.KIT11_DB ?? "";
const keys = process.env.KIT11_KEYS_DIR ?? "";
if (!/(^|\/)dry-\d+\.sqlite$/.test(ledger) || !/(^|\/)dry-\d+$/.test(keys)) {
  console.error("refused: set KIT11_DB=data/dry-N.sqlite and KIT11_KEYS_DIR=…/dry-N (a throwaway test world only)");
  process.exit(2);
}
if (process.env.KIT11_AGENTS !== "on" || process.env.KIT11_AUTONOMY !== "on") { console.error("refused: KIT11_AGENTS=on and KIT11_AUTONOMY=on"); process.exit(2); }
if (process.env.KIT11_RECYCLE) { console.error("refused: unset KIT11_RECYCLE (the faucet funds a fresh world)"); process.exit(2); }
if (existsSync(ledger)) { console.error(`refused: ${ledger} exists; a dry run starts from a fresh world`); process.exit(2); }
const world = /(dry-\d+)\.sqlite$/.exec(ledger)![1]!;
const out = resolve(process.argv[2] ?? `out/${world}`);
mkdirSync(out, { recursive: true });
mkdirSync(keys, { recursive: true });
const PORT = Number(process.env.KIT11_RELAY_PORT ?? 4466);
const url = `http://localhost:${PORT}`;
const env = { ...process.env, KIT11_APPROVER: "test-cfo", KIT11_RELAY_PORT: String(PORT), KIT11_LOCAL_RELAY_TOKEN: randomBytes(32).toString("hex") };
const repo = resolve(import.meta.dirname, "../../..");

const log = createWriteStream(join(out, "driver.log"), { flags: "a" });
const clean = (s: string) => redactSecrets(s).replace(/#view=[^\s"]+/g, "#view=…");
const utc = () => new Date().toISOString().slice(11, 19);
const say = (s: string) => { const line = clean(`${utc()} ${s}`); console.log(line); log.write(line + "\n"); };
const timings: { step: string; start: string; end: string; seconds: number; ok: boolean; note: string }[] = [];
const facts: Record<string, unknown> = { world, port: PORT, relay: "local (npm run relay -- --local), virtual passkeys test-cfo and test-controller" };
let failures = 0;
const check = (ok: boolean, what: string) => { say(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; return ok; };
async function timed<T>(step: string, f: () => Promise<T>): Promise<T | undefined> {
  const t0 = new Date();
  say(`=== ${step}`);
  try {
    const r = await f();
    timings.push({ step, start: t0.toISOString(), end: new Date().toISOString(), seconds: Math.round((Date.now() - t0.getTime()) / 1000), ok: true, note: "" });
    snapshot(step);
    return r;
  } catch (e) {
    failures++;
    timings.push({ step, start: t0.toISOString(), end: new Date().toISOString(), seconds: Math.round((Date.now() - t0.getTime()) / 1000), ok: false, note: clean((e as Error).message).slice(0, 200) });
    say(`FAIL  ${step}: ${(e as Error).message}`);
    snapshot(step);
    return undefined;
  }
}
const db = () => openDb(ledger);
/** The herstelplan's snapshot after each step: a consistent local copy (SQLite online backup), never in git. */
function snapshot(step: string): void {
  try {
    if (!existsSync(ledger)) return;
    const dir = join(repo, "data/snapshots", world);
    mkdirSync(dir, { recursive: true });
    void db().backup(join(dir, `${String(timings.length).padStart(2, "0")}-${step.split(" ")[0]!.replace(/[^\w-]/g, "")}.sqlite`)).catch(() => undefined);
  } catch { /* a snapshot is a convenience */ }
}

function cli(script: string, ...args: string[]): string {
  const r = spawnSync("npx", ["tsx", `src/cli/${script}`, ...args], { cwd: repo, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).join("\n");
  for (const l of text.split("\n").slice(-40)) if (l.trim()) say(`  ${l}`);
  if (r.status !== 0) throw new Error(`${script} ${args.join(" ")} exited ${r.status}`);
  return text;
}

let runner: ChildProcess | null = null;
let viewer = "";
function startRunner(): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn("npx", ["tsx", "src/cli/relay.ts", "--local"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    runner = p;
    const runLog = createWriteStream(join(out, "runner.log"), { flags: "a" });
    let buf = "";
    p.stdout!.on("data", (d: Buffer) => {
      const s = d.toString();
      runLog.write(clean(s));
      buf += s;
      const m = /viewer\s+(\S+#view=\S+)/.exec(buf);
      if (m && !viewer) { viewer = m[1]!; ok(); }
    });
    p.stderr!.on("data", (d: Buffer) => runLog.write(clean(d.toString())));
    p.on("exit", (code) => { if (!viewer) fail(new Error(`runner exited ${code}`)); });
    setTimeout(() => fail(new Error("runner did not start in 60 s")), 60_000);
  });
}

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
const count = (sql: string, ...a: unknown[]) => (db().prepare(sql).get(...a) as { n: number }).n;
const status = (id: string) => (db().prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string } | undefined)?.status;
const latest = (kind: string, where = "1=1") => (db().prepare(`SELECT proposal_id FROM proposals WHERE kind = ? AND ${where} ORDER BY rowid DESC LIMIT 1`).get(kind) as { proposal_id: string } | undefined)?.proposal_id;
const executed = (id: string, ms = 600_000) => until(`${id} executed`, () => { const s = status(id); if (s === "FAILED" || s === "REJECTED" || s === "EXPIRED") throw new Error(`${id} is ${s}`); return s === "EXECUTED" ? s : undefined; }, ms);
const headSeq = () => count("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log");
const lastEvent = (kind: string) => count("SELECT COALESCE(MAX(id), 0) AS n FROM world_events WHERE kind = ?", kind);
type Decision = { source: string; summary: string; events: number[] };
const decisionsAfter = (agent: string, seq: number) => db().prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.decision' AND actor = ? AND seq > ? ORDER BY seq").all(agent, seq).map((r) => JSON.parse((r as { payload_json: string }).payload_json) as Decision);
const decisionOn = (agent: string, eventId: number, seq: number) => decisionsAfter(agent, seq).find((d) => (d.events ?? []).includes(eventId));
const maxSold = () => count("SELECT COALESCE(MAX(CAST(json_extract(request_params_json, '$.seq') AS INTEGER)), 0) AS n FROM sales");
const setting = (k: string) => (db().prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;

const require = createRequire(join(repo, "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
const browser = await chromium.launch();
const errors: string[] = [];
async function phone(name: string): Promise<{ page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e: Error) => errors.push(`${name}: ${e.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { page };
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });

async function enrol(p: { page: Page }, person: string | null): Promise<string> {
  const { code } = openEnrolment(db(), { rpId: "localhost", origin: url, ...(person ? { addPerson: person } : {}) });
  await sleep(10_000);
  await p.page.goto(viewer);
  await p.page.goto(`${url}/enrol`);
  await p.page.fill("#code", code.toLowerCase());
  await p.page.click("button.confirm");
  await p.page.waitForFunction(() => document.querySelector(".verdict-head")?.textContent === "Confirm on the runner", null, { timeout: 60_000 });
  const shown = /Fingerprint ([0-9A-F]{4}(?:-[0-9A-F]{4}){3})/.exec((await p.page.textContent(".verdict-what")) ?? "")?.[1] ?? "";
  check(pendingPasskeys(db()).some((x) => x.fingerprint === shown), `enrol ${person ?? "test-cfo"} (virtual test passkey): fingerprint ${shown} waits on the runner`);
  confirmPasskey(db(), shown);
  return shown;
}

/** Opens a proposal on a phone, picks an option (or the one shown) or rejects, and signs with the passkey. */
async function sign(p: { page: Page }, id: string, o: { option?: "A" | "B"; tag: string; reject?: boolean }): Promise<{ verdict: string; text: string }> {
  const page = p.page;
  await page.goto(`${url}/approve/${id}`);
  try {
    await page.waitForSelector(o.reject ? "button.reject-btn" : "button.option", { timeout: 120_000 });
  } catch (e) {
    await shot(page, `${o.tag}-no-proposal`);
    say(`  the phone shows: ${((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
    throw e;
  }
  const text = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
  if (o.reject) await page.click("button.reject-btn");
  else if (o.option) await page.locator("button.option", { hasText: `Option ${o.option}` }).first().tap();
  else await page.locator("button.option").first().tap();
  await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
  await page.waitForFunction(() => !(document.querySelector("#sheet button.confirm") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  await shot(page, `${o.tag}-confirm`);
  await page.click("#sheet button.confirm");
  const FINAL = ["Approved", "Done", "1 of 2 approvals", "Rejected", "Refused", "Too late", "Already decided", "Approved, but execution stopped"];
  try {
    await page.waitForFunction((f: string[]) => f.includes(document.querySelector(".verdict-head")?.textContent ?? ""), FINAL, { timeout: 180_000 });
  } catch (e) {
    await shot(page, `${o.tag}-no-verdict`);
    say(`  the phone shows: ${((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(-400)}`);
    throw e;
  }
  await shot(page, `${o.tag}-verdict`);
  const verdict = (await page.textContent(".verdict-head")) ?? "";
  say(`  ${o.tag}: ${id} → "${verdict}"`);
  return { verdict, text };
}

async function linksStep(): Promise<void> {
  for (const n of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(viewer);
    await page.waitForSelector("#pending, #dash, main", { timeout: 20_000 });
    const text = (await page.textContent("body")) ?? "";
    check(!/another runner key/.test(text), `private tab ${n}: the viewer link opens in one tab, no key conflict`);
    if (n === 1) {
      const html = (await page.content()) ?? "";
      facts.second_approver_label_on_page = html.includes(SECOND_APPROVER.replace(/&/g, "&amp;")) || text.includes(SECOND_APPROVER);
      check(facts.second_approver_label_on_page === true, `the viewer page carries the label "${SECOND_APPROVER}"`);
      await shot(page, "viewer");
    }
    await ctx.close();
  }
}

const started = Date.now();
const cfo = await phone("test-cfo");
const controller = await phone("test-controller");
let serve: ChildProcess | null = null;
const stopServe = async () => {
  if (!serve?.pid) return;
  const pgid = serve.pid;
  try { process.kill(-pgid, "SIGTERM"); } catch { /* gone */ }
  await until("the world's serve loop to exit", () => spawnSync("ps", ["-o", "pid=", "-g", String(pgid)], { encoding: "utf8" }).stdout.trim() === "" || undefined, 60_000)
    .catch(() => { try { process.kill(-pgid, "SIGKILL"); } catch { /* gone */ } });
  say(`world serve (process group ${pgid}) stopped`);
  serve = null;
};

try {
  // ---- Vooraf ----
  await timed("V1 Health", async () => { cli("health.ts"); });
  await timed("V2 Bootstrap (fresh keys, faucet)", async () => { cli("bootstrap.ts"); });
  await timed("V3 Cards: each agent its company card at Airwallex", async () => { cli("cards.ts", "setup"); });
  await timed("V4 Visa TAP key of the Sourcing agent, pinned for Packwise", async () => { cli("visa.ts", "setup"); });
  await timed("V5 World options: upstream cache off, free EUR 150.00, TAP rail on", async () => {
    cli("world.ts", "setup", "--upstream-cache", "off", "--free-eur", "150.00", "--tap-rail", "on");
    check(setting("world.upstream_cache") === "off" && setting("world.free_eur_target") === "150.00" && setting("world.tap_rail") === "on", "world options written: cache off, free EUR 150.00, TAP rail on");
  });
  // ---- 1, 1b first (dry-179, holdouts point a): the shop and its suppliers run before the agents start; then the runner ----
  let noticeEvent = 0, noticeFrom = 0;
  await timed("S1 world serve --every 15", async () => {
    serve = spawn("npx", ["tsx", "src/cli/world.ts", "serve", "--every", "15"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const wl = createWriteStream(join(out, "world.log"), { flags: "a" });
    serve.stdout!.on("data", (d: Buffer) => wl.write(clean(d.toString())));
    serve.stderr!.on("data", (d: Buffer) => wl.write(clean(d.toString())));
    await until("the world serving", () => count("SELECT COUNT(*) AS n FROM sales") + count("SELECT COUNT(*) AS n FROM upstream_purchases") > 0 || undefined, 180_000);
    // dry-179 / holdouts (a): the agents' first look at the market must find the suppliers up, so both answer before
    // the runner starts (an offer, nothing paid).
    for (const [name, port] of [["Stockline", 4101], ["Ridgeline Data", 4103]] as const) {
      const res = await fetch(`http://127.0.0.1:${port}/v1/stock-check?seq=1`).catch(() => null);
      check(res?.status === 402 && !!res.headers.get("payment-required"), `${name} answers before the agents start (${res?.status ?? "nothing"} with an x402 offer)`);
    }
  });
  await timed("S1b world ridgeline-maintenance", async () => {
    const from = headSeq(), before = lastEvent("supplier.notice");
    cli("world.ts", "ridgeline-maintenance");
    const ev = lastEvent("supplier.notice");
    check(ev > before, "Ridgeline Data's maintenance notice reached the Sourcing agent");
    const res = await fetch("http://127.0.0.1:4103/v1/stock-check?seq=1").catch(() => null);
    check(res?.status === 503 && !res.headers.get("payment-required"), `Ridgeline answers ${res?.status ?? "nothing"} with no offer`);
    noticeEvent = ev; noticeFrom = from;
  });

  await timed("V6 Runner (local relay, real executors, the three agents)", startRunner);
  await timed("V7 Passkeys: test-cfo and test-controller (virtual, labelled test identities)", async () => {
    facts.fp_cfo = await enrol(cfo, null);
    facts.fp_controller = await enrol(controller, "test-controller");
    check(activePasskey(db()) !== null && count("SELECT COUNT(*) AS n FROM passkeys WHERE status = 'ACTIVE'") === 2, "two active passkeys, two people");
  });
  await timed("V8 Four eyes above EUR 1,000 (P-0001, test-cfo alone)", async () => {
    cli("policy.ts", "set", "approval.four_eyes_eur", "1000.00", "--reason", "dry run: four eyes above EUR 1,000");
    const pc = latest("policy_change", "status = 'PENDING_APPROVAL'");
    check(!!pc, `the four-eyes policy waits as ${pc}`);
    if (pc) {
      const v = await sign(cfo, pc, { tag: "v8-four-eyes" });
      check(v.verdict === "Approved" || v.verdict === "Done", `test-cfo approved ${pc} (${v.verdict})`);
      await until("the four-eyes policy in force", () => policyValue(db(), FOUR_EYES_KEY) === "1000.00", 60_000).catch(() => undefined);
    }
    check(policyValue(db(), FOUR_EYES_KEY) === "1000.00", "four eyes is on above EUR 1,000");
  });

  await timed("S1c Sourcing's decision on Ridgeline's notice", async () => {
    const d = await until("Sourcing's decision on Ridgeline's notice", () => decisionOn("sourcing", noticeEvent, noticeFrom), 300_000).catch(() => undefined);
    say(d ? `SOURCING DECIDED (${d.source}): ${d.summary}` : "NO SOURCING DECISION on Ridgeline's notice within 5 minutes");
    say(`SOURCING POLICY after its first look: ${setting("sourcing.buy_policy") ?? "the default"}`);
  });

  // ---- 2, 2b ----
  let riseAt = "";
  await timed("S2 world price-rise 0.04 --silent (after #16 is sold)", async () => {
    await until("#16 sold", () => maxSold() >= 16 || undefined, 900_000);
    say(`SOURCING POLICY at the rise: ${setting("sourcing.buy_policy") ?? "the default (Stockline, up to the mandate's cap)"}`);
    riseAt = new Date().toISOString();
    facts.rise_at = riseAt;
    cli("world.ts", "price-rise", "0.04", "--silent");
  });
  // 2b right after 2. The command waits up to 90 s for its outcome; the runbook goes on meanwhile (Treasury's options may
  // come at once), so it runs beside step 3 and its output is read at the end.
  let letThroughDone: Promise<void> = Promise.resolve();
  await timed("S2b world let-one-through (started; runs beside step 3)", async () => {
    facts.let_through_requested_at = new Date().toISOString();
    letThroughDone = new Promise<void>((done) => {
      const p = spawn("npx", ["tsx", "src/cli/world.ts", "let-one-through"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      p.stdout!.on("data", (d: Buffer) => { text += d.toString(); });
      p.stderr!.on("data", (d: Buffer) => { text += d.toString(); });
      p.on("exit", (code) => { for (const l of text.split("\n")) if (l.trim() && !/ExperimentalWarning|trace-warnings/.test(l)) say(`  let-one-through: ${l}`); say(`  let-one-through exited ${code}`); facts.let_through = setting("world.let_one_through"); done(); });
    });
  });

  // ---- 3 ----
  await timed("S3 Treasury's rebalance within 20.00, four eyes, replace", async () => {
    const prop = await until("Treasury's options", () => latest("mandate_replace", "status = 'PENDING_APPROVAL' AND created_by = 'treasury'"), 900_000).catch(() => undefined);
    if (!prop) { check(false, "Treasury proposed options within 15 minutes"); return; }
    await until("both options", () => count("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'mandate_replace' AND created_by = 'treasury'") >= 2 || undefined, 30_000).catch(() => undefined);
    facts.options_ready_at = new Date().toISOString();
    const plan = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'price_rise.plan' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
    const rec = plan ? ((JSON.parse(plan.payload_json) as { recommended?: string }).recommended ?? "B") : "B";
    const opt = rec === "A" ? "A" : "B";
    const id = latest("mandate_replace", `status = 'PENDING_APPROVAL' AND json_extract(terms_json, '$.option') = '${opt}'`) ?? prop;
    facts.replace_proposal = id; facts.replace_option = opt;
    const one = await sign(cfo, id, { option: opt, tag: "s3-cfo" });
    check(one.verdict === "1 of 2 approvals", `test-cfo: ${id} option ${opt} → "${one.verdict}" (four eyes: 1 of 2)`);
    const two = await sign(controller, id, { option: opt, tag: "s3-controller" });
    check(two.verdict === "Done" || two.verdict === "Approved", `test-controller (labelled test passkey): ${id} → "${two.verdict}" (2 of 2)`);
    await executed(id);
    facts.replace_executed_at = new Date().toISOString();
  });

  // ---- 4 ----
  await timed("S4 world dispute (Support decides)", async () => {
    const from = headSeq();
    cli("world.ts", "dispute");
    const ev = lastEvent("dispute.opened");
    const d = await until("Support's decision on the dispute", () => decisionOn("support", ev, from), 900_000);
    say(`SUPPORT DECIDED (${d.source}): ${d.summary}`);
    check(d.source === "claude", "the Support agent decided itself");
    const all = await until("a refund-all proposal (if any)", () => latest("refund_batch", "status = 'PENDING_APPROVAL'"), 120_000).catch(() => undefined);
    if (all) {
      const v = await sign(cfo, all, { tag: "s4-refund-all", reject: true });
      check(v.verdict === "Rejected", `test-cfo rejected ${all} as advised (${v.verdict})`);
    } else say("NO REFUND-ALL PROPOSAL");
  });

  // ---- 5 ----
  await timed("S5 world money-in (Treasury decides)", async () => {
    const from = headSeq();
    cli("world.ts", "money-in");
    const ev = lastEvent("money.in");
    const d = await until("Treasury's decision on the money in", () => decisionOn("treasury", ev, from), 900_000);
    say(`TREASURY DECIDED (${d.source}): ${d.summary}`);
    await until("the sweep paid (or none)", () => db().prepare("SELECT outcome FROM sweeps WHERE outcome IN ('PAID','FAILED','REFUSED') ORDER BY created_at DESC LIMIT 1").get() ?? undefined, 300_000).catch(() => undefined);
  });

  // ---- 6 ----
  await timed("S6 world invoice (Treasury plans the licence)", async () => {
    const from = headSeq();
    facts.invoice_at = new Date().toISOString();
    cli("world.ts", "invoice");
    const ev = lastEvent("invoice.received");
    const d = await until("Treasury's decision on the invoice", () => decisionOn("treasury", ev, from), 900_000);
    say(`TREASURY DECIDED (${d.source}): ${d.summary}`);
    const inv = await until("the licence proposal", () => latest("invoice_payment", "status = 'PENDING_APPROVAL'"), 120_000).catch(() => undefined);
    if (!inv) { check(false, "Treasury proposed the licence payment"); return; }
    facts.licence_proposal = inv;
    const v = await sign(cfo, inv, { tag: "s6-licence" });
    check(v.verdict === "Approved" || v.verdict === "Done", `test-cfo approved ${inv} (${v.verdict})`);
    facts.licence_approved_at = new Date().toISOString();
    await executed(inv, 900_000);
    facts.licence_executed_at = new Date().toISOString();
    await until("the transfer PAID", () => (db().prepare("SELECT status FROM transfers ORDER BY rowid DESC LIMIT 1").get() as { status?: string } | undefined)?.status === "PAID" || undefined, 600_000).catch(() => say("the transfer is not PAID within 10 minutes"));
    facts.licence_paid_at = new Date().toISOString();
  });

  // ---- 7 ----
  await timed("S7 world packwise-pro (Sourcing, TAP on its card)", async () => {
    const from = headSeq();
    cli("world.ts", "packwise-pro");
    const ev = lastEvent("supplier.notice");
    const d = await until("Sourcing's decision on Packwise", () => decisionOn("sourcing", ev, from), 600_000);
    say(`SOURCING DECIDED (${d.source}): ${d.summary}`);
    const raise = await until("a card raise asked by Sourcing (if any)", () => latest("policy_change", "status = 'PENDING_APPROVAL' AND created_by = 'sourcing'"), 120_000).catch(() => undefined);
    if (raise) {
      const before2 = headSeq(), evBefore = lastEvent("card.limit_changed");
      const v = await sign(cfo, raise, { tag: "s7-card-raise" });
      check(v.verdict === "Approved" || v.verdict === "Done", `test-cfo approved the card raise ${raise} (${v.verdict})`);
      await executed(raise);
      const ev2 = await until("card.limit_changed reaching Sourcing", () => { const e = lastEvent("card.limit_changed"); return e > evBefore ? e : undefined; }, 120_000);
      const d2 = await until("Sourcing's decision after the raise", () => decisionOn("sourcing", ev2, before2), 600_000);
      say(`SOURCING DECIDED (${d2.source}): ${d2.summary}`);
    } else say("NO CARD RAISE asked");
    await until("Packwise Pro bought (approved)", () => count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'sourcing.software_bought' AND json_extract(payload_json, '$.approved') = 1 AND seq > ?", from) > 0 || undefined, 300_000).catch(() => say("Packwise Pro not bought within 5 minutes"));
    for (const r of db().prepare("SELECT payload_json FROM audit_log WHERE event = 'sourcing.software_bought' AND seq > ? ORDER BY seq").all(from)) say(`SOFTWARE ${(r as { payload_json: string }).payload_json.slice(0, 400)}`);
  });

  await letThroughDone;
  await timed("L Links: the viewer in one private tab, twice; the second-approver label", linksStep);
  const pending = db().prepare("SELECT proposal_id, kind, created_by FROM proposals WHERE status = 'PENDING_APPROVAL'").all();
  say(`PENDING at the end: ${JSON.stringify(pending)}`);
} catch (e) {
  failures++;
  say(`FAIL  driver: ${(e as Error).message}`);
}
// ---- 8: the customer stops; the checks run against this world with its runner still up; then npm run stop ----
facts.let_through_final = setting("world.let_one_through");
say(`LET-THROUGH at the end: ${facts.let_through_final}`);
await stopServe();
await browser.close().catch(() => undefined);
facts.page_errors = errors;
await sleep(20_000);
const checks: Record<string, number | null> = {};
function check8(name: string, script: string, ...args: string[]): void {
  const r = spawnSync("npx", ["tsx", `src/cli/${script}`, ...args], { cwd: repo, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = clean(`${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).join("\n"));
  writeFileSync(join(out, `check-${name}.txt`), text);
  checks[name] = r.status;
  say(`CHECK ${name}: exit ${r.status}; ${text.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`);
}
const day = new Date().toISOString().slice(0, 10);
facts.lock_before_stop = (() => { try { const r = db().prepare("SELECT holder FROM locks WHERE lock_key = 'runner'").get() as { holder: string } | undefined; const h = r ? JSON.parse(r.holder) as { pid?: number; pgid?: number } : null; return h ? { pid: h.pid, pgid: h.pgid } : null; } catch { return null; } })();
await timed("C Checks: verify, reconcile, data-qa, origins, dashboard-vs-chain, agent-summary", async () => {
  check8("verify", "verify.ts");
  check8("reconcile", "reconcile.ts");
  check8("data-qa", "dataQa.ts", "--out", `docs/runs/${day}-${world}-data-qa.md`);
  check8("origins", "origins.ts", ledger);
  check8("dashboard-vs-chain", "dashboardVsChain.ts");
  check8("agent-summary", "agentSummary.ts");
});
facts.checks = checks;
await timed(`X npm run stop -- ${world}`, async () => {
  const r = spawnSync("npx", ["tsx", "src/cli/stop.ts", world], { cwd: repo, env, encoding: "utf8" });
  const text = clean(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  writeFileSync(join(out, "check-stop.txt"), text);
  checks.stop = r.status;
  say(`STOP exit ${r.status}: ${text.trim().split("\n").slice(-3).join(" | ")}`);
});
writeFileSync(join(out, "timings.json"), JSON.stringify({ total_minutes: Math.round((Date.now() - started) / 60_000), failures, timings, facts }, null, 2));
const red = Object.values(checks).some((c) => c !== 0);
say(failures === 0 && !red ? "driver: every step and check passed" : `driver: ${failures} step check(s) failed; check exits ${JSON.stringify(checks)}`);
process.exit(failures === 0 && !red ? 0 : 1);
