// Red team, round 2 on v1.5.3 (finding B): under segregation of duties the proposer of a loosening never approves it.
// The proposer's name was trimmed (src/executors/policyChange.ts) but the approver's was not (src/policy/approvals.ts
// split(" (")[0]), so a display name with a leading or trailing space proposed as "Carla CFO" and signed as "Carla CFO ",
// and the proposer's own key co-signed their own loosening. Both sides now read a name with one normaliser
// (src/lib/personName.ts). In the Cloud the signed-in person's user id is kept as well, and compared where the key's
// person is known. Test money only, no network.
import { describe, expect, it } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { openDb } from "../src/db/open.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { standInBank } from "../src/engine/standInBank.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { personName, samePerson } from "../src/lib/personName.js";
import { approvalHashOf } from "../src/metal/ownersExecute.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const now = new Date("2026-11-27T10:00:00Z");

function attempt(displayName: string) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.policy_sod_eur', '1000.00', ?), ('freeze', 'on', ?)").run(now.toISOString(), now.toISOString());
  const p = proposePolicyChange(db, { changes: [{ key: "freeze", to: "off" }], reason: "lift", signedInAs: displayName }, "human", now);
  const sign = (label: string, cred: string) => decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: `${label} (passkey ${cred})`, method: "passkey", signedSha256: approvalHashOf(p), passkey: { credentialId: cred, assertionSha256: "a".repeat(64) } }, now);
  return { db, p, sign };
}

describe("segregation of duties reads both names alike (red team round 2, finding B)", () => {
  it("personName trims, normalises, collapses spaces and drops the bracketed part; samePerson folds case", () => {
    expect(personName(" Carla  CFO (Finance) ")).toBe("Carla CFO");
    expect(personName("Carla CFO\t")).toBe("Carla CFO");
    expect(personName("Ｃａｒｌａ CFO")).toBe("Carla CFO");
    expect(samePerson("Carla CFO ", "carla cfo")).toBe(true);
    expect(samePerson("Strauß", "STRAUSS")).toBe(true);
    expect(samePerson("Carla CFO", "Dirk Owner")).toBe(false);
  });

  for (const name of ["Carla CFO ", " Carla CFO", "Carla  CFO", "carla cfo", "Carla CFO", "Carla CFO (Finance)"]) {
    it(`the proposer ${JSON.stringify(name)} cannot co-sign their own loosening, in any of their name's forms`, () => {
      const w = attempt(name);
      for (const form of [name, "Carla CFO", "CARLA CFO", " Carla CFO "]) {
        expect(() => w.sign(form, "credPROP"), JSON.stringify(form)).toThrow(/cannot approve it \(segregation of duties\)/);
      }
      expect(w.sign("Dirk Owner", "credOTHR")).toBe("PENDING_APPROVAL");
      expect((w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(w.p.proposal_id) as { status: string }).status).toBe("PENDING_APPROVAL");
    });
  }

  it("two people still approve it together", () => {
    const w = attempt("Carla CFO ");
    expect(w.sign("Dirk Owner", "credOTHR")).toBe("PENDING_APPROVAL");
    expect(() => w.sign("dirk  owner", "credOTH2")).toThrow(/already approved/);
    expect(w.sign("Erik Ops", "credERIK")).toBe("APPROVED");
  });
});

function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

describe("in the Cloud engine, the signed-in person's id is compared too", () => {
  const RP = "cloud.test", ORIGIN = `https://${RP}`;
  async function cloudWorld(label: string, person: string) {
    const db = openDb(":memory:");
    useDocStore(db, memoryDocs());
    const store = { text: null as string | null, load() { return this.text; }, save(text: string) { this.text = text; } };
    const bank = standInBank(store);
    const phone = new FakeAuthenticator();
    const host = new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, rp: { rpId: RP, origin: ORIGIN }, company: { name: "SoD Co", lang: "en" }, vault: null, feed: null });
    const start = await host.passkeyStart();
    const done = await host.passkeyFinish({ code: start.code, credential: phone.register({ challenge: start.challenge, origin: ORIGIN, rpId: RP }), label, person });
    if (!done.ok) throw new Error(done.reason);
    for (const [key, value] of [["approval.policy_sod_eur", "1000.00"], ["freeze", "on"]]) db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2026-11-20')").run(key, value);
    let counter = 0;
    const approve = (p: { id: string; terms_sha256: string; challenge: string }) => host.approve({ proposal_id: p.id, terms_sha256: p.terms_sha256, credential: phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: ++counter }) });
    return { db, host, approve };
  }

  it("a display name with a trailing space proposes, and the key labelled without it cannot approve", async () => {
    const w = await cloudWorld("Carla CFO", "user-carla");
    const out = await w.host.emergencyStop(false, "Carla CFO ");
    if (!out.ok) throw new Error(out.reason);
    const answer = await w.approve(out.proposal);
    expect(answer.status).not.toBe("approved");
    expect(answer.message).toMatch(/cannot approve it/);
  });

  it("a person who renamed themselves after their key was labelled is still its proposer, by their user id", async () => {
    const w = await cloudWorld("Carla CFO", "user-carla");
    const out = await w.host.emergencyStop(false, "Carla Renamed", "user-carla");
    if (!out.ok) throw new Error(out.reason);
    const terms = JSON.parse((w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(out.proposal.id) as { terms_json: string }).terms_json) as Record<string, unknown>;
    expect(terms).toMatchObject({ proposed_by: "Carla Renamed", proposed_by_id: "user-carla" });
    const answer = await w.approve(out.proposal);
    expect(answer.status).toBe("refused");
    expect(answer.message).toMatch(/proposed .* cannot approve it \(segregation of duties\)/);
    expect((w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(out.proposal.id) as { status: string }).status).toBe("PENDING_APPROVAL");
    expect(w.db.prepare("SELECT value FROM settings WHERE key = 'freeze'").get()).toEqual({ value: "on" });
  });

  it("another person's key is not refused by the id", async () => {
    const w = await cloudWorld("Dirk Owner", "user-dirk");
    const out = await w.host.emergencyStop(false, "Carla CFO", "user-carla");
    if (!out.ok) throw new Error(out.reason);
    const answer = await w.approve(out.proposal);
    expect(answer.status).toBe("cosigned");
  });
});
