// The passkeys' relying party per request (cloud/src/hostOrigin.ts): purser-try is served on its own address and, through
// kit11's service binding (worker/src/index.ts TRY_ENGINE), on the site's, with the request's URL unchanged. An allowed
// host gets its own RP id and origin, any other host the deployment's own; the same-origin check on POSTs reads the
// same origin; and a passkey made on the site's address signs an approval there, end to end, over HTTP.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handle } from "../cloud/src/app.js";
import { forRequest, relyingPartyFor, RP_HOSTS, rpAllowed } from "../cloud/src/hostOrigin.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const KIT11 = "kit11.max-31b.workers.dev";
const TRY = "purser-try.max-31b.workers.dev";
const own = { rpId: RP, origin: ORIGIN };

describe("relyingPartyFor", () => {
  it("allows the two hosts, as a constant", () => {
    expect(RP_HOSTS).toEqual([TRY, KIT11]);
  });

  it("gives an allowed host its own RP id and origin", () => {
    expect(relyingPartyFor(`https://${KIT11}/try`, own)).toEqual({ rpId: KIT11, origin: `https://${KIT11}` });
    expect(relyingPartyFor(`https://${TRY}/v1/engine/passkey/start`, own)).toEqual({ rpId: TRY, origin: `https://${TRY}` });
  });

  it("gives the deployment's own host, and any other host, the env's defaults", () => {
    expect(relyingPartyFor(`${ORIGIN}/try`, own)).toEqual(own);
    expect(relyingPartyFor("https://elsewhere.example/try", own)).toEqual(own);
    expect(relyingPartyFor(`https://evil.${KIT11}/try`, own)).toEqual(own);
    expect(relyingPartyFor(`http://localhost:8787/try`, { rpId: "localhost", origin: "http://localhost:8787" })).toEqual({ rpId: "localhost", origin: "http://localhost:8787" });
  });

  it("lets the engine take only an allowed relying party", () => {
    expect(rpAllowed({ rpId: KIT11, origin: `https://${KIT11}` }, own)).toBe(true);
    expect(rpAllowed(own, own)).toBe(true);
    expect(rpAllowed({ rpId: KIT11, origin: "https://elsewhere.example" }, own)).toBe(false);
    expect(rpAllowed({ rpId: "elsewhere.example", origin: "https://elsewhere.example" }, own)).toBe(false);
  });
});

describe("the cloud on the site's address (the request's URL host is kit11)", () => {
  let c: TestCloud;
  let A: TestTenant;
  const phone = new FakeAuthenticator();
  /** As the Worker does (cloud/src/worker.ts): the env for this request, then the app. */
  const at = async (host: string, method: string, path: string, o: { key?: string; body?: unknown; origin?: string } = {}) => {
    const req = new Request(`https://${host}${path}`, { method, headers: { ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}), ...(o.origin ? { origin: o.origin } : {}) }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    const res = await handle(req, forRequest(c.env, req));
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* a page */ }
    return { status: res.status, json, text };
  };

  beforeAll(async () => {
    c = testCloud({ engine: true });
    A = await c.tenant("northwind");
    expect((await c.req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status).toBe(200);
  });
  afterAll(() => c.close());

  it("accepts a POST whose Origin is the site's, and refuses another Origin", async () => {
    const ok = await at(KIT11, "POST", "/v1/engine/sync", { key: A.session, origin: `https://${KIT11}` });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    for (const origin of [ORIGIN, `https://${TRY}`, "https://elsewhere.example"]) {
      const no = await at(KIT11, "POST", "/v1/engine/sync", { key: A.session, origin });
      expect(no.status, origin).toBe(403);
      expect(no.json.error).toBe("this request came from another site");
    }
    // On the deployment's own address its own origin still goes through, and the site's does not.
    expect((await at(new URL(ORIGIN).host, "POST", "/v1/engine/sync", { key: A.session, origin: ORIGIN })).status).toBe(200);
    expect((await at(new URL(ORIGIN).host, "POST", "/v1/engine/sync", { key: A.session, origin: `https://${KIT11}` })).status).toBe(403);
  });

  it("serves /try with the site's relying party on the site's address, and its own on its own", async () => {
    const cfg = (text: string) => JSON.parse(/<meta name="purser-try" content="([^"]*)"/.exec(text)![1]!.replace(/&quot;/g, '"')) as { rpId: string; origin: string };
    expect(cfg((await at(KIT11, "GET", "/try")).text)).toMatchObject({ rpId: KIT11, origin: `https://${KIT11}` });
    expect(cfg((await at(new URL(ORIGIN).host, "GET", "/try")).text)).toMatchObject({ rpId: RP, origin: ORIGIN });
  });

  it("makes the passkey on the site's relying party and signs the approval there: paid", async () => {
    const o = `https://${KIT11}`;
    const up = await at(KIT11, "POST", "/v1/engine/documents", { key: A.session, origin: o, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    const filed = await at(KIT11, "POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session, origin: o });
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    const proposal = filed.json.proposal as { id: string; terms_sha256: string; challenge: string };

    const start = await at(KIT11, "POST", "/v1/engine/passkey/start", { key: A.session, origin: o });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    expect(start.json.rp).toEqual({ id: KIT11, name: "Purser" });
    // A passkey made for the deployment's own relying party does not fit this window.
    const wrong = await at(KIT11, "POST", "/v1/engine/passkey/finish", { key: A.session, origin: o, body: { code: start.json.code, credential: new FakeAuthenticator().register({ challenge: start.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    expect(wrong.status).toBe(409);
    const again = await at(KIT11, "POST", "/v1/engine/passkey/start", { key: A.session, origin: o });
    const done = await at(KIT11, "POST", "/v1/engine/passkey/finish", { key: A.session, origin: o, body: { code: again.json.code, credential: phone.register({ challenge: again.json.challenge as string, origin: o, rpId: KIT11 }) } });
    expect(done.status, JSON.stringify(done.json)).toBe(200);

    const r = await at(KIT11, "POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: A.session, origin: o, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: proposal.challenge, origin: o, rpId: KIT11, counter: 1 }) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ status: "approved" });
  });
});
