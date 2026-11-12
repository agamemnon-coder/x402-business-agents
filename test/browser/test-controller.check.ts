// Browser check of the virtual second approver (not part of npm test; needs Playwright with Chromium):
//   npx tsx test/browser/test-controller.check.ts [screenshot dir]
// Drives docs/runs/driver/test-controller.ts end to end against a LOCAL relay: a throwaway ledger and keys folder, the
// relay served on localhost, the runner in this process with a fake executor (nothing reaches Metal or any other
// network). The driver's real Chromium phone enrols, keeps its credential in a file, and in a later browser loads it
// again and approves. What plays the owner here is a second Chromium virtual authenticator, a stand-in for the
// owner's phone in this check only: no real phone takes part.
//
// It checks: enrol refuses before the owner's passkey; enrol does not confirm itself; the credential file is mode 600
// in the keys folder; approve refuses to sign first and signs second; the approval row names test-controller; the sign
// counter is kept, so a second proposal can be approved from the file; a proposal of another kind is refused; nothing
// printed holds the relay token, the viewer key or the private key; and the command itself refuses another name.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { revokeCall } from "@metalntwx/metal-pay/mandates";
import { audit } from "../../src/audit/log.js";
import { openDb } from "../../src/db/open.js";
import { proposeDevTest } from "../../src/executors/devTest.js";
import { coseP256, ownersExecuteTerms, type OwnersExecuteTerms } from "../../src/metal/ownersExecute.js";
import { passkeySigner } from "../../src/metal/passkeyOwner.js";
import { PASSKEY_VERIFIER } from "../../src/metal/passkeyRelay.js";
import { confirmPasskey, openEnrolment, pendingPasskeys } from "../../src/passkey/ledger.js";
import { createProposal, nextProposalId } from "../../src/policy/approvals.js";
import { viewerLink, viewKey } from "../../src/relay/config.js";
import { startLocalRelay } from "../../src/relay/local.js";
import { RelayRunner } from "../../src/relay/runner.js";
import { displayKey } from "../../src/relay/sign.js";
import { approve, chromiumPhone, CREDENTIAL_FILE, enrol, LABEL, loadCredential, NAME, Refused, type ControllerDeps } from "../../docs/runs/driver/test-controller.js";
import { virtualPhones, type Page } from "../../docs/runs/driver/virtualPhone.js";

const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "kit11-test-controller-"));
const keys = join(dir, "keys");
mkdirSync(keys, { mode: 0o700 });
process.env.KIT11_KEYS_DIR = keys;
process.env.KIT11_PASSKEY_OWNERS = "on";
const db = openDb(join(dir, "world.sqlite"));
const TOKEN = "test-controller-check-relay-token";
const local = await startLocalRelay({ port: 0, token: TOKEN });
const cfg = { url: local.url, origin: local.url, rpId: new URL(local.url).hostname, token: TOKEN };
const env = { KIT11_KEYS_DIR: keys, KIT11_RELAY_URL: local.url, KIT11_RELAY_TOKEN: TOKEN };
// The runner's key, where npm run relay keeps it: the driver reads its public half from the same file.
const signer = displayKey(join(keys, "relay-display-key.pem"));
const executed: string[] = [];
const runner = new RelayRunner({ db, cfg, fetch, signer, label: "max", log: (l) => console.log(`  runner: ${l}`), execute: async (_d, id) => { executed.push(id); } });
let syncing = true;
const loop = (async () => { while (syncing) { await runner.syncOnce().catch((e: Error) => console.error(e.message)); await new Promise((r) => setTimeout(r, 300)); } })();

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; return ok; };
const said: string[] = [];
const say = (line: string) => { said.push(line); console.log(`  driver: ${line}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deps: ControllerDeps = {
  db, env, say, now: () => new Date(),
  // The runner here syncs every 0.3 s; the hosted one takes a new window to the relay within its 2 s loop.
  sleep: (ms) => sleep(Math.min(ms, 1500)),
  phone: () => chromiumPhone({ env, db, say, ...(shots ? { shots } : {}) }),
};
const refused = async (run: () => Promise<unknown>): Promise<string> => { try { await run(); return ""; } catch (e) { return e instanceof Refused ? e.message : `not a refusal: ${(e as Error).message}`; } };
const count = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
const status = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const mode = (file: string) => (statSync(file).mode & 0o777).toString(8);
const file = join(keys, CREDENTIAL_FILE);

// 1. Before the owner's passkey: refused, no window, no file.
check(/the owner enrols first/.test(await refused(() => enrol(deps))) && count("SELECT COUNT(*) AS n FROM passkey_enrolments") === 0, "enrol before the owner's passkey: refused, no window opened");

// 2. The owner's passkey. Here: a second Chromium virtual authenticator standing in for the owner's phone.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors: string[] = [];
const phones = virtualPhones({ browser, url: cfg.url, viewer: () => viewerLink(cfg, signer.publicSpki), db: () => db, say: (l) => console.log(l), check, errors, sleep, shot: async (page: Page, name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }); } });
const owner = await phones.phone("owner stand-in");
{
  const { code } = openEnrolment(db, { rpId: cfg.rpId, origin: cfg.origin });
  await sleep(1000);
  const shown = await phones.createPasskey(owner, code);
  confirmPasskey(db, shown);
  check(count("SELECT COUNT(*) AS n FROM passkeys WHERE status = 'ACTIVE' AND label = 'max'") === 1, `the owner's passkey (a stand-in in this check) is enrolled and confirmed (${shown})`);
}

// 3. approve before enrol: no credential.
check(/run enrol first/.test(await refused(() => approve(deps, "P-0001"))), "approve before enrol: refused, there is no credential");

// 4. enrol: the real Chromium phone on the local relay. It does not confirm itself.
const { fingerprint } = await enrol(deps);
check(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(fingerprint) && pendingPasskeys(db).some((p) => p.fingerprint === fingerprint && p.label === NAME), `enrol: the virtual passkey ${fingerprint} waits on the runner under the label ${NAME}`);
check(count("SELECT COUNT(*) AS n FROM passkeys WHERE label = ?", NAME) === 0, "enrol: the driver did not confirm its own fingerprint");
check(mode(file) === "600" && loadCredential(file).credential.rpId === cfg.rpId, `enrol: the credential is in the keys folder, mode ${mode(file)}`);
check(said.includes(`                 npm run passkey -- confirm ${fingerprint}`), "enrol: it prints the exact confirm line for the operator");
check(/another relay|not the active passkey/.test(await refused(() => approve(deps, "P-0001"))), "approve before the operator confirmed: refused");
confirmPasskey(db, fingerprint); // the operator, on the owner's go
const enrolled = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'passkey.enrolled' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string };
check((JSON.parse(enrolled.payload_json) as { label: string }).label === NAME, "the enrolment's audit row carries the label test-controller");
check(/already has an active passkey/.test(await refused(() => enrol(deps))), "enrol again: refused, it replaces nobody's passkey");

// 5. An owners_execute on an account whose owners are these two passkeys (the calls of a real bind, public testnet data).
const F = JSON.parse(readFileSync(new URL("../fixtures/owners-execute-terms.json", import.meta.url), "utf8")) as OwnersExecuteTerms;
const owners = (db.prepare("SELECT public_key FROM passkeys WHERE status = 'ACTIVE' ORDER BY label").all() as { public_key: string }[]).map((r) => passkeySigner(PASSKEY_VERIFIER, coseP256(r.public_key)));
audit(db, "owner-signer", "owners.account_created", F.account, { account: F.account, owners: ["max", NAME], signers: owners, threshold: "2" });
function propose(action: OwnersExecuteTerms["action"], calls: OwnersExecuteTerms["calls"]): string {
  const id = nextProposalId(db);
  const expires = new Date(Date.now() + 15 * 60_000);
  expires.setUTCMilliseconds(0);
  createProposal(db, { terms: ownersExecuteTerms({ proposal_id: id, expires_at: expires.toISOString().replace(".000Z", "Z"), account: F.account, chain_id: F.chain_id, owners, calls, nonce: F.nonce, valid_until: String(Math.floor(expires.getTime() / 1000) + 120), action }), createdBy: "treasury" });
  return id;
}
const bind = propose(F.action, F.calls);

// 6. Never first.
check(/never signs first/.test(await refused(() => approve(deps, bind))) && count("SELECT COUNT(*) AS n FROM cosignatures") === 0, `approve ${bind} before the owner: refused, nothing signed`);

// 7. The owner signs; 8. the driver signs second, in a new browser, from the credential file.
const first = await phones.sign(owner, bind, { tag: "owner-bind" });
check(first.verdict === "1 of 2 approvals", `the owner's stand-in signs ${bind} first: "${first.verdict}"`);
const before = loadCredential(file).credential.signCount;
const second = await approve(deps, bind);
check(second.ok && ["Done", "Approved"].includes(second.verdict), `the driver approves ${bind} second, from its credential file: "${second.verdict}"`);
const row = db.prepare("SELECT approver FROM approvals WHERE proposal_id = ?").get(bind) as { approver: string } | undefined;
check(/^max \(passkey .{8}\) \+ test-controller \(passkey .{8}\)$/.test(row?.approver ?? ""), `ledger: ${bind} approved by ${row?.approver}`);
for (let i = 0; i < 20 && !executed.includes(bind); i++) await sleep(500);
check(executed.join() === bind, "the (fake) executor ran once for it");
const after = loadCredential(file).credential.signCount;
check(after > before && mode(file) === "600", `the sign counter is kept (${before} → ${after}); the file is still mode ${mode(file)}`);
check(said.some((l) => l.startsWith(`APPROVED         ${LABEL}: signed ${bind} as the second approver, after max`)), "its output names itself a virtual test passkey and says it signed second");

// 9. A second proposal (a revoke) from the same file: the kept counter still moves forward for the runner.
const revoke = propose({ ...F.action, what: "revoke" }, [{ target: F.account, value: "0", call_data: revokeCall(F.account, F.action.mandate).data }]);
check((await phones.sign(owner, revoke, { tag: "owner-revoke" })).verdict === "1 of 2 approvals", `the owner's stand-in signs ${revoke} first`);
const again = await approve(deps, revoke);
check(again.ok && status(revoke) !== "PENDING_APPROVAL" && loadCredential(file).credential.signCount > after, `the driver approves ${revoke} from the same file: "${again.verdict}"`);
check(/not waiting for approval/.test(await refused(() => approve(deps, revoke))), "a decided proposal: refused");

// 10. Another kind of proposal: refused, whoever approved it.
const dev = proposeDevTest(db).proposal_id;
check(new RegExp(`${dev} is a dev_test, not an owners_execute`).test(await refused(() => approve(deps, dev))), `approve ${dev} (a dev test): refused, it signs owners_execute only`);

// Nothing printed holds a secret; the command refuses another name without touching anything.
const text = said.join("\n");
check(!text.includes(TOKEN) && !text.includes(viewKey(TOKEN)) && !text.includes("#view=") && !text.includes(loadCredential(file).credential.privateKey), "nothing the driver printed holds the relay token, the viewer key or the private key");
check(said.every((l) => l.includes(LABEL) || /^ {17}npm run passkey -- confirm /.test(l)), "every line the driver printed about itself says it is a virtual test passkey");
const cli = (...args: string[]) => spawnSync("npx", ["tsx", "docs/runs/driver/test-controller.ts", ...args], { cwd: resolve(import.meta.dirname, "../.."), env: { ...process.env, ...env, KIT11_DB: join(dir, "world.sqlite") }, encoding: "utf8" });
const other = cli("enrol", "anna");
check(other.status === 2 && /REFUSED .*only ever test-controller/.test(other.stderr) && count("SELECT COUNT(*) AS n FROM passkey_enrolments WHERE status = 'OPEN'") === 0, `the command with another name exits ${other.status} and opens nothing`);
const reject = cli("approve", bind, "--reject");
check(reject.status === 2 && /only approves/.test(reject.stderr), `the command asked to reject exits ${reject.status}`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
syncing = false;
await loop;
await browser.close();
local.server.close();
console.log(failures === 0 ? "\ntest-controller check passes (local relay, fake executor; no real phone, no hosted relay, no chain)" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
