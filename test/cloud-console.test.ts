// Purser Cloud's console (cloud/src/console.ts): one page under a strict, per-response nonce policy, its script parses
// and only ever writes values as text, the font it serves is the repo's, and the API it talks to refuses a state change
// from another site. The routes the console added (/v1/company, the richer /v1/me) are owner-only where they change
// something and stay inside the caller's company.
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consoleCsp, consolePage } from "../cloud/src/console.js";
import { INTER_WOFF2_B64 } from "../cloud/src/font.gen.js";
import { EVENT_LINE_JS } from "../src/ui/engineEvents.js";
import { MESSAGES } from "../src/ui/i18n.js";
import { svg } from "../src/ui/payablesKit.js";
import { icon } from "../src/redesign/ui.js";
import { scriptBlocks, scriptBody, withoutBlocks } from "./support/scriptBlocks.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
let t: { id: string; key: string; owner: string };
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

const script = (html: string) => {
  const blocks = scriptBlocks(html);
  expect(blocks).toHaveLength(1);
  return scriptBody(blocks[0]!);
};

describe("the console page", () => {
  it("is served at / with a fresh nonce on its one script and its one stylesheet, and a strict policy", async () => {
    const a = await c.fetch(`${ORIGIN}/`);
    const b = await c.fetch(`${ORIGIN}/`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toMatch(/text\/html/);
    const csp = a.headers.get("content-security-policy")!;
    const n = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(n).not.toBe(/'nonce-([^']+)'/.exec(b.headers.get("content-security-policy")!)![1]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${n}'`);
    expect(csp).toContain(`style-src 'nonce-${n}'`);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    const html = await a.text();
    expect(html).toContain(`<script type="module" nonce="${n}">`);
    expect(html).toContain(`<style nonce="${n}">`);
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    expect(a.headers.get("referrer-policy")).toBe("no-referrer");
    expect(a.headers.get("permissions-policy")).toContain("publickey-credentials-get=(self)");
  });

  it("has no inline handlers, no javascript: links and no style attributes, and its script parses", () => {
    const html = consolePage("n0nce", { origin: ORIGIN, rpId: RP, mailDomain: "in.purser.test" });
    const markup = withoutBlocks(html, ["script", "style"]);
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    expect(markup).not.toMatch(/javascript:/i);
    expect(markup).not.toMatch(/\sstyle\s*=/i);
    // A module script parses as a function body once its import-free top level is wrapped.
    expect(() => new Script(`(async()=>{${script(html)}})`)).not.toThrow();
  });

  it("writes every value from the API as text: innerHTML only ever receives the page's own icons", () => {
    const js = script(consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" }));
    const uses = [...js.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(uses).toEqual(["IC[name]||''"]);
    expect(js).not.toMatch(/insertAdjacentHTML|outerHTML\s*=|document\.write|eval\(|new Function/);
  });

  it("carries its config escaped in a meta tag", () => {
    const html = consolePage("n", { origin: 'https://x"><script>alert(1)</script>', rpId: RP, mailDomain: "" });
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("serves the repo's own font, and nothing else outside /v1", async () => {
    const f = await c.fetch(`${ORIGIN}/assets/inter.woff2`);
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toBe("font/woff2");
    expect(Buffer.from(await f.arrayBuffer()).equals(readFileSync("src/ui/inter.woff2"))).toBe(true);
    expect(INTER_WOFF2_B64).toBe(readFileSync("src/ui/inter.woff2").toString("base64"));
    expect((await c.fetch(`${ORIGIN}/admin`)).status).toBe(404);
    expect((await c.fetch(`${ORIGIN}/.env`)).status).toBe(404);
    expect((await c.fetch(`${ORIGIN}/`, { method: "POST" })).status).toBe(405);
  });

  // 13 Nov: a typed or bookmarked path for the console (/sign-in, /login, /console, ...) went to a plain 404; it opens
  // the console's own route now (its pages are routes after "#"). Anything else stays a 404.
  it("sends the paths people type for the console to its own routes, and nothing else", async () => {
    for (const [path, to] of [["/sign-in", "/#/sign-in"], ["/sign-in/", "/#/sign-in"], ["/login", "/#/sign-in"], ["/signin", "/#/sign-in"], ["/console", "/#/sign-in"], ["/start", "/#/start"], ["/overview", "/#/overview"]] as const) {
      const r = await c.fetch(`${ORIGIN}${path}`, { redirect: "manual" });
      expect({ path, status: r.status, to: r.headers.get("location") }).toEqual({ path, status: 302, to });
    }
    expect((await c.fetch(`${ORIGIN}/sign-in/x`, { redirect: "manual" })).status).toBe(404);
  });
});

/** The page's config, as its script reads it from the meta tag. */
const config = (html: string) => {
  const raw = /<meta name="purser-cloud" content="([^"]*)">/.exec(html)![1]!;
  return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) as Record<string, unknown>;
};

describe("the console of a cloud with an engine", () => {
  it("is told so by the page's config, and a cloud with no engine is told it has none", async () => {
    // The script asks /v1/engine only when its config says engine true (test/browser/console.check.ts holds that no
    // such request leaves a page whose config says false).
    expect(config(await (await c.fetch(`${ORIGIN}/`)).text())).toEqual({ origin: ORIGIN, rpId: RP, mailDomain: "", engine: false });
    const withEngine = testCloud({ engine: true });
    try {
      const page = await withEngine.fetch(`${ORIGIN}/`);
      expect(config(await page.text())).toEqual({ origin: ORIGIN, rpId: RP, mailDomain: "", engine: true });
      const csp = page.headers.get("content-security-policy")!;
      expect(csp).toBe(consoleCsp(/'nonce-([^']+)'/.exec(csp)![1]!));
    } finally { withEngine.close(); }
    // A caller that says nothing of an engine gets a page that has none.
    expect(config(consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" })).engine).toBeUndefined();
  });

  it("keeps the policy it had: the engine's pages need nothing more", () => {
    expect(consoleCsp("N")).toBe("default-src 'none'; script-src 'nonce-N' 'self'; style-src 'nonce-N'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
  });

  it("carries the engine's words in both languages, and the one script that writes an event's line", () => {
    const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "", engine: true });
    const js = script(html);
    const words = Object.keys(MESSAGES.en).filter((k) => k.startsWith("cs.eng."));
    for (const k of ["cs.eng.chip", "cs.eng.chip_title", "cs.eng.upload", "cs.eng.upload_sub", "cs.eng.uploading", "cs.eng.too_big", "cs.eng.wrong_type", "cs.eng.duplicate", "cs.eng.work", "cs.eng.work_empty", "cs.eng.work_earlier",
      "cs.eng.who.parser", "cs.eng.who.code", "cs.eng.who.person", "cs.eng.step", "cs.eng.ev.ap.received", "cs.eng.ev.ap.status", "cs.eng.ev.vault.filed"]) expect(words).toContain(k);
    for (const k of words) {
      expect(MESSAGES.nl[k as keyof typeof MESSAGES.nl], k).toBeTruthy();
      expect({ k, carried: html.split(`"${k}":`).length - 1 }).toEqual({ k, carried: 2 });
    }
    // The page's own words (not an event's line, which the shared script looks up by the event's name) are all asked for by name.
    const own = words.filter((k) => !/^cs\.eng\.(ev|who|method)\.|^cs\.eng\.step$/.test(k));
    expect(own.filter((k) => !js.includes(`t('${k}'`))).toEqual([]);
    expect(js).toContain(EVENT_LINE_JS.trim());
    expect(js).toContain("eventLineOf(L.m,ma)");
  });

  it("says test money and the stand-in bank in the header's words, and never that the engine pays through Airwallex", () => {
    for (const lang of ["en", "nl"] as const) {
      expect(MESSAGES[lang]["cs.eng.chip"]).toMatch(lang === "en" ? /^Engine: test money$/ : /^Engine: testgeld$/);
      expect(MESSAGES[lang]["cs.eng.chip_title"]).toMatch(lang === "en" ? /stand-in bank.*no real money.*nothing is sent to Airwallex/ : /nagebootste bank.*geen echt geld.*niets naar Airwallex/);
      // The footer on every page says the same once the engine is on (the plain one speaks of the Airwallex sandbox).
      expect(MESSAGES[lang]["cs.eng.foot"]).toMatch(lang === "en" ? /test money.*stand-in bank.*Nothing is sent to Airwallex/ : /testgeld.*nagebootste bank.*niets naar Airwallex/);
      expect(MESSAGES[lang]["cs.eng.foot"]).not.toMatch(/sandbox/);
    }
    expect(script(consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "", engine: true }))).toContain("t('cs.eng.foot')");
  });

  it("carries the payment card's words in both languages: pay, set up approval, approve, and the stand-in bank beside the facts", () => {
    const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "", engine: true });
    const js = script(html);
    const keys = ["cs.eng.pay_h", "cs.eng.pay", "cs.eng.working", "cs.eng.ready", "cs.eng.not_yet", "cs.eng.not_yet_why", "cs.eng.stand_in", "cs.eng.signs",
      "cs.eng.terms_fold", "cs.eng.terms_hash", "cs.eng.proposal_id", "cs.eng.setup", "cs.eng.set_up", "cs.eng.approve", "cs.eng.cancelled", "cs.eng.approval_stays", "cs.eng.approved_terms", "cs.eng.more_terms"] as const;
    for (const k of keys) {
      for (const lang of ["en", "nl"] as const) expect(MESSAGES[lang][k], `${lang} ${k}`).toBeTruthy();
      expect({ k, carried: html.split(`"${k}":`).length - 1 }).toEqual({ k, carried: 2 });
      expect(js, k).toContain(`t('${k}'`);
    }
    expect(MESSAGES.en["cs.eng.pay"]).toBe("Pay…");
    expect(MESSAGES.en["cs.eng.setup"]).toBe("Set up approval on this device");
    expect(MESSAGES.en["cs.eng.approve"]).toBe("Approve with passkey");
    // The honesty line beside the phone page's facts (which name the Airwallex fee): this payment never reaches Airwallex.
    expect(MESSAGES.en["cs.eng.stand_in"]).toMatch(/stand-in bank inside Purser.*test money.*Nothing is sent to Airwallex/);
    expect(MESSAGES.nl["cs.eng.stand_in"]).toMatch(/nagebootste bank binnen Purser.*testgeld.*niets naar Airwallex/);
    expect(MESSAGES.en["cs.eng.signs"]).toMatch(/exactly these terms/);
    // The why of an invoice that cannot be paid is the engine's own (src/ap/detail.ts actionsFor) where it is not in the checks.
    for (const k of ["action.needs_vendor", "action.currency_not_paid"]) expect(js).toContain(`t('${k}'`);
  });

  it("carries the proof's words in both languages (paid, booked, archived) and the archive page's, with the stand-in label on the paid block", () => {
    const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "", engine: true });
    const js = script(html);
    const keys = ["cs.eng.proof_h", "cs.eng.paid_h", "cs.eng.paid_line", "cs.eng.test_bank", "cs.eng.paid_fold", "cs.eng.fee", "cs.eng.method", "cs.eng.transfer_ref", "cs.eng.payment_id", "cs.eng.paid_wait",
      "cs.eng.booked_h", "cs.eng.booked_line", "cs.eng.booked_uneven", "cs.eng.booked_fold", "cs.eng.account", "cs.eng.chain_head", "cs.eng.booked_wait",
      "cs.eng.archived_h", "cs.eng.archived_line", "cs.eng.archived_fold", "cs.eng.archived_wait", "cs.eng.open_archive",
      "cs.eng.archive", "cs.eng.archive_lede", "cs.eng.archive_empty", "cs.eng.archive_pick", "cs.eng.kb"] as const;
    for (const k of keys) {
      for (const lang of ["en", "nl"] as const) expect(MESSAGES[lang][k], `${lang} ${k}`).toBeTruthy();
      expect({ k, carried: html.split(`"${k}":`).length - 1 }).toEqual({ k, carried: 2 });
      expect(js, k).toContain(`t('${k}'`);
    }
    // Wherever money moved: the stand-in bank and test money, on the block itself.
    expect(MESSAGES.en["cs.eng.test_bank"]).toMatch(/^Stand-in bank, test money$/);
    expect(MESSAGES.nl["cs.eng.test_bank"]).toMatch(/^Nagebootste bank, testgeld$/);
    // The archive's files open in the same sandboxed frame, with bytes the page fetched from the vault route.
    expect(js).toContain("'/v1/engine/vault/file?path='+encodeURIComponent(");
    expect(js).toContain("f.setAttribute('sandbox','allow-scripts')");
    expect(js).toContain("PDF_MAX_BYTES");
    // A page of its own, reached from links: the menu keeps its seven items (13 Nov: Agents and Tokenisation joined it;
    // 14 Nov: Invoices and Books are two tabs again).
    expect(js).toContain("'/archive':archiveView");
    expect(html.match(/data-tab="/g)).toHaveLength(7);
    expect(html).not.toMatch(/<nav[^>]*>[^]*#\/archive[^]*<\/nav>/);
    expect(js).toContain("a.href='#/archive'");
  });

  it("asks the engine to pay, set up and approve through the page's one request that marks it under way, with user verification required", () => {
    const js = script(consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "", engine: true }));
    for (const path of ["'/v1/engine/invoices/'", "'/v1/engine/passkey/start'", "'/v1/engine/passkey/finish'", "'/v1/engine/proposals/'"]) expect(js).toContain(`engineCall(${path}`);
    expect(js).toMatch(/navigator\.credentials\.create\(\{publicKey:\{rp:\{id:s\.rp\.id,name:s\.rp\.name\},user:\{id:new TextEncoder\(\)\.encode\(s\.user\.id\)/);
    expect(js).toContain("attestation:'none'");
    expect(js).toContain("excludeCredentials:(s.exclude||[]).map(");
    expect(js).toContain("allowCredentials:[{type:'public-key',id:fromB64u(eng.passkey.credential_id)}]");
    expect(js.match(/userVerification:'required'/g)!.length).toBeGreaterThanOrEqual(4);
    // What the passkey signed is sent as @simplewebauthn/server reads it.
    expect(js).toContain("clientExtensionResults:c.getClientExtensionResults()");
    expect(js).toContain("terms_sha256:p.terms_sha256");
  });
});

describe("the API behind the console", () => {
  it("refuses a state change sent from another site, and takes one from its own origin or from a program", async () => {
    const make = (origin?: string) => c.req("POST", "/v1/keys", { key: t.key, body: { name: "x", scopes: ["read"] }, headers: origin ? { origin } : {} });
    const evil = await make("https://evil.example");
    expect(evil.status).toBe(403);
    expect(evil.json).toMatchObject({ code: "forbidden" });
    expect((await make(ORIGIN)).status).toBe(201);
    expect((await make()).status).toBe(201);
    // A page elsewhere can still not read: reads need the bearer token the console keeps in its own tab.
    expect((await c.req("GET", "/v1/invoices", { headers: { origin: "https://evil.example" } })).status).toBe(401);
    const sync = await c.req("POST", "/v1/sync", { key: t.key, body: {}, headers: { origin: "null" } });
    expect(sync.status).toBe(403);
  });

  it("/v1/me tells the console who is calling, whether an owner has a passkey, and the inbox once mail is routed", async () => {
    // A new company: only the starter key, no passkey yet.
    const fresh = await c.tenant("fresh", { bare: true });
    expect((await c.req("GET", "/v1/me", { key: fresh.key })).json).toMatchObject({ user: { id: fresh.owner, display_name: "Owner", role: "owner" }, owner_has_passkey: false, inbox: null });
    const me = await c.req("GET", "/v1/me", { key: t.key });
    expect(me.json).toMatchObject({ user: { id: t.owner, display_name: "Owner", role: "owner" }, owner_has_passkey: true, inbox: null });
    c.env.mailDomain = "in.purser.test";
    expect((await c.req("GET", "/v1/me", { key: t.key })).json.inbox).toBe("acme@in.purser.test");
  });

  it("renames the company for an owner only, and only that company", async () => {
    const other = await c.tenant("other");
    expect((await c.req("POST", "/v1/company", { key: t.key, body: { name: "Acme B.V." } })).json).toEqual({ name: "Acme B.V.", language: "nl" });
    expect((await c.req("GET", "/v1/me", { key: t.key })).json.tenant).toMatchObject({ name: "Acme B.V.", slug: "acme" });
    expect((await c.req("GET", "/v1/me", { key: other.key })).json.tenant).toMatchObject({ name: "other test company" });
    const reader = (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "r", scopes: ["read"] } })).json.api_key as string;
    expect((await c.req("POST", "/v1/company", { key: reader, body: { name: "Hacked" } })).status).toBe(403);
    expect((await c.req("POST", "/v1/company", { key: t.key, body: { name: "" } })).status).toBe(400);
    expect((await c.req("POST", "/v1/company", { key: t.key, body: { name: "x".repeat(201) } })).status).toBe(400);
    expect((await c.req("POST", "/v1/company", { body: { name: "No key" } })).status).toBe(401);
  });
});

// The console polish (12 Nov): English unless a person chose Dutch, the site's own mark in the header, a calmer first run.
describe("the console's language, mark and first run", () => {
  const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" });
  const js = script(html);
  const markup = withoutBlocks(html, ["script", "style"]);

  it("paints in English first: the page's language and the menu's words", () => {
    expect(html).toContain('<html lang="en" data-theme="light">');
    // 12 Nov: the console's own pages moved to a bar under the site's header (cloud/src/siteHeader.ts): nav.apptabs.
    const nav = /<nav class="apptabs"[^]*?<\/nav>/.exec(markup)![0];
    // 14 Nov: "Invoices & books" became two tabs, Invoices and Books.
    for (const w of ["Overview", "Agents", "Invoices", "Books", "Transactions", "Tokenisation", "Settings"]) expect(nav).toContain(`>${w}<`);
    expect(nav).not.toMatch(/Overzicht|Facturen|Boekhouding|Instellingen/);
    expect(markup).toContain(MESSAGES.en["cs.foot"]);
  });

  it("is Dutch only on an explicit choice: the person's own, or one made in the page, never the company's default", () => {
    const rule = /const langOf=([^;]+);/.exec(js)?.[1];
    expect(rule).toBeTruthy();
    const langOf = new Script(`(${rule})`).runInNewContext() as (saved: unknown, person: unknown) => string;
    expect(langOf(null, null)).toBe("en");
    expect(langOf(null, undefined)).toBe("en");
    expect(langOf("nl", null)).toBe("nl");
    expect(langOf("en", null)).toBe("en");
    expect(langOf("de", null)).toBe("en");
    expect(langOf(null, "nl")).toBe("nl");
    expect(langOf("nl", "en")).toBe("en");
    // The first paint and the person's account both go through the rule; the company's language (Dutch by default in
    // the cloud's data) and the language an older page saved on its own (the key it wrote unasked) are not read.
    expect(js).toContain("const L=LS[langOf(PREF,null)];");
    expect(js).toContain("langOf(PREF,ME.user&&ME.user.language)");
    expect(js).toContain("localStorage.getItem('purser.cloud.language')");
    expect(js).not.toContain("'purser.cloud.lang'");
    expect(js).not.toMatch(/ME\.language/);
  });

  it("carries Purser's own mark in the header: the feather, the word Purser and a quieter Cloud, no letter P", () => {
    const brand = /<a class="brand"[^]*?<\/a>/.exec(markup)![0];
    expect(brand).not.toMatch(/<span class="mk">P<\/span>/);
    expect(brand).toMatch(/<span class="mk"><svg [^>]*aria-hidden="true">/);
    // 12 Nov (owner): the site's own brand (src/redesign/ui.ts header), not a lockup of the console's: its feather, its
    // word Purser. Since the review of 13 Nov the console marks no menu item ("More" was marked on every page): "Purser
    // Cloud" under the site's "More" leads here, unmarked.
    expect(brand).toContain(icon("feather", 17));
    expect(brand).toMatch(/<span class="nm">Purser<\/span><\/a>/);
    expect(markup).toContain('<a href="/">Purser Cloud</a>');
    expect(markup).not.toContain('<summary class="on">More</summary>');
    expect(svg("feather", 17)).toContain("<path");
    // Inline, through the page's own icons: the policy stays what it was.
    expect(consoleCsp("N")).toBe("default-src 'none'; script-src 'nonce-N' 'self'; style-src 'nonce-N'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
  });

  it("marks the first run's steps (numbered, the current one, done ones ticked), with motion off for those who ask", () => {
    expect(js).toContain("el('ol','stepper')");
    expect(js).toContain("setAttribute('aria-current','step')");
    expect(js).toContain("ic('circle-check')");
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.stage[^}]*animation: none/);
  });

  it("says the first run in fewer words, in both languages, and keeps its honesty points", () => {
    const keys = ["cs.setup", "cs.setup_lede", "cs.step1", "cs.step1_sub", "cs.step2", "cs.step2_sub", "cs.step3", "cs.step3_sub", "cs.company_address", "cs.starter_key", "cs.starter_note",
      "cs.continue", "cs.company_name", "cs.make_passkey", "cs.owner_has_passkey", "cs.mail_to", "cs.inbox_later", "cs.make_runner_key", "cs.connect_runner", "cs.starter_gone", "cs.open_console",
      "cs.run_this", "cs.shown_once", "cs.sign_in", "cs.sign_in_lede", "cs.sign_in_passkey", "cs.new_company", "cs.set_it_up"] as const;
    const words = (lang: "en" | "nl") => keys.reduce((n, k) => n + MESSAGES[lang][k].trim().split(/\s+/).length, 0);
    // Before the polish: 257 English and 261 Dutch words. The ceilings are the polished counts.
    expect(words("en")).toBeLessThanOrEqual(183);
    expect(words("nl")).toBeLessThanOrEqual(179);
    for (const k of keys) expect(js.includes(`t('${k}'`) || html.includes(`"${k}":`), k).toBe(true);
    // One line per step, a one-sentence starter-key note.
    for (const k of ["cs.step1_sub", "cs.step2_sub", "cs.step3_sub", "cs.starter_note"] as const) for (const lang of ["en", "nl"] as const) {
      expect(MESSAGES[lang][k].split(/\s+/).length, `${lang} ${k}`).toBeLessThanOrEqual(12);
      expect(MESSAGES[lang][k].match(/[.!?](\s|$)/g) ?? [], `${lang} ${k}`).toHaveLength(1);
    }
    // Test money only; the cloud pays nothing on its own; the CFO approves.
    expect(MESSAGES.en["cs.setup_lede"]).toMatch(/Test money only.*pays nothing.*CFO approves/);
    expect(MESSAGES.nl["cs.setup_lede"]).toMatch(/Alleen testgeld.*betaalt niets.*CFO keurt/);
    expect(MESSAGES.en["cs.connect_runner"]).toMatch(/only after the CFO's Face ID/);
    expect(MESSAGES.nl["cs.connect_runner"]).toMatch(/pas na de Face ID van de CFO/);
  });
});
