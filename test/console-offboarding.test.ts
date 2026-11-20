// The console's offboarding screen (Settings, "Close and offboard the company"; cloud/src/offboardingView.ts). It shows
// only to the one caller POST /v1/offboarding accepts (an owner's own passkey session), says in plain words what goes
// and what is kept and links /privacy, and walks the owner through the API's own steps in order: the export made and
// downloaded, the company's address typed, a fresh passkey check, then the request; the API's answer is shown as it
// comes, a refusal word for word. The console's export download runs here against the real API (its manifest and every
// part, by their signed links), the page keeps no inline handler, and the console's policy is the one it had.
import { describe, expect, it } from "vitest";
import { consoleCsp, consolePage } from "../cloud/src/console.js";
import { OFFBOARDING_PRIVACY_URL, OFFBOARDING_VIEW_JS } from "../cloud/src/offboardingView.js";
import { SITE_ORIGIN } from "../cloud/src/siteHeader.js";
import { MESSAGES } from "../src/ui/i18n.js";
import { scriptBlocks, scriptBody, withoutBlocks } from "./support/scriptBlocks.js";
import { cloudAssertion, ORIGIN, RP, testCloud } from "./support/cloud.js";

/** A stand-in for the page's elements: a tree of plain objects with the few DOM members the view uses. */
class Node {
  kids: (Node | string)[] = [];
  attrs: Record<string, string> = {};
  id = ""; href = ""; target = ""; rel = ""; type = ""; value = ""; placeholder = ""; autocomplete = ""; htmlFor = "";
  disabled = false; spellcheck = true; maxLength = 0;
  onclick: (() => Promise<void> | void) | null = null;
  oninput: (() => void) | null = null;
  constructor(readonly tag: string, public cls: string) {}
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  replaceChildren(...k: (Node | string)[]) { this.kids = k; }
  append(...k: (Node | string)[]) { this.kids.push(...k); }
}
const el = (tag: string, cls: string, kids?: unknown): Node => {
  const n = new Node(tag, cls);
  n.kids = ([] as unknown[]).concat(kids ?? []).filter((k) => k !== null && k !== undefined && k !== false) as (Node | string)[];
  return n;
};
const btn = (label: string, cls: string) => { const b = el("button", "btn" + (cls ? " " + cls : ""), label); b.type = "button"; return b; };
const text = (n: Node | string): string => (typeof n === "string" ? n : n.kids.map(text).join(""));
const find = (n: Node | string, pick: (x: Node) => boolean, out: Node[] = []): Node[] => {
  if (typeof n === "string") return out;
  if (pick(n)) out.push(n);
  for (const k of n.kids) find(k, pick, out);
  return out;
};
const byId = (root: Node, id: string) => find(root, (n) => n.id === id)[0]!;

type Acts = { exportNow: () => Promise<unknown>; passkey: () => Promise<{ until: string }>; offboard: (confirm: string, exportId: string) => Promise<unknown>; quiet: (e: unknown) => boolean; signedOut: () => void };
const { offboardingShown, offboardingViewOf } = new Function(`${OFFBOARDING_VIEW_JS}\nreturn { offboardingShown, offboardingViewOf };`)() as {
  offboardingShown: (m: unknown) => boolean;
  offboardingViewOf: (m: unknown, t: unknown, e: typeof el, b: typeof btn, a: Acts, f: unknown) => Node[] | null;
};

const fmt = { stamp: (iso: string) => `at ${iso}`, day: (iso: string) => `on ${iso}` };
const tr = (lang: "en" | "nl") => {
  const m = MESSAGES[lang] as Record<string, string>;
  return (k: string, v: Record<string, unknown> = {}) => (m[k] ?? k).replace(/\{(\w+)\}/g, (_, x: string) => String(v[x] ?? `{${x}}`));
};
const OWNER = { kind: "session", role: "owner", signed_in_with: "passkey", demo: null, scopes: ["read", "sync", "admin"], tenant: { slug: "northwind", name: "Northwind BV" } };
const noActs: Acts = { exportNow: async () => ({}), passkey: async () => ({ until: "" }), offboard: async () => ({}), quiet: () => false, signedOut: () => {} };
const render = (m: unknown, lang: "en" | "nl" = "en", acts: Acts = noActs) => {
  const kids = offboardingViewOf(m, tr(lang), el, btn, acts, fmt);
  return kids ? el("div", "card panel offboarding", kids) : null;
};

describe("who sees the offboarding screen", () => {
  it("an owner signed in with their passkey, and nobody else", () => {
    expect(offboardingShown(OWNER)).toBe(true);
    expect(render(OWNER)).not.toBeNull();
    const others = [
      { ...OWNER, role: "cfo", scopes: ["read", "approve"] },
      { ...OWNER, role: "accountant", scopes: ["read", "sync"] },
      { ...OWNER, role: "viewer", scopes: ["read"] },
      // An admin key: the route refuses every key.
      { ...OWNER, kind: "key", role: null, signed_in_with: undefined },
      // An owner signed in with Google, Microsoft or Apple: read only, no passkey check.
      { ...OWNER, signed_in_with: "oidc", scopes: ["read"] },
      // The demo company's guest.
      { ...OWNER, demo: { as_of: "2026-10-31" } },
      { ...OWNER, scopes: ["read"] },
      null,
    ];
    for (const m of others) {
      expect(offboardingShown(m)).toBe(false);
      expect(render(m)).toBeNull();
    }
  });
});

describe("what it says", () => {
  it("in two or three plain sentences: closed, personal data minimised, books and both hash chains kept; /privacy linked", () => {
    const card = render(OWNER)!;
    const lede = text(find(card, (n) => n.tag === "p")[0]!);
    expect(lede.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(3);
    expect(lede).toContain("closes Northwind BV");
    expect(lede).toMatch(/Names become pseudonyms/);
    expect(lede).toMatch(/passkeys/);
    expect(lede).toMatch(/books, the documents and both hash chains \(the audit log and the ledger\) are kept unchanged/);
    const links = find(card, (n) => n.tag === "a");
    expect(links.map((a) => [a.href, a.target, a.rel])).toEqual([[`${SITE_ORIGIN}/privacy`, "_blank", "noopener noreferrer"]]);
    expect(OFFBOARDING_PRIVACY_URL).toBe(`${SITE_ORIGIN}/privacy`);
  });

  it("the steps in the API's order, the company's address to type, in English and in Dutch", () => {
    const heads = (lang: "en" | "nl") => find(render(OWNER, lang)!, (n) => n.tag === "h2").map(text);
    expect(heads("en")).toEqual(["Close and offboard the company", "1. Download the export", "2. Type the company's address", "3. Check with your passkey", "4. Offboard"]);
    expect(heads("nl")).toEqual(["Het bedrijf sluiten en vertrekken", "1. Download de export", "2. Typ het adres van het bedrijf", "3. Controleer met je passkey", "4. Vertrekken"]);
    const card = render(OWNER)!;
    expect(text(card)).toContain("To confirm, type northwind");
    expect(text(card)).toContain("always asks for your passkey again");
    expect(text(card)).toContain("This cannot be undone");
    expect(byId(card, "off-confirm").placeholder).toBe("northwind");
    // Every word it uses is in both catalogues, and Dutch is Dutch.
    const keys = [...OFFBOARDING_VIEW_JS.matchAll(/\bt\('(cs\.off\.[a-z0-9_]+)'/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of new Set([...keys, ...Object.keys(MESSAGES.en).filter((x) => x.startsWith("cs.off."))])) {
      const en = (MESSAGES.en as Record<string, string>)[k], nl = (MESSAGES.nl as Record<string, string>)[k];
      expect({ k, en: !!en, nl: !!nl, differ: en !== nl }).toEqual({ k, en: true, nl: true, differ: true });
      expect({ k, vars: [...nl!.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort() }).toEqual({ k, vars: [...en!.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort() });
    }
  });
});

describe("the walk through", () => {
  it("each step opens the next; the request names the typed address and the downloaded export; the answer is shown", async () => {
    const calls: unknown[][] = [];
    let out = false;
    const acts: Acts = {
      exportNow: async () => { calls.push(["export"]); return { id: "x_abc", parts: 3, bytes: 2_097_152, expires_at: "2026-11-21T12:00:00Z", reused: false }; },
      passkey: async () => { calls.push(["passkey"]); return { until: "2026-11-20T12:05:00Z" }; },
      offboard: async (confirm, exportId) => { calls.push(["offboard", confirm, exportId]); return { purge_after: "2033-12-31", people_pseudonymised: 2, passkeys_removed: 2, sign_in_links_removed: 0, sessions_removed: 1, keys_revoked: 1, hooks_removed: 1 }; },
      quiet: () => false, signedOut: () => { out = true; },
    };
    const card = render(OWNER, "en", acts)!;
    const [exp, typed, pk, go] = ["off-export", "off-confirm", "off-passkey", "off-go"].map((id) => byId(card, id));
    expect([exp!.disabled, typed!.disabled, pk!.disabled, go!.disabled]).toEqual([false, true, true, true]);
    await exp!.onclick!();
    expect(text(card)).toContain("Downloaded: export x_abc, 3 parts, 2.0 MB. Open until at 2026-11-21T12:00:00Z.");
    expect([typed!.disabled, pk!.disabled, go!.disabled]).toEqual([false, true, true]);
    typed!.value = "Northwind BV"; typed!.oninput!();
    expect(pk!.disabled).toBe(true);
    typed!.value = " northwind "; typed!.oninput!();
    expect([pk!.disabled, go!.disabled]).toEqual([false, true]);
    await pk!.onclick!();
    expect(text(card)).toContain("Passkey checked. Offboard before at 2026-11-20T12:05:00Z.");
    expect(go!.disabled).toBe(false);
    // Changing the address asks for the passkey again.
    typed!.value = "northwin"; typed!.oninput!();
    expect([pk!.disabled, go!.disabled]).toEqual([true, true]);
    typed!.value = "northwind"; typed!.oninput!(); await pk!.onclick!();
    await go!.onclick!();
    expect(calls).toEqual([["export"], ["passkey"], ["passkey"], ["offboard", "northwind", "x_abc"]]);
    expect(text(card)).toContain("Northwind BV is offboarded: its account is closed.");
    expect(text(card)).toContain("Kept unchanged until on 2033-12-31, then deleted: the books, the documents and both hash chains.");
    expect(text(card)).toContain("Removed now: 2 names made pseudonyms, 2 passkeys, 0 sign-in links, 1 sessions and 1 alert and chat targets; 1 keys revoked.");
    expect(out).toBe(true);
    expect([exp!.disabled, typed!.disabled, pk!.disabled, go!.disabled]).toEqual([true, true, true, true]);
  });

  it("the API's refusal is shown word for word, and nothing moves on", async () => {
    const refusal = "download the export first (its manifest and parts), then offboard";
    const acts: Acts = { ...noActs, exportNow: async () => ({ id: "x_abc", parts: 1, bytes: 10, expires_at: "2026-11-21T12:00:00Z" }), offboard: async () => { throw new Error(refusal); } };
    const card = render(OWNER, "en", acts)!;
    await byId(card, "off-export").onclick!();
    const typed = byId(card, "off-confirm"); typed.value = "northwind"; typed.oninput!();
    await byId(card, "off-passkey").onclick!();
    await byId(card, "off-go").onclick!();
    const bad = find(card, (n) => n.cls === "note-bad");
    expect(bad.map(text)).toEqual([refusal]);
    expect(byId(card, "off-go").disabled).toBe(false);
    // A failed export leaves step 2 closed and says why; a cancelled passkey prompt too.
    const card2 = render(OWNER, "en", { ...noActs, exportNow: async () => { throw new Error("an export of this company is already open"); }, passkey: async () => { throw new Error("cancelled"); } })!;
    await byId(card2, "off-export").onclick!();
    expect(find(card2, (n) => n.cls === "note-bad").map(text)).toEqual(["an export of this company is already open"]);
    expect(byId(card2, "off-confirm").disabled).toBe(true);
  });
});

describe("in the console", () => {
  const html = consolePage("n0nce", { origin: ORIGIN, rpId: RP, mailDomain: "in.cloud.test" });
  const blocks = scriptBlocks(html);
  const script = scriptBody(blocks[0]!);

  it("carries the view, puts the card on an owner's Settings only, and calls the API's own routes", () => {
    expect(html).toContain(OFFBOARDING_VIEW_JS.trim());
    const settings = script.slice(script.indexOf("async function settingsView(q){"), script.indexOf("// --- Connections (21 Nov)"));
    const ownerOnly = settings.indexOf("if(!owner){");
    expect(ownerOnly).toBeGreaterThan(0);
    expect(settings.indexOf("offboardingCard(m)")).toBeGreaterThan(settings.indexOf("return}", ownerOnly));
    expect(settings.match(/offboardingCard\(/g)).toHaveLength(1);
    expect(script).toContain("api('/v1/export/staged',{method:'POST'})");
    expect(script).toContain("api('/v1/offboarding',{method:'POST',body:{confirm,export_id:exportId}})");
    // The passkey step is the console's own step-up (cloud/src/stepUp.ts through /v1/auth/step-up).
    expect(script).toMatch(/passkey:async\(\)=>\{await stepUp\(\);/);
  });

  it("keeps no inline handler and no style attribute, and the console's policy is the one it had", () => {
    const markup = withoutBlocks(html, ["script", "style"]);
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    expect(markup).not.toMatch(/\sstyle\s*=/i);
    expect(blocks).toHaveLength(1);
    expect(OFFBOARDING_VIEW_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\beval\b|setAttribute\('on|\.style\b/);
    // test/site-header-shared.test.ts's CSP_BEFORE, as it stands.
    const CSP_BEFORE = "default-src 'none'; script-src 'nonce-NONCE' 'self'; style-src 'nonce-NONCE'; img-src 'self' data: blob: https://kit11.max-31b.workers.dev; font-src 'self'; connect-src 'self'; frame-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
    expect(consoleCsp("bm9uY2U=")).toBe(CSP_BEFORE.replaceAll("NONCE", "bm9uY2U="));
  });

  it("its export download, run against the API: the manifest and every part fetched and checked, and the API then offboards", async () => {
    const c = testCloud();
    try {
      const a = await c.tenant("northwind");
      // The console's own code, from the page: the export, its parts checked against their SHA-256, saved as one file.
      const code = script.slice(script.indexOf("const thisOrigin="), script.indexOf("const OFF_ACTS="));
      const saved: { name: string; body: string }[] = [];
      const reading: Promise<void>[] = [];
      const api = async (path: string, o: { method?: string; body?: unknown } = {}) => {
        const r = await c.req(o.method ?? "GET", path, { key: a.session, ...(o.body !== undefined ? { body: o.body } : {}) });
        if (r.status >= 400) throw Object.assign(new Error(r.json.error), { code: r.json.code });
        return r.json;
      };
      const fetched: string[] = [];
      const pageFetch = (u: string) => { fetched.push(u); expect(u.startsWith("/v1/export/download/")).toBe(true); return c.fetch(ORIGIN + u); };
      const run = new Function("api", "fetch", "location", "saveFile", "t", `${code}\nreturn exportForOffboarding;`)(
        api, pageFetch, { href: `${ORIGIN}/#/settings` },
        (blob: Blob, name: string) => { reading.push(blob.text().then((body) => { saved.push({ name, body }); })); },
        (k: string) => k,
      ) as () => Promise<{ id: string; parts: number; bytes: number; expires_at: string; reused: boolean }>;
      const x = await run();
      await Promise.all(reading);
      expect(x.reused).toBe(false);
      expect(x.parts).toBeGreaterThan(5);
      expect(fetched.length).toBe(x.parts + 1);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.name).toBe(`purser-export-${x.id}.json`);
      const file = JSON.parse(saved[0]!.body) as { export_id: string; manifest: { parts: { table: string; n: number }[] }; parts: Record<string, unknown[]> };
      expect(file.export_id).toBe(x.id);
      expect(Object.keys(file.parts)).toEqual(file.manifest.parts.map((p) => `${p.table}-${p.n}`));
      expect(saved[0]!.body).not.toContain("sig=");
      // A second press: the open export is downloaded again (one export a day), not refused.
      const again = await run();
      expect([again.id, again.reused]).toEqual([x.id, true]);
      // The API takes what the screen sends: the typed address, the downloaded export, after a fresh passkey check.
      c.clock.now = new Date(c.clock.now.getTime() + 6 * 60_000);
      expect((await c.req("POST", "/v1/offboarding", { key: a.session, body: { confirm: "northwind", export_id: x.id } })).json.code).toBe("step_up_required");
      const ch = await c.req("POST", "/v1/auth/step-up/start", { key: a.session });
      const up = await c.req("POST", "/v1/auth/step-up", { key: a.session, body: { challenge_id: ch.json.challenge_id, credential_id: a.ownerPasskey.credential_id, assertion: cloudAssertion(a.ownerPasskey, ch.json.challenge as string) } });
      expect(up.status).toBe(200);
      const done = await c.req("POST", "/v1/offboarding", { key: a.session, body: { confirm: "northwind", export_id: x.id }, headers: { "x-purser-step-up": up.json.step_up as string } });
      expect(done.status).toBe(200);
      expect(done.json).toMatchObject({ export_id: x.id, people_pseudonymised: 1 });
    } finally { c.close(); }
  });

  it("/v1/me tells the screen who is asking: shown for the owner's session, not for the owner's key or a CFO", async () => {
    const c = testCloud();
    try {
      const a = await c.tenant("northwind");
      const me = async (key: string) => (await c.req("GET", "/v1/me", { key })).json;
      expect(offboardingShown(await me(a.session))).toBe(true);
      expect(offboardingShown(await me(a.key))).toBe(false);
      const { addPerson } = await import("./support/cloud.js");
      const cfo = await addPerson(c, "northwind", a.session, "cfo");
      expect(offboardingShown(await me(cfo.session))).toBe(false);
    } finally { c.close(); }
  });
});
