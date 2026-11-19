// The phone page's start and its talk with the relay (src/approve/client.ts), without a page: boot() keeps the keys a
// link brings and takes them out of the address bar; api() sends the viewer key, and (D20) signs in with the passkey
// once before a CFO action when the relay said there is no session, or once after the relay asks for one, and never
// prompts twice for one action. Also the passkey's serialization and error words. The browser, location, history and
// storage are stood in for here; the page code that builds screens runs in the browser checks (test/browser).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("../src/approve/client.js");
const VIEW = "0123456789abcdef0123456789abcdef";
const RUNNER = "R".repeat(100);

interface Call { url: string; init: RequestInit }
let calls: Call[];
let answers: ((c: Call) => Response | Promise<Response>)[];
let store: Map<string, string>;
let replaceState: ReturnType<typeof vi.fn>;
let setIntervalFn: ReturnType<typeof vi.fn>;
let credentialsGet: ReturnType<typeof vi.fn>;
let swRegister: ReturnType<typeof vi.fn>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (...b: number[]) => new Uint8Array(b).buffer;

/** A passkey assertion as navigator.credentials.get returns it. */
function assertion(o: { userHandle?: ArrayBuffer | null; attachment?: string | null } = {}) {
  return {
    id: "cred-1", rawId: bytes(1, 2, 3), type: "public-key",
    response: { clientDataJSON: bytes(4), authenticatorData: bytes(5), signature: bytes(6), userHandle: o.userHandle ?? null },
    getClientExtensionResults: () => ({}),
    authenticatorAttachment: o.attachment ?? null,
  };
}

function stubBrowser(o: { hash?: string; manifest?: boolean; page?: string; storage?: "ok" | "throws" } = {}) {
  calls = [];
  answers = [];
  store = new Map();
  replaceState = vi.fn();
  setIntervalFn = vi.fn();
  credentialsGet = vi.fn();
  swRegister = vi.fn(() => Promise.resolve());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const c = { url, init };
    calls.push(c);
    const next = answers.shift();
    if (!next) throw new Error(`no answer scripted for ${url}`);
    return next(c);
  }));
  vi.stubGlobal("location", { hostname: "phone.example", hash: o.hash ?? "", pathname: "/approve/P-1", search: "?x=1" });
  vi.stubGlobal("history", { replaceState });
  vi.stubGlobal("setInterval", setIntervalFn);
  vi.stubGlobal("navigator", { credentials: { get: credentialsGet }, ...(o.manifest ? { serviceWorker: { register: swRegister } } : {}) });
  if (o.storage === "throws") {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  } else {
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  }
  vi.stubGlobal("document", {
    querySelector: (sel: string) => (o.manifest && sel === 'link[rel="manifest"]' ? {} : null),
    body: { dataset: o.page ? { page: o.page } : {} },
  });
}

/** A fresh copy of the page script, which boots on import as it does in the browser. */
async function load(o: Parameters<typeof stubBrowser>[0] = {}): Promise<Client> {
  stubBrowser(o);
  vi.resetModules();
  return import("../src/approve/client.js");
}

const headers = (c: Call) => c.init.headers as Record<string, string>;

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("boot", () => {
  it("keeps the viewer and runner keys a link brings on this device and takes them out of the address bar", async () => {
    await load({ hash: `#view=${VIEW}&runner=${RUNNER}` });
    expect(store.get("kit11.view")).toBe(VIEW);
    expect(store.get("kit11.runner")).toBe(RUNNER);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/approve/P-1?x=1");
    // The countdowns tick every second.
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it("leaves the address bar alone when the link carries no key, and registers the service worker only with a manifest", async () => {
    await load({ hash: "#other" });
    expect(replaceState).not.toHaveBeenCalled();
    expect(swRegister).not.toHaveBeenCalled();
    await load({ manifest: true });
    expect(swRegister).toHaveBeenCalledWith("/sw.js");
  });

  it("still starts when this browser refuses storage (a private window): the link's key holds for this page", async () => {
    const c = await load({ hash: `#view=${VIEW}`, storage: "throws" });
    answers.push(() => json(200, {}));
    await c.api("/api/approvals");
    expect(headers(calls[0]!)["x-kit11-view"]).toBe(VIEW);
  });
});

describe("api", () => {
  it("asks with the viewer key and no body, and hands back the status and the answer", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    answers.push(() => json(200, { proposals: [] }));
    expect(await c.api("/api/approvals")).toEqual({ status: 200, data: { proposals: [] } });
    expect(calls[0]!.url).toBe("/api/approvals");
    expect(calls[0]!.init).toMatchObject({ cache: "no-store" });
    expect(calls[0]!.init.method).toBeUndefined();
    expect(headers(calls[0]!)).toEqual({ accept: "application/json", "x-kit11-view": VIEW });
  });

  it("posts a body as JSON, and reads an answer that is not a JSON object as empty", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    answers.push(() => new Response("not json", { status: 502 }), () => json(200, [1, 2]));
    expect(await c.api("/api/decide", { decision: "REJECTED" })).toEqual({ status: 502, data: {} });
    expect(calls[0]!.init).toMatchObject({ method: "POST", body: '{"decision":"REJECTED"}' });
    expect(headers(calls[0]!)["content-type"]).toBe("application/json");
    expect(await c.api("/api/approvals")).toEqual({ status: 200, data: {} });
  });

  it("signs in with the passkey first when the relay said this device has no session, then sends the action once", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    answers.push(() => json(200, { session_active: false }));
    await c.api("/api/approvals");
    credentialsGet.mockResolvedValue(assertion({ userHandle: bytes(9), attachment: "platform" }));
    answers.push(() => json(200, { challenge: "Y2hhbA", allow: ["AQI"] }), () => json(200, { ok: true }), () => json(200, { saved: true }));
    expect(await c.api("/api/policy", { changes: [] })).toEqual({ status: 200, data: { saved: true } });
    expect(calls.slice(1).map((x) => x.url)).toEqual(["/api/session/options", "/api/session", "/api/policy"]);
    // The prompt is for this site, with Face ID required, for the passkeys the relay allows.
    const pk = credentialsGet.mock.calls[0]![0].publicKey;
    expect(pk).toMatchObject({ rpId: "phone.example", userVerification: "required", timeout: 60_000 });
    expect([...new Uint8Array(pk.challenge)]).toEqual([...Buffer.from("chal")]);
    expect([...new Uint8Array(pk.allowCredentials[0].id)]).toEqual([1, 2]);
    const session = JSON.parse(String(calls[2]!.init.body)) as { challenge: string; credential: Record<string, unknown> };
    expect(session.challenge).toBe("Y2hhbA");
    expect(session.credential).toEqual({
      id: "cred-1", rawId: "AQID", type: "public-key",
      response: { clientDataJSON: "BA", authenticatorData: "BQ", signature: "Bg", userHandle: "CQ" },
      clientExtensionResults: {}, authenticatorAttachment: "platform",
    });
    // Signed in: the next action goes straight through.
    answers.push(() => json(200, { saved: true }));
    await c.api("/api/policy", { changes: [] });
    expect(calls.at(-1)!.url).toBe("/api/policy");
    expect(credentialsGet).toHaveBeenCalledTimes(1);
  });

  it("asks once per action: a sign-in that fails still sends the action, and its 401 does not prompt again", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    answers.push(() => json(200, { session_active: false }));
    await c.api("/api/approvals");
    credentialsGet.mockRejectedValue(Object.assign(new Error("cancelled"), { name: "NotAllowedError" }));
    answers.push(() => json(200, { challenge: "Y2hhbA" }), () => json(401, { error: "sign in with your passkey first" }));
    expect(await c.api("/api/ask", { q: "cash?" })).toEqual({ status: 401, data: { error: "sign in with your passkey first" } });
    expect(calls.slice(1).map((x) => x.url)).toEqual(["/api/session/options", "/api/ask"]);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
  });

  it("does not sign in first for paths that need no session, nor for reads", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    answers.push(() => json(200, { session_active: false }), () => json(200, {}), () => json(200, {}));
    await c.api("/api/approvals");
    await c.api("/api/decide", { d: 1 });
    await c.api("/api/policy");
    expect(calls.map((x) => x.url)).toEqual(["/api/approvals", "/api/decide", "/api/policy"]);
    expect(credentialsGet).not.toHaveBeenCalled();
  });

  it("when a session lapsed (401 asking for one), signs in once and sends the same request again", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    credentialsGet.mockResolvedValue(assertion());
    answers.push(
      () => json(401, { error: "sign in with your passkey first (D20)" }),
      () => json(200, { challenge: "Y2hhbA" }), () => json(200, {}),
      () => json(200, { drafted: true }),
    );
    expect(await c.api("/api/policy-text", { text: "cap 500" })).toEqual({ status: 200, data: { drafted: true } });
    expect(calls.map((x) => x.url)).toEqual(["/api/policy-text", "/api/session/options", "/api/session", "/api/policy-text"]);
    expect(calls[3]!.init.body).toBe(calls[0]!.init.body);
    // No user handle and no attachment: neither is sent.
    const cred = (JSON.parse(String(calls[2]!.init.body)) as { credential: { response: object } }).credential;
    expect(cred.response).not.toHaveProperty("userHandle");
    expect(cred).not.toHaveProperty("authenticatorAttachment");
  });

  it("returns the 401 as it is when the sign-in after it fails, and does not retry a 401 of another kind", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    answers.push(() => json(401, { error: "sign in with your passkey first" }), () => json(500, {}));
    expect(await c.api("/api/policy", { a: 1 })).toEqual({ status: 401, data: { error: "sign in with your passkey first" } });
    answers.push(() => json(401, { error: "wrong viewer key" }));
    expect((await c.api("/api/policy", { a: 1 })).status).toBe(401);
    answers.push(() => json(401, { error: 7 }));
    expect((await c.api("/api/policy", { a: 1 })).status).toBe(401);
    expect(calls.map((x) => x.url)).toEqual(["/api/policy", "/api/session/options", "/api/policy", "/api/policy"]);
  });
});

describe("passkeySignIn", () => {
  it("is false when the options cannot be had, carry no challenge, the prompt gives nothing, or the relay refuses", async () => {
    const c = await load({ hash: `#view=${VIEW}` });
    answers.push(() => { throw new Error("offline"); });
    expect(await c.passkeySignIn()).toBe(false);
    answers.push(() => json(200, { allow: [] }));
    expect(await c.passkeySignIn()).toBe(false);
    answers.push(() => new Response("{", { status: 200 }));
    expect(await c.passkeySignIn()).toBe(false);
    credentialsGet.mockResolvedValueOnce(null);
    answers.push(() => json(200, { challenge: "AA" }));
    expect(await c.passkeySignIn()).toBe(false);
    credentialsGet.mockResolvedValueOnce(assertion());
    answers.push(() => json(200, { challenge: "AA" }), () => json(403, {}));
    expect(await c.passkeySignIn()).toBe(false);
    credentialsGet.mockResolvedValueOnce(assertion());
    answers.push(() => json(200, { challenge: "AA" }), () => { throw new Error("offline"); });
    expect(await c.passkeySignIn()).toBe(false);
    credentialsGet.mockResolvedValueOnce(assertion());
    answers.push(() => json(200, { challenge: "AA" }), () => json(200, {}));
    expect(await c.passkeySignIn()).toBe(true);
    // Its own session request goes with the cookie and the viewer key.
    expect(calls.at(-1)!.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(headers(calls.at(-1)!)["x-kit11-view"]).toBe(VIEW);
  });
});

describe("the passkey's words and wire form", () => {
  it("says a cancelled prompt in the page's language, and names the other refusals", async () => {
    const c = await load();
    vi.stubGlobal("PURSER_PHRASES", { nl: { "ph.cancelled": "Geannuleerd." }, en: { "ph.cancelled": "Cancelled (en)." } });
    const err = (name: string, message = "m") => Object.assign(new Error(message), { name });
    expect(c.passkeyError(err("NotAllowedError"))).toBe("Cancelled. Nothing was signed.");
    expect(c.passkeyError(err("AbortError"), "nl")).toBe("Geannuleerd.");
    expect(c.passkeyError(err("NotAllowedError"), "en")).toBe("Cancelled (en).");
    expect(c.passkeyError(err("InvalidStateError"))).toBe("This phone already has a passkey for this site.");
    expect(c.passkeyError(err("SecurityError"))).toBe("The passkey cannot be used on this address.");
    expect(c.passkeyError(err("TypeError", "bad options"))).toBe("The passkey did not answer: bad options");
    expect(c.passkeyError("plain")).toBe("The passkey did not answer: plain");
  });

  it("serializes a registration with its transports, or none when the browser cannot say", async () => {
    const c = await load();
    const reg = (getTransports?: () => string[], attachment: string | null = null) => ({
      id: "new", rawId: bytes(255), type: "public-key",
      response: { clientDataJSON: bytes(1), attestationObject: bytes(2), ...(getTransports ? { getTransports } : {}) },
      getClientExtensionResults: () => ({ credProps: { rk: true } }), authenticatorAttachment: attachment,
    }) as unknown as PublicKeyCredential;
    expect(c.serializeRegistration(reg(() => ["internal", "hybrid"], "platform"))).toEqual({
      id: "new", rawId: "_w", type: "public-key",
      response: { clientDataJSON: "AQ", attestationObject: "Ag", transports: ["internal", "hybrid"] },
      clientExtensionResults: { credProps: { rk: true } }, authenticatorAttachment: "platform",
    });
    const none = c.serializeRegistration(reg());
    expect((none.response as { transports: string[] }).transports).toEqual([]);
    expect(none).not.toHaveProperty("authenticatorAttachment");
    expect(c.serializeAssertion(assertion() as unknown as PublicKeyCredential)).toMatchObject({ id: "cred-1", rawId: "AQID" });
  });

  it("reads the terms as sent, or nothing when they are not a JSON object", async () => {
    const c = await load();
    expect(c.parsedOrEmpty('{"amount":"1.00"}')).toEqual({ amount: "1.00" });
    expect(c.parsedOrEmpty("[1]")).toEqual({});
    expect(c.parsedOrEmpty("null")).toEqual({});
    expect(c.parsedOrEmpty("{")).toEqual({});
  });

  it("names a line's account as masked, or by the IBAN's last four", async () => {
    const c = await load();
    expect(c.lineAccount({ account: "NL** 1234", iban_last4: "9999" })).toBe("NL** 1234");
    expect(c.lineAccount({ iban_last4: "9999" })).toBe("IBAN …9999");
    expect(c.lineAccount({})).toBe("");
  });
});
