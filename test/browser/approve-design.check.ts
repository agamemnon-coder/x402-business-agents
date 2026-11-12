// The phone pages' layout in Chromium, offline: the enrolment, approval and policy pages in every state this check can
// reach without a runner, at 390 x 844 and 1440 x 900, light and dark. Not part of npm test; needs Playwright with Chromium:
//   npx tsx test/browser/approve-design.check.ts [screenshot dir]
// The pages, stylesheet and script are the relay's own bundle (src/relay/assets.ts), served with the relay's own headers
// and CSP (worker/src/core.ts pageResponse). The relay's API is a stand-in on the same port: test fixtures
// (test/fixtures/proposals.json, expiry moved forward and hashed again), signed with a throwaway runner key made here,
// so the page's own checks (hash, runner signature, ledger counter) run for real. Chromium's virtual authenticator
// plays the phone's passkey. Nothing leaves localhost; nothing is approved anywhere.
// It fails on horizontal scroll, on text outside the viewport, on visible blocks that overlap their siblings, on a
// console or CSP error, and when a state does not show what it should.

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { buildPages } from "../../src/relay/assets.js";
import { pageResponse } from "../../worker/src/core.js";
import { canonicalize } from "../../src/approve/client.js";
import { openDb } from "../../src/db/open.js";
import { currentPolicy } from "../../src/policy/rules.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const shots = resolve(process.argv[2] ?? "test-results/approve-design");
mkdirSync(shots, { recursive: true });
const failures: string[] = [];
const fail = (m: string) => { failures.push(m); console.error(`FAIL ${m}`); };

// ── The stand-in relay's data ──
type Obj = Record<string, unknown>;
const F = JSON.parse(readFileSync(new URL("../fixtures/proposals.json", import.meta.url), "utf8")) as { names: Record<string, string>; proposals: { proposal_id: string; kind: string; terms: Obj }[] };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64u = (b: Buffer) => b.toString("base64url");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

const runner = generateKeyPairSync("ec", { namedCurve: "P-256" });
const runnerSpki = b64u(runner.publicKey.export({ type: "spki", format: "der" }));
const passkey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credId = Buffer.from("purser-design-check-credential");
const VIEW = "0123456789abcdef0123456789abcdef";
const policyRows = currentPolicy(openDb(":memory:"));

function proposal(id: string, group: string, expiresInMs: number, extra: Obj = {}): Obj {
  const f = F.proposals.find((p) => p.proposal_id === id)!;
  const expires_at = iso(Date.now() + expiresInMs);
  const canonical = canonicalize({ ...f.terms, expires_at });
  return { proposal_id: id, kind: f.kind, group, canonical, terms_sha256: sha(canonical), expires_at, created_by: f.kind === "invoice_payment" ? "treasury" : "treasury", created_at: iso(Date.now() - 60_000), review: null, ...extra };
}

let seq = 1;
function approvals(proposals: Obj[], opts: { badSignature?: boolean; enrolled?: boolean } = {}): Obj {
  const passkeyInfo = { rp_id: "localhost", credentials: opts.enrolled === false ? [] : [{ id: b64u(credId), label: "iPhone", enrolled_at: iso(Date.now() - 86_400_000) }] };
  const body = { proposals, names: F.names, passkey: passkeyInfo, policy: policyRows, ledger_seq: seq++ };
  const text = canonicalize(body as never);
  const sig = sign("sha256", Buffer.from(opts.badSignature ? `${text} ` : text), { key: runner.privateKey, dsaEncoding: "ieee-p1363" });
  return { ...body, relay: { synced_at: iso(Date.now()), age_ms: 1200 }, enrolment_open: false, session_active: true, signature: { sig: b64u(sig) } };
}

interface Scenario {
  approvals?: () => Obj;
  approvalsStatus?: number;
  approvalsDelayMs?: number;
  assertionDelayMs?: number;
  ticket?: { status: string; message?: string };
  enrolOptions?: { status: number; data: Obj };
}
let S: Scenario = {};

// ── The server: the relay's own page responses, the API from the scenario ──
const pages = buildPages();
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
    if (url.pathname === "/api/approvals") {
      await wait(S.approvalsDelayMs);
      return S.approvalsStatus ? json(S.approvalsStatus, { error: "no" }) : json(200, S.approvals ? S.approvals() : approvals([]));
    }
    if (url.pathname === "/api/assertions") { await wait(S.assertionDelayMs); return json(202, { ticket: "T-1" }); }
    if (url.pathname.startsWith("/api/tickets/")) return json(200, S.ticket ?? { status: "queued" });
    if (url.pathname === "/api/enrol/options") {
      const o = S.enrolOptions ?? { status: 200, data: { challenge: b64u(Buffer.from("enrol-challenge-0123456789abcdef")), rp: { id: "localhost", name: "Purser" }, user: { id: b64u(Buffer.from("cfo")), name: "cfo", displayName: "CFO" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 60_000, attestation: "none", authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, excludeCredentials: [] } };
      return json(o.status, o.data);
    }
    if (url.pathname === "/api/enrol") return json(202, { ticket: "T-2" });
    if (url.pathname.startsWith("/api/")) return json(404, { error: "not in this check" });
    const r = pageResponse(new Request(`http://localhost${req.url ?? "/"}`), pages);
    if (!r) { res.writeHead(404); res.end(); return; }
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  })());
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const link = `#view=${VIEW}&runner=${runnerSpki}`;

// ── The layout rules, measured in the page (a string, so no bundler helper reaches the page) ──
const LAYOUT_JS = `(() => {
    const out = [];
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) out.push(\`horizontal scroll (\${document.documentElement.scrollWidth} > \${W})\`);
    const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("details:not([open]) > :not(summary)"); };
    const name = (e) => \`\${e.tagName.toLowerCase()}\${e.id ? \`#\${e.id}\` : ""}\${e.className && typeof e.className === "string" ? \`.\${e.className.trim().replace(/\\s+/g, ".")}\` : ""}\`;
    // Text outside the viewport, sideways: any element whose own text sticks out (clipped ellipsis boxes stay inside).
    for (const e of document.querySelectorAll("body *")) {
      if (!visible(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = e.getBoundingClientRect();
      if (r.right > W + 1 || r.left < -1) out.push(\`text outside the viewport: \${name(e)} (\${Math.round(r.left)}–\${Math.round(r.right)} of \${W})\`);
    }
    // Siblings that overlap: the blocks of each container, in flow (sticky and fixed bars are meant to sit over content).
    for (const parent of document.querySelectorAll("header, main, main *, .sheet *")) {
      const kids = [...parent.children].filter((k) => visible(k) && !["sticky", "fixed", "absolute"].includes(getComputedStyle(k).position) && !["SUMMARY", "BR", "svg", "path"].includes(k.tagName));
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 2 && y > 2) out.push(\`overlap: \${name(kids[i])} and \${name(kids[j])}\`);
      }
    }
    return out;
})()`;
async function layout(page: import("playwright").Page, tag: string): Promise<void> {
  const problems = await page.evaluate(LAYOUT_JS) as string[];
  for (const p of problems) fail(`${tag}: ${p}`);
}

// purser.test points at the same server: a host that is not localhost, where a guest without the viewer link sees the guest card.
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP purser.test 127.0.0.1"] });
const sizes = [{ w: 390, h: 844 }, { w: 1440, h: 900 }] as const;
const schemes = ["light", "dark"] as const;
let shotsTaken = 0;

/** One state, at every size and scheme: a fresh context each time (its own passkey and pinned runner key). */
async function state(name: string, path: string, scenario: () => Scenario, drive: (page: import("playwright").Page) => Promise<void>, guest = false): Promise<void> {
  for (const size of sizes) for (const scheme of schemes) {
    const tag = `${name} ${size.w} ${scheme}`;
    S = scenario();
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, colorScheme: scheme, deviceScaleFactor: size.w === 390 ? 2 : 1 });
    const page = await ctx.newPage();
    const errors: string[] = [];
    // The guest host is plain HTTP and not localhost, so Chromium says it ignores the relay's COOP header: true, and only here.
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource: the server responded with a status of (404|503|400)/.test(m.text()) && !(guest && /Cross-Origin-Opener-Policy header has been ignored/.test(m.text()))) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable", { enableUI: false });
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: { credentialId: credId.toString("base64"), isResidentCredential: false, rpId: "localhost", privateKey: (passkey.privateKey.export({ type: "pkcs8", format: "der" })).toString("base64"), signCount: 0 } });
    try {
      await page.goto(guest ? `${base.replace("localhost", "purser.test")}${path}` : `${base}${path}${link}`);
      await drive(page);
      await page.waitForTimeout(900); // the entrance animations (.35 s) and the tick (.6 s) have finished
      await layout(page, tag);
      const file = join(shots, `${name}-${size.w}-${scheme}.png`);
      await page.screenshot({ path: file });
      shotsTaken++;
    } catch (e) {
      fail(`${tag}: ${(e as Error).message.split("\n")[0]}`);
      await page.screenshot({ path: join(shots, `${name}-${size.w}-${scheme}-FAILED.png`) }).catch(() => undefined);
    }
    for (const e of errors) fail(`${tag}: console: ${e}`);
    await ctx.close();
  }
}

const see = async (page: import("playwright").Page, selector: string, text?: RegExp) => {
  await page.waitForSelector(selector, { timeout: 8000 });
  if (!text) return;
  // The page moves on by itself (a ticket polled each second): wait for the words, then say what it read if they never came.
  const ok = await page.waitForFunction(([s, src, flags]) => new RegExp(src, flags).test(document.querySelector(s)?.textContent ?? ""), [selector, text.source, text.flags] as const, { timeout: 8000 }).then(() => true, () => false);
  if (!ok) throw new Error(`${selector} reads ${JSON.stringify(((await page.textContent(selector)) ?? "").slice(0, 120))}, not ${text}`);
};
const settle = (page: import("playwright").Page) => page.waitForFunction(() => { const b = document.getElementById("approve") as HTMLButtonElement | null; return !!b && !b.disabled; }, undefined, { timeout: 8000 });

const invoice = () => approvals([proposal("P-0004", "G-4", 30 * 60_000)]);

// ── Enrolment ──
await state("enrol-code", "/enrol", () => ({}), async (p) => { await see(p, "#code"); });
await state("enrol-wrong-code", "/enrol", () => ({ enrolOptions: { status: 400, data: { error: "That code is not open", attempts_left: 4 } } }), async (p) => {
  await p.fill("#code", "ABCD-EFGH");
  await p.click("button.confirm");
  await see(p, ".sheet-status", /tries left/);
});
await state("enrol-fingerprint", "/enrol", () => ({ ticket: { status: "queued" } }), async (p) => {
  await p.fill("#code", "ABCD-EFGH");
  await p.click("button.confirm");
  await see(p, ".verdict-what", /Fingerprint [0-9A-F]{4}(-[0-9A-F]{4}){3}/);
  const fp = /[0-9A-F]{4}(?:-[0-9A-F]{4}){3}/.exec((await p.textContent(".verdict-what")) ?? "")![0];
  S.ticket = { status: "pending", message: `Passkey received, fingerprint ${fp}. Confirm it on the runner.` };
  await see(p, ".verdict-head", /Confirm on the runner/);
  if (await p.locator(".alarm").count()) throw new Error("the fingerprint alarm shows for the phone's own passkey");
});
await state("enrol-done", "/enrol", () => ({ ticket: { status: "enrolled", message: "" } }), async (p) => {
  await p.fill("#code", "ABCD-EFGH");
  await p.click("button.confirm");
  await see(p, ".verdict-head", /Passkey enrolled/);
});

// ── Approval ──
await state("approve-loading", "/approve/P-0004", () => ({ approvals: invoice, approvalsDelayMs: 60_000 }), async (p) => { await see(p, "#app .muted", /Loading/); });
await state("approve-invoice", "/approve/P-0004", () => ({ approvals: invoice }), async (p) => {
  await see(p, ".what-title");
  await see(p, ".hero-amount", /1,850\.00/);
  await settle(p);
});
await state("approve-options", "/approve/P-0001", () => ({ approvals: () => approvals([proposal("P-0001", "G-1", 30 * 60_000), proposal("P-0002", "G-1", 30 * 60_000)]) }), async (p) => {
  await see(p, ".choices");
  await settle(p);
});
await state("approve-against", "/approve/P-0004", () => ({ approvals: () => approvals([proposal("P-0004", "G-4", 30 * 60_000, { review: { model: "claude-opus-5-5", recommendation: "reject", text: "The invoice number was paid last month." } })]) }), async (p) => {
  await see(p, ".actions.against");
  await settle(p);
});
await state("approve-signing", "/approve/P-0004", () => ({ approvals: invoice, assertionDelayMs: 60_000 }), async (p) => {
  await settle(p);
  await p.click("#approve");
  await see(p, "#sign-status", /Sending the signature/);
});
await state("approve-waiting", "/approve/P-0004", () => ({ approvals: invoice, ticket: { status: "queued" } }), async (p) => {
  await settle(p);
  await p.click("#approve");
  await see(p, ".verdict.wait .verdict-head", /Signed/);
});
await state("approve-approved", "/approve/P-0004", () => ({ approvals: invoice, ticket: { status: "executed", message: "Paid EUR 1,850.00 to Lizenzhaus Beispiel GmbH (SWIFT)." } }), async (p) => {
  await settle(p);
  await p.click("#approve");
  await see(p, ".verdict.ok .verdict-head", /Done/);
});
await state("approve-rejected", "/approve/P-0004", () => ({ approvals: invoice, ticket: { status: "rejected", message: "" } }), async (p) => {
  await settle(p);
  await p.click("#reject");
  await see(p, ".verdict.ok .verdict-head", /Rejected/);
});
await state("approve-expired", "/approve/P-0004", () => ({ approvals: () => approvals([proposal("P-0004", "G-4", -60_000)]) }), async (p) => {
  await see(p, ".what-title");
  await p.waitForTimeout(1000);
  if (!(await p.locator("#approve").isDisabled())) throw new Error("an expired proposal's approve button is enabled");
});
await state("approve-too-late", "/approve/P-0004", () => ({ approvals: invoice, ticket: { status: "too_late", message: "The proposal expired before the runner saw your signature." } }), async (p) => {
  await settle(p);
  await p.click("#approve");
  await see(p, ".verdict.warn .verdict-head", /Too late/);
});
await state("approve-error", "/approve/P-0004", () => ({ approvals: invoice, ticket: { status: "failed", message: "Airwallex refused the transfer: insufficient funds." } }), async (p) => {
  await settle(p);
  await p.click("#approve");
  await see(p, ".verdict.bad .verdict-head", /execution stopped/);
});
await state("approve-unsigned", "/approve/P-0004", () => ({ approvals: () => approvals([proposal("P-0004", "G-4", 30 * 60_000)], { badSignature: true }) }), async (p) => { await see(p, ".alarm", /not signed by the runner/); });
await state("approve-offline", "/approve/P-0004", () => ({ approvalsStatus: 503 }), async (p) => { await see(p, ".alarm", /not connected yet/); });

await state("approve-guest", "/approve/P-0004", () => ({ approvals: invoice }), async (p) => {
  await see(p, ".guest h1", /Open your private link/);
  if (!(await p.isVisible("text=needs the private viewer link"))) throw new Error("the guest card lost the words the pages check reads");
  for (const [q, href] of [[".guest a.confirm", "/?signin"], [".guest a.secondary", "/?recorded"]] as const) if ((await p.getAttribute(q, "href")) !== href) throw new Error(`${q} does not lead to ${href}`);
}, true);

// ── Policy ──
await state("policy", "/policy", () => ({ approvals: () => approvals([]) }), async (p) => { await see(p, ".policy-row"); });

await browser.close();
server.close();
if (failures.length) {
  console.error(`approve-design check: ${failures.length} failure(s); screenshots in ${shots}`);
  process.exit(1);
}
console.log(`approve-design check passes: enrol (code, wrong code, fingerprint, enrolled), approve (loading, invoice, options, against advice, signing, waiting, approved, rejected, expired, too late, error, unsigned, offline, guest without the link) and policy at 390 x 844 and 1440 x 900, light and dark: ${shotsTaken} screenshots in ${shots}`);
