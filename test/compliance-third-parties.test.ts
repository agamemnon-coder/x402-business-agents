// The ICT third-party register (docs/compliance/third-parties.json, DORA Art. 28(3)): every outside host the code
// calls belongs to a provider in it, and every host in it is one the code names; each provider's data levels are the
// classification's, each critical or important provider has an exit plan, and the rendered page is the register's.
// A host the code writes but never calls (a documentation link, an explorer link, Purser's own deployments, a
// placeholder in a test case) is listed below with the reason, so a new outside service cannot slip in unregistered.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRITICALITY, LEVELS, loadRegister, registerMarkdown, REGISTER_FORMAT } from "../src/compliance/thirdParties.js";

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules") files(p, out); } else if (/\.ts$/.test(n) && !/\.gen\./.test(n)) out.push(p);
  }
  return out;
}

/** Hosts written in the code that it does not call, each with why. */
const NOT_CALLED: Record<string, string> = {
  "github.com": "links to the repository and its records",
  "www.airwallex.com": "links to Airwallex's documentation and products",
  "airwallexdev.com": "a link to Airwallex's builder guide, in a comment",
  "testnet.metalntwx.com": "links to Alta's block explorer",
  "docs.metalntwx.com": "links to Alta's documentation",
  "developer.visa.com": "links to Visa's documentation",
  "developers.google.com": "links to Google's documentation",
  "developer.xero.com": "a link to Xero's documentation",
  "developer.moneybird.com": "a link to Moneybird's documentation",
  "developers.cloudflare.com": "links to Cloudflare's documentation and pricing",
  "learn.microsoft.com": "links to Microsoft's documentation",
  "mail.google.com": "the Gmail OAuth scope's name, not a host called",
  "platform.claude.com": "a link to Anthropic's pricing page",
  "claude.ai": "an origin allowed to call Purser Cloud's connector, not a host Purser calls",
  "claude.com": "an origin allowed to call Purser Cloud's connector, not a host Purser calls",
  "eur-lex.europa.eu": "links to the regulations in the control map",
  "www.iso.org": "a link to the standard in the control map",
  "www.aicpa-cima.com": "a link to the criteria in the control map",
  "www.ecb.europa.eu": "a cited source of the unit economics, read by a person",
  "shields.io": "a link to the badge service in the proof page's text",
  "img.shields.io": "badge images in the generated compliance pages, loaded by the reader's browser",
  "vscode.dev": "a link in the connect page",
  "youtu.be": "links to the demo films",
  "www.youtube-nocookie.com": "the demo film's embed, loaded by the visitor's browser",
  "kit11.site": "Purser's own site",
  "zeeland-betalen.nl": "a made-up payment page in an eval case",
  "mueller-zahlung.de": "a made-up payment page in an eval case",
  "www.mueller-soehne-gurtband.de": "a made-up supplier in an eval case",
};
/** Placeholders, tests and Purser's own deployments, by the shape of the name. */
const OWN_OR_PLACEHOLDER = /(^|\.)(example(\.[a-z]+)?|test|invalid|local|internal)$|\.workers\.dev$|^example\./;

const CODE_HOSTS = (() => {
  const out = new Map<string, string>();
  for (const f of [...files("src"), ...files("cloud/src"), ...files("worker/src")]) {
    for (const m of readFileSync(f, "utf8").matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) if (!out.has(m[1]!)) out.set(m[1]!, f);
  }
  return out;
})();

describe("the ICT third-party register", () => {
  const r = loadRegister();

  it("is well formed: unique providers, a known criticality, the classification's levels, code that exists", () => {
    expect(r.format).toBe(REGISTER_FORMAT);
    expect(r.review_by > r.as_of).toBe(true);
    const ids = r.providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["airwallex", "alta", "visa-airi", "anthropic", "cloudflare", "github", "t0", "moneybird"]));
    for (const p of r.providers) {
      expect(CRITICALITY, p.id).toContain(p.criticality);
      expect(p.data_shared.length, p.id).toBeGreaterThan(0);
      for (const d of p.data_shared) expect(LEVELS, p.id).toContain(d.level);
      for (const c of p.code) expect(existsSync(c), `${p.id}: ${c}`).toBe(true);
      expect(p.contract, p.id).toMatch(/^none/);
      if (p.reached_through) expect(ids, p.id).toContain(p.reached_through);
    }
  });

  it("gives each critical or important provider an exit plan that exists", () => {
    const plans = readFileSync("docs/compliance/exit-plans.md", "utf8");
    const headings = new Set([...plans.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-")));
    for (const p of r.providers.filter((x) => x.criticality === "critical" || x.criticality === "important")) {
      expect(p.exit_plan, p.id).toMatch(/^exit-plans\.md#/);
      expect(headings.has(p.exit_plan!.split("#")[1]!), `${p.id}: ${p.exit_plan}`).toBe(true);
    }
    expect(r.providers.filter((p) => p.criticality === "critical").map((p) => p.id).sort()).toEqual(["airwallex", "alta", "cloudflare"]);
  });

  it("holds every outside host the code calls, and nothing the code does not name", () => {
    const registered = new Map(r.providers.flatMap((p) => p.hosts.map((h) => [h, p.id] as const)));
    expect(registered.size, "a host belongs to one provider").toBe(r.providers.reduce((n, p) => n + p.hosts.length, 0));
    const unregistered = [...CODE_HOSTS].filter(([h]) => !registered.has(h) && !(h in NOT_CALLED) && !OWN_OR_PLACEHOLDER.test(h)).map(([h, f]) => `${h} (${f})`);
    expect(unregistered, "outside hosts the code names that are neither in the register nor known not to be called").toEqual([]);
    const gone = [...registered.keys()].filter((h) => !CODE_HOSTS.has(h));
    expect(gone, "hosts in the register that the code no longer names").toEqual([]);
    const stale = Object.keys(NOT_CALLED).filter((h) => !CODE_HOSTS.has(h));
    expect(stale, "hosts listed as not called that the code no longer names").toEqual([]);
    for (const h of Object.keys(NOT_CALLED)) expect(registered.has(h), h).toBe(false);
  });

  it("is rendered to docs/compliance/third-parties.md (npm run compliance:controls)", () => {
    expect(readFileSync("docs/compliance/third-parties.md", "utf8")).toBe(registerMarkdown(r));
  });
});
