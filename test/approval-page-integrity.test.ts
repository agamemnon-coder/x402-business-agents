// Outside audit, finding 1.5: "the relay serves the approval page; a compromised relay could serve a different script and
// mislead the human. Make approval UI integrity independently verifiable." The phone's pages are one document each under
// a CSP of hashes, their SHA-256 is published in docs/evidence/approval-page.json, and npm run verify-approval-page
// compares a live page with it (src/approve/integrity.ts). Breaks if the committed record drifts from the code (any
// change to a page, its script or its stylesheet), if a phone page's CSP stops being strict and hash-based, if the relay
// serves other bytes than the record names, or if the check passes a tampered page. And because a lying page could
// still show one thing and ask Face ID to sign another, it also shows that the runner and the cloud refuse a signature
// over terms displayed differently: they verify against their own canonical terms, never the page's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { consoleCsp, consolePage } from "../cloud/src/console.js";
import { checkServedPage, inlinePhonePage, normaliseConsole, RECORD_PATH, sha256Hex, shownBuild, verifyApprovalPages } from "../src/approve/integrity.js";
import { approvalPageRecord, recordText } from "../src/approve/pageRecord.js";
import { openDb } from "../src/db/open.js";
import { canonicalTerms, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { buildPages, phoneScript } from "../src/relay/assets.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { pageResponse } from "../worker/src/core.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN as CLOUD_ORIGIN, RP as CLOUD_RP, testCloud } from "./support/cloud.js";

const record = approvalPageRecord();
const pages = buildPages();
const RELAY = "https://kit11.example.workers.dev";
const relayFetch = (async (input: string | URL | Request) => pageResponse(new Request(String(input)), pages) ?? new Response("not found", { status: 404 })) as typeof fetch;
const b64sha = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

describe("the published record of the approval pages (docs/evidence/approval-page.json)", () => {
  it("is what this code serves: a change to a page, its script or its stylesheet without a new record fails here", () => {
    expect(readFileSync(new URL(`../${RECORD_PATH}`, import.meta.url), "utf8"), "run npm run approval-page-record and commit docs/evidence/approval-page.json").toBe(recordText(record));
  });

  it("any change to the script or the stylesheet changes every phone page's hash, CSP and build id", () => {
    const script = phoneScript();
    const changed = approvalPageRecord({ client: `${script}\n;` });
    const restyled = approvalPageRecord({ css: `${readFileSync(new URL("../src/approve/style.css", import.meta.url), "utf8")}\n` });
    for (const other of [changed, restyled]) {
      for (const name of ["approve", "enrol", "policy"]) {
        const [a, b] = [record.pages.find((p) => p.name === name)!, other.pages.find((p) => p.name === name)!];
        expect({ name, sha: a.sha256 === b.sha256, csp: a.csp === b.csp, build: a.build === b.build }).toEqual({ name, sha: false, csp: false, build: false });
      }
    }
  });

  it("the relay serves exactly the recorded bytes and CSP at each path", async () => {
    for (const [path, name] of [["/approve/P-0001", "approve"], ["/approve/P-0042", "approve"], ["/enrol", "enrol"], ["/policy", "policy"]] as const) {
      const res = pageResponse(new Request(`${RELAY}${path}`), pages)!;
      const html = await res.text();
      const want = record.pages.find((p) => p.name === name)!;
      expect({ path, sha: sha256Hex(html), csp: res.headers.get("content-security-policy") }).toEqual({ path, sha: want.sha256, csp: want.csp });
      expect(shownBuild(html)).toBe(want.build);
      expect(html).toContain(`Page build ${want.build}`);
    }
  });
});

describe("each phone page has a strict, hash-based CSP", () => {
  for (const name of ["approve", "enrol", "policy"] as const) {
    it(`${name}: one inline script and one inline stylesheet, each allowed by its SHA-256 only; nothing else runs`, () => {
      const html = pages[name];
      const csp = pages.csp[name];
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)];
      expect(scripts.map((s) => s[1])).toEqual([' type="module"']); // no src: the page loads no other script
      expect(styles.map((s) => s[1])).toEqual([""]);
      // The markup around them: no handler, style attribute, frame or address of anyone else's.
      const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
      expect(markup).not.toMatch(/\son\w+=|\sstyle=|="\s*javascript:|<iframe|<object|<embed|https?:\/\//i);
      const directives = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
      expect(directives["default-src"]).toEqual(["'none'"]);
      expect(directives["script-src"]).toEqual([`'sha256-${b64sha(scripts[0]![2]!)}'`]);
      expect(directives["style-src"]).toEqual([`'sha256-${b64sha(styles[0]![2]!)}'`]);
      expect(directives["base-uri"]).toEqual(["'none'"]);
      expect(directives["frame-ancestors"]).toEqual(["'none'"]);
      expect(directives["form-action"]).toEqual(["'none'"]);
      expect(csp).not.toMatch(/'unsafe-|'strict-dynamic'|\*|https?:|data:|blob:/);
    });
  }

  it("refuses a template, script or stylesheet that would break out of its element", () => {
    const t = pages.approve; // already inlined: no tags left to fill
    expect(() => inlinePhonePage(t, "x", "y")).toThrow(/links \/assets\/approve.css/);
    const template = readFileSync(new URL("../src/approve/page.html", import.meta.url), "utf8");
    expect(() => inlinePhonePage(template, "a('</script><script>evil()')", "")).toThrow(/end its inline element/);
    expect(() => inlinePhonePage(template, "x", "a{}</style><script>")).toThrow(/end its inline element/);
    expect(() => inlinePhonePage(template.replace(/__PURSER_PAGE_BUILD__/g, ""), "x", "y")).toThrow(/build id/);
  });
});

describe("npm run verify-approval-page", () => {
  it("passes the pages the relay serves, from its bare address", async () => {
    const out = await verifyApprovalPages([RELAY], record, relayFetch);
    expect(out.ok, out.lines.join("\n")).toBe(true);
    expect(out.lines).toHaveLength(3);
    expect(out.lines.every((l) => /^ok {4}.*as published$/.test(l))).toBe(true);
  });

  it("fails a relay that serves another script, keeps the script but loosens the CSP, or shows another build", async () => {
    const tampered: [string, (r: Response, html: string) => Response][] = [
      ["script", (r, html) => new Response(html.replace("canonicalize", "canonicalise"), { headers: r.headers })],
      ["csp", (r, html) => new Response(html, { headers: { "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'" } })],
      ["no csp", (_r, html) => new Response(html)],
      ["build shown", (r, html) => new Response(html.replace(/data-build="[^"]+"/, 'data-build="0000-0000-0000"'), { headers: r.headers })],
    ];
    for (const [what, change] of tampered) {
      const evil = (async (input: string | URL | Request) => {
        const r = pageResponse(new Request(String(input)), pages)!;
        return new URL(String(input)).pathname.startsWith("/approve/") ? change(r, await r.text()) : r;
      }) as typeof fetch;
      const out = await verifyApprovalPages([`${RELAY}/approve/P-0007`], record, evil);
      expect({ what, ok: out.ok }).toEqual({ what, ok: false });
      expect(out.lines[0]).toMatch(/^FAIL/);
    }
    expect((await verifyApprovalPages([`${RELAY}/nowhere`], record, relayFetch)).ok).toBe(false);
  });

  it("checks Purser Cloud's console with its nonces and its own addresses set aside, and refuses one changed or naming another origin", () => {
    const cfg = { origin: CLOUD_ORIGIN, rpId: CLOUD_RP, mailDomain: "mail.cloud.test", engine: true };
    for (const n of ["bm9uY2Ux", "c2Vjb25kbm9uY2U="]) {
      const c = checkServedPage(record, `${CLOUD_ORIGIN}/`, consolePage(n, cfg), consoleCsp(n));
      expect(c, c.problems.join("; ")).toMatchObject({ ok: true, page: "cloud-console" });
    }
    expect(checkServedPage(record, "https://elsewhere.test/", consolePage("bg==", cfg), consoleCsp("bg==")).problems.join(" ")).toMatch(/names https:\/\/cloud.test, not https:\/\/elsewhere.test/);
    const changed = consolePage("bg==", cfg).replace("navigator.credentials.get", "navigator.credentials.get/*x*/");
    expect(changed).not.toBe(consolePage("bg==", cfg));
    expect(checkServedPage(record, `${CLOUD_ORIGIN}/`, changed, consoleCsp("bg==")).ok).toBe(false);
    expect(() => normaliseConsole("<html></html>", "")).toThrow(/not Purser Cloud's console/);
  });
});

// ── A page that shows one thing and has Face ID sign another ──
const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
let tickets = 0;
const item = (kind: InboxItem["kind"], body: unknown, id: string | null = null): InboxItem => ({ ticket: `t-${++tickets}`, kind, proposal_id: id, body: JSON.stringify(body), received_at: NOW.toISOString() });

describe("a signature over terms displayed differently is refused: the verifier uses its own canonical terms", () => {
  it("on the runner: a lying page's own hash, or the real hash with a signature over what it displayed, approves nothing", async () => {
    const db = openDb(":memory:");
    const phone = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, NOW);
    await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, NOW);
    confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
    const terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-0001", expires_at: "2026-11-20T11:00:00Z", amount: "9850.00", currency: "EUR", vendor: "Bergtex Textil GmbH", iban: "DE89370400440532013000", invoice_no: "BTX-1" } as Terms;
    createProposal(db, { terms, createdBy: "treasury" }, NOW);
    const real = termsHash(terms);
    // What the lying page displayed: a small amount to the right supplier; it hashed that and asked Face ID to sign it.
    const displayed = { ...terms, amount: "98.50" } as Terms;
    const shown = termsHash(displayed);
    expect(canonicalTerms(displayed)).not.toBe(canonicalTerms(terms));
    let counter = 0;
    const overShown = () => phone.sign({ challenge: challengeFor(shown), origin: ORIGIN, rpId: RP, counter: ++counter });
    for (const claimed of [shown, real]) {
      const out = await processAssertion(db, item("assertion", { proposal_id: "P-0001", terms_sha256: claimed, credential: overShown() }, "P-0001"), NOW);
      expect(out.status).toBe("refused");
      expect(out.message).toMatch(/challenge/i);
    }
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = 'P-0001'").get() as { status: string }).status).toBe("PENDING_APPROVAL");
    // The genuine signature over the runner's own terms is the only one that approves.
    const ok = await processAssertion(db, item("assertion", { proposal_id: "P-0001", terms_sha256: real, credential: phone.sign({ challenge: challengeFor(real), origin: ORIGIN, rpId: RP, counter: ++counter }) }, "P-0001"), NOW);
    expect(ok.status).toBe("approved");
  });

  describe("in Purser Cloud", () => {
    beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
    afterAll(() => { vi.useRealTimers(); });

    it("the engine refuses the page's own hash and a signature over the displayed terms; nothing is paid", async () => {
      const c = testCloud({ engine: true });
      try {
        const t = await c.tenant("acme");
        const phone = new FakeAuthenticator();
        const s = await c.req("POST", "/v1/engine/passkey/start", { key: t.session });
        expect((await c.req("POST", "/v1/engine/passkey/finish", { key: t.session, body: { code: s.json.code, credential: phone.register({ challenge: s.json.challenge as string, origin: CLOUD_ORIGIN, rpId: CLOUD_RP }) } })).status).toBe(200);
        const up = await c.req("POST", "/v1/engine/documents", { key: t.session, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
        const filed = await c.req("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: t.session });
        const p = filed.json.proposal as { id: string; terms_sha256: string };
        const shown = sha256Hex(JSON.stringify({ shown: "EUR 18.50 to Bergtex Textil GmbH" }));
        const overShown = (n: number) => phone.sign({ challenge: challengeFor(shown), origin: CLOUD_ORIGIN, rpId: CLOUD_RP, counter: n });
        const a = await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: t.session, body: { terms_sha256: shown, credential: overShown(1) } });
        expect(a.json).toMatchObject({ status: "refused", message: expect.stringMatching(/not the ones on screen/) });
        const b = await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: t.session, body: { terms_sha256: p.terms_sha256, credential: overShown(2) } });
        expect(b.json).toMatchObject({ status: "refused", message: expect.stringMatching(/other terms than the ones on screen/) });
        expect((await c.req("GET", `/v1/engine/proposals/${p.id}`, { key: t.session })).json.proposal).toMatchObject({ status: "PENDING_APPROVAL" });
      } finally { c.close(); }
    });
  });
});
