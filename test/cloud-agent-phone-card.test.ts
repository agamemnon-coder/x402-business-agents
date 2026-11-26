// An agent's card on a phone and the company's card design (cloud/src/agentPhoneCard.ts, cloud/src/agentCardArt.ts,
// 23 Nov): the design is cosmetic and checked (a logo is a small PNG, JPEG or WebP, never SVG), saved for the company by
// an owner or admin and never for the demo's shared guest; the phone's link is signed and expires; its page shows the
// last four only, escapes every value, has no script and no way to act; Apple Wallet is said to wait for its certificate
// until the owner sets it. Offline: the cloud over SQLite.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanDesign, CARD_PRESETS, DEFAULT_STYLE, initialsOf, isLight, LOGO_MAX, modelShort, validLogo } from "../cloud/src/agentCardArt.js";
import { cardFaceHtml, cardMetaHtml, designFromQuery, PHONE_LINK_DAYS } from "../cloud/src/agentPhoneCard.js";
import { passConfigFrom } from "../cloud/src/walletPass.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { throwawayPassEnv } from "./support/passCert.js";

// The smallest real PNG (1x1, transparent), and an SVG that would run a script if it were ever drawn as a page.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const SVG = `data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")}`;

describe("the card design", () => {
  it("keeps only what is valid: a hex colour, 1 to 3 initials, a small PNG/JPEG/WebP logo, known presets", () => {
    expect(cleanDesign({ color: "#AbCdEf", initials: "NW", logo: PNG, styles: { sourcing: "lagoon", support: "nope", "x y": "rose" } }))
      .toEqual({ v: 1, color: "#abcdef", initials: "NW", logo: PNG, styles: { sourcing: "lagoon" } });
    expect(cleanDesign({ color: "red", initials: "<b>", logo: SVG, styles: "x" })).toEqual({ v: 1, color: null, initials: null, logo: null, styles: {} });
    expect(validLogo("data:image/png;base64,PHN2Zz4=")).toBeNull(); // says PNG, is not one
    expect(validLogo(`data:image/png;base64,${"A".repeat(Math.ceil(LOGO_MAX * 4 / 3) + 100)}`)).toBeNull();
    expect(cleanDesign(null)).toEqual({ v: 1, color: null, initials: null, logo: null, styles: {} });
  });
  it("gives every agent its own preset, and reads a colour's lightness for the words on it", () => {
    expect(new Set(Object.values(DEFAULT_STYLE)).size).toBe(Object.keys(DEFAULT_STYLE).length);
    for (const s of Object.values(DEFAULT_STYLE)) expect(CARD_PRESETS).toContain(s);
    expect(isLight("#fde047")).toBe(true);
    expect(isLight("#1e3a8a")).toBe(false);
    expect(initialsOf("Northwind Outdoor (demo company)")).toBe("N");
    expect(modelShort("claude-haiku-5-5")).toBe("Haiku 5.5");
  });
  it("takes the console's choice from the link (cosmetic only), anything else dropped", () => {
    const d = designFromQuery(new URLSearchParams("s=ember&c=FF0000&i=AB"), "support", cleanDesign({ logo: PNG }));
    expect(d).toMatchObject({ color: "#ff0000", initials: "AB", logo: PNG, styles: { support: "ember" } });
    expect(designFromQuery(new URLSearchParams("s=<x>&c=red&i=abc"), "support", cleanDesign(null))).toEqual(cleanDesign(null));
  });
  it("draws the card's face with every value escaped and the last four only", () => {
    const html = cardFaceHtml({ company: "<Acme & Co>", demo: false, agent: "support", name: "Support <img src=x onerror=alert(1)>", role: "x", status: "active", model: "claude-sonnet-5-5",
      card: { last4: "2361", currency: "EUR", per_purchase: "60.00", per_month: "150.00", spent_month: "38.00", month: "2026-11" } }, cleanDesign(null));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Support &lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;Acme &amp; Co&gt;");
    expect(html).toContain("•••• 2361");
    expect(html).not.toContain("•••• •••• •••• 2361");
    expect(html).toContain('class="acard p-lagoon');
    // 26 Nov (the owner: "far too busy"): the model is in the details (the page's rows), not on the card.
    expect(html).not.toContain("Sonnet 5.5");
  });
  // 21 Nov (Max: "blue with gold and the Purser logo, sleek"): one family of navy metal cards; Purser's feather is the mark
  // until the company sets its own; an agent without a card is the same family, matte ("bare"), and says so; no chip, no
  // number, no network on it; a simulated card stays labelled: since 26 Nov (the owner: "remove SIMULATED") under the card,
  // as plain words, never as a badge on it.
  it("draws Purser's feather until the company sets a mark, and a cardless agent as a matte card that says so", () => {
    const base = { company: "Northwind Outdoor (demo company)", demo: true, agent: "checker", name: "Checker agent", role: "x", status: "off", model: "claude-haiku-5-5" };
    const bare = cardFaceHtml({ ...base, card: null }, cleanDesign(null));
    expect(bare).toContain('class="ac-pf"');
    expect(bare).toMatch(/class="acard p-graphite bare/);
    expect(bare).toContain("No card of its own");
    expect(bare).not.toMatch(/ac-chip|ac-net|ac-tag|••••/);
    const own = cardFaceHtml({ ...base, card: null }, cleanDesign({ initials: "NW" }));
    expect(own).toContain('<span class="ac-mark">NW</span>');
    expect(own).not.toContain("ac-pf");
    const paid = cardFaceHtml({ ...base, agent: "support", status: "active", card: { last4: "2361", currency: "EUR", per_purchase: null, per_month: "150.00", spent_month: "38.00", month: "2026-11" } }, cleanDesign(null));
    expect(paid).not.toContain(" bare");
    expect(paid).not.toMatch(/ac-tag|ac-chip|ac-meter|ac-model|Simulated/);
    expect(paid).toContain('<span class="ac-net txt">VISA</span>');
    const used = { last4: "2361", currency: "EUR", per_purchase: null, per_month: "150.00", spent_month: "38.00", month: "2026-11" };
    expect(cardMetaHtml({ ...base, agent: "support", status: "active", card: used })).toContain('<span class="hon">Simulated card · test money</span>');
    expect(cardMetaHtml({ ...base, demo: false, agent: "support", status: "active", card: used })).toContain('<span class="hon">Sandbox card · test money</span>');
    expect(cardMetaHtml({ ...base, card: null })).not.toContain('class="hon"');
  });
});

let c: TestCloud, t: TestTenant, seq = 0;
beforeEach(async () => { c = testCloud(); t = await c.tenant("phonecard"); seq = 0; });
afterEach(() => { c.close(); });
const get = (path: string) => c.fetch(new URL(path, ORIGIN).href);
const audit = (ts: string, event: string, payload: unknown, subject: string | null = null) =>
  c.env.sql.run("INSERT INTO audit_rows (tenant_id, seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [t.id, ++seq, ts, "system", event, subject, JSON.stringify(payload), `h${seq - 1}`, `h${seq}`] as never);
const card = () => audit("2026-11-21T09:00:00Z", "card.issued", { agent: "support", last4: "2361", currency: "EUR", limits: "60.00 / 150.00", nickname: "support agent: helpdesk software" }, "support");

describe("the routes", () => {
  it("save the company's design for an owner, read it back for a reader; a demo guest cannot save", async () => {
    expect((await c.req("GET", "/v1/card-design", { key: t.session })).json).toMatchObject({ can_save: true, updated_at: null, design: { color: null } });
    const s = await c.req("POST", "/v1/card-design", { key: t.session, body: { color: "#112233", initials: "PC", logo: SVG, styles: { support: "rose" } } });
    expect(s.status).toBe(200);
    expect(s.json.design).toEqual({ v: 1, color: "#112233", initials: "PC", logo: null, styles: { support: "rose" } });
    expect((await c.req("GET", "/v1/card-design", { key: t.session })).json).toMatchObject({ design: { color: "#112233", styles: { support: "rose" } } });
    const g = await c.req("POST", "/v1/auth/guest", {});
    const guest = g.json.session as string;
    expect((await c.req("GET", "/v1/card-design", { key: guest })).json).toMatchObject({ can_save: false });
    expect((await c.req("POST", "/v1/card-design", { key: guest, body: { color: "#000000" } })).status).toBe(403);
  });

  it("make a signed link for an agent in the records, its QR, and a page that shows the card read only", async () => {
    await card();
    expect((await c.req("POST", "/v1/agents/treasury/phone-card/link", { key: t.key })).status).toBe(404);
    const l = await c.req("POST", "/v1/agents/support/phone-card/link", { key: t.key, body: { design: { styles: { support: "ember" }, color: "#ff0000", initials: "PC" } } });
    expect(l.status).toBe(201);
    expect(String(l.json.qr_svg)).toMatch(/^<svg [^>]*><rect [^>]*\/><path fill="#000" d="[M0-9hvz. -]+"\/><\/svg>$/);
    expect(l.json.expires_at).toBe(new Date(c.clock.now.getTime() + PHONE_LINK_DAYS * 86_400_000).toISOString());
    const url = new URL(l.json.url as string);
    expect(url.pathname).toMatch(/^\/card\/pcd\.t_[A-Za-z0-9_-]+\.support\.[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
    expect(url.search).toBe("?s=ember&c=ff0000&i=PC");
    const page = await get(`${url.pathname}${url.search}`);
    expect(page.status).toBe(200);
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^default-src 'none'; style-src 'nonce-[A-Za-z0-9+/=]+'; img-src data:;/);
    const html = await page.text();
    expect(html).not.toMatch(/<script|<form|<input|<button/i);
    expect(html).toContain("•••• 2361");
    expect(html).toContain("Sandbox card · test money");
    expect(html).toContain('class="acard p-ember');
    expect(html).toContain(".acard{--brand:#ff0000}");
    expect(html).toContain("Apple Wallet: waiting for the pass certificate");
    expect(html).toContain("Read only: this page cannot pay, freeze or change anything.");
    // A changed MAC, another agent under the same MAC, or past its days: nothing.
    expect((await get(url.pathname.slice(0, -2) + (url.pathname.endsWith("AA") ? "BB" : "AA"))).status).toBe(404);
    expect((await get(url.pathname.replace(".support.", ".treasury."))).status).toBe(404);
    c.clock.now = new Date(c.clock.now.getTime() + PHONE_LINK_DAYS * 86_400_000 + 1000);
    expect((await get(url.pathname)).status).toBe(404);
  });

  it("offer Apple Wallet on the phone's page once the owner set the pass certificate", async () => {
    c.env.walletPass = passConfigFrom(throwawayPassEnv().env)!;
    await card();
    const l = await c.req("POST", "/v1/agents/support/phone-card/link", { key: t.key });
    const html = await (await get(new URL(l.json.url as string).pathname)).text();
    expect(html).toMatch(/<a class="wal" href="[^"]+\/v1\/wallet-pass\/pwp\.[^"]+">Add to Apple Wallet<\/a>/);
  });

  it("show the recorded negotiation's turns, the bank change refused by the rails, the deal agreed", async () => {
    const n = await c.req("GET", "/v1/negotiation/recorded", { key: t.key });
    expect(n.status).toBe(200);
    expect(n.json).toMatchObject({ outcome: "agreed", currency: "EUR", amount: "1850.00" });
    const turns = n.json.turns as { who: string; ok: boolean; accept: boolean; refused: string | null; amount: string }[];
    expect(turns.map((x) => [x.who, x.ok, x.accept])).toEqual([["sourcing", true, false], ["supplier", false, false], ["sourcing", true, false], ["supplier", true, true]]);
    expect(turns[1]!.refused).toMatch(/bank details/);
    expect(String(n.json.label)).toMatch(/written in advance, not a live model call/);
    expect((await c.req("GET", "/v1/negotiation/recorded", { key: null })).status).toBe(401);
  });
});
