// The fresh security review of build/next (30 October): each test breaks if its finding comes back.
import { describe, expect, it } from "vitest";
import { askPurser, recoverTaskCards, relayAsk, type TaskReading } from "../src/agents/askPurser.js";
import { describeTerms } from "../src/approve/client.js";
import { ClaudeReader, type Read } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { TASK_WITHIN_PER_DAY } from "../src/config/policy.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { executeQuarantineRelease, pollQuarantine, setupReceivePolicy } from "../src/policy/quarantine.js";
import { buildRelayState, MAX_RELAY_PROPOSALS } from "../src/relay/state.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { FakeReceivePolicy } from "../src/redteam/receivePolicy.js";

const now = new Date("2026-10-30T10:00:00Z");
const tools = (db: DB) => new Tools(db, new ClaudeReader(db, null));
/** A model that reads whatever it is told to: what a misread or a nudged reading looks like to code. */
class Reads extends Tools {
  constructor(db: DB, private readonly reading: TaskReading) { super(db, new ClaudeReader(db, null)); }
  override async task(): Promise<Read<TaskReading>> { return { value: this.reading, source: "claude", model: "fake" }; }
}
const count = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const terms = (db: DB, id: string) => JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as Record<string, unknown>;

describe("HIGH-1: a chat message through the relay never issues a card at once", () => {
  // Breaks if the relay (phone or viewer link) can get a within-policy card without Face ID.
  it("makes a proposal from the relay, even for a small amount and even with Airwallex at hand", async () => {
    const db = openDb(":memory:");
    const r = await relayAsk(db, tools(db))("Book a flight to Berlin on 12 November, at most €100", "t-1", now);
    expect(r).toMatchObject({ proposalId: "P-0001" });
    expect(r.reply).toMatch(/Face ID/);
    expect(count(db, "SELECT COUNT(*) AS n FROM task_cards")).toBe(0);
  });

  it("issues within the policy only when the CFO asks at the runner itself", async () => {
    const db = openDb(":memory:");
    const text = "Book a flight to Berlin on 12 November, at most €100";
    expect(await askPurser(db, tools(db), text, now, { rail: new FakeIssuing() })).toMatchObject({ proposalId: "P-0001", taskId: null });
    expect(await askPurser(db, tools(db), text, now, { rail: new FakeIssuing(), from: "runner" })).toMatchObject({ proposalId: null, taskId: "task:T-0001" });
  });

  // Breaks if a card above the four-eyes threshold could skip the second person by being "within policy".
  it("sends a card above the four-eyes threshold to Face ID", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '200.00', ?)").run(now.toISOString());
    const r = await askPurser(db, tools(db), "Flight to Berlin, at most €250", now, { rail: new FakeIssuing(), from: "runner" });
    expect(r).toMatchObject({ proposalId: "P-0001", taskId: null });
  });

  it(`issues at most ${TASK_WITHIN_PER_DAY} cards a day within the policy; the next one asks for Face ID`, async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    for (let i = 0; i < TASK_WITHIN_PER_DAY; i++) {
      expect((await askPurser(db, tools(db), `Train to Antwerp, at most €${40 + i}`, now, { rail: awx, from: "runner" })).taskId).not.toBeNull();
    }
    const over = await askPurser(db, tools(db), "Train to Antwerp, at most €45", now, { rail: awx, from: "runner" });
    expect(over).toMatchObject({ taskId: null, proposalId: "P-0001" });
    const nextDay = new Date(now.getTime() + 25 * 3_600_000);
    expect((await askPurser(db, tools(db), "Train to Antwerp, at most €46", nextDay, { rail: awx, from: "runner" })).taskId).not.toBeNull();
  });
});

describe("LOW-4: within the policy, the amount and date must be the message's own", () => {
  // Breaks if a bare number (a room number) read as the amount is issued without a person checking it.
  it("does not issue at once on a number that has no euro sign", async () => {
    const db = openDb(":memory:");
    const text = "hotel room 205 for 2 nights, at most €80";
    const r = await askPurser(db, new Reads(db, { kind: "hotel", amount_eur: "205.00", purpose: text, date: null }), text, now, { rail: new FakeIssuing(), from: "runner" });
    expect(r).toMatchObject({ taskId: null, proposalId: "P-0001" });
  });

  it("does not issue at once on a date the message does not name", async () => {
    const db = openDb(":memory:");
    const text = "Flight to Berlin, at most €150";
    const r = await askPurser(db, new Reads(db, { kind: "flight", amount_eur: "150.00", purpose: text, date: "2026-11-25" }), text, now, { rail: new FakeIssuing(), from: "runner" });
    expect(r).toMatchObject({ taskId: null, proposalId: "P-0001" });
  });
});

describe("MEDIUM-3: the approval says who asked", () => {
  it("puts who asked in the signed terms and on the phone", async () => {
    const db = openDb(":memory:");
    await askPurser(db, tools(db), "Hotel in Munich, at most €600", now, { from: "runner" });
    await relayAsk(db, tools(db))("Hotel in Munich, at most €500", "t-2", now);
    await askPurser(db, tools(db), "Train to Antwerp, at most €40", now, { asker: "ext:trailbot" });
    expect(["P-0001", "P-0002", "P-0003"].map((id) => terms(db, id).asked_by)).toEqual(["cfo-at-runner", "dashboard-link", "ext:trailbot"]);
    const agent = describeTerms(terms(db, "P-0003"), {});
    expect(agent.rows).toContainEqual(["Asked by", "outside agent ext:trailbot"]);
    expect(agent.warnings.join(" ")).not.toMatch(/your own message/);
    expect(agent.warnings.join(" ")).toMatch(/agent/);
    const link = describeTerms(terms(db, "P-0002"), {});
    expect(link.warnings.join(" ")).toMatch(/dashboard link/);
  });

  it("labels the dashboard's chat lines by who sent them", async () => {
    const db = openDb(":memory:");
    await askPurser(db, tools(db), "Hotel in Munich, at most €600", now, { from: "runner" });
    await relayAsk(db, tools(db))("Hotel in Munich, at most €500", "t-3", now);
    await askPurser(db, tools(db), "Train to Antwerp, at most €40", now, { asker: "ext:trailbot" });
    const from = buildSnapshot(db, now).ask.filter((m) => m.from !== "purser").map((m) => m.from);
    expect(from).toEqual(["you", "dashboard link", "agent ext:trailbot"]);
  });
});

describe("MEDIUM-2: no flood of proposals", () => {
  // Breaks if one outside agent can fill the CFO's phone with task card requests.
  it("keeps one waiting task card request per outside agent, and at most a few asks an hour", async () => {
    const db = openDb(":memory:");
    expect((await askPurser(db, tools(db), "Train to Antwerp, at most €40", now, { asker: "ext:trailbot" })).proposalId).toBe("P-0001");
    const again = await askPurser(db, tools(db), "Train to Ghent, at most €30", now, { asker: "ext:trailbot" });
    expect(again).toMatchObject({ proposalId: null });
    expect(again.reply).toMatch(/already waiting/);
    for (let i = 0; i < 5; i++) await askPurser(db, tools(db), "hello", now, { asker: "ext:chatty" });
    const sixth = await askPurser(db, tools(db), "Train to Antwerp, at most €40", now, { asker: "ext:chatty" });
    expect(sixth).toMatchObject({ proposalId: null });
    expect(sixth.reply).toMatch(/too many/i);
  });

  it("keeps at most three waiting task card requests from the dashboard link", async () => {
    const db = openDb(":memory:");
    const ask = relayAsk(db, tools(db));
    for (let i = 0; i < 3; i++) expect((await ask(`Hotel in Munich, at most €${500 + i}`, `t-${i}`, now)).proposalId).not.toBeNull();
    expect((await ask("Hotel in Munich, at most €510", "t-9", now)).proposalId).toBeNull();
  });

  // Breaks if a flood of proposals could push the relay state over its size limit and hide the emergency stop.
  it(`sends at most ${MAX_RELAY_PROPOSALS} proposals to the relay, policy changes first`, async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < MAX_RELAY_PROPOSALS + 20; i++) await askPurser(db, tools(db), `Hotel in Munich, at most €${400 + i}`, now, { asker: `ext:a${i}` });
    const stop = proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "stop" }, "human", now);
    const sent = buildRelayState(db, { rpId: "x.example", relayToken: "t".repeat(32) }, now).approvals.proposals;
    expect(sent).toHaveLength(MAX_RELAY_PROPOSALS);
    expect(sent[0]!.proposal_id).toBe(stop.proposal_id);
  });
});

describe("LOW-5: a task card is reserved before Airwallex is asked", () => {
  it("never reuses a number, and answers a ticket once", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.createCard = async () => { throw new Error("Airwallex is down"); };
    expect((await askPurser(db, tools(db), "Train to Antwerp, at most €40", now, { rail: awx, from: "runner" })).taskId).toBeNull();
    expect(db.prepare("SELECT task_id, status FROM task_cards").all()).toEqual([{ task_id: "task:T-0001", status: "FAILED" }]);
    const ok = await askPurser(db, tools(db), "Train to Antwerp, at most €40", now, { rail: new FakeIssuing(), from: "runner" });
    expect(ok.taskId).toBe("task:T-0002");
    const ask = relayAsk(db, tools(db));
    await ask("Hotel in Munich, at most €600", "same", now);
    const twice = await ask("Hotel in Munich, at most €600", "same", now);
    expect(twice.proposalId).toBeNull();
    expect(count(db, "SELECT COUNT(*) AS n FROM proposals")).toBe(1);
  });

  // Breaks if a crash between Airwallex and the ledger leaves a live card that the emergency stop does not know.
  it("freezes a card Airwallex made for a reservation that never finished", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    db.prepare("INSERT INTO task_cards (task_id, proposal_id, kind, purpose, mccs, amount_cents, valid_until, status, created_at) VALUES ('task:T-0001', 'T-0001', 'train', 'x', '4112', 4000, ?, 'PENDING', ?)")
      .run("2026-11-06T10:00:00.000Z", now.toISOString());
    const holder = await awx.createCardholder({ email: "agents+tasks@northwind-outdoor.example", firstName: "Task", lastName: "Cards" });
    const card = await awx.createCard({ cardholderId: holder.id, nickname: "task T-0001: train", createdBy: "x", limits: { currency: "EUR", perTxCents: 4000, monthlyCents: 4000 }, controls: { mccs: ["4112"], currencies: ["EUR"], activeTo: "2026-11-06T10:00:00.000Z", singleUse: true } });
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(await recoverTaskCards(db, awx, later)).toBe(1);
    expect(awx.cards.find((c) => c.cardId === card.cardId)?.status).toBe("INACTIVE");
    expect(db.prepare("SELECT status FROM task_cards").get()).toEqual({ status: "FAILED" });
  });
});

describe("quarantine (MEDIUM-2, LOW-6)", () => {
  const W = "0x00000000000000000000000000000000000000e1" as const;
  const B = "0x00000000000000000000000000000000000000b1" as const;
  const X = "0x00000000000000000000000000000000000000f9" as const;
  const UNIT = 10n ** 16n;
  const world = async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'business'), (?, 'sweep')").run(B, W);
    const rp = new FakeReceivePolicy();
    await setupReceivePolicy(db, rp, "k", now);
    return { db, rp };
  };

  // Breaks if dust or one sender's repeat payments can fill the phone with proposals.
  it("holds dust and repeat payments without new proposals", async () => {
    const { db, rp } = await world();
    rp.receive(X, W, 1n);
    rp.receive(X, W, 2n * UNIT);
    rp.receive(X, W, 3n * UNIT);
    expect(await pollQuarantine(db, rp, now)).toBe(3);
    expect(count(db, "SELECT COUNT(*) AS n FROM quarantines WHERE status = 'OPEN'")).toBe(3);
    expect(count(db, "SELECT COUNT(*) AS n FROM proposals")).toBe(2);
  });

  // Breaks if an accept could send the held money anywhere but the sweep wallet.
  it("refuses an accept that names another address, and shows the sweep wallet's address", async () => {
    const { db, rp } = await world();
    rp.receive(X, W, 2n * UNIT);
    await pollQuarantine(db, rp, now);
    const t = terms(db, "P-0002");
    expect(describeTerms(t, {}).rows).toContainEqual(["Goes to", `the sweep wallet ${W}`]);
    const bad = { ...t, to: X };
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = 'P-0002'").run(JSON.stringify(bad));
    db.prepare("UPDATE proposals SET terms_sha256 = ? WHERE proposal_id = 'P-0002'").run((await import("../src/lib/terms.js")).termsHash(bad as never));
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = 'P-0002'").get() as { terms_sha256: string };
    decide(db, { proposalId: "P-0002", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
    await expect(executeQuarantineRelease(db, rp, "k", "P-0002", now)).rejects.toThrow(/does not match the approved terms/);
  });
});
