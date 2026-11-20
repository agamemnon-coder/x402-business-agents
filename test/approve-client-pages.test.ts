// The phone's pages themselves (src/approve/client.ts), run in the test process on a stand-in DOM (test/support/fakeDom.ts)
// with the relay, the passkey and the device's storage stood in for: what each page draws from what the relay sends,
// and what it sends back when the CFO presses a button. The approval page refuses anything the runner did not sign or
// that is older than what the phone saw; it arms its buttons only after a moment; Approve signs the terms hash and
// Reject the rejection hash; a refusal or a cancelled Face ID leaves nothing sent. The payables views speak the
// company's language, a batch can lose one line, the enrolment page shows the passkey's fingerprint, and the policy
// editor only ever tightens the policy. The browser checks (test/browser) look at the same pages in a real browser.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalize, sha256Hex, rejectionHash, batchRemovalHash, type PhoneProposal } from "../src/approve/client.js";
import { displayKey, displayKeyFingerprint, signedPart, type DisplayKey } from "../src/relay/sign.js";
import { phonePhrases } from "../src/ui/i18n.js";
import { pageDocument, textOf, type FakeDocument, type FakeElement } from "./support/fakeDom.js";

const VIEW = "0123456789abcdef0123456789abcdef";
const key = (): DisplayKey => displayKey(join(mkdtempSync(join(tmpdir(), "kit11-pages-")), "relay-display-key.pem"));
let runner: DisplayKey;
let otherRunner: DisplayKey;
beforeAll(() => { runner = key(); otherRunner = key(); });

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const CUSTOMER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

/** A proposal as the relay lists it: canonical terms and their hash, as the runner computes them. */
async function proposal(terms: Record<string, unknown>, o: Partial<PhoneProposal> = {}): Promise<PhoneProposal> {
  const canonical = canonicalize(terms);
  return {
    proposal_id: String(terms.proposal_id), kind: String(terms.kind), group: String(terms.proposal_id), canonical, terms_sha256: await sha256Hex(canonical),
    expires_at: String(terms.expires_at), created_by: "support", created_at: new Date().toISOString(), review: null, warnings: [], ...o,
  };
}

const refundTerms = (id = "P-0001", extra: Record<string, unknown> = {}) => ({
  schema: "kit11.approval-terms/v1", kind: "refund_batch", proposal_id: id, expires_at: inAnHour(), customer: CUSTOMER,
  refunds: [{ sale_id: "7", amount: "0.05", to: CUSTOMER }, { sale_id: "8", amount: "0.10", to: CUSTOMER }], total: "0.15", reason: "duplicate charge", ...extra,
});

interface ApprovalsIn {
  proposals: PhoneProposal[];
  names?: Record<string, string>;
  credentials?: { id: string; label: string; enrolled_at: string }[];
  policy?: unknown[];
  seq?: number;
  age_ms?: number;
  language?: string;
  by?: DisplayKey | null;
  session_active?: boolean;
}
/** What the relay hands the phone at /api/approvals, signed by the runner (or by another key, or by none). */
function approvals(o: ApprovalsIn): Record<string, unknown> {
  const a = {
    proposals: o.proposals, names: o.names ?? {}, policy: o.policy ?? [], ledger_seq: o.seq ?? 5,
    passkey: { rp_id: "phone.example", credentials: o.credentials ?? [{ id: "AQID", label: "iPhone", enrolled_at: "2026-11-01T10:00:00Z" }] },
  };
  const by = o.by === undefined ? runner : o.by;
  return {
    ...a, ...(by ? { signature: { alg: "ES256", sig: by.sign(signedPart(a)) } } : {}),
    relay: { synced_at: "x", age_ms: o.age_ms ?? 1000 }, enrolment_open: false,
    ...(o.language ? { language: o.language } : {}), ...(o.session_active === undefined ? {} : { session_active: o.session_active }),
  };
}

// ── The browser around the page ──

interface Call { path: string; body: unknown }
type Answer = { status: number; body?: unknown } | ((c: Call) => { status: number; body?: unknown });
let doc: FakeDocument;
let calls: Call[];
let routes: Map<string, Answer[]>;
let store: Map<string, string>;
let credentialsGet: ReturnType<typeof vi.fn>;
let credentialsCreate: ReturnType<typeof vi.fn>;

/** Scripts the relay's next answers on a path (the last one repeats). */
function relay(path: string, ...answers: Answer[]): void { routes.set(path, answers); }

const bytes = (...b: number[]) => new Uint8Array(b).buffer;
const assertion = () => ({
  id: "cred-1", rawId: bytes(1, 2, 3), type: "public-key",
  response: { clientDataJSON: bytes(4), authenticatorData: bytes(5), signature: bytes(6), userHandle: null },
  getClientExtensionResults: () => ({}), authenticatorAttachment: "platform",
});
const challengeHex = (call: number) => Buffer.from(new Uint8Array((credentialsGet.mock.calls[call]![0] as { publicKey: { challenge: ArrayBuffer } }).publicKey.challenge)).toString("hex");

function stub(o: { page?: string; hash?: string; search?: string; pathname?: string; hostname?: string; seen?: Record<string, string> }): void {
  doc = pageDocument(o.page);
  calls = [];
  routes = new Map();
  store = new Map(Object.entries(o.seen ?? {}));
  credentialsGet = vi.fn(async () => assertion());
  credentialsCreate = vi.fn();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { hostname: o.hostname ?? "phone.example", hash: o.hash ?? `#view=${VIEW}&runner=${runner.publicSpki}`, pathname: o.pathname ?? "/approve/P-0001", search: o.search ?? "" });
  vi.stubGlobal("history", { replaceState: () => undefined });
  vi.stubGlobal("setInterval", () => 0);
  vi.stubGlobal("navigator", { credentials: { get: credentialsGet, create: credentialsCreate } });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const c: Call = { path: url, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const list = routes.get(url) ?? routes.get(url.replace(/\/[^/]+$/, "/*"));
    if (!list || list.length === 0) throw new Error(`the relay cannot be reached: ${url}`);
    const next = list.length > 1 ? list.shift()! : list[0]!;
    const a = typeof next === "function" ? next(c) : next;
    return new Response(a.body === undefined ? "not json" : JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }));
}

/** Lets the page's promises (fetch, WebCrypto) settle, advancing the stood-in clock by `ms` too. */
const realSetTimeout = globalThis.setTimeout;
const realPause = (ms: number) => new Promise((r) => realSetTimeout(r, ms));
async function settle(ms = 0): Promise<void> {
  const quiet = async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(0);
      if (i % 4 === 3) await realPause(2);
    }
  };
  await quiet();
  if (ms) {
    await vi.advanceTimersByTimeAsync(ms);
    await quiet();
  }
}

/** Boots a fresh copy of the page script, as the browser does on load. */
async function open(o: Parameters<typeof stub>[0], before?: () => void): Promise<typeof import("../src/approve/client.js")> {
  stub(o);
  before?.();
  vi.resetModules();
  const m = await import("../src/approve/client.js");
  for (let i = 0; i < 50 && doc.getElementById("app")!.childNodes.length === 0; i++) await settle();
  await settle();
  return m;
}

const app = () => doc.getElementById("app")!;
const byId = (id: string) => doc.getElementById(id)!;
const button = (words: string | RegExp, root: FakeElement = doc.documentElement): FakeElement => {
  const b = root.querySelectorAll("button").find((x) => (typeof words === "string" ? textOf(x) === words : words.test(textOf(x))));
  if (!b) throw new Error(`no button ${String(words)} in: ${textOf(root)}`);
  return b;
};
async function press(b: FakeElement, ms = 0): Promise<void> {
  const done = b.click();
  await settle(ms);
  await done;
  await settle();
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(async () => {
  // What a page still had under way finishes before its browser is taken away.
  await settle();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as { PURSER_PHRASES?: unknown }).PURSER_PHRASES;
});

describe("the approval page: what it shows before anything can be signed", () => {
  it("a guest without the viewer link gets one calm card and the relay is not asked", async () => {
    await open({ page: "approve", hash: "" });
    expect(textOf(app())).toContain("Open your private link once on this phone to approve");
    expect(app().querySelector("a.confirm")!.href).toBe("/?signin");
    expect(calls).toEqual([]);
  });

  it.each([
    [401, "This device needs the viewer link"],
    [503, "The runner has not connected yet"],
    [500, "Cannot reach the approval relay."],
  ])("says why when the relay answers %i", async (status, words) => {
    await open({ page: "approve" }, () => relay("/api/approvals", { status, body: {} }));
    expect(textOf(app())).toContain(words);
  });

  it("refuses what the runner it knows did not sign, and what is older than this phone saw", async () => {
    const p = await proposal(refundTerms());
    await open({ page: "approve" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], by: null }) }));
    expect(textOf(app())).toContain("is not signed by the runner this phone knows");
    expect(app().querySelector("button")).toBeNull();

    await open({ page: "approve", seen: { "kit11.seq": "9" } }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], seq: 3 }) }));
    expect(textOf(app())).toContain("The relay sent an older signed state than this phone already saw");
  });

  it("a new run's key is used only after the person's own press, then the page loads with it", async () => {
    const p = await proposal(refundTerms());
    await open({ page: "approve", hash: `#view=${VIEW}&runner=${otherRunner.publicSpki}`, seen: { "kit11.runner": runner.publicSpki } },
      () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], by: otherRunner }) }));
    expect(textOf(app())).toContain("This link is from a new run");
    expect(textOf(app())).toContain(displayKeyFingerprint(runner.publicSpki));
    expect(textOf(app())).toContain(displayKeyFingerprint(otherRunner.publicSpki));
    // A press the browser does not mark as the person's own changes nothing.
    const use = app().querySelector("#use-new-key")!;
    use.dispatch("click", false);
    expect(textOf(app())).toContain("The key was not changed.");
    expect(store.get("kit11.runner")).toBe(runner.publicSpki);
    use.dispatch("click", true);
    expect(store.get("kit11.runner")).toBe(otherRunner.publicSpki);
    await settle();
    expect(textOf(app())).toContain("Refund 2 sales");
  });

  it("looks for a proposal that is not there yet for 90 seconds, then says it is not waiting", async () => {
    const other = await proposal(refundTerms("P-0002"));
    await open({ page: "approve", pathname: "/approve/P-0009" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [other] }) }));
    expect(textOf(app())).toContain("Looking for P-0009");
    for (let i = 0; i < 37; i++) await settle(2500);
    expect(textOf(app())).toContain("P-0009 is not waiting for approval");
  });
});

describe("the approval page: one proposal", () => {
  it("draws the payee, agent and why from the hashed terms, arms after a moment, and Approve signs the terms hash", async () => {
    const p = await proposal(refundTerms(), { review: { model: "claude-opus-5-5", recommendation: "approve", text: "The two sales were charged twice." }, warnings: ["A planted line was ignored"] });
    await open({ page: "approve" }, () => {
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], names: { [CUSTOMER]: "Customer Ltd" }, policy: [{ key: "approval.refund_eur", value: "0.10" }], age_ms: 60_000 }) });
      relay("/api/assertions", (c) => ({ status: 202, body: { ticket: "T-1", echo: c.body } }));
      relay("/api/tickets/T-1", { status: 200, body: { status: "queued" } }, { status: 200, body: { status: "approved" } }, { status: 200, body: { status: "executed", message: "Paid 2 refunds." } });
    });
    const page = textOf(app());
    expect(page).toContain("Refund 2 sales");
    expect(page).toContain("Customer Ltd");
    expect(page).toContain("The runner last synced 60 s ago");
    expect(page).toContain("A planted line was ignored");
    expect(page).toContain("Opus review, advisory: approve");
    expect(page).toContain(p.terms_sha256.slice(0, 8));
    const approve = byId("approve");
    expect(approve.disabled).toBe(true); // a double tap cannot land on it
    await settle(900);
    expect(approve.disabled).toBe(false);
    await press(approve, 3000);
    expect(challengeHex(0)).toBe(p.terms_sha256);
    const sent = calls.find((c) => c.path === "/api/assertions")!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ proposal_id: "P-0001", terms_sha256: p.terms_sha256, decision: "APPROVED", credential: { id: "cred-1", rawId: "AQID" } });
    expect(textOf(app())).toContain("Done");
    expect(textOf(app())).toContain("Paid 2 refunds.");
  });

  it("Reject signs the rejection hash, never the terms hash", async () => {
    const p = await proposal(refundTerms());
    await open({ page: "approve" }, () => {
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p] }) });
      relay("/api/assertions", { status: 202, body: { ticket: "T-2" } });
      relay("/api/tickets/T-2", { status: 200, body: { status: "rejected" } });
    });
    await settle(900);
    await press(byId("reject"));
    expect(challengeHex(0)).toBe(await rejectionHash(p.terms_sha256));
    expect((calls.find((c) => c.path === "/api/assertions")!.body as { decision: string }).decision).toBe("REJECTED");
    expect(textOf(app())).toContain("Rejected with your passkey. Nothing will be paid.");
  });

  it("a cancelled Face ID sends nothing and arms the buttons again; a refusal by the relay says so", async () => {
    const p = await proposal(refundTerms());
    await open({ page: "approve" }, () => {
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p] }) });
      relay("/api/assertions", { status: 409, body: { error: "already decided" } });
    });
    await settle(900);
    credentialsGet.mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    await press(byId("approve"));
    expect(textOf(byId("sign-status"))).toBe("Cancelled. Nothing was signed.");
    expect(calls.some((c) => c.path === "/api/assertions")).toBe(false);
    expect(byId("approve").disabled).toBe(false);
    credentialsGet.mockResolvedValueOnce(null);
    await press(byId("approve"));
    expect(textOf(byId("sign-status"))).toBe("Cancelled. Nothing was signed.");
    await press(byId("reject"));
    expect(textOf(byId("sign-status"))).toBe("Not accepted: already decided. Nothing was rejected.");
    expect(byId("reject").disabled).toBe(false);
  });

  it("an unreachable relay after Face ID is said in words, and nothing counts as approved", async () => {
    const p = await proposal(refundTerms());
    await open({ page: "approve" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p] }) }));
    await settle(900);
    await press(byId("approve"));
    expect(textOf(byId("sign-status"))).toBe("Not accepted: the relay cannot be reached. Nothing was approved.");
  });

  it("terms that do not hash to the hash shown cannot be approved; they can still be rejected", async () => {
    const p = { ...(await proposal(refundTerms())), terms_sha256: "ab".repeat(32) };
    await open({ page: "approve" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p] }) }));
    expect(textOf(app())).toContain("Do not approve: the terms do not hash to the hash shown.");
    await settle(900);
    expect(byId("approve").disabled).toBe(true);
    expect(byId("reject").disabled).toBe(false);
  });

  it("without an enrolled passkey nothing can be signed", async () => {
    const p = await proposal(refundTerms());
    await open({ page: "approve" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], credentials: [] }) }));
    expect(textOf(app())).toContain("No passkey is enrolled yet, so nothing can be signed here.");
    await settle(4000);
    expect(byId("approve").disabled).toBe(true);
    expect(byId("reject").disabled).toBe(true);
  });

  it("when Opus advises rejecting, Reject comes first and Approve is the slow, named second choice", async () => {
    const p = await proposal(refundTerms(), { review: { model: null, recommendation: "reject", text: "Sale 8 was never charged." } });
    await open({ page: "approve" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p] }) }));
    const actions = app().querySelector(".actions")!;
    expect(actions.classList.contains("against")).toBe(true);
    expect(textOf(actions.children[0]!)).toBe("Reject (Opus advises this)");
    expect(textOf(byId("approve"))).toBe("Approve anyway with Face ID");
    expect(textOf(app())).toContain("Opus advises rejecting this.");
    expect(textOf(app())).toContain("Purser's code (no model), advisory: reject");
    await settle(900);
    expect(byId("reject").disabled).toBe(false);
    expect(byId("approve").disabled).toBe(true);
    await settle(2500);
    expect(byId("approve").disabled).toBe(false);
  });

  it("an expired proposal is not signed even when pressed", async () => {
    const t = refundTerms("P-0001", { expires_at: new Date(Date.now() + 2000).toISOString().replace(/\.\d{3}Z$/, "Z") });
    const p = await proposal(t);
    await open({ page: "approve" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p] }) }));
    await settle(900);
    await press(byId("reject"));
    expect(textOf(byId("sign-status"))).toBe("This proposal has expired. Nothing was signed.");
    expect(credentialsGet).not.toHaveBeenCalled();
  });

  it("a runner that has not picked the signature up after 20 s says the signature waits for it", async () => {
    const p = await proposal(refundTerms());
    await open({ page: "approve" }, () => {
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p] }) });
      relay("/api/assertions", { status: 202, body: { ticket: "T-3" } });
      relay("/api/tickets/T-3", { status: 200, body: { status: "queued" } });
    });
    await settle(900);
    const going = byId("approve").click();
    for (let i = 0; i < 25; i++) await settle(1000);
    expect(textOf(app())).toContain("The runner has not picked it up yet.");
    relay("/api/tickets/T-3", { status: 200, body: { status: "cosigned", message: "One of two." } });
    await settle(1000);
    await going;
    expect(textOf(app())).toContain("1 of 2 approvals");
  });
});

describe("the approval page: price options", () => {
  const steps = [{ order: "1", agent: "sourcing", cap: "0.04", budget: "1.00", payees: [OTHER], spent_at_proposal: "0.10" }];
  const option = (id: string, opt: string, q: string) => ({ schema: "kit11.approval-terms/v1", kind: "mandate_replace", proposal_id: id, expires_at: inAnHour(), option: opt, query_price: q, upstream_price: "0.03", margin: "0.01", steps, total_budget: "1.00" });

  it("shows both options, chooses one apart from signing, and the button names the one chosen", async () => {
    const a = await proposal(option("P-0001", "A", "0.04"), { group: "g", agent_advice: { agent: "Treasury agent", model: "claude-sonnet-4", recommends: true, text: "Keeps the margin." } });
    const b = await proposal(option("P-0002", "B", "0.05"), { group: "g", agent_advice: { agent: "Treasury agent", model: null, recommends: false, text: "Loses sales." } });
    await open({ page: "approve" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [a, b], names: { [OTHER.toLowerCase()]: "Supplier" } }) }));
    const options = app().querySelectorAll("button.option");
    expect(options.map(textOf)).toEqual([expect.stringContaining("Option A"), expect.stringContaining("Option B")]);
    expect(textOf(options[0]!)).toContain("Treasury agent recommends this");
    expect(options[0]!.getAttribute("aria-checked")).toBe("true");
    expect(textOf(byId("approve"))).toBe("Approve option A with Face ID");
    expect(textOf(app())).toContain("This is not");
    expect(textOf(app())).toContain("Treasury agent (Sonnet), advisory: recommends this option");
    await press(options[1]!);
    expect(options[1]!.getAttribute("aria-checked")).toBe("true");
    expect(textOf(byId("approve"))).toBe("Approve option B with Face ID");
    expect(textOf(app())).toContain("Treasury agent, advisory: recommends the other option");
    await settle(900);
    await press(byId("approve"));
    expect(challengeHex(0)).toBe(b.terms_sha256);
  });
});

describe("the approval page: a payables payment in the company's language", () => {
  const supplier = (extra: Record<string, unknown> = {}) => ({
    schema: "kit11.approval-terms/v1", kind: "supplier_payment", proposal_id: "P-0001", expires_at: inAnHour(),
    invoice_no: "ZV-4480 · Zeeland B.V.", vendor: "Zeeland B.V.", amount: "302.50", currency: "EUR", method: "LOCAL", clearing: "SEPA",
    beneficiary_id: "ben_1", beneficiary_name: "Zeeland B.V.", account: "IBAN NL91…4300", fee_reserve: "0.00", reference: "ZV-4480",
    reason: "professional_business_services", transfer_request_id: "r1", conversion: null,
    paying_account: { id: "acct_northwind", name: "Northwind Outdoor B.V." },
    platform_fee: { amount: "1.51", currency: "EUR", bps: "50", to_account: "acct_purser_platform", request_id: "f1" },
    document_total_line: "Totaal te betalen € 302,50", document_currency: "EUR", test_money: true, source: "payables_inbox", ...extra,
  });

  it("draws a Dutch first screen with the paying account and the fee, and Goedkeuren signs the terms hash", async () => {
    const p = await proposal(supplier(), { four_eyes: { approved_by: ["anna"] }, review: { model: "claude-opus-5-5", recommendation: "approve", text: "Klopt." } });
    await open({ page: "approve" }, () => {
      (globalThis as { PURSER_PHRASES?: unknown }).PURSER_PHRASES = phonePhrases();
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], language: "nl" }) });
      relay("/api/assertions", { status: 202, body: { ticket: "T-4" } });
      relay("/api/tickets/T-4", { status: 200, body: { status: "executed" } });
    });
    const page = textOf(app());
    expect(page).toContain("Betaal factuur ZV-4480");
    expect(page).toContain("€ 302,50");
    expect(page).toContain("Northwind Outdoor B.V.");
    expect(page).toContain("(anna)");
    expect(doc.documentElement.lang).toBe("nl");
    expect(textOf(doc.querySelector("header .sub"))).not.toMatch(/^Approvals/);
    await settle(900);
    await press(byId("approve"));
    expect(challengeHex(0)).toBe(p.terms_sha256);
    expect(textOf(app())).toContain("Done");
  });

  it("warns when the amount is not on the invoice's own line, and in English for an English company", async () => {
    const p = await proposal(supplier({ amount: "3025.00", vendor: "Someone Else" }), { review: { model: null, recommendation: "reject", text: "Mismatch." } });
    await open({ page: "approve" }, () => {
      (globalThis as { PURSER_PHRASES?: unknown }).PURSER_PHRASES = phonePhrases();
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], language: "en" }) });
      relay("/api/assertions", { status: 400, body: {} });
    });
    const page = textOf(app());
    expect(page).toContain("Pay invoice ZV-4480");
    expect(page).toMatch(/not (written|on)/i);
    expect(page).toContain("Someone Else");
    expect(app().querySelector(".actions")!.classList.contains("against")).toBe(true);
    await settle(900);
    credentialsGet.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "AbortError" }));
    await press(byId("reject"));
    expect(calls.some((c) => c.path === "/api/assertions")).toBe(false);
    await press(byId("reject"));
    expect(textOf(byId("sign-status"))).toContain("400");
  });

  it("refuses to arm Approve on terms that do not check out", async () => {
    const p = { ...(await proposal(supplier())), expires_at: "2030-01-01T00:00:00Z" };
    await open({ page: "approve" }, () => {
      (globalThis as { PURSER_PHRASES?: unknown }).PURSER_PHRASES = phonePhrases();
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], language: "en" }) });
    });
    expect(textOf(app())).toContain("the expiry shown is not the one in the terms");
    await settle(4000);
    expect(byId("approve").disabled).toBe(true);
  });
});

describe("the approval page: a batch, signed once, one line taken out first", () => {
  async function batch(o: { corrupt?: boolean; lines?: number } = {}) {
    const lineTerms = (n: number) => ({ schema: "kit11.approval-terms/v1", kind: "supplier_payment", proposal_id: `P-000${n + 1}`, expires_at: inAnHour(), invoice_no: `INV-${n} · Vendor ${n}`, vendor: `Vendor ${n}`, beneficiary_name: `Vendor ${n}`, amount: `${n + 1}00.00`, currency: "EUR", account: `IBAN …00${n}`, source: "payables_inbox", paying_account: { id: "acct_1", name: "Northwind" }, platform_fee: { amount: "0.50", currency: "EUR", bps: "50", to_account: "acct_purser" }, document_total_line: `Total EUR ${n + 1}00.00` });
    const lines = await Promise.all(Array.from({ length: o.lines ?? 2 }, async (_x, n) => {
      const t = lineTerms(n);
      return { proposal_id: t.proposal_id, terms: t, terms_sha256: o.corrupt && n === 0 ? "00".repeat(32) : await sha256Hex(canonicalize(t)) };
    }));
    const terms = { schema: "kit11.approval-terms/v1", kind: "payment_batch", proposal_id: "P-0100", expires_at: inAnHour(), lines, totals: [{ currency: "EUR", amount: "300.00" }], test_money: true };
    return proposal(terms);
  }

  it("lists every line with its account and fee; Take out signs that line's removal; Approve the batch hash", async () => {
    const p = await batch();
    await open({ page: "approve", pathname: "/approve/P-0100" }, () => {
      relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], language: "en" }) });
      relay("/api/assertions", { status: 503, body: { error: "runner offline" } }, { status: 202, body: { ticket: "T-5" } });
      relay("/api/tickets/T-5", { status: 200, body: { status: "executed" } });
      (globalThis as { PURSER_PHRASES?: unknown }).PURSER_PHRASES = phonePhrases();
    });
    const lines = app().querySelectorAll("li.batch-line");
    expect(lines).toHaveLength(2);
    expect(textOf(lines[0]!)).toContain("Vendor 0");
    expect(textOf(lines[0]!)).toContain("IBAN …000");
    await settle(900);
    const takeOut = lines[1]!.querySelector("button")!;
    expect(takeOut.disabled).toBe(false);
    credentialsGet.mockRejectedValueOnce(Object.assign(new Error("gone"), { name: "SecurityError" }));
    await press(takeOut);
    expect(textOf(app().querySelector(".sheet-status"))).toBe("The passkey cannot be used on this address.");
    credentialsGet.mockResolvedValueOnce(null);
    await press(takeOut);
    expect(calls.some((c) => c.path === "/api/assertions")).toBe(false);
    await press(takeOut);
    expect(challengeHex(2)).toBe(await batchRemovalHash(p.terms_sha256, "P-0002"));
    expect(calls.find((c) => c.path === "/api/assertions")!.body).toMatchObject({ decision: "REMOVE_LINE", line: "P-0002" });
    expect(textOf(app().querySelector(".sheet-status"))).toContain("runner offline");
    await press(byId("approve"));
    expect(challengeHex(3)).toBe(p.terms_sha256);
    expect(textOf(app())).toContain("Done");
  });

  it("a line whose terms do not hash to the hash the batch lists makes the batch unsignable", async () => {
    const p = await batch({ corrupt: true, lines: 1 });
    await open({ page: "approve", pathname: "/approve/P-0100" }, () => relay("/api/approvals", { status: 200, body: approvals({ proposals: [p], language: "nl" }) }));
    expect(textOf(app())).toContain("P-0001");
    await settle(900);
    expect(byId("approve").disabled).toBe(true);
    credentialsGet.mockResolvedValueOnce(null);
    await press(byId("reject"));
    expect(calls.some((c) => c.path === "/api/assertions")).toBe(false);
  });
});

describe("the enrolment page", () => {
  const options = { challenge: "AAEC", rp: { id: "phone.example", name: "Purser" }, user: { id: "dXNlcg", name: "cfo", displayName: "CFO" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 60000, attestation: "none", authenticatorSelection: {}, excludeCredentials: [{ type: "public-key", id: "AQID" }] };
  const registration = (spki: ArrayBuffer | null) => ({
    id: "new-cred", rawId: bytes(9), type: "public-key", authenticatorAttachment: null,
    response: { clientDataJSON: bytes(1), attestationObject: bytes(2), getTransports: () => ["internal"], ...(spki ? { getPublicKey: () => spki } : {}) },
    getClientExtensionResults: () => ({}),
  });
  const code = () => doc.getElementById("code")!;
  const go = () => button("Create passkey with Face ID");
  const status = () => textOf(app().querySelector(".sheet-status"));

  it("without the run's key says so before anything is typed", async () => {
    await open({ page: "enrol", hash: "", pathname: "/enrol" });
    expect(status()).toContain("This phone does not have this run's key yet");
    expect(go().disabled).toBe(true);
  });

  it("a wrong code, a cancelled or failed Face ID and a refused passkey each say why and let the person try again", async () => {
    await open({ page: "enrol", pathname: "/enrol" }, () => {
      relay("/api/enrol/options", { status: 403, body: { error: "wrong code", attempts_left: 2 } }, { status: 200, body: options });
      relay("/api/enrol", { status: 409, body: {} });
    });
    code().value = "ABCD-EFGH";
    await press(go());
    expect(status()).toBe("wrong code (2 tries left).");
    expect(go().disabled).toBe(false);
    credentialsCreate.mockRejectedValueOnce(Object.assign(new Error("dup"), { name: "InvalidStateError" }));
    await press(go());
    expect(status()).toBe("This phone already has a passkey for this site.");
    credentialsCreate.mockResolvedValueOnce(null);
    await press(go());
    expect(status()).toBe("Cancelled. No passkey was created.");
    credentialsCreate.mockResolvedValueOnce(registration(null));
    await press(go());
    expect(status()).toBe("Not accepted: error 409.");
    expect(calls.filter((c) => c.path === "/api/enrol/options").map((c) => c.body)).toEqual([{ code: "ABCD-EFGH" }, { code: "ABCD-EFGH" }, { code: "ABCD-EFGH" }, { code: "ABCD-EFGH" }]);
    expect(credentialsCreate.mock.calls[0]![0].publicKey.rp).toEqual(options.rp);
  });

  it("shows the new passkey's fingerprint in groups, and warns when the runner received another one", async () => {
    const spki = bytes(...Array.from({ length: 64 }, (_x, i) => i));
    await open({ page: "enrol", pathname: "/enrol" }, () => {
      relay("/api/enrol/options", { status: 200, body: options });
      relay("/api/enrol", { status: 202, body: { ticket: "E-1" } });
      relay("/api/tickets/E-1", { status: 200, body: { status: "pending", message: "Confirm fingerprint 0000-0000-0000-0000 on the runner." } });
    });
    credentialsCreate.mockResolvedValueOnce(registration(spki));
    code().value = "ABCD-EFGH";
    await press(go());
    const sent = calls.find((c) => c.path === "/api/enrol")!.body as { credential: { response: { transports: string[] } } };
    expect(sent.credential.response.transports).toEqual(["internal"]);
    expect(app().querySelectorAll(".fp-code span").length).toBeGreaterThan(4);
    expect(textOf(app())).toContain("The runner received another passkey than this phone made");
    expect(app().querySelector(".enrol-flow")!.dataset.step).toBe("3");
  });

  it("an enrolled passkey reaches the last step", async () => {
    await open({ page: "enrol", pathname: "/enrol" }, () => {
      relay("/api/enrol/options", { status: 200, body: options });
      relay("/api/enrol", { status: 202, body: { ticket: "E-2" } });
      relay("/api/tickets/E-2", { status: 200, body: { status: "enrolled" } });
    });
    credentialsCreate.mockResolvedValueOnce(registration(null));
    await press(go());
    expect(textOf(app())).toContain("This browser cannot show the fingerprint");
    expect(textOf(app())).toContain("Passkey enrolled");
    expect(app().querySelector(".enrol-flow")!.dataset.step).toBe("done");
  });
});

describe("the policy editor", () => {
  const policy = [
    { key: "cap.sourcing", agent: "sourcing", label: "Sourcing agent's cap", unit: "USDZ", kind: "money", value: "1.00", display: "1.00 USDZ" },
    { key: "card.max_eur", label: "Card per purchase", unit: "", kind: "optional_money", value: "", display: "none" },
    { key: "freeze", label: "Emergency stop", unit: "", kind: "choice", choices: ["off", "on"], value: "off", display: "off" },
    { key: "stop.sourcing", agent: "sourcing", label: "Sourcing agent: stop", unit: "", kind: "choice", choices: ["off", "on"], value: "off", display: "off" },
    { key: "pause.sourcing", agent: "sourcing", label: "Sourcing agent: pause", unit: "", kind: "choice", choices: ["off", "on"], value: "off", display: "off" },
  ];
  const signedPolicy = (o: Partial<ApprovalsIn> = {}) => approvals({ proposals: [], policy, ...o });
  const inputs = () => app().querySelectorAll(".policy-input");
  const note = () => textOf(app().children.at(-1)!);

  it("as a guest, or with the relay down, says so", async () => {
    await open({ page: "policy", hash: "", pathname: "/policy" });
    expect(textOf(app())).toContain("Open your private link once");
    await open({ page: "policy", pathname: "/policy" }, () => relay("/api/approvals", { status: 500, body: {} }));
    expect(textOf(app())).toBe("Cannot reach the relay.");
    await open({ page: "policy", pathname: "/policy" }, () => relay("/api/approvals", { status: 200, body: signedPolicy({ by: null }) }));
    expect(textOf(app())).toContain("is not signed by the runner");
  });

  it("checks a change before Face ID: nothing changed, a bad amount, no reason, a loosening", async () => {
    await open({ page: "policy", pathname: "/policy" }, () => relay("/api/approvals", { status: 200, body: signedPolicy({ credentials: [] }) }));
    expect(textOf(app())).toContain("No passkey is enrolled yet, so no change can be signed here.");
    const review = button("Review change");
    await press(review);
    expect(note()).toBe("Nothing changed.");
    inputs()[2]!.value = "1.5"; // the cap, by its order on the page after the two text boxes
    await press(review);
    expect(note()).toBe("Sourcing agent's cap: write it with two decimals, like 0.03 (not \"1.5\").");
    inputs()[2]!.value = "0,50";
    await press(review);
    expect(note()).toBe("Say why, in one line.");
    byId("reason").value = "Tighter";
    inputs()[2]!.value = "2.00";
    await press(review);
    expect(note()).toContain("Sourcing agent's cap: this would loosen the policy.");
  });

  it("a tightening opens the summary; Back signs nothing; Confirm signs its hash and sends it to the runner", async () => {
    await open({ page: "policy", pathname: "/policy", search: "?freeze=on" }, () => {
      relay("/api/approvals", { status: 200, body: signedPolicy() });
      relay("/api/policy", { status: 400, body: { error: "stale policy" } }, { status: 202, body: { ticket: "C-1" } });
      relay("/api/tickets/C-1", { status: 200, body: { status: "executed", message: "Applied." } });
    });
    expect(byId("reason").value).toBe("Emergency stop");
    await press(button("Review change"));
    const sheet = byId("sheet");
    expect(sheet.hidden).toBe(false);
    expect(textOf(sheet)).toContain("You are approving");
    expect(doc.body.classList.contains("locked")).toBe(true);
    await press(button("Back", sheet));
    expect(sheet.hidden).toBe(true);
    expect(doc.body.classList.contains("locked")).toBe(false);

    await press(button("Review change"));
    const confirm = button("Confirm with Face ID", sheet);
    expect(confirm.disabled).toBe(true);
    await settle(900);
    expect(confirm.disabled).toBe(false);
    credentialsGet.mockRejectedValueOnce(new Error("hardware"));
    await press(confirm);
    expect(textOf(sheet)).toContain("The passkey did not answer: hardware");
    await press(confirm);
    expect(textOf(sheet)).toContain("Not accepted: stale policy. Nothing was approved.");
    await press(confirm);
    const sent = calls.filter((c) => c.path === "/api/policy").at(-1)!.body as { canonical: string; terms_sha256: string };
    expect(JSON.parse(sent.canonical).changes).toEqual([{ key: "freeze", label: "Emergency stop", from: "off", to: "on" }]);
    expect(challengeHex(2)).toBe(sent.terms_sha256);
    expect(sent.terms_sha256).toBe(await sha256Hex(sent.canonical));
    expect(textOf(sheet)).toContain("Applied.");
  });

  it("opened for one agent, shows only its settings and sets its stop and pause for review", async () => {
    await open({ page: "policy", pathname: "/policy", search: "?agent=sourcing&stop=on&pause=on" }, () => relay("/api/approvals", { status: 200, body: signedPolicy() }));
    expect(textOf(app().querySelector("h1"))).toBe("CFO policy: Sourcing agent");
    expect(app().querySelectorAll(".policy-row label").map(textOf)).not.toContain("Emergency stop");
    expect(app().querySelector("#ask")).toBeNull();
    expect(byId("reason").value).toBe("Pause this agent");
    expect(app().querySelectorAll("select").map((s) => s.value)).toEqual(["on", "on"]);
  });

  it("drafts rules from the CFO's words and links the drafted proposal; Ask Purser links the card it proposed", async () => {
    await open({ page: "policy", pathname: "/policy" }, () => {
      relay("/api/approvals", { status: 200, body: signedPolicy({ session_active: true }) });
      relay("/api/policy-text", { status: 500, body: { error: "runner busy" } }, { status: 202, body: { ticket: "W-1" } });
      relay("/api/tickets/W-1", { status: 200, body: { status: "drafted", message: "P-0042 drafted: 2 rules." } });
      relay("/api/ask", { status: 500, body: {} }, { status: 202, body: { ticket: "A-1" } });
      relay("/api/tickets/A-1", { status: 200, body: { status: "answered", message: "I proposed P-0043: a card for the flight." } });
    });
    const draft = button("Draft rules from my words");
    await press(draft);
    expect(textOf(app().querySelectorAll(".policy-words .drafted")[1])).toBe("Write the policy first.");
    byId("words").value = "Refunds above 0.05 I want to see.";
    await press(draft);
    expect(textOf(app().querySelectorAll(".policy-words .drafted")[1])).toBe("runner busy");
    byId("words").value = "x".repeat(130);
    await press(draft);
    const link = app().querySelectorAll("a.confirm").find((a) => a.href === "/approve/P-0042")!;
    expect(link.hidden).toBe(false);
    expect(textOf(app())).toContain(`"${"x".repeat(120)}…"`);

    const ask = button("Ask");
    await press(ask);
    expect(textOf(app())).toContain("Write what you need first.");
    byId("ask").value = "Book a flight to Berlin, at most 250.";
    await press(ask);
    expect(textOf(app())).toContain("The relay did not take the message.");
    await press(ask);
    expect(app().querySelectorAll("a.confirm").some((a) => a.href === "/approve/P-0043" && !a.hidden)).toBe(true);
  });
});
