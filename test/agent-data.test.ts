// Proof an agent can fetch and check (agent-surface, 12 Nov): /proof.json carries the runs, the guarantees and the
// agents' limits as data, every value read from the same functions the pages use; /receipt-sample.json serves one real
// signed receipt byte for byte, which anyone can verify offline; llms.txt points to both under "## For agents".
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_IDS, agentView } from "../src/redesign/agents.js";
import { proofData, RECEIPT_SAMPLE_FILE, REPOSITORY_URL } from "../src/redesign/agentData.js";
import { GUARANTEES } from "../src/redesign/guarantees.js";
import { EXPLORER, REPO_BLOB } from "../src/redesign/metalStory.js";
import { liveRuns } from "../src/redesign/runs.js";
import { buildPages } from "../src/relay/assets.js";
import { canonicalTerms, RECEIPT_MEANS, verifyReceipt } from "../src/try/receipt.js";
import { SITE_URL } from "../src/ui/meta.js";
import { COMMON_HEADERS, notFoundResponse, pageResponse, type Pages } from "../worker/src/core.js";
import { privateFindings } from "./support/privacyScan.js";

const root = (p: string) => new URL(`../${p}`, import.meta.url);
const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const get = (path: string, p: Pages = pages) => pageResponse(new Request(`https://kit11.example${path}`), p);
const doc = proofData();
const receiptText = readFileSync(root(RECEIPT_SAMPLE_FILE), "utf8");
const receipt = JSON.parse(receiptText) as { note: string; terms: Record<string, unknown>; terms_sha256: string; public_key: Record<string, string>; assertion: Record<string, string> };

/** Every string leaf of a JSON value, with the key it sits under. */
const leaves = (v: unknown, key = ""): [string, string][] => Array.isArray(v) ? v.flatMap((x) => leaves(x, key)) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => leaves(x, k)) : typeof v === "string" ? [[key, v]] : [];
const keys = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(keys) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];
const abs = (href: string) => href.startsWith("http") ? href : href.startsWith("../../") ? REPO_BLOB + href.slice(6) : `${SITE_URL}/${href}`;

describe("/proof.json", () => {
  it("is proofData() as JSON, served with the common headers and the JSON type", async () => {
    expect(JSON.parse(pages.proofJson!)).toEqual(proofData());
    expect(doc.schema).toBe("purser.proof/v1");
    const r = (await get("/proof.json"))!;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    for (const [k, v] of Object.entries(COMMON_HEADERS)) expect({ k, v: r.headers.get(k) }).toEqual({ k, v });
    expect(JSON.parse(await r.text())).toEqual(doc);
  });

  it("carries every live run as its liveRuns() row, every guarantee as GUARANTEES, each agent's limits as agentView()", () => {
    const rows = liveRuns();
    expect(doc.runs.length).toBe(rows.length);
    rows.forEach((row, i) => {
      const run = doc.runs[i]!;
      expect(run).toEqual({
        key: row.key, date_iso: row.iso, title: row.title, rails: row.rails, what: row.what, checks: row.checks, money: row.money,
        ids: row.ids.map((x) => ({ label: x.label, value: x.value, ...(x.href ? { url: abs(x.href) } : {}) })),
        records: row.files.map((f) => ({ label: f.label, url: abs(f.href) })),
        page: `${SITE_URL}/runs#${row.key}`,
      });
    });
    expect(doc.guarantees).toEqual(GUARANTEES.map((g) => ({
      id: g.id, promise: g.promise, enforced_by: g.by, how: g.how, source: REPO_BLOB + g.source, test: REPO_BLOB + g.test,
      evidence: { label: g.evidence.label, url: abs(g.evidence.href) },
    })));
    expect(doc.agents.map((a) => a.id)).toEqual(AGENT_IDS);
    for (const a of doc.agents) {
      const v = agentView(a.id);
      expect(a).toEqual({
        id: v.id, name: v.name, job: v.job, models: v.models,
        card: v.card ? { per_purchase: v.card.per_tx, monthly: v.card.monthly, only: v.card.only } : null,
        mandate: v.mandate ? { cap: v.mandate.cap, budget: v.mandate.budget, tx_url: v.mandate.tx ? `${EXPLORER}/tx/${v.mandate.tx}` : null } : null,
        page: `${SITE_URL}/agents/${a.id}`,
      });
    }
  });

  it("links only to the site, the repository or the Metal explorer, over https, with no relative path left", () => {
    expect(doc.site).toBe(SITE_URL);
    expect(doc.repository).toBe(REPOSITORY_URL);
    expect(REPO_BLOB.startsWith(`${REPOSITORY_URL}/`)).toBe(true);
    const urls = leaves(doc).filter(([k, v]) => /^(url|tx_url|page|site|repository|source|test)$/.test(k) || /^https?:/.test(v));
    expect(urls.length).toBeGreaterThan(20);
    for (const [k, v] of urls) {
      const ok = v.startsWith("https://") && [SITE_URL, REPOSITORY_URL, EXPLORER].some((base) => v === base || v.startsWith(`${base}/`));
      expect({ k, v, ok }).toEqual({ k, v, ok: true });
    }
    for (const [k, v] of leaves(doc)) expect({ k, v, rel: v.includes("../") }).toEqual({ k, v, rel: false });
  });

  it("holds nothing private: no card number or last four, no e-mail, no key or token", () => {
    const text = JSON.stringify(doc);
    expect(text.match(/(?<![0-9A-Za-z])\d{13,19}(?![0-9A-Za-z])/g)).toBeNull();
    expect(keys(doc).filter((k) => /last.?4|last.?four|pan|card.?number|cvc|cvv/i.test(k))).toEqual([]);
    expect(text).not.toMatch(/····\d{4}/);
    for (const a of doc.agents) if (a.card) expect(JSON.stringify(a.card)).not.toContain(agentView(a.id).card!.last4);
    // The project's own scan (test/support/privacyScan.ts) on the text without its links (test 3 holds the links) and
    // without the repository file path in the verify command: e-mails, keys, tokens, credential or assertion fields,
    // long base64 runs and unknown hashes.
    const noLinks = text.replace(/https:\/\/[^"\s]+/g, "").replace(/\bdocs\/[\w./-]+\.json\b/g, "");
    // 12 Nov (merge with main): the runs carry the public ids /runs already publishes (a transfer's or a transaction's
    // 64-hex id); those are known. Any other 64-hex value is still a finding.
    const published = new Set([...JSON.stringify(liveRuns()).matchAll(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)].map((m) => m[0].toLowerCase()));
    expect(privateFindings(noLinks, { known64: published, known40: new Set() })).toEqual([]);
    expect(privateFindings(`${noLinks} ${"ab".repeat(32)}`, { known64: published, known40: new Set() })).toEqual([`an unknown 64-hex value: ${"ab".repeat(32)}`]);
  });
});

describe("/receipt-sample.json", () => {
  it("serves the receipt the constant names, byte for byte, as JSON", async () => {
    expect(pages.receiptSample).toBe(receiptText);
    const r = (await get("/receipt-sample.json"))!;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    for (const [k, v] of Object.entries(COMMON_HEADERS)) expect({ k, v: r.headers.get(k) }).toEqual({ k, v });
    expect(await r.text()).toBe(receiptText);
  });

  it("verifies offline, and one cent more breaks the terms hash", () => {
    expect(verifyReceipt(receipt).ok).toBe(true);
    const amount = String(receipt.terms.amount);
    const cent = (Math.round(Number(amount) * 100) + 1) / 100;
    const changed = { ...receipt, terms: { ...receipt.terms, amount: cent.toFixed(2) } };
    const r = verifyReceipt(changed);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.check === "terms hash")?.ok).toBe(false);
  });

  it("claims no more than is read at build time: the guarantees and check steps are code, not run records", () => {
    expect(proofData().note).not.toMatch(/every value/i);
    expect(proofData().note).toMatch(/run records and code/);
  });

  it("is described in proof.json by its own note and the verifier's own sentences", () => {
    expect(doc.receipt_sample).toEqual({
      url: `${SITE_URL}/receipt-sample.json`, what: receipt.note, proves: RECEIPT_MEANS[0], does_not_prove: RECEIPT_MEANS[1],
      verify_command: (receipt as unknown as { verify: string }).verify,
    });
    expect(doc.receipt_sample.verify_command).toContain("npm run verify-receipt -- ");
  });

  it("says how to check a receipt in four steps, and the four steps hold on the sample", () => {
    const steps = doc.how_to_check_a_receipt;
    expect(steps.length).toBe(4);
    expect(steps[0]).toMatch(/canonical JSON/); expect(steps[0]).toMatch(/sorted/); expect(steps[0]).toMatch(/decimal strings/);
    expect(steps[1]).toMatch(/SHA-256/); expect(steps[1]).toContain("terms_sha256");
    expect(steps[2]).toMatch(/challenge/); expect(steps[2]).toContain("clientDataJSON");
    expect(steps[3]).toContain("ES256"); expect(steps[3]).toContain("public_key");
    // The same four steps, done here with Node's crypto only, on the served receipt.
    const hash = createHash("sha256").update(canonicalTerms(receipt.terms)).digest();
    expect(hash.toString("hex")).toBe(receipt.terms_sha256);
    const client = JSON.parse(Buffer.from(receipt.assertion.clientDataJSON!, "base64url").toString("utf8")) as { challenge: string };
    expect(client.challenge).toBe(hash.toString("base64url"));
    const key = createPublicKey({ key: { ...receipt.public_key }, format: "jwk" });
    const signed = Buffer.concat([Buffer.from(receipt.assertion.authenticatorData!, "base64url"), createHash("sha256").update(Buffer.from(receipt.assertion.clientDataJSON!, "base64url")).digest()]);
    expect(verify("sha256", signed, { key, dsaEncoding: "der" }, Buffer.from(receipt.assertion.signature!, "base64url"))).toBe(true);
  });
});

describe("llms.txt, for agents", () => {
  const t = readFileSync(root("llms.txt"), "utf8");
  const block = t.slice(t.indexOf("## For agents"));

  it("ends with a short \"## For agents\" block naming both URLs", () => {
    expect(t).toContain("## For agents");
    expect(block.slice("## For agents".length)).not.toMatch(/\n## /);
    expect(block.trim().split("\n").filter((l) => l.trim()).length).toBeLessThanOrEqual(6);
    expect(block).toContain(`${SITE_URL}/proof.json`);
    expect(block).toContain(`${SITE_URL}/receipt-sample.json`);
    expect(block).toContain("npm run mcp, docs/agent-api.md");
    // The command an agent can run in a clone is the receipt's own, so it names a file that exists there.
    expect(block).toContain((JSON.parse(receiptText) as { verify: string }).verify);
    expect(block).not.toMatch(/agent-ready|WebMCP|MCP endpoint|certified|endorsed|approved by/i);
  });

  it("says what the receipt is from its own note, and what it does not prove from the verifier", () => {
    const line = block.split("\n").find((l) => /receipt/i.test(l) && /does not prove/i.test(l))!;
    expect(line).toBeDefined();
    for (const words of ["sandbox", "test money", "the owner's own passkey", "Face ID, as stated by the owner", "7 November"]) {
      expect({ words, note: receipt.note.includes(words), line: line.includes(words) }).toEqual({ words, note: true, line: true });
    }
    const notProven = /who holds the key, or that it was Face ID \(no attestation is checked\)/;
    expect(RECEIPT_MEANS[1]).toMatch(notProven);
    expect(line).toMatch(notProven);
  });
});

describe("a bundle without them", () => {
  it("answers 404 for both paths", async () => {
    const { proofJson: _p, receiptSample: _r, ...older } = pages;
    for (const path of ["/proof.json", "/receipt-sample.json"]) {
      const r = (await get(path, older as Pages)) ?? notFoundResponse(older as Pages);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
  });
});
