// /try/verify (A3): the receipt checked in the browser with WebCrypto, no server call. The page's checks
// (VERIFY_CORE, run here in Node's WebCrypto) must say exactly what `npm run verify-receipt` says (src/try/receipt.ts),
// check by check, on a good receipt and on every kind of change; the page must not be able to call any server.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { RECEIPT_FORMAT, verifyReceipt, type ReceiptResult, type TryReceipt } from "../src/try/receipt.js";
import { VERIFY_CORE, VERIFY_LEAD, tryVerifyPage } from "../src/try/verify.js";
import { TRY_VERIFY_CSP, TRY_VERIFY_PAGE } from "../src/servers/dashboard.js";
import { pageResponse } from "../worker/src/core.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { BASE, RP, call, challengeOf, desk, signBody, withPasskey } from "./support/trySign.js";

const verifyReceiptWeb = new Function(`${VERIFY_CORE}\nreturn verifyReceiptWeb;`)() as (r: unknown) => Promise<ReceiptResult>;

async function signed(withFx: boolean): Promise<TryReceipt> {
  const { d } = desk(undefined, withFx ? new StandInQuotes() : null);
  const { w, auth, b } = await withPasskey(d, new FakeAuthenticator());
  const a = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
  const r = await call(d, "sign", signBody(w.world.token, b, a));
  expect(r.status).toBe(200);
  const ans = (await r.json()) as { terms_sha256: string; public_key: TryReceipt["public_key"] };
  return {
    receipt: RECEIPT_FORMAT, note: "", terms: JSON.parse(b.canonical) as Record<string, unknown>, terms_sha256: ans.terms_sha256, algorithm: "ES256", public_key: ans.public_key,
    credential_id: a.id, rp_id: RP, origin: BASE, assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature },
  };
}
const flipByte = (b64u: string, at: number) => { const b = Buffer.from(b64u, "base64url"); b[at] = b[at]! ^ 0x01; return b.toString("base64url"); };
const with_ = (r: TryReceipt, patch: (c: TryReceipt) => void) => { const c = JSON.parse(JSON.stringify(r)) as TryReceipt; patch(c); return c; };

describe("the browser's checks are verify-receipt's, check by check", () => {
  it("on a good receipt, with and without an FX quote, and on every change", async () => {
    for (const fx of [false, true]) {
      const good = await signed(fx);
      const cases: [string, unknown, string[]][] = [
        ["good", good, []],
        ["amount + 0.01", with_(good, (c) => { c.terms.amount = "1850.01"; }), ["terms hash"]],
        ["IBAN", with_(good, (c) => { c.terms.payee_iban = "DE00000000000000000666"; }), ["terms hash"]],
        ["currency", with_(good, (c) => { c.terms.currency = "USD"; }), ["terms hash"]],
        ["the hash too", with_(good, (c) => { c.terms.amount = "1850.01"; c.terms_sha256 = createHash("sha256").update("x").digest("hex"); }), ["terms hash", "challenge"]],
        ["a number in the terms", with_(good, (c) => { (c.terms as Record<string, unknown>).amount = 1850; }), ["terms"]],
        ["the signature", with_(good, (c) => { c.assertion.signature = flipByte(c.assertion.signature, 12); }), ["signature"]],
        ["another key", with_(good, (c) => { c.public_key.x = flipByte(c.public_key.x, 5); }), ["signature"]],
        ["another origin", with_(good, (c) => { c.origin = "https://elsewhere.example"; }), ["origin"]],
        ["another RP id", with_(good, (c) => { c.rp_id = "elsewhere.example"; }), ["RP id"]],
        ["user verification off", with_(good, (c) => { const a = Buffer.from(c.assertion.authenticatorData, "base64url"); a[32] = a[32]! & ~0x04; c.assertion.authenticatorData = a.toString("base64url"); }), ["user verified", "signature"]],
        ["algorithm", with_(good, (c) => { (c as { algorithm: string }).algorithm = "RS256"; }), ["algorithm"]],
        ["not a receipt", { hello: "world" }, ["format"]],
        ["no assertion", with_(good, (c) => { delete (c as Partial<TryReceipt>).assertion; }), ["format"]],
      ];
      if (fx) cases.push(["FX rate", with_(good, (c) => { (c.terms.fx as Record<string, string>).client_rate = "1.129678"; }), ["terms hash"]]);
      for (const [what, r, fails] of cases) {
        const node = verifyReceipt(r), web = await verifyReceiptWeb(r);
        expect({ what, fx, web }).toEqual({ what, fx, web: node });
        expect({ what, failed: web.checks.filter((c) => !c.ok).map((c) => c.check) }).toEqual({ what, failed: fails });
        expect(web.ok).toBe(fails.length === 0);
      }
    }
  });
});

describe("the page: in the browser only, under a CSP that allows no connection", () => {
  it("says what it is, and its CSP hashes its one script and forbids every connection", () => {
    const html = tryVerifyPage();
    expect(html).toBe(TRY_VERIFY_PAGE);
    expect(html).toContain(VERIFY_LEAD);
    expect(VERIFY_LEAD).toBe("Don't trust our server: check it yourself.");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(TRY_VERIFY_CSP).toContain(`script-src 'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`);
    expect(TRY_VERIFY_CSP).toContain("connect-src 'none'");
    expect(TRY_VERIFY_CSP).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(html.match(/<script>/g)).toHaveLength(1);
    // Nothing in it could reach a server: no fetch, beacon, XHR, socket or form.
    expect(script).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource|\.submit\(/);
    expect(html).not.toMatch(/<form/);
  });

  it("the Worker serves it at /try/verify only in a bundle that has /try/sign, with that CSP", async () => {
    const pages = { tryVerify: TRY_VERIFY_PAGE, csp: { tryVerify: TRY_VERIFY_CSP } } as unknown as Parameters<typeof pageResponse>[1];
    const r = pageResponse(new Request("https://x.example/try/verify"), { ...pages, csp: { ...(pages as { csp: object }).csp } } as never);
    expect(r?.status).toBe(200);
    expect(r?.headers.get("content-security-policy")).toBe(TRY_VERIFY_CSP);
    expect(pageResponse(new Request("https://x.example/try/verify"), { csp: {} } as never)?.status ?? 404).toBe(404);
  });
});
