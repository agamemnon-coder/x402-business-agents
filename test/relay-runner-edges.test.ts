// The runner's side of the relay (src/relay/runner.ts), against a scripted relay: a refused sync keeps the verdicts for
// the next one (and names a wrong relay token); a ticket is handled once; a submission the runner cannot take (no
// drafter, no Ask Purser, malformed text, an unexpected error, a failing model) is refused on its own ticket with a
// reason and no credential in it; a relay that lost its copy gets the whole state again; a webhook is acked once.
import { describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/open.js";
import type { InboxItem } from "../src/passkey/process.js";
import { RelayRunner, type Ack } from "../src/relay/runner.js";

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-10-30T10:00:00Z");
type Sync = { state_hash: string; state?: unknown; acks: Ack[]; hook_acks: string[] };

/** A relay that answers each sync with the next scripted answer, recording what the runner sent. */
function relay(answers: (Response | (() => Response))[]) {
  const sent: Sync[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sent.push(JSON.parse(String(init!.body)) as Sync);
    const a = answers.shift();
    if (!a) throw new Error("no answer scripted");
    return typeof a === "function" ? a() : a;
  }) as typeof fetch;
  return { sent, fetch: fetchImpl };
}
const ok = (inbox: InboxItem[] = [], o: { need_state?: boolean; hooks?: unknown[] } = {}) => new Response(JSON.stringify({ need_state: o.need_state ?? false, inbox, hooks: o.hooks ?? [] }), { status: 200 });
const item = (ticket: string, kind: string, body: string) => ({ ticket, kind, body, received_at: t0.toISOString() }) as unknown as InboxItem;

function runner(answers: (Response | (() => Response))[], extra: Partial<ConstructorParameters<typeof RelayRunner>[0]> = {}) {
  const r = relay(answers);
  const log: string[] = [];
  const run = new RelayRunner({ db: openDb(":memory:"), cfg: { url: BASE, origin: BASE, rpId: "kit11.example.workers.dev", token: TOKEN }, now: () => t0, fetch: r.fetch, execute: async () => undefined, log: (l) => log.push(l), ...extra });
  return { run, sent: r.sent, log };
}

describe("the runner's syncs", () => {
  it("a refused sync names a wrong token and keeps the verdicts for the next sync", async () => {
    const { run, sent } = runner([ok([item("tk1", "policy_text", JSON.stringify({ text: "x" }))]), new Response("no", { status: 401 }), new Response("no", { status: 503 }), ok()]);
    await run.syncOnce();
    await expect(run.syncOnce()).rejects.toThrow("the relay answered 401 (wrong relay token: redeploy with npm run relay:deploy)");
    await expect(run.syncOnce()).rejects.toThrow(/^the relay answered 503$/);
    await run.syncOnce();
    // The verdict on tk1 was offered with each failed sync and delivered with the last.
    expect(sent.map((s) => s.acks.map((a) => a.ticket))).toEqual([[], ["tk1"], ["tk1"], ["tk1"]]);
    expect(sent[3]!.acks[0]).toMatchObject({ status: "refused", message: "this runner does not draft rules from text" });
  });

  it("pushes the state once while nothing changes, and again when the relay says it lost it", async () => {
    const { run, sent } = runner([ok([], { need_state: true }), ok(), ok()]);
    await run.syncOnce();
    await run.syncOnce();
    await run.syncOnce();
    expect(sent.map((s) => "state" in s)).toEqual([true, true, false]);
  });

  it("handles a ticket once even when the relay hands it over again", async () => {
    const twice = item("tk1", "ask", JSON.stringify({ text: "hello" }));
    const { run, sent } = runner([ok([twice]), ok([twice]), ok()]);
    await run.syncOnce();
    await run.syncOnce();
    await run.syncOnce();
    expect(sent.flatMap((s) => s.acks).filter((a) => a.ticket === "tk1")).toHaveLength(1);
  });
});

describe("submissions the runner refuses on their own ticket", () => {
  it("chat without Ask Purser, and malformed text to a runner that has a drafter or Ask Purser", async () => {
    const { run, sent } = runner([
      ok([item("a1", "ask", JSON.stringify({ text: "hi" })), item("a2", "ask", "{not json"), item("d1", "policy_text", JSON.stringify({ text: 5 }))]),
      ok(),
    ], { draftPolicy: async () => ({ proposalId: null, message: "never" }) });
    await run.syncOnce();
    await run.syncOnce();
    expect(sent[1]!.acks.map((a) => [a.ticket, a.message])).toEqual([
      ["a1", "this runner does not take chat messages"],
      ["a2", "this runner does not take chat messages"],
      ["d1", "malformed submission"],
    ]);
  });

  it("a model that fails, or a draft that becomes nothing, is a refusal saying so; a reply is an answer", async () => {
    const { run, sent } = runner([
      ok([item("a1", "ask", JSON.stringify({ text: "pay everyone" })), item("a2", "ask", JSON.stringify({ text: "x" })), item("d1", "policy_text", JSON.stringify({ text: "cap 0.03" })), item("d2", "policy_text", JSON.stringify({ text: "y" }))]),
      ok(),
    ], {
      ask: async (text) => { if (text === "x") return { proposalId: null, reply: "nothing to do" }; throw new Error("overloaded"); },
      draftPolicy: async (text) => { if (text === "y") return { proposalId: "P-0007", message: "drafted P-0007" }; throw new Error("model timeout"); },
    });
    await run.syncOnce();
    await run.idle();
    await run.syncOnce();
    const acks = Object.fromEntries(sent[1]!.acks.map((a) => [a.ticket, [a.status, a.message]]));
    expect(acks).toEqual({
      a1: ["refused", "Purser could not answer (overloaded); nothing changed"],
      a2: ["answered", "nothing to do"],
      d1: ["refused", "the runner could not draft rules from this text (model timeout); nothing changed"],
      d2: ["drafted", "drafted P-0007"],
    });
  });

  it("an unexpected error is a refusal with the error's words, with any credential in them redacted", async () => {
    // The redactor knows credentials by their values in the environment, and any bearer token by its form.
    const secret = `sk-ant-api03-${"x".repeat(60)}`;
    vi.stubEnv("KIT11_ANTHROPIC_API_KEY", secret);
    const { run, sent, log } = runner([ok([item("d1", "policy_text", JSON.stringify({ text: "cap" }))]), ok()], {
      draftPolicy: (() => { throw new Error(`the drafter broke with key ${secret} and header Bearer abc.def-123`); }) as never,
    });
    await run.syncOnce();
    await run.syncOnce();
    const ack = sent[1]!.acks[0]!;
    expect(ack).toMatchObject({ ticket: "d1", status: "refused" });
    expect(ack.message).toMatch(/^the runner could not process this submission \(the drafter broke with key .*\); nothing was approved$/);
    expect(ack.message).not.toContain(secret);
    expect(ack.message).toContain("[redacted] and header Bearer [redacted]");
    expect(log.join("\n")).not.toContain(secret);
    vi.unstubAllEnvs();
  });
});

describe("webhooks the relay kept", () => {
  it("are handled once and acked; without a handler they stay on the relay", async () => {
    const hooks = [{ id: "h1", name: "issuing.card.active", body: "{}" }, { id: "h2", name: "x", body: "{}" }, { id: "h1", name: "issuing.card.active", body: "{}" }];
    const seen: string[] = [];
    const { run, sent, log } = runner([ok([], { hooks }), ok(), ok()], { onHook: (h) => { seen.push(h.id); return `recorded ${h.id}`; } });
    await run.syncOnce();
    await run.syncOnce();
    expect(seen).toEqual(["h1", "h2"]);
    expect(sent[1]!.hook_acks).toEqual(["h1", "h2"]);
    expect(log).toContain("hook     recorded h1");
    const bare = runner([ok([], { hooks }), ok()]);
    await bare.run.syncOnce();
    await bare.run.syncOnce();
    expect(bare.sent[1]!.hook_acks).toEqual([]);
  });
});
