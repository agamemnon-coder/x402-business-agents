// /security, upgraded 19 Nov (the owner: an enterprise-grade, visually strong security page): "How a payment is guarded"
// (src/redesign/securityArch.ts), the layers and trust boundaries a payment passes with every security control where it
// sits, and "What we did, with evidence" (src/redesign/securityEvidence.ts), each item with its figure and its committed
// record. The page is served with 200 and one h1, every link reaches a file or a page that exists, and every figure is
// the evidence wall's (docs/evidence/evidence-wall.json, as src/redesign/evidenceWallData.ts computes it) or is read
// again here from its own record.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { committedWall } from "../src/redesign/evidenceWall.js";
import { evidenceWall } from "../src/redesign/evidenceWallData.js";
import { ARCH_BOUNDARIES, ARCH_CSS, ARCH_LAYERS, archFiles, archHtml } from "../src/redesign/securityArch.js";
import { EVIDENCE_CSS, evidenceHtml, evidenceItems, formalModel, securityEvidence, wallTile } from "../src/redesign/securityEvidence.js";
import { securityPage } from "../src/redesign/security.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
const exists = (p: string) => existsSync(new URL(`../${p}`, import.meta.url));
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (html: string) => decode(html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";

describe("/security: served, one h1, every link reaches something that exists", () => {
  const pages = buildPages() as Pages;
  const html = pages.security!;

  it("responds 200 with its own style-only policy, and has exactly one h1", async () => {
    const res = pageResponse(new Request("https://x.test/security"), pages)!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toMatch(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+';/);
    const body = await res.text();
    expect((body.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(scriptBlocks(body)).toEqual([]);
    expect(body).not.toMatch(/\sstyle="/);
  });

  it("links only to repository files that exist", () => {
    const files = [...html.matchAll(/href="https:\/\/github\.com\/agamemnon-coder\/x402-business-agents\/blob\/main\/([^"#]+)/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThan(40);
    for (const f of files) expect({ f, exists: exists(f) }).toEqual({ f, exists: true });
    for (const f of archFiles()) expect({ f, exists: exists(f) }).toEqual({ f, exists: true });
    for (const i of evidenceItems()) expect({ id: i.id, rec: i.rec, exists: exists(i.rec) }).toEqual({ id: i.id, rec: i.rec, exists: true });
  });

  it("links to pages of this site that the site serves", () => {
    const section = (id: string) => new RegExp(`<section class="card [a-z]+" id="${id}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";
    const local = [...`${section("arch")}${section("done")}`.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]!)).filter((h) => !/^https?:/.test(h));
    expect(local.length).toBeGreaterThan(3);
    for (const h of local) {
      const path = `/${h.replace(/^\//, "").replace(/#.*$/, "")}`;
      expect({ h, status: pageResponse(new Request(`https://x.test${path}`), pages)?.status }).toEqual({ h, status: 200 });
    }
  });
});

describe("How a payment is guarded: the layers, the trust boundaries and where each control sits", () => {
  const html = archHtml(), text = textOf(html);

  it("draws the five layers in order, with a trust boundary between every two", () => {
    expect(ARCH_LAYERS.map((l) => l.id)).toEqual(["ar-agent", "ar-rules", "ar-sign", "ar-locks", "ar-proof"]);
    expect([...html.matchAll(/<li class="(ar-band z-[a-z]+|ar-tb)"/g)].map((m) => (m[1] === "ar-tb" ? "tb" : "layer"))).toEqual(["layer", "tb", "layer", "tb", "layer", "tb", "layer", "tb", "layer"]);
    expect(ARCH_BOUNDARIES).toHaveLength(4);
    expect(text).toContain("Claude reads the invoice");
    expect(text).toMatch(/If Claude fails or answers outside its schema, code's own parser reads the invoice instead\./);
    expect(ARCH_LAYERS[1]!.rules!.map((r) => r.name)).toEqual(["Limits", "Payee allowlist", "Duplicates", "Cash floor"]);
    expect(text).toContain("signs the SHA-256 of the canonical terms");
    expect(ARCH_LAYERS[3]!.locks!.map((k) => k.name)).toEqual(["Airwallex card controls", "Alta mandate on chain", "CFO passkey"]);
    expect(text).toContain("A proof file anyone can verify offline");
    // A schematic, said so, and the live parts labelled.
    expect(html).toContain('<span class="pill">Schematic</span>');
    expect(text).toContain("(sandbox)");
    expect(text).toContain("(testnet)");
  });

  it("puts every control where it sits, each linked to the code that enforces it", () => {
    const at = Object.fromEntries(ARCH_LAYERS.map((l) => [l.id, l.controls.map((c) => c.name)]));
    expect(at).toEqual({
      "ar-agent": ["CSP and headers", "Rate limits", "zod validation"],
      "ar-rules": ["Hash first"],
      "ar-sign": ["/health tamper alarm"],
      "ar-locks": ["Idempotency", "HMAC webhooks"],
      "ar-proof": ["Hash-chained audit log", "Offline verifier"],
    });
    for (const l of ARCH_LAYERS) for (const c of l.controls) expect(html).toContain(`href="${REPO}${c.code}"`);
    // The code says what the drawing says.
    expect(read("src/ops/health.ts")).toContain("approved_terms_changed");
    expect(read("src/policy/hashFirst.ts")).toContain("before anything outside");
    expect(read("src/agents/toolSchema.ts")).toMatch(/\bzod\b/);
    expect(read("src/policy/airwallexEvents.ts")).toMatch(/hmac|HMAC/);
    expect(read("worker/src/core.ts")).toContain("underRateLimit");
  });

  it("moves with CSS only, and stands still for a reader who asks for reduced motion", () => {
    expect(scriptBlocks(html)).toEqual([]);
    expect(html).not.toMatch(/\sstyle="/);
    expect(ARCH_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.ar-card \{ animation: none !important; \}\n {2}\.ar-dot \{ animation: none !important; display: none; \}\n\}$/);
    expect(ARCH_CSS).toContain("@keyframes ar-run-l");
    expect(ARCH_CSS).toContain("@keyframes ar-stop");
    // Only the theme's tokens: no colour of its own, so light and dark both follow the site.
    expect(ARCH_CSS.match(/#[0-9a-f]{3,6}\b/gi) ?? []).toEqual([]);
    expect(EVIDENCE_CSS.match(/#[0-9a-f]{3,6}\b/gi) ?? []).toEqual([]);
    // No text under 14 px.
    for (const css of [ARCH_CSS, EVIDENCE_CSS]) for (const m of css.matchAll(/font-size: ([\d.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(14);
  });
});

describe("What we did, with evidence: every figure from the wall or its own record", () => {
  const wall = committedWall()!, fresh = evidenceWall();
  const items = evidenceItems();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  it("lists the fourteen measures, each with a figure, where it ran and its record", () => {
    expect(items.map((i) => i.id)).toEqual(["e-redteam", "e-chaos", "e-fuzz", "e-tamper", "e-formal", "e-mutation", "e-scan", "e-pinned", "e-stride", "e-mapping", "e-requirements", "e-openssf", "e-continuity", "e-report"]);
    const html = evidenceHtml();
    for (const i of items) expect(html).toContain(`<li id="${i.id}"><div class="ev-top"><b class="ev-fig">`);
    expect(securityPage()).toContain(html);
    expect(securityPage().indexOf('id="done"')).toBeGreaterThan(securityPage().indexOf('id="arch"'));
  });

  it("takes the wall's figures as the wall has them, and the wall is its records' (evidenceWallData)", () => {
    const fromWall = items.filter((i) => i.wall);
    expect(fromWall.map((i) => [i.id, i.wall])).toEqual([["e-redteam", "redteam-api"], ["e-chaos", "chaos-money"], ["e-fuzz", "fuzzing"], ["e-tamper", "tamper-matrix"], ["e-scan", "ci"], ["e-openssf", "openssf"]]);
    for (const i of fromWall) {
      const t = wallTile(i.wall!, wall), f = wallTile(i.wall!, fresh);
      expect({ id: i.id, fig: i.fig, tag: i.tag }).toEqual({ id: i.id, fig: t.fig, tag: t.tag });
      expect({ id: i.id, fig: t.fig, label: t.label, note: t.note }).toEqual({ id: i.id, fig: f.fig, label: f.label, note: f.note });
      expect(i.label.startsWith(t.label)).toBe(true);
      expect(i.note.startsWith(t.note)).toBe(true);
    }
    // The owner's list, as the wall states it.
    expect(byId["e-redteam"]!.fig).toBe("All 128");
    expect(byId["e-chaos"]!.fig).toBe("0");
    expect(byId["e-chaos"]!.label).toBe("money invariants broken in 317 chaos scenarios");
    expect(byId["e-fuzz"]!.fig).toBe("All 17");
    expect(byId["e-tamper"]!.fig).toBe("All 894");
    expect(byId["e-openssf"]!.fig).toBe("Silver");
  });

  it("reads every other figure from its own record", () => {
    const fm = read("docs/evidence/formal-model.md");
    expect(byId["e-formal"]!.fig).toBe(/\*\*([\d,]+) distinct states\*\*/.exec(fm)![1]);
    expect(formalModel()).toEqual({ states: "1,102,845", caught: 3, planted: 3 });
    expect(() => formalModel(fm.replace("**No error.**", "**Error.**"))).toThrow(/No error/);
    const mu = json<{ proof_verifier: { after: { killed: number; total: number } } }>("docs/evidence/mutation-testing.json").proof_verifier.after;
    expect(byId["e-mutation"]!.fig).toBe(`${mu.killed} of ${mu.total}`);
    const vex = json<{ statements: unknown[] }>("docs/security/vex/purser.openvex.json").statements.length;
    expect(byId["e-scan"]!.note).toContain(`its ${vex} findings are in CI tooling and test fixtures`);
    const wf = readdirSync(new URL("../.github/workflows", import.meta.url)).map((f) => read(`.github/workflows/${f}`)).join("\n");
    const uses = [...wf.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+)/gm)].map((m) => m[1]!).filter((u) => !u.startsWith("./"));
    expect(uses.every((u) => /@[0-9a-f]{40}$/.test(u))).toBe(true);
    expect(byId["e-pinned"]!.fig).toBe(`All ${uses.length}`);
    expect(byId["e-pinned"]!.note).toContain(`Harden-Runner on ${uses.filter((u) => u.startsWith("step-security/harden-runner@")).length} of ${(wf.match(/^\s+runs-on:/gm) ?? []).length} CI jobs, auditing egress (it blocks nothing yet)`);
    expect(byId["e-pinned"]!.note).toContain(`${json<{ components: unknown[] }>("docs/security/sbom.cdx.json").components.length} components; v1.2.0 released with Sigstore-signed SLSA provenance`);
    expect(read("docs/security/openssf-silver.md")).toContain("First signed release: https://github.com/agamemnon-coder/x402-business-agents/releases/tag/v1.2.0");
    expect(byId["e-stride"]!.fig).toBe(String(read("docs/security.md").split("\n").filter((l) => /^\| \d+[a-z]? \| .* \| [STRIDE](, [STRIDE])* \| /.test(l)).length));
    expect(byId["e-mapping"]!.fig).toBe(String((read("docs/security/SECURITY-MAPPING.md").match(/^\| C\d+ \|/gm) ?? []).length));
    expect(byId["e-mapping"]!.note.startsWith("Mapped, not certified")).toBe(true);
    expect(byId["e-requirements"]!.fig).toBe(String((read("docs/security/requirements.md").match(/^\| SR\d+ \|/gm) ?? []).length));
    expect(byId["e-continuity"]!.fig).toBe(`All ${(read("GOVERNANCE.md").match(/\| In place since/g) ?? []).length}`);
    expect(byId["e-report"]!.fig).toBe(`${/We aim to answer within (\d+) working days/.exec(read("SECURITY.md").replace(/\s+/g, " "))![1]}`);
  });

  it("says where each ran, claims nothing it did not run, and keeps the site's word rules", () => {
    const text = textOf(`${archHtml()} ${evidenceHtml()}`);
    expect(items.filter((i) => i.tag === "doc").map((i) => i.id)).toEqual(["e-stride", "e-mapping", "e-requirements", "e-continuity", "e-report"]);
    expect(text).toContain("Test money only.");
    expect(text).not.toMatch(/stand-in|unsafe-inline/i);
    expect(text).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
    expect(text.replace(/\bMapped, not certified\b/g, "")).not.toMatch(/\b(certified|certification|endorsed|approved by|compliant|audited by|partnered with)\b/i);
    expect(text).not.toMatch(/\bVisa\b/);
    expect(() => securityEvidence({ ...wall, groups: wall.groups.map((g) => ({ ...g, tiles: g.tiles.filter((t) => t.key !== "fuzzing") })) })).toThrow(/no tile fuzzing/);
  });

  it("is indexed, with the same records, in docs/security/README.md", () => {
    const readme = read("docs/security/README.md");
    const rel = (p: string) => (p.startsWith("docs/security/") ? p.slice("docs/security/".length) : `../../${p}`).replace(/^\.\.\/\.\.\/docs\//, "../");
    for (const i of items) expect({ id: i.id, linked: readme.includes(`(${rel(i.rec)}`) }).toEqual({ id: i.id, linked: true });
    expect(readme).toMatch(/^## How to verify$/m);
    // Its figures are the page's, each in bold in its row.
    for (const i of items) expect({ id: i.id, fig: readme.includes(`**${i.fig}**`) }).toEqual({ id: i.id, fig: true });
  });
});
