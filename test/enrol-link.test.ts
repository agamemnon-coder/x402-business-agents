// /enrol without a viewer link first (14 Nov, the vic-5 run: the owner opened /enrol, typed the code, and only then met
// "this relay needs its viewer link"). The runner now prints one enrolment link that carries the viewer key and its own
// pin in the fragment, and the page says what is missing before anything is typed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enrolLink, viewerLink, type RelayConfig } from "../src/relay/config.js";

const cfg = { url: "https://relay.example", origin: "https://relay.example", rpId: "relay.example", token: "a".repeat(64) } as RelayConfig;
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("the enrolment link", () => {
  it("is the enrol page with the viewer link's own key and pin in its fragment", () => {
    const view = viewerLink(cfg, "SPKI", {});
    const enrol = enrolLink(cfg, "SPKI", {});
    expect(enrol).toBe(view.replace("https://relay.example/#", "https://relay.example/enrol#"));
    expect(enrol).toMatch(/^https:\/\/relay\.example\/enrol#view=[0-9a-f]{32}&runner=SPKI$/);
    // Without a runner key (adding a person from the CLI): the key alone.
    expect(enrolLink(cfg, undefined, {})).toMatch(/^https:\/\/relay\.example\/enrol#view=[0-9a-f]{32}$/);
  });

  it("is what the runner and the passkey CLI print, never the bare /enrol", () => {
    expect(src("src/cli/relay.ts")).toContain("on the phone open ${enrolLink(cfg, signer.publicSpki)} and type ${code}");
    expect(src("src/cli/passkey.ts")).toContain("on their phone open ${enrolLink(cfg)} and type ${code}");
    for (const f of ["src/cli/relay.ts", "src/cli/passkey.ts"]) expect(src(f)).not.toContain("${cfg.url}/enrol and type");
  });

  it("the page takes the key from its own address, and says what is missing before the code is typed", async () => {
    const client = src("src/approve/client.ts");
    // boot() reads #view and #runner on every page, /enrol included, then clears them from the address bar.
    expect(client).toMatch(/viewKey = takeViewKey\(location\.hash, store\);[\s\S]*if \(document\.body\.dataset\.page === "enrol"\) enrolPage\(\);/);
    const { ENROL_NEEDS_KEY } = await import("../src/approve/client.js");
    expect(ENROL_NEEDS_KEY).toMatch(/enrol link the runner printed \(it ends in #view=…\)/);
    expect(client).toMatch(/if \(!viewKey && [^\n]*\) \{\n\s+status\.textContent = ENROL_NEEDS_KEY;/);
  });
});
