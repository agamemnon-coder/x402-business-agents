// Segregation of duties in the Cloud engine (26 Nov review): a policy change the CFO asks for in Purser Cloud (the
// emergency stop, the rule for high-risk payments) is signed with the signed-in person as its proposer, so that person's
// own passkey never approves it, even though nobody typed --by; and above the CFO's threshold for it
// (approval.policy_sod_eur), a loosening with no proposer named is refused. Test money: the in-memory stand-in bank.
import { describe, expect, it } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { openDb } from "../src/db/open.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { standInBank } from "../src/engine/standInBank.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "cloud.test", ORIGIN = `https://${RP}`;

function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

async function world() {
  const db = openDb(":memory:");
  useDocStore(db, memoryDocs());
  const store = { text: null as string | null, load() { return this.text; }, save(text: string) { this.text = text; } };
  const bank = standInBank(store);
  const phone = new FakeAuthenticator();
  const host = new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, rp: { rpId: RP, origin: ORIGIN }, company: { name: "SoD Co", lang: "en" }, vault: null, feed: null });
  const start = await host.passkeyStart();
  const done = await host.passkeyFinish({ code: start.code, credential: phone.register({ challenge: start.challenge, origin: ORIGIN, rpId: RP }), label: "Carla CFO" });
  if (!done.ok) throw new Error(done.reason);
  // The threshold on, and the stop pulled: lifting it loosens with no euro amount, so it is above the threshold.
  for (const [key, value] of [["approval.policy_sod_eur", "1000.00"], ["freeze", "on"]]) db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2026-11-20')").run(key, value);
  let counter = 0;
  const approve = (p: { id: string; terms_sha256: string; challenge: string }) => host.approve({ proposal_id: p.id, terms_sha256: p.terms_sha256, credential: phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: ++counter }) });
  return { db, host, approve };
}

describe("segregation of duties in the Cloud engine", () => {
  it("the signed-in person who asks to lift the stop is its proposer, and their passkey cannot approve it", async () => {
    const w = await world();
    const out = await w.host.emergencyStop(false, "Carla CFO");
    if (!out.ok) throw new Error(out.reason);
    const terms = JSON.parse((w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(out.proposal.id) as { terms_json: string }).terms_json) as Record<string, unknown>;
    expect(terms).toMatchObject({ proposed_by: "Carla CFO" });
    const answer = await w.approve(out.proposal);
    expect(answer.status).not.toBe("approved");
    expect(answer.message).toMatch(/Carla CFO proposed .* cannot approve it/);
    expect((w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(out.proposal.id) as { status: string }).status).toBe("PENDING_APPROVAL");
    expect(w.db.prepare("SELECT value FROM settings WHERE key = 'freeze'").get()).toEqual({ value: "on" });
  });

  it("with no proposer named, a loosening above the threshold is not even filed", async () => {
    const w = await world();
    const out = await w.host.emergencyStop(false);
    expect(out).toEqual({ ok: false, reason: expect.stringMatching(/segregation of duties applies .*the signed-in person/) });
    // Switching the high-risk rule off loosens too: refused without the person, filed with them.
    w.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.second_key_eur', '5000.00', '2026-11-20')").run();
    expect(await w.host.proposeSecondKey([{ key: "approval.second_key_eur", to: "" }])).toEqual({ ok: false, reason: expect.stringMatching(/segregation of duties applies/) });
    expect(await w.host.proposeSecondKey([{ key: "approval.second_key_eur", to: "" }], "Carla CFO")).toMatchObject({ ok: true });
  });
});
