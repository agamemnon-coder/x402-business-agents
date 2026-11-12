// The virtual second approver of a passkey-owners run ("Face ID signs on chain"), for when the owner has one device.
// Not product code and not part of npm test. The passkey account needs two owners, two different people's passkeys.
// The first is the owner's own, on the owner's phone. The second is either a second real device
// (npm run passkey -- add <name>) or this: a passkey in Chromium's virtual authenticator, under the fixed label
// "test-controller". It is a test identity. It is not a person and not a device, and everything it prints says so.
//
//   KIT11_DB=… KIT11_KEYS_DIR=… KIT11_RELAY_URL=… KIT11_RELAY_TOKEN=… npx tsx docs/runs/driver/test-controller.ts enrol
//   (the same settings)                                              npx tsx docs/runs/driver/test-controller.ts approve <proposal id>
//
//   enrol     opens an enrolment window that adds test-controller (as npm run passkey -- add adds a person), creates
//             the passkey on the relay's enrol page, keeps its credential in the keys folder and prints its
//             fingerprint. It does NOT confirm it: the operator runs npm run passkey -- confirm <fingerprint> on the
//             owner's go.
//   approve   loads that credential and approves one owners_execute on the relay's approval page, as the SECOND
//             approver: only after another person's approval is in the ledger. It never signs first, never rejects,
//             and signs no other kind of proposal.
//
// What a phone needs before the relay's pages show it anything is the viewer link the runner prints: the relay's
// address, the viewer key (derived from the relay's token) and the runner's public key. This driver builds the same
// link from KIT11_RELAY_URL (the address the runner prints; it is never looked up here), the token in
// KIT11_RELAY_TOKEN (or CLOUDFLARE_API_TOKEN, from which the runner derives it) and the runner's key file in the keys
// folder. The token, the viewer key and the passkey's private key are never printed and never written anywhere but
// the credential file: test-controller.passkey.json in KIT11_KEYS_DIR, which must be outside the repository, readable
// by its owner only.
//
// The logic takes its phone as a parameter (ControllerPhone), so test/test-controller.test.ts runs it without a
// browser; test/browser/test-controller.check.ts drives the real Chromium phone against a local relay.

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, type DB } from "../../../src/db/open.js";
import { redactSecrets } from "../../../src/lib/redact.js";
import { keysDir } from "../../../src/metal/agentCli.js";
import { OWNERS_EXECUTE } from "../../../src/metal/ownersExecute.js";
import { openEnrolment, openWindow, pendingPasskeys } from "../../../src/passkey/ledger.js";
import { relayToken, viewerLink, type RelayConfig } from "../../../src/relay/config.js";
import { displayKey } from "../../../src/relay/sign.js";
import { hideViewKey, virtualPhones } from "./virtualPhone.js";

/** The one name this driver's passkey ever has. It is the label in the ledger, the audit rows and the run record. */
export const NAME = "test-controller";
/** How every line this driver prints names itself. */
export const LABEL = `virtual test passkey (${NAME})`;
export const CREDENTIAL_FILE = `${NAME}.passkey.json`;
/** The runner takes a new enrolment window to the relay at its next sync; the code is typed after that. */
const SYNC_WAIT_MS = 10_000;
const REPO = resolve(import.meta.dirname, "../../..");

type Env = Record<string, string | undefined>;

/** A refusal: nothing was opened, signed or changed. The command ends with exit code 2. */
export class Refused extends Error {
  constructor(message: string) { super(message); this.name = "Refused"; }
}

/** A credential as Chromium's virtual authenticator hands it out and takes it back (CDP WebAuthn; binary fields are base64). */
export interface CdpCredential { credentialId: string; isResidentCredential: boolean; rpId?: string; privateKey: string; userHandle?: string; signCount: number }
export interface StoredCredential { label: typeof NAME; virtual: true; what: string; saved_at: string; credential: CdpCredential }

/** The virtual phone, as the logic needs it. The real one is chromiumPhone below. */
export interface ControllerPhone {
  /** Types the enrolment code on the relay's enrol page and creates the passkey: the fingerprint the page shows, and the credential. */
  enrol(code: string): Promise<{ fingerprint: string; credential: CdpCredential }>;
  /** Loads the credential, opens the proposal's approval view and approves. `guard` is called with the view open, just before the press. */
  approve(id: string, stored: StoredCredential, guard: () => void): Promise<{ verdict: string }>;
  /** The credential's sign counter as the authenticator has it now; null when it holds none. */
  signCount(): Promise<number | null>;
  close(): Promise<void>;
}

export interface ControllerDeps {
  db: DB;
  env: Env;
  say: (line: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<unknown>;
  phone: () => Promise<ControllerPhone>;
}

const USAGE = "usage: npx tsx docs/runs/driver/test-controller.ts enrol | approve <proposal id>";

export function parseCommand(args: readonly string[]): { cmd: "enrol" } | { cmd: "approve"; id: string } {
  const [cmd, ...rest] = args;
  if (cmd === "reject" || rest.some((a) => /reject/i.test(a))) throw new Refused(`the ${LABEL} only approves, as the second approver; it rejects nothing on anybody's behalf`);
  if (cmd === "enrol") {
    if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== NAME)) throw new Refused(`this driver's passkey is only ever ${NAME} (a constant); a person's passkey is enrolled on their own device with npm run passkey -- add <name>`);
    return { cmd };
  }
  if (cmd === "approve" && rest.length === 1) {
    if (!/^P-\d{4,}$/.test(rest[0]!)) throw new Refused(`not a proposal id: ${JSON.stringify(rest[0]!.slice(0, 20))} (like P-0002)`);
    return { cmd, id: rest[0]! };
  }
  throw new Refused(USAGE);
}

/** Where the credential is kept: in the keys folder, which is named explicitly and never inside the repository. */
export function credentialFile(env: Env): string {
  if (!env.KIT11_KEYS_DIR) throw new Refused("set KIT11_KEYS_DIR (the world's keys folder, outside the repository): the virtual passkey's credential is kept there");
  try { return join(keysDir(env as NodeJS.ProcessEnv), CREDENTIAL_FILE); } catch (e) { throw new Refused((e as Error).message); }
}

/** Writes the credential for its owner alone (mode 600), in one step; a file that is there is never made more readable than it was. */
export function saveCredential(file: string, c: StoredCredential): void {
  const mode = existsSync(file) ? statSync(file).mode & 0o600 : 0o600;
  const tmp = `${file}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, "wx", mode);
  try { writeSync(fd, `${JSON.stringify(c, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}

export function loadCredential(file: string): StoredCredential {
  if (!existsSync(file) || statSync(file).size === 0) throw new Refused(`no credential of the ${LABEL} in the keys folder (${CREDENTIAL_FILE}): run enrol first`);
  if (statSync(file).mode & 0o077) throw new Refused(`${CREDENTIAL_FILE} in the keys folder is readable by others; it holds a private key: chmod 600 it, or enrol again`);
  let c: Partial<StoredCredential>;
  try { c = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredCredential>; } catch { c = {}; }
  const k = c.credential;
  if (c.label !== NAME || c.virtual !== true || !k || typeof k.credentialId !== "string" || typeof k.privateKey !== "string" || !Number.isSafeInteger(k.signCount)) {
    throw new Refused(`${CREDENTIAL_FILE} in the keys folder is not the virtual ${NAME}'s credential file`);
  }
  return c as StoredCredential;
}

/** The relay as the phone reaches it: its address from KIT11_RELAY_URL (never looked up), its token from the environment. */
export function relayOf(env: Env): RelayConfig {
  if (!env.KIT11_RELAY_URL || !URL.canParse(env.KIT11_RELAY_URL)) throw new Refused("set KIT11_RELAY_URL to the relay's address, as the runner prints it (npm run relay); this driver does not look it up");
  const token = relayToken(env);
  if (!token) throw new Refused("set KIT11_RELAY_TOKEN (the relay's token, the one the runner uses): the phone's viewer key is derived from it");
  const url = new URL(env.KIT11_RELAY_URL);
  return { url: url.origin, origin: url.origin, rpId: url.hostname, token };
}

/** The viewer link the runner prints, built the same way. It holds the viewer key: opened by the phone, never printed. */
export function viewerOf(env: Env): string {
  const cfg = relayOf(env);
  const key = join(keysDir(env as NodeJS.ProcessEnv), "relay-display-key.pem");
  if (!existsSync(key)) throw new Refused("the runner's key file is not in the keys folder yet: start the runner (npm run relay) with the same KIT11_KEYS_DIR first");
  return viewerLink(cfg, displayKey(key).publicSpki, env as NodeJS.ProcessEnv);
}

const b64url = (b64: string) => Buffer.from(b64, "base64").toString("base64url");
const activeOf = (db: DB) => db.prepare("SELECT credential_id FROM passkeys WHERE status = 'ACTIVE' AND label = ?").get(NAME) as { credential_id: string } | undefined;

/** Why `enrol` may not run, in one sentence; null when it may. Nothing is changed by asking. */
export function enrolRefusal(db: DB, now: Date): string | null {
  const mine = activeOf(db);
  if (mine) return `${NAME} already has an active passkey (${mine.credential_id.slice(0, 8)}); this driver replaces nobody's passkey`;
  if (!db.prepare("SELECT 1 FROM passkeys WHERE status = 'ACTIVE' AND label != ?").get(NAME)) {
    return `no other person's passkey is enrolled yet: the owner enrols first (npm run relay -- --enrol, then npm run passkey -- confirm <fingerprint>); the ${LABEL} is only ever the second approver`;
  }
  const open = openWindow(db, now);
  if (open && open.label !== NAME) return `an enrolment window is open for ${open.label ?? "the runner's own passkey (the owner's)"}; the ${LABEL} never enrols through a window that is not its own. Let that enrolment finish or run out first`;
  const waiting = open ? pendingPasskeys(db, now).find((p) => p.window_id === open.window_id) : undefined;
  if (waiting) return `the ${LABEL} is created already and waits on the runner; on the owner's go: npm run passkey -- confirm ${waiting.fingerprint}`;
  return null;
}

export async function enrol(d: ControllerDeps): Promise<{ fingerprint: string }> {
  const file = credentialFile(d.env);
  const cfg = relayOf(d.env);
  const why = enrolRefusal(d.db, d.now());
  if (why) throw new Refused(why);
  // The window is this driver's own: it adds test-controller (virtual, not a person) beside the owner's passkey and
  // revokes nothing (src/passkey/ledger.ts, whose word for a second passkey's label is "person").
  const { window, code } = openEnrolment(d.db, { rpId: cfg.rpId, origin: cfg.origin, addPerson: NAME }, d.now());
  d.say(`WINDOW           ${LABEL}: an enrolment window for ${NAME} (virtual, not a person) is open until ${window.expires_at.slice(11, 19)} UTC; the runner (npm run relay) must be running`);
  await d.sleep(SYNC_WAIT_MS);
  const phone = await d.phone();
  try {
    const made = await phone.enrol(code);
    // Kept before anything else is checked: the private key exists only in the browser until this line.
    saveCredential(file, { label: NAME, virtual: true, what: "A passkey in Chromium's virtual authenticator: a test identity for the second approver's role, not a person's device.", saved_at: d.now().toISOString(), credential: made.credential });
    const waiting = pendingPasskeys(d.db, d.now()).filter((p) => p.window_id === window.window_id);
    const w = waiting[0];
    if (waiting.length !== 1 || !w || w.fingerprint !== made.fingerprint || w.credential_id !== b64url(made.credential.credentialId) || w.label !== NAME) {
      throw new Error(`${LABEL}: the fingerprint the page shows (${made.fingerprint || "none"}) is not the passkey that waits on the runner in this driver's own window; do not confirm anything, and run enrol again`);
    }
    d.say(`CREATED          ${LABEL}: a passkey in Chromium's virtual authenticator, not on a person's device; fingerprint ${made.fingerprint}`);
    d.say(`KEPT             ${LABEL}: its credential is in the keys folder (${CREDENTIAL_FILE}, readable by its owner only); it is never printed`);
    d.say(`CONFIRM          ${LABEL}: it counts only once the operator confirms it on the runner, on the owner's go:`);
    d.say(`                 npm run passkey -- confirm ${made.fingerprint}`);
    return { fingerprint: made.fingerprint };
  } finally {
    await phone.close();
  }
}

/** Why `approve` may not sign this proposal, in one sentence, or the other person whose approval it follows. Nothing is changed by asking. */
export function approveCheck(db: DB, id: string, stored: StoredCredential, now: Date): { refusal: string } | { after: string } {
  const mine = activeOf(db);
  if (!mine || mine.credential_id !== b64url(stored.credential.credentialId)) {
    return { refusal: `the credential in ${CREDENTIAL_FILE} is not the active passkey labelled ${NAME} in this world's ledger; run enrol, and have the operator confirm its fingerprint, first` };
  }
  const p = db.prepare("SELECT kind, status, expires_at FROM proposals WHERE proposal_id = ?").get(id) as { kind: string; status: string; expires_at: string } | undefined;
  if (!p) return { refusal: `no proposal ${id} in this world's ledger` };
  if (p.kind !== OWNERS_EXECUTE) return { refusal: `${id} is a ${p.kind}, not an owners_execute: the ${LABEL} signs nothing else` };
  if (p.status !== "PENDING_APPROVAL") return { refusal: `${id} is ${p.status.toLowerCase().replace(/_/g, " ")}, not waiting for approval` };
  if (Date.parse(p.expires_at) <= now.getTime()) return { refusal: `${id} expired at ${p.expires_at}; file a new proposal and have both sign again` };
  const signed = (db.prepare("SELECT person FROM cosignatures WHERE proposal_id = ? ORDER BY created_at, rowid").all(id) as { person: string }[]).map((r) => r.person);
  if (signed.includes(NAME)) return { refusal: `the ${LABEL} approved ${id} already; it waits for the other person` };
  const other = signed.find((person) => person !== NAME);
  if (!other) return { refusal: `nobody else has approved ${id} yet: the ${LABEL} never signs first and never stands in for the owner. The owner signs with their own passkey; then run this again` };
  return { after: other };
}

/** The verdicts of the phone's page that mean this passkey's approval counted. */
const COUNTED = ["Approved", "Done", "Approved, but execution stopped"];

export async function approve(d: ControllerDeps, id: string): Promise<{ ok: boolean; verdict: string }> {
  const file = credentialFile(d.env);
  relayOf(d.env);
  const stored = loadCredential(file);
  const check = (): string => {
    const c = approveCheck(d.db, id, stored, d.now());
    if ("refusal" in c) throw new Refused(c.refusal);
    return c.after;
  };
  const after = check();
  const phone = await d.phone();
  try {
    let verdict: string;
    try {
      ({ verdict } = await phone.approve(id, stored, () => { check(); }));
    } finally {
      // The sign counter after each use, whatever came of it: the runner accepts a counter only when it moved forward.
      const count = await phone.signCount().catch(() => null);
      if (count !== null && count > stored.credential.signCount) saveCredential(file, { ...stored, saved_at: d.now().toISOString(), credential: { ...stored.credential, signCount: count } });
    }
    const ok = COUNTED.includes(verdict);
    d.say(ok
      ? `APPROVED         ${LABEL}: signed ${id} as the second approver, after ${after}; the page says "${verdict}"${verdict === "Approved, but execution stopped" ? " (the signature counts; the runner's log says why the execution stopped)" : ""}`
      : `NOT APPROVED     ${LABEL}: ${id}: the page says "${verdict}"; this passkey approved nothing`);
    return { ok, verdict };
  } finally {
    await phone.close();
  }
}

/** The page must itself show an on-chain proposal that another person approved already: the last look before the press. */
export function pageCheck(text: string): string | null {
  if (!/signed on chain/.test(text)) return "the page does not show an on-chain proposal";
  const so = /Approved so far: ([^.]*)\./.exec(text)?.[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (!so.some((person) => person !== NAME)) return `the page shows no approval by another person: the ${LABEL} never signs first`;
  return null;
}

/** The real phone: Chromium at phone size with a virtual authenticator (virtualPhone.ts), on the relay the environment names. */
export async function chromiumPhone(d: Pick<ControllerDeps, "env" | "db" | "say"> & { shots?: string }): Promise<ControllerPhone> {
  const cfg = relayOf(d.env);
  const viewer = viewerOf(d.env);
  // Playwright is not a dependency of this repo; it comes with the environment (Chromium pre-installed).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = createRequire(join(REPO, "package.json"))("playwright") as { chromium: any };
  const browser = await chromium.launch(d.env.CHROMIUM_PATH ? { executablePath: d.env.CHROMIUM_PATH } : {});
  try {
    const phones = virtualPhones({
      browser, url: cfg.url, viewer: () => viewer, db: () => d.db, check: (ok) => ok,
      // What the shared helpers say about this phone's page is said under this driver's label too.
      say: (line) => d.say(`${"".padEnd(17)}${LABEL}, its page: ${line.trim()}`), errors: [], sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      shot: async (page, name) => { if (d.shots) await page.screenshot({ path: join(d.shots, `${name}.png`) }); },
    });
    const p = await phones.phone(NAME);
    const credentials = async () => ((await p.cdp.send("WebAuthn.getCredentials", { authenticatorId: p.authenticatorId })) as { credentials: CdpCredential[] }).credentials;
    return {
      async enrol(code) {
        const fingerprint = await phones.createPasskey(p, code);
        const all = await credentials();
        if (all.length !== 1) throw new Error(`${LABEL}: the virtual authenticator holds ${all.length} credentials after the enrolment, not one`);
        return { fingerprint, credential: all[0]! };
      },
      async approve(id, stored, guard) {
        if (stored.credential.rpId !== cfg.rpId) throw new Refused(`the ${LABEL} was created for another relay address than KIT11_RELAY_URL names; a passkey works at the address it was created at`);
        await p.cdp.send("WebAuthn.addCredential", { authenticatorId: p.authenticatorId, credential: stored.credential });
        await phones.openViewer(p);
        const { verdict } = await phones.sign(p, id, { tag: NAME, beforePress: (text) => {
          guard();
          const why = pageCheck(text);
          if (why) throw new Refused(why);
        } });
        return { verdict };
      },
      signCount: async () => (await credentials())[0]?.signCount ?? null,
      close: () => browser.close(),
    };
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}

async function main(): Promise<number> {
  // Nothing this driver prints may hold the viewer key, the token or the endpoint, whatever an error quotes.
  const say = (line: string) => console.log(hideViewKey(redactSecrets(line)));
  try {
    const c = parseCommand(process.argv.slice(2));
    if (!process.env.KIT11_DB) throw new Refused("set KIT11_DB (the world's ledger, the one the runner uses)");
    credentialFile(process.env);
    relayOf(process.env);
    const db = openDb();
    const deps: ControllerDeps = { db, env: process.env, say, now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), phone: () => chromiumPhone({ env: process.env, db, say }) };
    if (c.cmd === "enrol") { await enrol(deps); return 0; }
    return (await approve(deps, c.id)).ok ? 0 : 1;
  } catch (e) {
    const refused = e instanceof Refused;
    console.error(hideViewKey(redactSecrets(`${refused ? "REFUSED          " : "FAILED           "}${LABEL}: ${(e as Error).message}${refused ? ". Nothing was signed." : ""}`)));
    return refused ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
