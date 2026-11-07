// A new run's runner key (Max, 7 Nov: he opened a new run's link on a phone that still knew the last run's key, and
// had to close all private tabs to recover). The phone keeps its pinned key until the person presses "This is a new
// run: use the new key", on a link that carries that key, and only when that key signed what the relay sends now.
// A payload signed by any other key, or by none, is refused whatever is pressed.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freshEnough, judgeRunnerKey, runnerKeyFingerprint, takeRunnerKey, useNewRunnerKey, verifyRunnerSignature } from "../src/approve/client.js";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal } from "../src/policy/approvals.js";
import { displayKey, displayKeyFingerprint, signApprovals, type DisplayKey } from "../src/relay/sign.js";
import { buildRelayState } from "../src/relay/state.js";

const t0 = new Date("2026-11-07T14:00:00Z");
const key = (): DisplayKey => displayKey(join(mkdtempSync(join(tmpdir(), "kit11-runner-key-")), "relay-display-key.pem"));
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};

/** What the relay hands the phone: one waiting proposal, signed by `by` (or by no one). */
function approvals(by: DisplayKey | null, seq?: number) {
  const db = openDb(":memory:");
  createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-07T15:00:00Z", total: "0.15" } as Terms, createdBy: "support" }, t0);
  const state = buildRelayState(db, { rpId: "r.example", relayToken: "t" }, t0);
  const a = seq === undefined ? state.approvals : { ...state.approvals, ledger_seq: seq };
  return { ...(by ? signApprovals(a, by) : a), generated_at: "x", relay: { age_ms: 1 }, enrolment_open: false } as unknown as Record<string, unknown>;
}

const old = key(); // the last run's runner
const fresh = key(); // this run's runner
const press = { isTrusted: true }; // a click the browser marks as the person's own

describe("a new run's runner key: replaced only by the person's press", () => {
  it("shows both fingerprints' keys, and one press on the link's key replaces the pin; the page then verifies with it", async () => {
    const store = mem();
    takeRunnerKey(`#view=${"ab".repeat(16)}&runner=${old.publicSpki}`, store);
    expect(freshEnough(900, store)).toBe(true); // the last run's ledger had counted far
    const pin = takeRunnerKey(`#view=${"cd".repeat(16)}&runner=${fresh.publicSpki}`, store);
    expect(pin).toEqual({ key: old.publicSpki, offered: fresh.publicSpki });
    expect(store.getItem("kit11.runner")).toBe(old.publicSpki); // the link alone changed nothing

    const now = approvals(fresh, 12);
    const v = await judgeRunnerKey(now, pin);
    expect(v).toEqual({ state: "new_run", pinned: old.publicSpki, offered: fresh.publicSpki });
    expect(await runnerKeyFingerprint(old.publicSpki)).toBe(displayKeyFingerprint(old.publicSpki));
    expect(await runnerKeyFingerprint(fresh.publicSpki)).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(await runnerKeyFingerprint(fresh.publicSpki)).not.toBe(await runnerKeyFingerprint(old.publicSpki));

    const next = useNewRunnerKey(v, press, store);
    expect(next).toEqual({ key: fresh.publicSpki, offered: null });
    expect(store.getItem("kit11.runner")).toBe(fresh.publicSpki);
    // Later pages, without any link, use the new key; the new run's ledger counts from its own start.
    const later = takeRunnerKey("", store);
    expect(later).toEqual({ key: fresh.publicSpki, offered: null });
    expect(await judgeRunnerKey(now, later)).toEqual({ state: "signed", key: fresh.publicSpki });
    expect(freshEnough(12, store)).toBe(true);
    // And the last run's state, replayed by a relay, is no longer accepted.
    expect((await judgeRunnerKey(approvals(old, 950), later)).state).toBe("unsigned");
  });

  it("keeps the offer of the viewer link opened on the dashboard for the approval page opened from Claude's message", async () => {
    const store = mem();
    takeRunnerKey(`#runner=${old.publicSpki}`, store);
    takeRunnerKey(`#runner=${fresh.publicSpki}`, store); // the dashboard tab
    const pin = takeRunnerKey("", store); // the approval page, another tab, no fragment
    expect(pin).toEqual({ key: old.publicSpki, offered: fresh.publicSpki });
    const v = await judgeRunnerKey(approvals(fresh), pin);
    expect(v.state).toBe("new_run");
    expect(useNewRunnerKey(v, press, store)?.key).toBe(fresh.publicSpki);
  });
});

describe("a new run's runner key: refused without the person's explicit press", () => {
  it("changes nothing for no press, a script's click, or a verdict that is not a new run", async () => {
    const store = mem();
    takeRunnerKey(`#runner=${old.publicSpki}`, store);
    const pin = takeRunnerKey(`#runner=${fresh.publicSpki}`, store);
    const v = await judgeRunnerKey(approvals(fresh), pin);
    expect(v.state).toBe("new_run");
    for (const p of [null, undefined, { isTrusted: false }]) expect(useNewRunnerKey(v, p, store)).toBeNull();
    expect(useNewRunnerKey({ state: "signed", key: fresh.publicSpki }, press, store)).toBeNull();
    expect(store.getItem("kit11.runner")).toBe(old.publicSpki);
    // Opening the link again and again never replaces the pin by itself: the page keeps asking.
    for (let i = 0; i < 3; i++) expect(takeRunnerKey(`#runner=${fresh.publicSpki}`, store).key).toBe(old.publicSpki);
    expect((await judgeRunnerKey(approvals(fresh), takeRunnerKey("", store))).state).toBe("new_run");
  });

  it("keeps the pinned key, and offers nothing, while the relay's answer is signed by it", async () => {
    const store = mem();
    takeRunnerKey(`#runner=${old.publicSpki}`, store);
    const pin = takeRunnerKey(`#runner=${fresh.publicSpki}`, store);
    const v = await judgeRunnerKey(approvals(old), pin);
    expect(v).toEqual({ state: "signed", key: old.publicSpki });
    expect(useNewRunnerKey(v, press, store)).toBeNull();
    expect(store.getItem("kit11.runner")).toBe(old.publicSpki);
  });
});

describe("a new run's runner key: an unsigned or other-key payload is refused", () => {
  it("refuses a payload signed by a key that is neither pinned nor offered by the link, whatever is pressed", async () => {
    const store = mem();
    takeRunnerKey(`#runner=${old.publicSpki}`, store);
    const pin = takeRunnerKey(`#runner=${fresh.publicSpki}`, store);
    const v = await judgeRunnerKey(approvals(key()), pin);
    expect(v).toEqual({ state: "unsigned" });
    expect(useNewRunnerKey(v, press, store)).toBeNull();
    expect(store.getItem("kit11.runner")).toBe(old.publicSpki);
  });

  it("refuses an unsigned payload, and one the relay changed after the new key signed it", async () => {
    const store = mem();
    takeRunnerKey(`#runner=${old.publicSpki}`, store);
    const pin = takeRunnerKey(`#runner=${fresh.publicSpki}`, store);
    expect(await judgeRunnerKey(approvals(null), pin)).toEqual({ state: "unsigned" });
    const signedByFresh = approvals(fresh);
    const p0 = (signedByFresh.proposals as { canonical: string }[])[0]!;
    const changed = { ...signedByFresh, proposals: [{ ...p0, canonical: p0.canonical.replace("0.15", "9.15") }] };
    expect(await verifyRunnerSignature(changed, fresh.publicSpki)).toBe(false);
    const v = await judgeRunnerKey(changed, pin);
    expect(v).toEqual({ state: "unsigned" });
    expect(useNewRunnerKey(v, press, store)).toBeNull();
  });

  it("never offers a key no link carried: a payload signed by a new key, with no offer on the device, is refused", async () => {
    const store = mem();
    takeRunnerKey(`#runner=${old.publicSpki}`, store);
    const pin = takeRunnerKey("", store);
    expect(pin.offered).toBeNull();
    expect(await judgeRunnerKey(approvals(fresh), pin)).toEqual({ state: "unsigned" });
    // A fragment that is not a key offers nothing either.
    expect(takeRunnerKey("#runner=<script>alert(1)</script>", store)).toEqual({ key: old.publicSpki, offered: null });
  });
});
