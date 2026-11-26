// The authority map in Purser Cloud (26 Nov). The runner builds it (src/policy/authorityMap.ts): per agent, what it may
// pay, on which rail, per payment, in all, from, to, when, under which grant and what needs the CFO. Cloud holds only
// what the runner pushes, so the runner pushes a snapshot with its sync (src/cloudsync/client.ts), the cloud checks it
// against a strict schema and a size cap and keeps the newest per company (cloud/src/authorityMap.ts), GET
// /v1/authority-map reads it, and the console's Agents page shows it under each card as text (cloud/src/authorityView.ts).
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTHORITY_MAX_BYTES, AuthorityMapSnapshot } from "../cloud/src/authorityMap.js";
import { AUTHORITY_JS } from "../cloud/src/authorityView.js";
import { WALLET_JS } from "../cloud/src/agentWallet.js";
import { batchesFor, pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { authorityMap } from "../src/policy/authorityMap.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const NOW = new Date("2026-11-08T12:00:00Z");
let c: TestCloud;
let db: DB;
let a: { id: string; key: string };
let b: { id: string; key: string };
const target = (key: string) => ({ url: "https://cloud.test", key, fetch: c.fetch });
const read = async (key: string) => (await c.req("GET", "/v1/authority-map", { key })).json as { authority_map: unknown; received_at: string | null };
/** A push of the authority map alone, as the runner sends it inside a batch. */
const pushMap = (key: string, map: unknown) => c.req("POST", "/v1/sync", { key, body: { authority_map: map } });
/** What the push did with the map. */
const applied = (r: { json: Record<string, unknown> }) => (r.json.applied as Record<string, unknown>).authority_map;

beforeEach(async () => {
  c = testCloud();
  db = openDb(":memory:");
  a = await c.tenant("northwind");
  b = await c.tenant("other-co");
});
afterEach(() => c.close());

describe("the authority map's sync", () => {
  it("goes from the runner's push to the cloud and back by the read API, unchanged", async () => {
    expect((await read(a.key)).authority_map).toBeNull();
    // An outside agent with a card is on the map too.
    db.prepare("INSERT INTO external_agents (agent_id, display_name, purpose, per_tx_cents, monthly_cents, status, proposal_id, created_at) VALUES ('ext:acme', 'Acme <b>agent</b>', 'reports', 2500, 10000, 'ACTIVE', NULL, ?)").run(NOW.toISOString());
    await pushToCloud(db, target(a.key), NOW, authorityMap);
    const got = await read(a.key);
    expect(got.authority_map).toEqual(JSON.parse(JSON.stringify(authorityMap(db, NOW))));
    expect(got.received_at).toBe(c.clock.now.toISOString());
    const names = (got.authority_map as { agents: { name: string; rows: unknown[] }[] }).agents.map((x) => x.name);
    expect(names).toContain("Acme <b>agent</b> (outside agent)");
    // The same map again changes nothing; a newer one with a change replaces it.
    const again = await pushMap(a.key, authorityMap(db, NOW));
    expect(applied(again)).toEqual({ added: 0, changed: 0, unchanged: 1 });
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('card.sourcing.per_tx', '12.00', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(NOW.toISOString());
    const later = new Date(NOW.getTime() + 60_000);
    expect(applied(await pushMap(a.key, authorityMap(db, later)))).toEqual({ added: 0, changed: 1, unchanged: 0 });
    // An older snapshot arriving late never replaces a newer one.
    const stale = { ...authorityMap(db, new Date(NOW.getTime() - 60_000)), policy_sha256: "0".repeat(64) };
    expect(applied(await pushMap(a.key, stale))).toEqual({ added: 0, changed: 0, unchanged: 1 });
    const now = (await read(a.key)).authority_map as { generated_at: string; agents: { agent: string; rows: { what: string; per_payment: string }[] }[] };
    expect(now.generated_at).toBe(later.toISOString());
    expect(now.agents.find((x) => x.agent === "sourcing")!.rows.find((r) => /company card/.test(r.what))!.per_payment).toBe("EUR 12.00");
  });

  it("rides with the first batch of a push when the caller builds it, and not otherwise", () => {
    const empty = { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] };
    expect(batchesFor(db, empty, { now: NOW }).filter((x) => "authority_map" in x)).toHaveLength(0);
    const batches = batchesFor(db, empty, { now: NOW, authority: authorityMap });
    expect(batches.filter((x) => "authority_map" in x)).toHaveLength(1);
    expect(AuthorityMapSnapshot.safeParse(batches.find((x) => "authority_map" in x)!.authority_map).success).toBe(true);
  });
});

describe("the authority map's schema", () => {
  const good = () => JSON.parse(JSON.stringify(authorityMap(openDb(":memory:"), NOW))) as { agents: Record<string, unknown>[] } & Record<string, unknown>;
  it("refuses an unknown field, a wrong status, a bad hash or an over-long text, and stores nothing", async () => {
    const extra = { ...good(), note: "x" };
    const status = good(); status.agents[0]!.status = "boss";
    const hash = { ...good(), policy_sha256: "nope" };
    const long = good(); (long.agents[0]!.rows as Record<string, string>[])[0]!.what = "x".repeat(5000);
    const rowExtra = good(); (rowExtra.agents[0]!.rows as Record<string, string>[])[0]!.html = "<img src=x onerror=alert(1)>";
    for (const bad of [extra, status, hash, long, rowExtra]) {
      const r = await pushMap(a.key, bad);
      expect(r.status, JSON.stringify(r.json)).toBe(400);
    }
    expect((await read(a.key)).authority_map).toBeNull();
  });

  it("caps the snapshot's size", () => {
    const big = good();
    const row = (big.agents[2]!.rows as Record<string, string>[])[0]!;
    big.agents = Array.from({ length: 50 }, (_, i) => ({ ...big.agents[2]!, agent: `ext:a${i}`, rows: Array.from({ length: 30 }, () => ({ ...row, needs_cfo: "y".repeat(900) })) }));
    expect(JSON.stringify(big).length).toBeGreaterThan(AUTHORITY_MAX_BYTES);
    expect(AuthorityMapSnapshot.safeParse(big).success).toBe(false);
  });
});

describe("the authority map per company", () => {
  it("is read only by the company that pushed it", async () => {
    await pushMap(a.key, authorityMap(db, NOW));
    expect((await read(a.key)).authority_map).not.toBeNull();
    expect((await read(b.key)).authority_map).toBeNull();
    // A second company's push is its own, and leaves the first's as it was.
    const other = authorityMap(db, NOW);
    other.agents = other.agents.slice(0, 1);
    await pushMap(b.key, other);
    expect(((await read(b.key)).authority_map as { agents: unknown[] }).agents).toHaveLength(1);
    expect(((await read(a.key)).authority_map as { agents: unknown[] }).agents).toHaveLength(3);
    expect((await c.req("GET", "/v1/authority-map", { key: null })).status).toBe(401);
  });
});

describe("the Authority section on the Agents page", () => {
  /** The section's script run against a small stand-in for the page's DOM, with the console's el and dl helpers. */
  function render(map: unknown, agent: string) {
    type N = { tag: string; className: string; text?: string; kids: N[]; attrs: Record<string, string>; append: (...k: (N | string)[]) => void; setAttribute: (k: string, v: string) => void; replaceChildren: (...k: N[]) => void; hidden?: boolean };
    const node = (tag: string): N => {
      const n: N = { tag, className: "", kids: [], attrs: {}, append: (...k) => { for (const x of k) n.kids.push(typeof x === "string" ? { tag: "#text", className: "", text: x, kids: [], attrs: {}, append() {}, setAttribute() {}, replaceChildren() {} } : x); }, setAttribute: (k, v) => { n.attrs[k] = v; }, replaceChildren: (...k) => { n.kids = k; } };
      return n;
    };
    const document = { createElement: node, createTextNode: (t: string) => ({ tag: "#text", className: "", text: t, kids: [], attrs: {} }) };
    const ctx: Record<string, unknown> = { document, NL: false, Node: Object, AUTH_FETCH: () => Promise.resolve({ authority_map: map }) };
    runInNewContext(`const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
      const dl=(pairs)=>{const d=el('dl','read');for(const [k,v] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));d.append(el('dd','',String(v)))}return d};
      const api=(p)=>AUTH_FETCH(p);` + AUTHORITY_JS + `;this.box=authorityOf(${JSON.stringify(agent)});`, ctx);
    return ctx.box as N;
  }
  const texts = (n: { tag: string; text?: string; kids: unknown[] }): string[] => n.tag === "#text" ? [n.text!] : (n.kids as typeof n[]).flatMap(texts);
  const tags = (n: { tag: string; kids: unknown[] }): string[] => [n.tag, ...(n.kids as typeof n[]).flatMap(tags)];

  it("draws each row as text, so markup in a pushed value stays words", async () => {
    const m = authorityMap(db, NOW);
    m.agents[0]!.rows[0]!.what = "<img src=x onerror=alert(1)>";
    const box = render(m, "sourcing");
    await new Promise((r) => setTimeout(r, 0));
    expect(box.tag).toBe("details");
    const words = texts(box);
    expect(words).toContain("Authority");
    expect(words).toContain("<img src=x onerror=alert(1)>");
    expect(tags(box)).not.toContain("img");
    expect(words).toContain(m.agents[0]!.rows[0]!.needs_cfo);
  });

  it("shows nothing for an agent the map does not name, or when there is no map", async () => {
    const none = render(null, "sourcing");
    await new Promise((r) => setTimeout(r, 0));
    expect(none.hidden).toBe(true);
    const other = render(authorityMap(db, NOW), "dispute_desk");
    await new Promise((r) => setTimeout(r, 0));
    expect(other.hidden).toBe(true);
  });

  it("is in the Agents page's script, which never writes markup", () => {
    expect(WALLET_JS).toContain(AUTHORITY_JS.trim());
    expect(WALLET_JS).toContain("authorityOf(x.r.id)");
    expect(AUTHORITY_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect([...AUTHORITY_JS.matchAll(/api\('([^']+)'/g)].map((m) => m[1])).toEqual(["/v1/authority-map"]);
  });
});
