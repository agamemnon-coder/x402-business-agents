// /metal's two record-driven sections (master list 585): "Face ID signs on chain" and "Invoice → token → pre-financing →
// settlement". Tested on fixture records only (test/fixtures), never on docs/runs. With a record every link is a real
// transaction link from the record; without one, one labelled line and the runbook. Never a placeholder hash.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPLORER_TX } from "../src/metal/network.js";
import { FACEID_RUNBOOK, FACEID_TITLE, METAL_ONCHAIN_CSS, NOT_RUN_YET, TOKEN_TITLE, TOKENIZE_RUNBOOK, faceIdOnChainSection, ownersSteps, tokenFlow, tokenFlowSection, tokenRunFile, ownersRunFile, type OwnersRecord } from "../src/redesign/metalOnchain.js";
import type { TokenizeRunRecord } from "../src/tokenize/runRecord.js";

const fx = <T>(name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
const owners = fx<OwnersRecord>("faceid-onchain-run.json");
const token = fx<TokenizeRunRecord>("tokenize-run.json");
const text = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const hrefs = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);

describe("Face ID signs on chain", () => {
  const html = faceIdOnChainSection({ file: "docs/runs/2026-11-12-faceid-onchain.json", rec: owners });

  it("shows bind, paid, refused, raised, paid, revoked: each with its transaction from the record", () => {
    const steps = ownersSteps(owners);
    expect(steps.map((s) => s.key)).toEqual(["bind", "paid", "refused", "replace", "paid", "revoke"]);
    const recTx = new Set(owners.steps.map((s) => s.tx).filter(Boolean));
    for (const s of steps) { expect(recTx.has(s.hash)).toBe(true); expect(s.href).toBe(`${EXPLORER_TX}${s.hash}`); }
    expect(text(html)).toContain("Refused 0.06");
    expect(text(html)).toContain("Raised: cap 0.10");
  });

  it("labels the stand-in, the network and the money next to it", () => {
    const t = text(html);
    expect(t).toContain(FACEID_TITLE);
    expect(t).toMatch(/Metal testnet · test money · second signer: labelled virtual test passkey · CFO's device as stated by the owner/);
  });

  it("links only Metal's explorer and the run record", () => {
    for (const h of hrefs(html)) expect(h).toMatch(/^(https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}|https:\/\/github\.com\/agamemnon-coder\/x402-business-agents\/blob\/main\/docs\/runs\/2026-11-12-faceid-onchain\.md)$/);
  });

  it("drops a step whose link is not Metal's explorer for exactly its hash", () => {
    const odd: OwnersRecord = { ...owners, steps: owners.steps.map((s) => s.kind === "refusal" ? { ...s, explorer: `https://evil.test/tx/${s.tx}` } : s) };
    expect(ownersSteps(odd).map((s) => s.key)).not.toContain("refused");
  });

  it("without a record: one labelled line and the runbook, no hash", () => {
    const none = faceIdOnChainSection(null);
    expect(text(none)).toBe(`${FACEID_TITLE}. ${NOT_RUN_YET} runbook ↗`);
    expect(hrefs(none)).toEqual([`https://github.com/agamemnon-coder/x402-business-agents/blob/main/${FACEID_RUNBOOK}`]);
    expect(none).not.toMatch(/0x[0-9a-f]{6}/);
  });
});

describe("Invoice → token → pre-financing → settlement", () => {
  const html = tokenFlowSection({ file: "docs/runs/2026-11-12-tokenize.json", rec: token });

  it("four steps, each transaction read from the record", () => {
    const nodes = tokenFlow(token);
    expect(nodes.map((n) => n.key)).toEqual(["invoice", "token", "financed", "settled"]);
    for (const k of ["mint", "accept", "settle"]) {
      const t = token.transactions.find((x) => x.key === k)!;
      expect(html).toContain(`${EXPLORER_TX}${t.hash}`);
    }
    expect(text(html)).toContain(`a simulated financier paid ${token.received.creditor}`);
    expect(text(html)).toContain(`the debtor paid ${token.received.holder} to the holder`);
  });

  it("labels prototype, testnet, test money, simulated financier and the scaling", () => {
    expect(text(html)).toMatch(new RegExp(`Prototype · Metal testnet · test money · financier simulated · amounts scaled down ${token.labels.face_value_scaled_by}× for testnet`));
    expect(text(html)).toContain("approved with a labelled test passkey");
  });

  it("a step whose transaction did not land shows as not run, without a link", () => {
    const partial = { ...token, transactions: token.transactions.filter((t) => t.key !== "settle") };
    const nodes = tokenFlow(partial);
    expect(nodes[3]).toMatchObject({ note: "not run", href: null, hash: null });
  });

  it("without a record: one labelled line and the runbook", () => {
    const none = tokenFlowSection(null);
    expect(text(none)).toBe(`${TOKEN_TITLE}. ${NOT_RUN_YET} runbook ↗`);
    expect(hrefs(none)).toEqual([`https://github.com/agamemnon-coder/x402-business-agents/blob/main/${TOKENIZE_RUNBOOK}`]);
  });
});

describe("the records", () => {
  it("finds the newest record by name only", () => {
    expect(ownersRunFile(["2026-11-12-faceid-onchain.json", "2026-11-13-faceid-onchain.json", "x.json"])).toBe("docs/runs/2026-11-13-faceid-onchain.json");
    expect(tokenRunFile(["2026-11-12-faceid-onchain.json"])).toBeNull();
  });
  it("styles with the site's tokens only", () => {
    expect(METAL_ONCHAIN_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
});
