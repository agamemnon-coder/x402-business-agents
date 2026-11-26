// Entities without hand-editing (governance round, 26 Nov): `npm run entities -- list | add | allow` (src/cli/entities.ts).
// Adding an entity opens it to no agent; `allow` files pay_from.<entity>.<agent> allowed as a policy change, which counts
// only once the CFO signs it with the passkey (the real WebAuthn path here: src/passkey/process.ts). The invoice's
// detail then names the paying entity and its account (src/ap/detail.ts payingEntityOf, the page's "Paid from" row),
// and so does "Why it was paid this way" (src/payouts/rationale.ts). Test money: the in-memory stand-in rails only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { payingEntityOf } from "../src/ap/detail.js";
import { entitiesCommand } from "../src/cli/entities.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executePolicyChange } from "../src/executors/policyChange.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { buildRationale } from "../src/payouts/rationale.js";
import { mayPayFrom } from "../src/policy/entities.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { detailPage } from "../src/servers/payablesPage.js";
import { RATIONALE_WORDS_JS } from "../src/servers/rationaleWords.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const RP = "purser.example", ORIGIN = `https://${RP}`;
const bill = readFileSync(new URL("../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");
let tickets = 0, counter = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: new Date().toISOString() });

async function world(): Promise<{ db: DB; phone: FakeAuthenticator; ltd: FakeAirwallex }> {
  const db = openDb(":memory:");
  const bv = new FakeAirwallex();
  bv.payingAccount = "acct_nwbv_0001";
  await seedTreasury(db, bv, bv);
  const ltd = new FakeAirwallex();
  ltd.payingAccount = "acct_nwltd_0001";
  ltd.bal.EUR.availableCents = 10_000_000;
  ltd.beneficiaries = bv.beneficiaries;
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN });
  expect((await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "cfo" })).status).toBe("pending");
  confirmPasskey(db, fingerprintOf(phone.spkiSha256));
  return { db, phone, ltd };
}

/** The CFO approves proposal `id` with the passkey on the phone. */
async function faceId(db: DB, phone: FakeAuthenticator, id: string): Promise<void> {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  const signed = item("assertion", { proposal_id: id, terms_sha256: p.terms_sha256, credential: phone.sign({ challenge: challengeFor(p.terms_sha256), origin: ORIGIN, rpId: RP, counter: ++counter }) }, id);
  expect((await processAssertion(db, signed)).status).toBe("approved");
}
/** A policy change the CFO approves with the passkey, then run. */
async function cfoSigns(db: DB, phone: FakeAuthenticator, id: string): Promise<void> {
  await faceId(db, phone, id);
  executePolicyChange(db, id);
}

describe("npm run entities", () => {
  it("is a script of its own", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.entities).toBe("tsx src/cli/entities.ts");
  });

  it("lists, adds and allows: an added entity is open to no agent until the CFO signs the allow with the passkey", async () => {
    const { db, phone } = await world();
    expect(entitiesCommand(db, ["list"])).toMatch(/^no legal entities/);
    expect(entitiesCommand(db, ["add", "nl-bv", "--name", "Northwind Outdoor BV", "--country", "NL", "--account", "acct_nwbv_0001"])).toMatch(/^added Northwind Outdoor BV \(nl-bv, NL, EUR\)/);
    expect(entitiesCommand(db, ["add", "uk-ltd", "--name", "Northwind Outdoor Ltd", "--country", "gb", "--account", "acct_nwltd_0001"])).toMatch(/GB, GBP\), funded from acct_nwltd_0001 only/);
    // What it refuses, in its own words: an account another entity uses, a country with no known currency, a bad account.
    expect(() => entitiesCommand(db, ["add", "uk-ltd-2", "--name", "Ltd 2", "--country", "GB", "--account", "acct_nwltd_0001"])).toThrow(/already funds Northwind Outdoor Ltd/);
    expect(() => entitiesCommand(db, ["add", "br-ltda", "--name", "Northwind Ltda", "--country", "BR", "--account", "acct_br_0001"])).toThrow(/--currency/);
    expect(() => entitiesCommand(db, ["add", "de-gmbh", "--name", "Northwind GmbH", "--country", "DE", "--account", "DE89 3704"])).toThrow(/acct_/);
    expect(entitiesCommand(db, ["list"]).split("\n")).toEqual([
      expect.stringMatching(/^nl-bv +Northwind Outdoor BV · NL · EUR · account acct_nwbv_0001 · may pay from it: no agent$/),
      expect.stringMatching(/^uk-ltd +Northwind Outdoor Ltd · GB · GBP · account acct_nwltd_0001 · may pay from it: no agent$/),
    ]);

    expect(() => entitiesCommand(db, ["allow", "fr-sas", "treasury"])).toThrow(/holds no entity "fr-sas"/);
    expect(() => entitiesCommand(db, ["allow", "uk-ltd", "tresury"])).toThrow(/is not an agent/);
    const filed = entitiesCommand(db, ["allow", "uk-ltd", "treasury", "--reason", "Ltd pays its own suppliers"]);
    const id = /^(P-\d+) lets the treasury agent pay from uk-ltd \(pay_from\.uk-ltd\.treasury allowed\)/.exec(filed)?.[1];
    expect(id, filed).toBeTruthy();
    expect(filed).toMatch(/counts only once the CFO approves it with the passkey/);
    const p = db.prepare("SELECT kind, status, terms_json FROM proposals WHERE proposal_id = ?").get(id) as { kind: string; status: string; terms_json: string };
    expect(p).toMatchObject({ kind: "policy_change", status: "PENDING_APPROVAL" });
    expect((JSON.parse(p.terms_json) as { changes: unknown[]; reason: string })).toMatchObject({ changes: [{ key: "pay_from.uk-ltd.treasury", from: "blocked", to: "allowed" }], reason: "Ltd pays its own suppliers" });
    expect(mayPayFrom(db, "treasury", "uk-ltd")).toBe(false);

    await cfoSigns(db, phone, id!);
    expect(mayPayFrom(db, "treasury", "uk-ltd")).toBe(true);
    expect(entitiesCommand(db, ["list"])).toMatch(/uk-ltd .* may pay from it: treasury/);
    expect(entitiesCommand(db, ["allow", "uk-ltd", "treasury"])).toMatch(/may already pay from uk-ltd/);
    expect(() => entitiesCommand(db, ["remove", "uk-ltd"])).toThrow(/^usage: npm run entities/);
  });

  // 26 Nov review: the allow never named its proposer, so above the CFO's segregation-of-duties threshold the person who
  // filed it could approve it alone. Now it needs --by there, and the name is signed into the terms.
  it("with segregation of duties on, an allow needs --by, and the proposer is signed into its terms", async () => {
    const { db } = await world();
    entitiesCommand(db, ["add", "uk-ltd", "--name", "Northwind Outdoor Ltd", "--country", "GB", "--account", "acct_nwltd_0001"]);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.policy_sod_eur', '1000.00', ?)").run(new Date().toISOString());
    expect(() => entitiesCommand(db, ["allow", "uk-ltd", "treasury"])).toThrow(/segregation of duties applies .*--by <person>/);
    const id = /^(P-\d+)/.exec(entitiesCommand(db, ["allow", "uk-ltd", "treasury", "--by", "lena"]))![1]!;
    const p = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string };
    expect(JSON.parse(p.terms_json)).toMatchObject({ proposed_by: "lena", changes: [{ key: "pay_from.uk-ltd.treasury", to: "allowed" }] });
  });

  it("the payment's detail names the paying entity and its account, and so does why it was paid this way", async () => {
    const { db, phone, ltd } = await world();
    entitiesCommand(db, ["add", "nl-bv", "--name", "Northwind Outdoor BV", "--country", "NL", "--account", "acct_nwbv_0001"]);
    entitiesCommand(db, ["add", "uk-ltd", "--name", "Northwind Outdoor Ltd", "--country", "GB", "--account", "acct_nwltd_0001"]);
    await cfoSigns(db, phone, /^(P-\d+)/.exec(entitiesCommand(db, ["allow", "uk-ltd", "treasury"]))![1]!);
    const out = await proposeInvoicePayment(db, ltd, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "uk-ltd");
    if (out.kind !== "proposed") throw new Error(out.reason);
    const id = out.proposal.proposal_id;
    expect(payingEntityOf(db, id)).toEqual({ id: "uk-ltd", name: "Northwind Outdoor Ltd", country: "GB", account: "acct_nwltd_0001", currency: "GBP" });
    await faceId(db, phone, id);
    expect((await executeInvoicePayment(db, ltd, ltd, id)).transfer.status).toBe("PAID");
    const why = buildRationale(db, id)!;
    expect(why.funding.account).toBe("Northwind Outdoor Ltd, GB (acct_nwltd_0001)");
    const words = new Function(`${RATIONALE_WORDS_JS}; return rationaleWords;`)() as (r: typeof why) => { funding: string };
    expect(words(why).funding).toMatch(/^Paid EUR from the EUR balance of Northwind Outdoor Ltd, GB \(acct_nwltd_0001\)/);
    // A company with no entities: nothing to name.
    const single = openDb(":memory:");
    expect(payingEntityOf(single, null)).toBeNull();
    expect(payingEntityOf(single, "P-0404")).toBeNull();
    // The invoice's page shows it beside what Purser read, labelled, from the detail's own field.
    const html = detailPage("csrf", "nonce", "AP-0001");
    expect(html).toContain("d.paying_entity");
    expect(html).toContain("Paying entity");
  });
});
