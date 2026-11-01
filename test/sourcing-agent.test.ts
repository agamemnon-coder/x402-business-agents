// The Sourcing agent meets the supplier's price rise itself (Haiku, with tools): it checks the live offer against its
// mandate, tries the purchase for the next customer query, sees Metal refuse it, and tells the Treasury agent in its
// own words. Metal's refusal on chain is the limit; the agent cannot raise its cap. Fake client only.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { meetPriceRise, type SourcingDeps } from "../src/agents/sourcingAgent.js";

function deps(): SourcingDeps & { tries: number; told: string[] } {
  const d = {
    tries: 0, told: [] as string[],
    offer: async () => ({ liveCents: 4, capCents: 3, budgetLeftCents: 920 }),
    tryPurchase: async () => { d.tries++; return { seq: 41, refused: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", charged: false }; },
    notify: (m: string) => { d.told.push(m); },
  };
  return d;
}

function fake(turns: { name: string; input: unknown }[][], last = "Metal refused the 0.04 purchase; I told Treasury."): Anthropic {
  let i = 0;
  return {
    beta: { messages: { create: async () => {
      const t = turns[i++];
      const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      if (!t) return { content: [{ type: "text", text: last }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
      return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
    } } },
  } as unknown as Anthropic;
}

describe("the Sourcing agent meets the price rise", () => {
  it("checks the offer, tries the purchase, sees the refusal and tells Treasury itself", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const r = await meetPriceRise(db, { oldCents: 2, noticeCents: 4 }, d, fake([
      [{ name: "check_offer", input: {} }],
      [{ name: "try_purchase", input: {} }],
      [{ name: "notify_treasury", input: { message: "Stockline now charges 0.04, my cap is 0.03: Metal refused stock check #41. I need a cap of at least 0.04." } }],
    ]));
    expect(r).toMatchObject({ source: "claude", tried: true, refusal: expect.stringMatching(/mandate_cap_exceeded/) });
    expect(d.tries).toBe(1);
    expect(d.told[0]).toMatch(/0\.04/);
    expect(r.message).toMatch(/0\.04/);
  });

  // dry-18: Haiku checked the offer and wrote to Treasury without trying the purchase, so code had to take over. Treasury
  // needs Metal's answer, not the notice: the message is refused until the purchase was tried, and the agent goes on.
  it("may not tell Treasury before it tried the purchase; it tries, then tells", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const r = await meetPriceRise(db, { oldCents: 2, noticeCents: 4 }, d, fake([
      [{ name: "check_offer", input: {} }],
      [{ name: "notify_treasury", input: { message: "Stockline will charge 0.04; I need a cap of 0.04." } }],
      [{ name: "try_purchase", input: {} }],
      [{ name: "notify_treasury", input: { message: "Metal refused #41 at 0.04 over my 0.03 cap; I need a cap of 0.04." } }],
    ]));
    expect(r.run.calls.map((c) => c.blocked ?? "ok")).toEqual(["ok", "not tried yet", "Metal mandate", "ok"]);
    expect(d.told).toEqual(["Metal refused #41 at 0.04 over my 0.03 cap; I need a cap of 0.04."]);
    expect(r).toMatchObject({ source: "claude", tried: true });
  });

  // dry-26: Haiku wrote to Treasury, code refused it ("not tried yet"), and Haiku simply stopped. Code now sends it back
  // once with the reason when it ends unfinished; then it tries and tells.
  it("is sent back once with the reason when it stops before trying, and then tries and tells", async () => {
    const db = openDb(":memory:");
    const d = deps();
    let i = 0;
    const prompts: string[] = [];
    const turns = [
      [{ name: "check_offer", input: {} }],
      [{ name: "notify_treasury", input: { message: "Stockline will charge 0.04." } }],
      null, // stops here, without trying
      [{ name: "try_purchase", input: {} }],
      [{ name: "notify_treasury", input: { message: "Metal refused #41 at 0.04 over my 0.03 cap; I need 0.04." } }],
    ];
    const client = { beta: { messages: { create: async (p: { messages: { role: string; content: unknown }[] }) => {
      const last = p.messages.at(-1)!;
      if (last.role === "user" && typeof last.content === "string") prompts.push(last.content);
      const t = turns[i++];
      const usage = { input_tokens: 1, output_tokens: 1 };
      if (!t) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
      return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
    } } } } as unknown as Anthropic;
    const r = await meetPriceRise(db, { oldCents: 2, noticeCents: 4 }, d, client);
    expect(prompts.some((x) => /not finished/i.test(x) && /try_purchase/.test(x))).toBe(true);
    expect(r).toMatchObject({ source: "claude", tried: true });
    expect(d.told).toEqual(["Metal refused #41 at 0.04 over my 0.03 cap; I need 0.04."]);
  });

  it("is sent back at most once: an agent that stops again falls back to code", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const r = await meetPriceRise(db, { oldCents: 2, noticeCents: 4 }, d, fake([[{ name: "check_offer", input: {} }]]));
    expect(r.source).toBe("fallback");
    expect(r.run.turns).toBe(3);
  });

  it("tries the purchase only once", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const r = await meetPriceRise(db, { oldCents: 2, noticeCents: 4 }, d, fake([[{ name: "try_purchase", input: {} }], [{ name: "try_purchase", input: {} }]]));
    expect(d.tries).toBe(1);
    expect(r.run.calls[1]).toMatchObject({ blocked: "one try" });
  });

  it("leaves the purchase and the message to code when the agent is not there", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const r = await meetPriceRise(db, { oldCents: 2, noticeCents: 4 }, d, null);
    expect(r).toMatchObject({ source: "fallback", tried: false });
    expect(d.tries).toBe(0);
  });

  it("counts as not decided when the agent never tried the purchase", async () => {
    const db = openDb(":memory:");
    const r = await meetPriceRise(db, { oldCents: 2, noticeCents: 4 }, deps(), fake([[{ name: "check_offer", input: {} }]], "I will wait."));
    expect(r.source).toBe("fallback");
  });
});
