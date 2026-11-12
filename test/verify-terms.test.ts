// "Verify" per approval and payment (master list 686): the browser's own code, run here in Node, says the stored terms
// hash to the signed hash, and says "Does not match" for tampered terms. Records without full terms get no button.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIGNED_FILES, VERIFY_TERMS_CORE, VERIFY_TERMS_JS, VERIFY_WORDS, signedByRun, termsMatch, verifyItem, verifyList } from "../src/redesign/verifyTerms.js";

const core = new Function(`${VERIFY_TERMS_CORE}; return { vfVerdict: vfVerdict, vfCanonical: vfCanonical };`)() as {
  vfVerdict: (json: string, hash: string) => Promise<"match" | "mismatch">; vfCanonical: (v: unknown) => string;
};
const receipt = JSON.parse(readFileSync(new URL(`../${SIGNED_FILES.awx1}`, import.meta.url), "utf8")) as { terms: Record<string, unknown>; terms_sha256: string };

describe("verify the signed terms", () => {
  it("the browser's code says the stored terms match the signed hash", async () => {
    expect(await core.vfVerdict(JSON.stringify(receipt.terms), receipt.terms_sha256)).toBe("match");
  });

  it("tampered terms do not match", async () => {
    const tampered = { ...receipt.terms, amount: "2400.00" };
    expect(await core.vfVerdict(JSON.stringify(tampered), receipt.terms_sha256)).toBe("mismatch");
    const iban = { ...receipt.terms, iban_last4: "9999" };
    expect(await core.vfVerdict(JSON.stringify(iban), receipt.terms_sha256)).toBe("mismatch");
  });

  it("key order does not matter; the canonical form decides", async () => {
    const reversed = Object.fromEntries(Object.entries(receipt.terms).reverse());
    expect(await core.vfVerdict(JSON.stringify(reversed), receipt.terms_sha256)).toBe("match");
  });

  const runs = signedByRun();
  it("every button on /runs carries terms that hash to their signed hash", () => {
    const all = Object.values(runs).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) if (s.terms) expect(termsMatch(s.terms, s.hash)).toBe(true);
    for (const s of all) if (!s.terms) expect(verifyItem(s)).not.toContain('class="vfb"');
  });

  it("awx-1 and the platform run carry their payout ids; the Metal run its transactions", () => {
    expect(runs["awx-1"]?.[0]?.ref?.value).toBe("738a4263-6d6c-4de8-94a3-93da1c175fb4");
    expect(runs["awx-1"]?.[0]?.terms).not.toBeNull();
    expect(runs["platform-e2e-1"]?.[0]?.ref?.value).toBe("593c340b-1752-4537-9ef2-0eb3558897cc");
    const metal = runs["faceid-onchain-1"] ?? [];
    expect(metal.map((s) => s.id)).toEqual(["P-0001", "P-0002", "P-0003"]);
    const md = readFileSync(new URL("../docs/runs/2026-11-12-faceid-onchain.md", import.meta.url), "utf8");
    for (const s of metal) {
      expect(md).toContain(s.hash);
      expect(s.ref?.href).toMatch(/^https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/);
      expect(md).toContain(s.ref!.href!);
      expect(verifyItem(s)).toContain(VERIFY_WORDS.hashOnly);
    }
  });

  it("a shortened published copy says so and never shows a false mismatch", () => {
    const short = (runs["main-1"] ?? []).filter((s) => !s.terms);
    for (const s of short) expect(verifyItem(s)).toContain(VERIFY_WORDS.shortened);
  });

  it("renders the hash last and nothing for a run without approvals", () => {
    const html = verifyItem(runs["awx-1"]![0]!);
    expect(html.lastIndexOf("vfh")).toBeGreaterThan(html.indexOf("vfb"));
    expect(html).not.toMatch(/<\/script>(?![\s\S]*<span class="vfr">)[\s\S]*<script/);
    expect(verifyList(undefined)).toBe("");
    expect(VERIFY_TERMS_JS).not.toMatch(/`|\$\{/);
  });
});
