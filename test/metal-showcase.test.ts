import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { mandateViews, metalShowcase, OTHER_RUNS } from "../src/metal/showcase.js";

const T = (n: number) => `0x${String(n).padStart(64, "0")}`;
const at = (iso: string) => new Date(iso);
const OWNER = "0x00000000000000000000000000000000000000b1";
const SUPPLIER = "0x00000000000000000000000000000000000000c5";

/** A ledger with the sourcing mandate bound, two purchases, a refusal on chain, a replacement and one more purchase. */
function world() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'supplier')").run(SUPPLIER);
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00", payee: SUPPLIER, principal: OWNER, tx: T(1) }, at("2026-10-29T21:00:00Z"));
  const buy = db.prepare("INSERT INTO upstream_purchases (price_cents, tx_hash, outcome, refusal_reason, created_at) VALUES (?, ?, ?, ?, ?)");
  buy.run(2, T(2), "PAID", null, "2026-10-30T07:00:00Z");
  buy.run(2, T(3), "PAID", null, "2026-10-30T07:01:00Z");
  buy.run(0, null, "REFUSED", "mandate_cap_exceeded", "2026-10-30T07:02:00Z");
  audit(db, "sourcing", "upstream.refused", "3", { reason: "mandate_cap_exceeded", seq: 3 }, at("2026-10-30T07:02:00Z"));
  audit(db, "owner-signer", "mandate.replaced", "sourcing", { cap: "0.04", budget: "12.00", proposal_id: "P-0002", tx: T(4) }, at("2026-10-30T07:10:00Z"));
  buy.run(4, T(5), "PAID", null, "2026-10-30T07:11:00Z");
  return db;
}

describe("How Purser uses Metal (/metal)", () => {
  it("shows a mandate as the chain enforces it now: the latest limits, with the spend carried over", () => {
    const [m] = mandateViews(world());
    expect(m).toMatchObject({ role: "sourcing", agent: "Operations agent", cap: "0.04", budget: "12.00", used: "0.08", left: "11.92", count: 3 });
    expect(m!.payee.name).toBe("Stockline, the warehouse API");
    // The expiry runs from the latest binding: 40 days.
    expect(m!.expires_at).toBe("2026-12-09T07:10:00.000Z");
    expect(m!.history.map((h) => [h.cap, h.tx?.href?.endsWith(T(1).slice(2)) || h.tx?.href?.endsWith(T(4).slice(2))])).toEqual([["0.03", true], ["0.04", true]]);
    expect(m!.latest[0]).toMatchObject({ amount: "0.04" });
    expect(m!.refusal?.reason).toBe("mandate_cap_exceeded");
    expect(m!.refusal?.plain).toMatch(/above the mandate's cap per payment/);
  });

  it("lists only what the ledger proves: no Dispute desk card without a case, no mandates card without a binding", () => {
    const s = metalShowcase(world());
    const ids = s.features.map((f) => f.id);
    expect(ids).toContain("mandates");
    expect(ids).toContain("replace");
    expect(ids).not.toContain("dispute");
    expect(ids).not.toContain("verify");
    expect(s.dispute).toBeNull();
    const empty = metalShowcase(openDb(":memory:"));
    expect(empty.mandates).toEqual([]);
    expect(empty.features.map((f) => f.id)).toEqual(["clearing", "receive"]);
  });

  it("every proof from a separate run is a transaction docs/metal-award.md records, and the page says which run", () => {
    const dossier = readFileSync(new URL("../docs/metal-award.md", import.meta.url), "utf8");
    for (const run of Object.values(OTHER_RUNS)) {
      expect(run.source).toMatch(/separate live run/);
      for (const p of run.proofs) expect(dossier).toContain(p.tx);
    }
  });

  it("every proof link points at Metal's testnet explorer", () => {
    for (const f of metalShowcase(world()).features) {
      for (const p of f.proofs) if (p.href && !p.href.startsWith("#")) expect(p.href).toMatch(/^https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/);
      for (const d of f.docs) expect(d.href).toMatch(/^https:\/\/docs\.metalntwx\.com\//);
    }
  });
});

describe("the recorded case's evidence report (/metal/report)", () => {
  it("runs under a CSP with only its own style: no script, no style attribute", async () => {
    const { METAL_REPORT, METAL_REPORT_CSP, METAL_PAGE } = await import("../src/servers/dashboard.js");
    expect(METAL_REPORT).toMatch(/<h1>Your dispute DD-/);
    expect(METAL_REPORT).not.toMatch(/<script|\sstyle="/);
    expect(METAL_REPORT_CSP).toMatch(/^default-src 'none'; style-src 'sha256-/);
    expect(METAL_REPORT_CSP).not.toMatch(/script-src/);
    expect(METAL_PAGE).not.toContain("__METAL_JSON__");
  });
});
