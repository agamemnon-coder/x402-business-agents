// The two banks of a company's engine behind one rail (cloud/src/engine/awxWire.ts), in a deployment without kit11's
// gateway: a step that moves no money is refused by the missing gateway and taken by the simulated bank, labelled in
// the company's notes; the payee's bank check is answered by the stand-in, labelled; outside an action at Airwallex
// there is no batch rail. The guard here lets everything through, so what refuses is the missing gateway itself.
import { describe, expect, it } from "vitest";
import { wireAirwallex } from "../cloud/src/engine/awxWire.js";
import type { ActGuard } from "../src/airwallex/routedRail.js";
import { memoryActStore } from "../src/engine/awxActions.js";
import { standInBank } from "../src/engine/standInBank.js";
import type { FakeAirwallex } from "../src/redteam/airwallex.js";

const open: ActGuard = { blocked: async () => null, spend: async () => undefined, release: async () => undefined };

describe("a deployment without the Airwallex gateway", () => {
  it("a step that moves no money goes to the simulated bank, with the gateway's refusal in the note at the given time", async () => {
    const store = memoryActStore();
    const bank = standInBank({ load: () => null, save: () => {} }) as unknown as FakeAirwallex;
    const w = wireAirwallex({ bank, store, guard: open, port: null, now: () => new Date("2026-11-10T09:00:00Z") });
    // An action at Airwallex: the gateway that is not there refuses, and the simulated bank answers instead.
    expect(await w.routed.within("airwallex", () => w.routed.usdGlobalAccountId())).toBe(await bank.usdGlobalAccountId());
    const [note] = store.notes();
    expect(note).toMatchObject({ at: "2026-11-10T09:00:00.000Z", what: "the USD account", bank: "simulated" });
    expect(note!.label).toMatch(/^the USD account on the simulated bank: .*(no Airwallex gateway|503)/);
    // Outside an action at Airwallex there is no batch rail; inside one, the rail is Airwallex's, behind the guard.
    expect(w.rails.batches).toBeUndefined();
    expect(await w.routed.within("airwallex", async () => w.rails.batches)).toBeDefined();
  });

  it("the payee's bank check is the stand-in's, labelled, on the real clock when none is given", async () => {
    const store = memoryActStore();
    const w = wireAirwallex({ bank: standInBank({ load: () => null, save: () => {} }) as unknown as FakeAirwallex, store, guard: open, port: null });
    const v = w.verifier();
    const check = await v.verifyAccount({ name: "Bergtex Textil GmbH", entity: "COMPANY", country: "DE", currency: "EUR", iban: "DE89370400440532013000" });
    expect(check).toBeTruthy();
    expect(v.source).toBe("stand-in");
    const [note] = store.notes();
    expect(note).toMatchObject({ what: "bank check", bank: "simulated", label: "the payee's bank was not asked through Airwallex (no Airwallex gateway in this deployment); the stand-in answered, labelled" });
    expect(Date.now() - Date.parse(note!.at)).toBeLessThan(60_000);
  });
});
