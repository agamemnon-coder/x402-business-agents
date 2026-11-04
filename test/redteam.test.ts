// The red team's attacks (security item 4), each in a fresh throwaway world: every one must be blocked, and the
// verdict comes from the ledger, not from the error text. npm run redteam runs the same attacks with a model
// choosing them and writing documents of its own.
import { describe, expect, it } from "vitest";
import { ATTACKS, runAttack } from "../src/redteam/attacks.js";
import { redTeamWorld } from "../src/redteam/world.js";

describe("red team", () => {
  it("has an attack for each kind of threat the CFO asks about", () => {
    expect(new Set(ATTACKS.map((a) => a.category))).toEqual(new Set(["approval", "money", "documents", "policy", "outside agent", "ledger"]));
    expect(new Set(ATTACKS.map((a) => a.id)).size).toBe(ATTACKS.length);
  });

  for (const a of ATTACKS) {
    it(`blocks: ${a.title}`, async () => {
      const r = await runAttack(await redTeamWorld(), a);
      expect(r, `${r.id}: ${r.evidence}`).toMatchObject({ blocked: true });
    });
  }
});
