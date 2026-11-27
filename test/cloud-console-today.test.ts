// The console's `today` (review 153): the demo company's figures stand at its own last day, but leaving the demo without
// reloading the page (signing out, switching company, a passkey sign-in: each sets ME=null) must bring back the real day,
// or a real company's invoices read as overdue, or not, against the demo's calendar.
import { Script, createContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { scriptBlocks, scriptBody } from "./support/scriptBlocks.js";
import { ORIGIN, RP } from "./support/cloud.js";

const js = (() => {
  const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" });
  const blocks = scriptBlocks(html).filter((b) => !/src=|type="application\/json"/.test(b.slice(0, b.indexOf(">"))));
  return blocks.map(scriptBody).join("\n");
})();

/** One top-level line of the console's script, from where `start` begins to the end of its line. */
function line(start: string): string {
  const a = js.indexOf(start);
  expect(a, start).toBeGreaterThanOrEqual(0);
  return js.slice(a, js.indexOf("\n", a));
}

describe("the console's day", () => {
  it("is the demo's last day in the demo, and the real day again once the person leaves it", async () => {
    const real = new Date().toISOString().slice(0, 10);
    const answers = [{ demo: { as_of: "2026-10-31T23:59:59Z" }, user: null }, { demo: null, user: { language: null } }];
    const ctx = createContext({ api: async () => answers.shift(), langOf: () => "en", PREF: null, L: { lang: "en" }, useLanguage: () => undefined, ME: null });
    new Script(`${line("let today=")}\nvar ME=null;\n${line("async function me(){")}\nglobalThis.me=me;globalThis.day=()=>today;globalThis.leave=()=>{ME=null};`).runInContext(ctx);
    const c = ctx as unknown as { me: () => Promise<unknown>; day: () => string; leave: () => void };
    expect(c.day()).toBe(real);
    await c.me();
    expect(c.day()).toBe("2026-10-31");
    c.leave(); // sign-out, a company switch or a passkey sign-in
    await c.me();
    expect(c.day()).toBe(real);
  });
});
