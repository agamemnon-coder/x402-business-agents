// The OAuth side of connecting an AI to Purser Cloud (cloud/src/claude/oauth.ts), refusal by refusal: a registered
// client's redirect addresses are https, or http on this machine, with no credentials or fragment; its id is signed, so
// a forged one is no client; a client id that is a metadata document's address is fetched once, without a redirect, at
// most 10 kB, and taken only when it names itself and lists acceptable redirect addresses as a public client; an
// authorize request needs one of the client's own redirect addresses, response_type code, PKCE S256 and this resource.
// A client's name is shown without control characters; a host Purser does not know is said to be unknown.
import { describe, expect, it } from "vitest";
import { authorizeAsk, backTo, clientOf, isCimdId, redirectHost, registerClient, resourceOf } from "../cloud/src/claude/oauth.js";

const SECRET = "oauth-test-secret-0123456789";
const ORIGIN = "https://cloud.test";
const now = new Date("2026-11-20T09:00:00Z");
const PKCE = "A".repeat(43);

describe("registering a client (RFC 7591)", () => {
  it("takes 1 to 5 https addresses, or http on this machine", async () => {
    const c = await registerClient(SECRET, { client_name: "Claude\u0000\u0007 Desktop\u007f", redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:33418/callback", "http://localhost/cb", "http://[::1]:9/cb"] });
    expect(c).toMatchObject({ client_name: "Claude Desktop", token_endpoint_auth_method: "none", grant_types: ["authorization_code"] });
    expect(String(c.client_id)).toMatch(/^pcc\./);
    expect(await registerClient(SECRET, { redirect_uris: ["https://a.example/cb"] })).toMatchObject({ client_name: "An MCP client" });
  });

  it("refuses an address that is plain http elsewhere, carries credentials or a fragment, is not a URL, or too long; and more than five", async () => {
    for (const bad of ["http://evil.example/cb", "https://user:pw@a.example/cb", "https://a.example/cb#frag", "not a url", `https://a.example/${"x".repeat(500)}`, "javascript:alert(1)"]) {
      await expect(registerClient(SECRET, { redirect_uris: [bad] }), bad.slice(0, 40)).rejects.toMatchObject({ status: 400, code: "invalid_redirect_uri" });
    }
    await expect(registerClient(SECRET, { redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`) })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    await expect(registerClient(SECRET, null)).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    await expect(registerClient(SECRET, { redirect_uris: [42] })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
  });

  it("a client id signed with another secret, or changed, is no client", async () => {
    const { client_id } = await registerClient(SECRET, { redirect_uris: ["https://a.example/cb"] }) as { client_id: string };
    expect(await clientOf(SECRET, client_id)).toEqual({ n: "An MCP client", r: ["https://a.example/cb"] });
    await expect(clientOf("another-secret", client_id)).rejects.toMatchObject({ status: 401, code: "invalid_client", message: "unknown client: register first" });
    await expect(clientOf(SECRET, `${client_id.slice(0, -3)}abc`)).rejects.toMatchObject({ code: "invalid_client" });
    await expect(clientOf(SECRET, "")).rejects.toMatchObject({ code: "invalid_client" });
  });
});

describe("a client id that is its metadata document's address", () => {
  it("is an https address with a host name and a path, nothing else", () => {
    expect(isCimdId("https://claude.ai/oauth/mcp-client-metadata.json")).toBe(true);
    for (const bad of ["http://claude.ai/x.json", "https://claude.ai/", "https://claude.ai:8443/x.json", "https://u:p@claude.ai/x.json", "https://claude.ai/x.json#a", "https://localhost/x.json", "https://10.0.0.1/x.json", "https://intranet/x.json", `https://claude.ai/${"x".repeat(500)}`, "pcc.abc.def"]) {
      expect(isCimdId(bad), bad.slice(0, 40)).toBe(false);
    }
  });

  const ID = "https://client.example/meta/oauth-client.json";
  const doc = (o: Record<string, unknown> = {}) => JSON.stringify({ client_id: ID, client_name: "Example AI", redirect_uris: ["https://client.example/cb"], token_endpoint_auth_method: "none", ...o });
  const fetchOf = (r: () => Response) => { const seen: RequestInit[] = []; return { seen, f: async (_u: string, init: RequestInit) => { seen.push(init); return r(); } }; };
  let n = 0;
  /** Each case its own address, so the five-minute cache of one case never answers another. */
  const idFor = () => `https://client${++n}.example/meta/oauth-client.json`;

  it("is fetched without following a redirect, and taken when it names itself and lists good addresses", async () => {
    const id = idFor();
    const { seen, f } = fetchOf(() => new Response(doc({ client_id: id }), { status: 200, headers: { "cache-control": "max-age=60" } }));
    expect(await clientOf(SECRET, id, f, now)).toEqual({ n: "Example AI", r: ["https://client.example/cb"], h: new URL(id).hostname });
    expect(seen[0]).toMatchObject({ method: "GET", redirect: "manual" });
    // Cached: asked again within its max-age, nothing is fetched.
    await clientOf(SECRET, id, f, new Date(now.getTime() + 30_000));
    expect(seen).toHaveLength(1);
    await clientOf(SECRET, id, f, new Date(now.getTime() + 61_000));
    expect(seen).toHaveLength(2);
  });

  it("is refused with its reason when it cannot be had or is not a public client's own document", async () => {
    const refused = async (r: (id: string) => Response | Promise<never>) => {
      const id = idFor();
      return clientOf(SECRET, id, async () => r(id), now).then(() => "accepted", (e: { code: string; message: string }) => `${e.code}: ${e.message}`);
    };
    expect(await clientOf(SECRET, idFor(), undefined, now).catch((e: Error) => e.message)).toBe("this server cannot fetch a client's metadata document; register at /oauth/register");
    expect(await refused(() => Promise.reject(new Error("dns")))).toBe("invalid_client: the client's metadata document could not be fetched");
    expect(await refused(() => new Response("", { status: 302, headers: { location: "https://evil.example" } }))).toBe("invalid_client: the client's metadata document answered 302 (a redirect is not followed)");
    expect(await refused(() => new Response("x".repeat(10_001), { status: 200 }))).toBe("invalid_client: the client's metadata document is larger than 10 kB");
    expect(await refused(() => new Response("{not json", { status: 200 }))).toBe("invalid_client: the client's metadata document is not JSON");
    expect(await refused(() => new Response(doc(), { status: 200 }))).toBe("invalid_client: the client's metadata document does not name its own address as client_id");
    expect(await refused((id) => new Response(doc({ client_id: id, redirect_uris: [] }), { status: 200 }))).toMatch(/needs 1 to 10 redirect_uris/);
    expect(await refused((id) => new Response(doc({ client_id: id, redirect_uris: ["http://evil.example/cb"] }), { status: 200 }))).toMatch(/needs 1 to 10 redirect_uris/);
    expect(await refused((id) => new Response(doc({ client_id: id, token_endpoint_auth_method: "client_secret_basic" }), { status: 200 }))).toBe("invalid_client: only public clients (token_endpoint_auth_method none) can sign in here");
    // No name: its host stands for it.
    const id = idFor();
    expect((await clientOf(SECRET, id, async () => new Response(doc({ client_id: id, client_name: 42 }), { status: 200 }), now)).n).toBe(new URL(id).hostname);
  });
});

describe("an authorize request", () => {
  async function client(uris = ["https://claude.ai/api/mcp/auth_callback"]) {
    return (await registerClient(SECRET, { client_name: "Claude", redirect_uris: uris })).client_id as string;
  }
  const q = (o: Record<string, string>) => new URLSearchParams({ response_type: "code", code_challenge: PKCE, code_challenge_method: "S256", ...o });

  it("asks for this client, one of its own addresses, PKCE S256 and this resource", async () => {
    const id = await client();
    const { ask } = await authorizeAsk(SECRET, ORIGIN, q({ client_id: id, state: "s".repeat(600) }));
    // A client with one address may leave it out; the state is cut, the resource defaults to /mcp.
    expect(ask).toMatchObject({ redirect_uri: "https://claude.ai/api/mcp/auth_callback", resource: resourceOf(ORIGIN) });
    expect(ask.state).toHaveLength(500);
    expect(await authorizeAsk(SECRET, ORIGIN, q({ client_id: id, resource: ORIGIN }))).toMatchObject({ ask: { resource: ORIGIN } });
  });

  it("refuses another address, another response type, no or weak PKCE, another resource", async () => {
    const id = await client(["https://claude.ai/a", "https://claude.ai/b"]);
    const refused = (o: Record<string, string>) => authorizeAsk(SECRET, ORIGIN, q({ client_id: id, redirect_uri: "https://claude.ai/a", ...o })).then(() => "accepted", (e: { code: string }) => e.code);
    expect(await refused({ redirect_uri: "https://evil.example/cb" })).toBe("invalid_request");
    expect(await authorizeAsk(SECRET, ORIGIN, q({ client_id: id })).then(() => "accepted", (e: { code: string }) => e.code)).toBe("invalid_request");
    expect(await refused({ response_type: "token" })).toBe("unsupported_response_type");
    expect(await refused({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await refused({ code_challenge: "short" })).toBe("invalid_request");
    expect(await refused({ resource: "https://other.example/mcp" })).toBe("invalid_target");
    expect(await refused({})).toBe("accepted");
  });

  it("goes back to the client's own address with the code, the state and the issuer", () => {
    const url = backTo({ client_id: "c", redirect_uri: "https://claude.ai/cb?x=1", state: "st", code_challenge: PKCE, resource: resourceOf(ORIGIN) }, ORIGIN, { code: "abc" });
    expect(new URL(url).searchParams.toString()).toBe("x=1&code=abc&state=st&iss=https%3A%2F%2Fcloud.test");
    expect(new URL(backTo({ client_id: "c", redirect_uri: "https://claude.ai/cb", state: "", code_challenge: PKCE, resource: "" }, ORIGIN, { error: "access_denied" })).searchParams.has("state")).toBe(false);
  });

  it("says when a redirect host is one Purser does not know", () => {
    expect(redirectHost("https://claude.ai/cb")).toEqual({ host: "claude.ai", known: true, loopback: false });
    expect(redirectHost("https://app.chatgpt.com/cb")).toMatchObject({ known: true });
    expect(redirectHost("http://127.0.0.1:5000/cb")).toEqual({ host: "127.0.0.1:5000", known: true, loopback: true });
    expect(redirectHost("https://claude.ai.evil.example/cb")).toMatchObject({ known: false });
    expect(redirectHost("http://claude.ai/cb")).toMatchObject({ known: false });
  });
});
