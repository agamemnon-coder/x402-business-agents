// The live commands of `npm run awx-depth` refuse to start without the owner's go, a counted call budget of at most 40,
// their own ledger and the company's own account. Breaks if any of those is dropped.
import { describe, expect, it } from "vitest";
import { AWX_DEPTH_MAX_BUDGET, awxDepthRefusals } from "../src/cli/awxDepthRefusals.js";

const ok = { AWX_DEPTH_GO: "yes", AIRWALLEX_CALL_BUDGET: "40", AIRWALLEX_CALL_LOG: "/tmp/x.jsonl", KIT11_DB: "data/awx-depth-1112.sqlite" };

describe("awx-depth live refusals", () => {
  it("runs with all four in place", () => expect(awxDepthRefusals(ok)).toEqual([]));
  it("refuses each missing or wider setting", () => {
    expect(awxDepthRefusals({ ...ok, AWX_DEPTH_GO: undefined }).join()).toMatch(/AWX_DEPTH_GO/);
    expect(awxDepthRefusals({ ...ok, AIRWALLEX_CALL_LOG: undefined }).join()).toMatch(/CALL_LOG/);
    expect(awxDepthRefusals({ ...ok, AIRWALLEX_CALL_BUDGET: String(AWX_DEPTH_MAX_BUDGET + 1) }).join()).toMatch(/at most 40/);
    expect(awxDepthRefusals({ ...ok, KIT11_DB: "data/kit11.sqlite" }).join()).toMatch(/awx-depth/);
    expect(awxDepthRefusals({ ...ok, AIRWALLEX_PLATFORM: "on" }).join()).toMatch(/own sandbox account/);
  });
});
