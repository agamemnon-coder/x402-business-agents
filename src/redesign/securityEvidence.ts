// /security's "What we did, with evidence" (19 Nov, the owner): every security measure the project took, each with its
// figure and a link to its committed record. Nothing is typed in: the figures that /proof's evidence wall already shows
// are taken from the committed wall (docs/evidence/evidence-wall.json, written by npm run evidence:wall from the
// records; test/evidence-wall.test.ts holds it to them), each with the wall's own words; every other figure is read
// here from its record (a record that no longer says it is an error, never a guess). What ran where is said on each
// item: a test world on this computer, CI, an outside programme, or a document.

import { readdirSync } from "node:fs";
import { committedWall, TAG_WORDS, type EvidenceWall, type WallTag, type WallTile } from "./evidenceWall.js";
import { outLink, repoHref, repoText } from "./productPage.js";
import { countOf, esc } from "./ui.js";

/** Where an item ran: the wall's tags, and "doc" for what is written down rather than run. */
export type EvTag = WallTag | "doc";
export const EV_TAG_WORDS: Record<EvTag, string> = { ...TAG_WORDS, doc: "Written down" };

export interface EvItem {
  id: string;
  fig: string;
  label: string;
  note: string;
  tag: EvTag;
  /** The committed record, a repository path that exists. */
  rec: string;
  /** An anchor in the record, if any. */
  anchor?: string;
  /** The wall tile the figure is taken from, when /proof's wall shows it. */
  wall?: string;
  /** A second link (an outside page), as [href, label]. */
  also?: [string, string];
  /** Where the tile itself leads, when that is not the record (the CI runs the figure counts); default: the record. */
  go?: string;
}
export interface EvGroup { id: string; title: string; items: EvItem[] }

const BLOB = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
const json = <T>(path: string) => JSON.parse(repoText(path)) as T;
/** A doc as running text: bold and code marks out, line breaks as spaces. */
const flat = (path: string) => repoText(path).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
const must = <T>(v: T | null | undefined, what: string): T => {
  if (v === null || v === undefined) throw new Error(`${what}: not found in its record`);
  return v;
};
/** A section of a markdown doc: from its heading to the next heading of the same level. */
function section(path: string, heading: string): string {
  const text = repoText(path), at = text.indexOf(`\n## ${heading}\n`);
  if (at < 0) throw new Error(`${path} has no section "${heading}"`);
  const rest = text.slice(at + heading.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** A tile of the committed wall, by key; missing: an error. */
export function wallTile(key: string, w: EvidenceWall | null = committedWall()): WallTile {
  const t = w?.groups.flatMap((g) => g.tiles).find((x) => x.key === key);
  if (!t) throw new Error(`docs/evidence/evidence-wall.json has no tile ${key}`);
  return t;
}
/** The record a tile links to, as a repository path: its own link when that is a file here, else its first record. */
const tileRec = (t: WallTile) => (t.href.startsWith(BLOB) ? t.href.slice(BLOB.length) : t.rec.split(" ")[0]!);
/** An item from a tile of the committed wall: its figure, words, tag and record, as the wall has them. */
export const fromWall = (id: string, key: string, w: EvidenceWall | null, extra: Partial<EvItem> = {}): EvItem => {
  const t = wallTile(key, w);
  return { id, fig: t.fig, label: t.label, note: t.note, tag: t.tag, rec: tileRec(t), wall: key, ...extra };
};

// The records read here, one function each.

export const FORMAL_REC = "docs/evidence/formal-model.md";
/** The TLA+ model's run: distinct states, no error, planted bugs caught. */
export function formalModel(text: string = repoText(FORMAL_REC)): { states: string; caught: number; planted: number } {
  const states = must(/\| States \| \*\*([\d,]+) distinct states\*\*/.exec(text)?.[1], `${FORMAL_REC}: the states`);
  if (!/\| Result \| \*\*No error\.\*\*/.test(text)) throw new Error(`${FORMAL_REC} no longer says "No error."`);
  const p = must(/\| Planted bugs \| (\d+) of (\d+) caught/.exec(text), `${FORMAL_REC}: the planted bugs`);
  return { states, caught: Number(p[1]), planted: Number(p[2]) };
}

export const MUTATION_REC = "docs/evidence/mutation-testing.json";
interface MutationRecord { status: string; proof_verifier: { before: { total: number; killed: number; score: number }; after: { total: number; killed: number; score: number }; survivors_after?: { id: string; verdict: string }[] } }
/**
 * The proof verifier's mutation run, before and after the new tests; whether the run as a whole is partial; and why the
 * mutants left alive are left, in the record's words (so "50 of 51" never reads as a bug missed without its reason).
 */
export function mutation(r: MutationRecord = json<MutationRecord>(MUTATION_REC)): { killed: number; total: number; score: number; before: number; partial: boolean; left: string[] } {
  const a = r.proof_verifier.after, left = r.proof_verifier.survivors_after ?? [];
  if (left.length !== a.total - a.killed) throw new Error(`${MUTATION_REC}: ${a.total - a.killed} mutants survived but ${left.length} are explained`);
  return { killed: a.killed, total: a.total, score: a.score, before: r.proof_verifier.before.score, partial: r.status.startsWith("partial"), left: left.map((x) => x.verdict) };
}
/** The survivors' verdicts as a sentence: "The one left is equivalent: …". */
const leftWords = (left: string[]): string => left.length === 0 ? "" : left.length === 1 ? ` The one left is ${left[0]!.replace(/\.?$/, ".")}` : ` The ${left.length} left: ${left.join("; ").replace(/\.?$/, ".")}`;

export const VEX_REC = "docs/security/vex/purser.openvex.json";
/** The OpenVEX statements: how many, and whether every one says the component is not in the product. */
export function vex(r: { statements: { status: string; justification?: string }[] } = json(VEX_REC)): { statements: number; notInProduct: boolean } {
  // A statement marked fixed is history (OpenVEX never deletes one); the open ones are those still not fixed.
  const open = r.statements.filter((s) => s.status !== "fixed");
  return { statements: open.length, notInProduct: open.every((s) => s.status === "not_affected" && s.justification === "component_not_present") };
}

const WORKFLOWS = ".github/workflows";
export const SBOM_REC = "docs/security/sbom.cdx.json";
export const SILVER_REC = "docs/security/openssf-silver.md";
export const RELEASE_REC = (tag: string) => `docs/releases/${tag}.md`;
/**
 * The one reference allowed by tag, not by commit SHA: the SLSA project's generic generator (release.yml, job
 * slsa-provenance), whose README says it MUST be referenced as @vX.Y.Z; the owner chose it on 19 November 2026.
 */
export const SLSA_GENERATOR = "slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml";
/**
 * The supply chain, read from the workflows and records: Actions pinned to a commit SHA (and the SLSA generator, the
 * one allowed by its release tag), jobs behind Harden-Runner and whether it only audits, the bill of materials'
 * components, and the first release signed by the release workflow.
 */
export function supplyChain(files: string[] = readdirSync(new URL(`../../${WORKFLOWS}`, import.meta.url)).filter((f) => /\.ya?ml$/.test(f)).map((f) => `${WORKFLOWS}/${f}`)): { pinned: number; actions: number; slsaByTag: boolean; hardened: number; jobs: number; auditOnly: boolean; components: number; release: string } {
  const texts = files.map(repoText);
  const uses = texts.flatMap((t) => [...t.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+)/gm)].map((m) => m[1]!)).filter((u) => !u.startsWith("./") && !u.startsWith("docker://"));
  const hardened = uses.filter((u) => u.startsWith("step-security/harden-runner@")).length;
  const jobs = texts.reduce((n, t) => n + (t.match(/^\s+runs-on:/gm) ?? []).length, 0);
  const policies = texts.flatMap((t) => [...t.matchAll(/^\s*egress-policy:\s*(\w+)/gm)].map((m) => m[1]!));
  const silver = flat(SILVER_REC);
  if (!silver.includes("signed_releases (MUST): Met")) throw new Error(`${SILVER_REC} no longer says signed_releases is Met`);
  const release = must(/First signed release: https:\/\/github\.com\/agamemnon-coder\/x402-business-agents\/releases\/tag\/(v[\d.]+)/.exec(silver)?.[1], `${SILVER_REC}: the first signed release`);
  const byTag = uses.filter((u) => !/@[0-9a-f]{40}$/.test(u));
  const other = byTag.filter((u) => !(u.startsWith(`${SLSA_GENERATOR}@`) && /@v\d+\.\d+\.\d+$/.test(u)));
  if (other.length) throw new Error(`${WORKFLOWS}: not pinned to a commit SHA: ${other.join(", ")}`);
  return {
    pinned: uses.length - byTag.length, actions: uses.length, slsaByTag: byTag.length > 0, hardened, jobs,
    auditOnly: policies.length === hardened && policies.every((p) => p === "audit"),
    components: json<{ components: unknown[] }>(SBOM_REC).components.length, release,
  };
}

export const THREAT_REC = "docs/security.md";
/** The threat model's attacks, each with its STRIDE class (one table row each). */
export function strideRows(text: string = section(THREAT_REC, "Attackers and attacks")): number {
  return text.split("\n").filter((l) => /^\| [^|]+ \| [^|]+ \| [^|]+ \| [STRIDE](?:, [STRIDE])* \|/.test(l)).length;
}

export const MAPPING_REC = "docs/security/SECURITY-MAPPING.md";
/** The mapping's controls (C1, C2, …) and the gaps it names in one list. */
export function mapping(): { controls: number; gaps: number; notCertified: boolean } {
  const text = repoText(MAPPING_REC);
  return {
    controls: (text.match(/^\| C\d+ \|/gm) ?? []).length,
    gaps: (section(MAPPING_REC, "Gaps in one list").match(/^\d+\. /gm) ?? []).length,
    notCertified: flat(MAPPING_REC).includes("It is a map, not a claim of compliance or certification: nobody has audited Purser against any of them."),
  };
}

export const REQUIREMENTS_REC = "docs/security/requirements.md";
/** The security requirements (SR1, SR2, …). */
export const requirements = (text: string = section(REQUIREMENTS_REC, "What you can expect (the security requirements)")): number => (text.match(/^\| SR\d+ \|/gm) ?? []).length;

export const GOVERNANCE_REC = "GOVERNANCE.md";
/** The continuity plan: its parts, those marked in place, and those that need nothing handed over. */
export function continuity(text: string = section(GOVERNANCE_REC, "Continuity: if the maintainer is gone")): { parts: number; inPlace: number; nothing: number } {
  const rows = text.split("\n").filter((l) => /^\| (?!What someone|---)/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
  const status = rows.map((r) => r[r.length - 2] ?? "");
  return { parts: rows.length, inPlace: status.filter((s) => s.startsWith("In place")).length, nothing: status.filter((s) => s.startsWith("Nothing to hand over")).length };
}

export const REPORTING_REC = "SECURITY.md";
/** How fast a private report is answered, as SECURITY.md says it. */
export const answerDays = (text: string = flat(REPORTING_REC)): number => {
  if (!text.includes("GitHub private vulnerability reporting") || !text.includes("/security/advisories/new")) throw new Error(`${REPORTING_REC} no longer asks for a private advisory`);
  return Number(must(/Within (\d+) working days of the report \| We acknowledge it/.exec(text)?.[1], `${REPORTING_REC}: the answer time`));
};

/** The zero-trust harness's report (20 Nov): attacks on the payment path, how many stopped, how many moved money. */
export const ZERO_TRUST_REC = "docs/zero-trust/report.json";
export function zeroTrustTotals(r: { attacks_run: number; attacks_stopped: number; attacks_where_money_moved: number; layers: number; attacks: { stopped_by: unknown; moved: boolean }[]; generated: { date: string } } = json(ZERO_TRUST_REC)): { run: number; stopped: number; moved: number; layers: number } {
  const stopped = r.attacks.filter((a) => a.stopped_by && !a.moved).length, moved = r.attacks.filter((a) => a.moved).length;
  if (r.attacks.length !== r.attacks_run || stopped !== r.attacks_stopped || moved !== r.attacks_where_money_moved) throw new Error(`${ZERO_TRUST_REC}: its attacks do not add up to its totals`);
  return { run: r.attacks_run, stopped, moved, layers: r.layers };
}

/** The section's groups and items, in the page's order. */
export function securityEvidence(w: EvidenceWall | null = committedWall()): EvGroup[] {
  const zt = zeroTrustTotals(), fm = formalModel(), mu = mutation(), vx = vex(), sc = supplyChain(), mp = mapping(), co = continuity(), ci = wallTile("ci", w);
  if (!vx.notInProduct) throw new Error(`${VEX_REC}: a statement is not "not affected, component not present"; the page would need to say which`);
  if (!mp.notCertified) throw new Error(`${MAPPING_REC} no longer says it is a map, not a certification`);
  if (co.inPlace + co.nothing !== co.parts) throw new Error(`${GOVERNANCE_REC}: a part of the continuity plan is not in place; the page would need to say which`);
  return [
    { id: "ev-attack", title: "Attacked and checked on purpose", items: [
      // 21 Nov (the owner: "a lot of old things on the new page"): the zero-trust harness and the hostile model, the
      // newest attack tests, here as items; their old charts and the red team's October rounds left the page.
      { id: "e-zerotrust", fig: countOf(zt.stopped, zt.run), label: "attacks on the payment path stopped (zero-trust harness)", note: `${zt.moved === 0 ? "None" : zt.moved} moved money; each one is mapped to the layer that stopped it. Simulated rails, on this computer.`, tag: "test", rec: ZERO_TRUST_REC },
      fromWall("e-hostile", "hostile-model", w),
      fromWall("e-redteam", "redteam-api", w, { label: "attacks on the /try API held (red team v2)" }),
      fromWall("e-chaos", "chaos-money", w),
      fromWall("e-fuzz", "fuzzing", w),
      fromWall("e-tamper", "tamper-matrix", w),
      { id: "e-formal", fig: fm.states, label: "states of the payment state machine checked by TLC (TLA+): no error", note: `${countOf(fm.caught, fm.planted)} planted bugs caught, each with a trace. A model of the code, not the code; offline.`, tag: "test", rec: FORMAL_REC, also: [repoHref("formal/PurserPayment.tla"), "The model"] },
      { id: "e-mutation", fig: countOf(mu.killed, mu.total), label: "planted bugs caught in the proof verifier (mutation testing)", note: `${mu.score}% after the new tests, ${mu.before}% before.${leftWords(mu.left)}${mu.partial ? " A partial run: most module groups are not measured yet." : ""} Offline.`, tag: "test", rec: "docs/evidence/mutation-testing.md" },
    ] },
    { id: "ev-supply", title: "Supply chain", items: [
      { id: "e-scan", fig: ci.fig, label: ci.label, note: `${ci.note} OSV-Scanner checks every lockfile daily; its ${vx.statements} findings are in CI tooling and test fixtures, none in the product, each with an OpenVEX statement.`, tag: "ci", rec: ".github/workflows/osv-scanner.yml", wall: "ci", go: ci.href, also: [repoHref("docs/security/vex/README.md"), "VEX"] },
      { id: "e-pinned", fig: countOf(sc.pinned, sc.actions), label: "Actions pinned to a full commit SHA", note: `${sc.slsaByTag ? `The ${sc.actions - sc.pinned === 1 ? "other is" : "others are"} the SLSA generator, by its release tag as its README requires. ` : ""}Harden-Runner on ${sc.hardened} of ${sc.jobs} CI jobs${sc.auditOnly ? ", auditing egress (it blocks nothing yet)" : ""}; a CycloneDX bill of materials, ${sc.components} components; ${sc.release} released with Sigstore-signed SLSA provenance.`, tag: "ci", rec: RELEASE_REC(sc.release), also: [repoHref("docs/security/README.md", "#verify-a-release"), "Verify a release"] },
    ] },
    { id: "ev-written", title: "Governance, written down", items: [
      { id: "e-stride", fig: String(strideRows()), label: "attacks in the threat model, each with its STRIDE class and what stops it", note: "With the trust boundaries, least privilege and the accepted risks.", tag: "doc", rec: THREAT_REC, anchor: "#attackers-and-attacks" },
      { id: "e-mapping", fig: String(mp.controls), label: "controls mapped to NIST SSDF, the OWASP Top Ten for LLM applications and DORA", note: `Mapped, not certified: nobody has audited Purser against them; ${mp.gaps} gaps named.`, tag: "doc", rec: MAPPING_REC },
      { id: "e-requirements", fig: String(requirements()), label: "security requirements, each with where it is enforced and tested", note: "With what you cannot expect, input validation, hardening and cryptography.", tag: "doc", rec: REQUIREMENTS_REC },
      fromWall("e-openssf", "openssf", w, { rec: SILVER_REC, also: [wallTile("openssf", w).href, "bestpractices.dev"] }),
      { id: "e-continuity", fig: countOf(co.inPlace, co.parts - co.nothing), label: "parts of the continuity plan in place, as the owner reports", note: "If the maintainer is gone, someone else can merge and release within a week; one maintainer today.", tag: "doc", rec: GOVERNANCE_REC, anchor: "#continuity-if-the-maintainer-is-gone" },
      { id: "e-report", fig: String(answerDays()), label: "working days: our aim for answering a private vulnerability report", note: "Through a private GitHub security advisory, never a public issue; fixed in private with a regression test, then disclosed with credit.", tag: "doc", rec: REPORTING_REC },
    ] },
  ];
}

/** The figures of every item, as the page shows them (for the test that holds each to its record). */
export const evidenceItems = (groups: EvGroup[] = securityEvidence()): EvItem[] => groups.flatMap((g) => g.items);

export const EVIDENCE_CSS = `.ev { padding: 18px; display: grid; gap: 14px; min-width: 0; }
.ev h2.ev-h { font-size: 21px; line-height: 1.25; letter-spacing: -.015em; margin: 0; }
.ev .ev-sub { margin: 0; font-size: 15.5px; color: var(--muted); line-height: 1.5; max-width: 48em; }
.ev h3 { margin: 6px 0 0; font-size: 15px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
.ev-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 600px) { .ev-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); } }
.ev-grid > li { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 14px; background: var(--sunken); border: 1px solid var(--border); min-width: 0; }
/* Each tile is one link to its source (21 Nov, the owner: "no dead zones, and every figure goes somewhere"): the
   figure, its words and the whole tile around them; the second link stays a link of its own, above it. */
.ev-grid a.ev-a { display: flex; flex-direction: column; gap: 6px; color: inherit; text-decoration: none; outline: none; }
.ev-grid a.ev-a::after { content: ""; position: absolute; inset: 0; border-radius: 14px; }
.ev-grid > li:has(a.ev-a:hover), .ev-grid > li:has(a.ev-a:focus-visible) { border-color: var(--accent); background: var(--surface); }
.ev-grid > li:has(a.ev-a:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.ev-grid > li .links a { position: relative; z-index: 1; }
.ev-grid .ev-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.ev-grid .ev-fig { font-size: 30px; font-weight: 800; letter-spacing: -.025em; line-height: 1.05; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ev-grid .ev-tag { flex: none; font-size: 14px; font-weight: 650; padding: 2px 9px; border-radius: 999px; background: var(--surface); color: var(--muted); border: 1px solid var(--border); white-space: nowrap; }
.ev-grid .ev-tag.t-test, .ev-grid .ev-tag.t-check { color: var(--ok); }
.ev-grid .ev-tag.t-ci, .ev-grid .ev-tag.t-external { color: var(--accent); }
.ev-grid .ev-lab { margin: 0; font-size: 15.5px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.ev-grid .ev-note { margin: 0; font-size: 14.5px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.ev-grid .links { margin-top: auto; padding-top: 2px; }`;

/** Where an item's tile leads: its own `go`, else its record. */
export const itemHref = (i: EvItem): string => i.go ?? repoHref(i.rec, i.anchor ?? "");
const itemHtml = (i: EvItem) => `<li id="${esc(i.id)}"><a class="ev-a" href="${esc(itemHref(i))}" target="_blank" rel="noopener"><div class="ev-top"><b class="ev-fig">${esc(i.fig)}</b><span class="ev-tag t-${i.tag}">${esc(EV_TAG_WORDS[i.tag])}</span></div>
      <p class="ev-lab">${esc(i.label)}</p><p class="ev-note">${esc(i.note)}</p></a>
      <div class="links">${outLink(repoHref(i.rec, i.anchor ?? ""), i.rec.split("/").pop()!)}${i.also ? outLink(i.also[0], i.also[1]) : ""}</div></li>`;

/** The section, as markup. */
export function evidenceHtml(groups: EvGroup[] = securityEvidence()): string {
  return `<section class="card ev" id="done" aria-labelledby="done-h">
  <h2 class="ev-h" id="done-h">What we did, with evidence</h2>
  <p class="ev-sub">Each figure is read from the committed record it links to. The tag says where it ran: a test world on our own computer, CI, an outside programme, or a document. Test money only.</p>
  ${groups.map((g) => `<h3 id="${esc(g.id)}">${esc(g.title)}</h3>
  <ul class="ev-grid">
    ${g.items.map(itemHtml).join("\n    ")}
  </ul>`).join("\n  ")}
</section>`;
}
