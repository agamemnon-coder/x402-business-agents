// The GDPR record of processing (src/compliance/gdpr.ts, docs/compliance/gdpr.md): every Secret and Restricted row of
// the data classification's inventory belongs to exactly one processing activity, every recipient is a provider of the
// third-party register, the transfers come from its locations (the United States ones flagged, with no mechanism), the
// rights the page names are routes Purser Cloud has, and the page shows the record as the code holds it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockOf } from "../src/compliance/controls.js";
import { ACTIVITIES, inventory, ropaMarkdown, transfers } from "../src/compliance/gdpr.js";
import { loadRegister } from "../src/compliance/thirdParties.js";

describe("the record of processing activities", () => {
  it("covers every Secret and Restricted row of the classification once", () => {
    const rows = inventory();
    expect(rows.length).toBeGreaterThan(30);
    const personal = rows.filter((r) => r.level === "Secret" || r.level === "Restricted").map((r) => r.tables[0]!);
    const assigned = ACTIVITIES.flatMap((a) => a.rows);
    expect(new Set(assigned).size, "a row in two activities").toBe(assigned.length);
    expect(personal.filter((t) => !assigned.includes(t)), "rows in no activity").toEqual([]);
    expect(assigned.filter((t) => !personal.includes(t)), "activity rows that are not Secret or Restricted rows").toEqual([]);
  });

  it("names recipients from the register, and flags the transfers to the United States", () => {
    const ids = new Set(loadRegister().providers.map((p) => p.id));
    for (const a of ACTIVITIES) for (const id of a.recipients) expect(ids.has(id), `${a.id}: ${id}`).toBe(true);
    expect(transfers().filter((t) => t.third_country).map((t) => t.id).sort()).toEqual(["anthropic", "resend", "twilio"]);
  });

  it("is on docs/compliance/gdpr.md as the code holds it, with the rights' routes Purser Cloud has", () => {
    const page = readFileSync("docs/compliance/gdpr.md", "utf8");
    expect(blockOf(page, "ropa")).toBe(ropaMarkdown());
    const cloud = ["cloud/src/app.ts", "cloud/src/securityAudit.ts", "cloud/src/apiSpec.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    for (const route of ["GET /v1/me", "POST /v1/users/{id}/erase", "POST /v1/offboarding", "POST /v1/export/staged", "GET /v1/export/csv/{format}/{kind}"]) {
      expect(page, route).toContain(route.split(" ")[1]!);
      expect(cloud, route).toContain(route);
    }
  });
});
