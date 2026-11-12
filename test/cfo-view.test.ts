// The CFO's view, made visible (Max's last round, item 4): "See the CFO's view" on Home and /proof, to the existing CFO
// dashboard replay of the main run (/?autonomy: read-only, public, no viewer key), with one line at its top. Before it
// was linked, its page was audited for anything private; the audit is kept here as a test that fails if a key, a token,
// a viewer key, an RPC URL, an email or other personal data ever reaches that page (its HTML and its inline data).
import { describe, expect, it } from "vitest";
import { CFO_VIEW_LINE, CFO_VIEW_LINK, CFO_VIEW_URL } from "../src/config/brand.js";
import { homePage } from "../src/redesign/home.js";
import { proofPage } from "../src/redesign/proof.js";
import { loadRecord, runLabel } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";
import { PAGE } from "../src/servers/dashboard.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const { record } = loadRecord();
const SERVED = buildPages().dashboard;
const decode = (s: string) => s.split("&#39;").join("'").split("&quot;").join('"').split("&amp;").join("&");

/** A data block's JSON, found by position (its id), "<" unescaped as the page's own script reads it. */
function dataBlock(html: string, id: string): unknown {
  const block = scriptBlocks(html).find((b) => b.slice(0, b.indexOf(">")).includes(`id="${id}"`));
  expect({ id, found: !!block }).toEqual({ id, found: true });
  const body = block!.slice(block!.indexOf(">") + 1, block!.toLowerCase().lastIndexOf("</script"));
  return JSON.parse(body);
}
/** Every [path, key, value] of a JSON value, strings and numbers alike. */
function leaves(v: unknown, path = ""): [string, string, string][] {
  if (Array.isArray(v)) return v.flatMap((x) => leaves(x, `${path}[]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => (x && typeof x === "object" ? leaves(x, `${path}.${k}`) : [[`${path}.${k}`, k, String(x)] as [string, string, string], ...leaves(x, `${path}.${k}`)]));
  return [];
}
const BLOCKS = ["recorded-data", "autonomy-data", "agent-names", "redteam-data"];

describe("See the CFO's view: on Home and /proof, to the main run's dashboard replay", () => {
  it("is one link on each, to /?autonomy, worded as Max asked", () => {
    expect([CFO_VIEW_LINK, CFO_VIEW_URL]).toEqual(["See the CFO's view", "./?autonomy"]);
    // Home shows only the way through since Max's round of 7 Nov (watch, try, proof): the CFO's view is on /proof.
    expect(decode(homePage()).includes(`href="${CFO_VIEW_URL}"`)).toBe(false);
    for (const [name, html] of [["proof", proofPage()]] as const) {
      // Proof also keeps its "Open the CFO dashboard" under the audit rows, to the same view. Since 12 Nov the link
      // worded as Max asked is in the utility row at the end of the page, so it is the second of the two.
      const links = decode(html).split(`href="${CFO_VIEW_URL}"`).length - 1;
      const a = decode(html).lastIndexOf(`href="${CFO_VIEW_URL}"`), end = decode(html).indexOf("</a>", a);
      expect({ name, links, text: decode(html).slice(a, end).endsWith(CFO_VIEW_LINK) }).toEqual({ name, links: name === "proof" ? 2 : 1, text: true });
      const first = decode(html).indexOf(`href="${CFO_VIEW_URL}"`);
      expect(decode(html).slice(first, decode(html).indexOf("</a>", first))).toContain("Open the CFO dashboard");
    }
  });

  it("lands on the replay of the main run, labelled as such, with no key: the data is inside the page", () => {
    const a = dataBlock(SERVED, "autonomy-data") as { label: string; recorded_at: string };
    expect(a.label).toBe(runLabel(record));
    expect(a.label).toMatch(/^Replay of the main run, 3 Nov \d\d:\d\d–\d\d:\d\d UTC · test money · real Claude decisions$/);
    // The page asks the server for data only in the live view (api/snapshot with the viewer key); /?autonomy renders
    // its own data block and never reaches that branch first.
    const js = scriptBlocks(SERVED).find((b) => b.startsWith("<script>"))!;
    const autonomy = js.indexOf("} else if (wantAutonomy && AUTONOMY) {"), live = js.indexOf('} else if (MODE === "local" || viewKey) {');
    expect(autonomy).toBeGreaterThan(0);
    expect(live).toBeGreaterThan(autonomy);
    expect(js.slice(autonomy, live)).not.toMatch(/fetch\(|poll\(|XMLHttpRequest|EventSource|WebSocket/);
  });

  it("opens with the line Max wrote, shown only on that view", () => {
    expect(CFO_VIEW_LINE).toBe("This is what the CFO opens: what the agents did, what waits for a signature, and each limit the CFO set.");
    for (const html of [PAGE, SERVED]) {
      const at = html.indexOf('<main class="wrap" id="dash" hidden>');
      expect(html.slice(at, at + 200)).toContain(`<p class="cfoline" id="cfo-line" hidden>${CFO_VIEW_LINE}</p>`);
    }
    const js = scriptBlocks(SERVED).find((b) => b.startsWith("<script>"))!;
    const autonomy = js.indexOf("} else if (wantAutonomy && AUTONOMY) {"), next = js.indexOf("} else if (wantRecorded && RECORDED) {");
    expect(js.slice(autonomy, next)).toContain('document.getElementById("cfo-line").hidden = false;');
    expect(js.slice(next)).not.toContain('"cfo-line"');
  });
});

describe("the CFO's view holds nothing private (audit before linking it)", () => {
  // What the page could leak, and the shape each would have.
  const PATTERNS: [string, RegExp][] = [
    ["an email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/],
    // The page's own script and comment say how a viewer link works ("#view=<key>"); a key itself is 32 hex digits.
    ["a viewer key or runner key in a link", /#view=[0-9a-f]{8,}|[?&#]runner=[A-Za-z0-9_-]{20,}|x-kit11-view["']?\s*:\s*["'][0-9a-f]/i],
    ["an Anthropic or other API key", /\bsk-(ant-)?[A-Za-z0-9_-]{16,}|\b(pk|rk|sk)_(live|test)_[A-Za-z0-9]{8,}/],
    ["a bearer token or JWT", /\bBearer\s+[A-Za-z0-9._-]{12,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ["a PEM key", /-----BEGIN [A-Z ]*(PRIVATE )?KEY-----/],
    ["a mnemonic or seed phrase field", /"(mnemonic|seed|seed_phrase|private_key|privateKey|secret|api_key|apiKey|password|access_token|refresh_token|client_secret|relay_token|view_key)"\s*:/i],
    ["an RPC endpoint", /\b(rpc|infura|alchemy|quiknode|quicknode|ankr)\b[^"\s]*\.(io|com|net|org|xyz)|https?:\/\/[^"\s]*\/rpc\b/i],
    ["a local address or file path", /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b|\/(home|Users|root|tmp)\/[A-Za-z0-9._-]+\//],
    ["an IBAN", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/],
    ["a phone number", /\+\d{1,3}[ -]?\d{2,4}[ -]?\d{3,4}[ -]?\d{3,4}\b/],
  ];

  for (const [name, html] of [["the dashboard page as the Worker serves it", SERVED], ["the dashboard page as npm run judge serves it", PAGE]] as const) {
    it(`${name}: none of ${PATTERNS.length} kinds of private data, in the markup, the script or the inline data`, () => {
      for (const [what, re] of PATTERNS) expect({ what, found: re.exec(html)?.[0] ?? null }).toEqual({ what, found: null });
      // An IP address, in the inline data (the icons' drawing paths are numbers too, so the markup is left out here).
      for (const id of BLOCKS) for (const [path, , value] of leaves(dataBlock(html, id))) expect({ path, ip: /(?<![\d.])(\d{1,3}\.){3}\d{1,3}(?![\d.])/.exec(value)?.[0] ?? null }).toEqual({ path, ip: null });
    });
  }

  it("links only to public hosts: Metal's testnet explorer, the project's own site and repository, and the SVG namespace", () => {
    const hosts = new Set([...SERVED.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]!));
    expect([...hosts].filter((h) => !["testnet.metalntwx.com", "kit11.max-31b.workers.dev", "www.w3.org", "github.com"].includes(h))).toEqual([]);
    expect(hosts.has("testnet.metalntwx.com")).toBe(true);
    for (const m of SERVED.matchAll(/https:\/\/github\.com\/([^/"\s]+)/g)) expect(m[1]).toBe("agamemnon-coder");
  });

  it("carries no key, token or secret under any name in its inline data, and no passkey credential", () => {
    for (const id of BLOCKS) {
      for (const [path, key, value] of leaves(dataBlock(SERVED, id))) {
        expect({ path, bad: /(secret|token$|password|mnemonic|seed|private|api_?key|auth(orization)?$|cookie|session|view_?key|relay)/i.test(key) && !/^tokens$/.test(key) }).toEqual({ path, bad: false });
        if (key === "credential") expect({ path, value }).toEqual({ path, value: "null" });
      }
    }
  });

  it("every 64-hex value on the page is public: a transaction or a hash the record names as one, never a key", () => {
    // A private key and a transaction hash look alike (64 hex digits), so each one is checked against what it is: the
    // record's transactions (fields named tx, and explorer links) and its hashes (fields named hash or …sha256).
    const known = new Set<string>();
    for (const id of BLOCKS) {
      for (const [, key, value] of leaves(dataBlock(SERVED, id))) {
        // tx: a transaction; hash, …sha256: a hash of terms, evidence or an audit row; head: the audit chain's head;
        // mandate: an on-chain mandate's hash.
        if (/(^|_)(tx|hash|sha256|head|mandate)$/i.test(key) || /^https:\/\/testnet\.metalntwx\.com\/tx\//.test(value)) for (const m of value.matchAll(/[0-9a-fA-F]{64}/g)) known.add(m[0].toLowerCase());
      }
    }
    const all = [...new Set([...SERVED.matchAll(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)].map((m) => m[0].toLowerCase()))];
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((h) => !known.has(h))).toEqual([]);
  });

  it("names people only as the run's labelled roles: Max (the CFO) and the labelled test passkey", () => {
    const people = new Set<string>();
    for (const id of BLOCKS) for (const [path, key, value] of leaves(dataBlock(SERVED, id))) if (/^(approver|cosigner|signers)$/.test(key) || path.endsWith(".passkey.label")) people.add(value);
    expect([...people].sort()).toEqual(["max", "max + test-controller"]);
    // And as the pages word them: "Max · Face ID", with the labelled test passkey as the second approver.
    const by = new Set<string>();
    for (const id of BLOCKS) for (const [path, , value] of leaves(dataBlock(SERVED, id))) if (/\.decisions\[\]\.by$/.test(path)) by.add(value);
    expect([...by].filter((x) => x !== "null").sort()).toEqual(["Max & Test-controller · Face ID", "Max · Face ID"]);
  });

  it("holds no secret the environment has, if any is set where this runs", () => {
    for (const [name, value] of Object.entries(process.env)) {
      if (!value || value.length < 12 || !/(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)/i.test(name)) continue;
      expect({ name, found: SERVED.includes(value) || PAGE.includes(value) }).toEqual({ name, found: false });
    }
  });
});
