// What the console keeps in the browser (ASVS 4.0.3 V8.2.2, V8.2.3 in docs/security/asvs-l2.md). The session token is in
// sessionStorage (this tab, gone when it closes); the Overview's last live Airwallex read (the sandbox's balances) is
// kept beside it in sessionStorage, never in localStorage, and signing out (or a session that ends) removes both. A copy
// an older page left in localStorage is removed when the console loads.
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { scriptBlocks, scriptBody } from "./support/scriptBlocks.js";
import { ORIGIN, RP } from "./support/cloud.js";

const js = (() => {
  const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" });
  const blocks = scriptBlocks(html).filter((b) => !/src=|type="application\/json"/.test(b.slice(0, b.indexOf(">"))));
  return blocks.map(scriptBody).join("\n");
})();

class Store {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

/** One top-level `const name=…;` statement of the console's script, by its start and the next line. */
function statement(name: string): string {
  const a = js.indexOf(`const ${name}=`);
  expect(a, name).toBeGreaterThanOrEqual(0);
  return js.slice(a, js.indexOf("\n", a));
}

describe("the console's browser storage", () => {
  it("keeps the Airwallex overview in this tab's sessionStorage, never in localStorage", () => {
    expect(js).toContain("const AWL_OV_KEY='purser.awl.ov';");
    expect(js).not.toMatch(/localStorage\.(setItem|getItem)\(AWL_OV_KEY/);
    expect(js).toMatch(/sessionStorage\.setItem\(AWL_OV_KEY,/);
    expect(js).toMatch(/sessionStorage\.getItem\(AWL_OV_KEY\)/);
    // The only things in localStorage: the language, the company's short name and (26 Nov) whether the sidebar is
    // collapsed (no figure, no token).
    const keys = [...js.matchAll(/localStorage\.setItem\('([^']+)'/g)].map((m) => m[1]);
    expect(new Set(keys)).toEqual(new Set(["purser.cloud.language", "purser.cloud.slug", "purser.cloud.sb"]));
  });

  it("removes the session and the overview at sign-out, and an older page's localStorage copy on load", () => {
    const sessionStorage = new Store(), localStorage = new Store();
    sessionStorage.setItem("purser.cloud.session", "{}");
    sessionStorage.setItem("purser.awl.ov", '{"b":{}}');
    sessionStorage.setItem("purser.other", "kept");
    localStorage.setItem("purser.awl.ov", '{"b":{}}');
    localStorage.setItem("purser.cloud.slug", "acme");
    const ctx = { sessionStorage, localStorage, out: null as unknown };
    new Script(`${statement("KEY")}\n${statement("AWL_OV_KEY")}\n${statement("forget")}\n${statement("dropOldCopies")}\ndropOldCopies();out=forget`).runInNewContext(ctx);
    expect(localStorage.getItem("purser.awl.ov")).toBeNull();
    expect(localStorage.getItem("purser.cloud.slug")).toBe("acme");
    (ctx.out as () => void)();
    expect(sessionStorage.getItem("purser.cloud.session")).toBeNull();
    expect(sessionStorage.getItem("purser.awl.ov")).toBeNull();
    expect(sessionStorage.getItem("purser.other")).toBe("kept");
  });

  it("calls forget wherever a session ends: sign-out, a 401 and the 15 minutes", () => {
    expect(js).toContain("dropOldCopies();");
    expect(js.match(/forget\(\);S=null;ME=null/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
