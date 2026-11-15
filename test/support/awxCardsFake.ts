// A small Airwallex sandbox for the agents' live cards (test/agent-cards.test.ts, test/browser/agent-cards.check.ts):
// login, cardholders, cards, transactions and the purchase simulation, in memory. It sends a full card number and a CVV
// on purpose, as a careless API might, so the tests can show neither ever gets past kit11's card desk.
export const PAN = "4242424242421902";
export const CVV = "737";

/** A small Airwallex sandbox: login, cardholders, cards, transactions, the purchase simulation. It leaks a PAN and a CVV on purpose. */
export function fakeSandbox(o: { issuing?: boolean } = {}) {
  const calls: string[] = [];
  type FakeCard = { card_id: string; card_status: string; nick_name: string; per: number; month: number; created_at?: string; last4?: string };
  const cards = new Map<string, FakeCard>();
  const byRequest = new Map<string, string>();
  const holders: { cardholder_id: string; email: string }[] = [];
  const txs: Record<string, unknown>[] = [];
  let n = 0;
  // Each card's own full number (the default PAN, or PAN with another last four): it must never get past kit11.
  const cardJson = (c: FakeCard) => ({
    card_id: c.card_id, cardholder_id: "ch_secret_holder", card_number: c.last4 ? PAN.slice(0, 12) + c.last4 : PAN, cvv: CVV, card_status: c.card_status, nick_name: c.nick_name, brand: "VISA",
    created_at: c.created_at ?? "2026-11-15T03:00:00.000+0000",
    authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: c.per, interval: "PER_TRANSACTION" }, { amount: c.month, interval: "MONTHLY" }] } },
  });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = u.pathname.replace(/^\/api\/v1/, "");
    calls.push(`${method} ${path}`);
    if (u.host !== "api.sandbox.airwallex.com") throw new Error(`not the sandbox: ${u.host}`);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : {}; // eslint-disable-line @typescript-eslint/no-explicit-any -- a fake API's loose JSON
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/authentication/login") return ok({ token: "tok" });
    if (path.startsWith("/issuing") && o.issuing === false) return new Response(JSON.stringify({ code: "unauthorized" }), { status: 403 });
    const ps = u.searchParams.get("page_size");
    if (method === "GET" && ps !== null && Number(ps) < 10) return new Response(JSON.stringify({ code: "validation_failed" }), { status: 400 });
    if (method === "GET" && path === "/issuing/cards") return ok({ items: [...cards.values()].map(cardJson), has_more: false });
    if (method === "GET" && path === "/issuing/cardholders") return ok({ items: holders, has_more: false });
    if (method === "POST" && path === "/issuing/cardholders/create") { const h = { cardholder_id: `ch_${++n}`, email: body.email }; holders.push(h); return ok(h); }
    if (method === "POST" && path === "/issuing/cards/create") {
      const again = byRequest.get(body.request_id);
      if (again) return ok(cardJson(cards.get(again)!));
      const lim = body.authorization_controls.transaction_limits.limits;
      const c = { card_id: `card_${String(++n).padStart(8, "0")}`, card_status: "ACTIVE", nick_name: body.nick_name, per: lim[0].amount, month: lim[1].amount };
      cards.set(c.card_id, c); byRequest.set(body.request_id, c.card_id);
      return ok(cardJson(c));
    }
    const m = /^\/issuing\/cards\/([^/]+)(\/update)?$/.exec(path);
    if (m) {
      const c = cards.get(m[1]!);
      if (!c) return new Response("{}", { status: 404 });
      if (m[2]) {
        if (body.card_status) c.card_status = body.card_status;
        const lim = body.authorization_controls?.transaction_limits?.limits;
        if (lim) { c.per = lim[0].amount; c.month = lim[1].amount; }
      }
      return ok(cardJson(c));
    }
    if (method === "GET" && path === "/issuing/transactions") return ok({ items: txs.filter((t) => t.card_id === u.searchParams.get("card_id")), has_more: false });
    if (method === "POST" && path === "/simulation/issuing/create") {
      const c = cards.get(body.card_id)!;
      const reason = c.card_status !== "ACTIVE" ? "CARD_INACTIVE" : body.transaction_amount > c.per ? "LIMIT_EXCEEDED" : null;
      const t = { card_transaction_id: `ctx_${++n}`, card_id: c.card_id, card_number: PAN, transaction_amount: -body.transaction_amount, transaction_currency: "EUR", status: reason ? "FAILED" : "APPROVED", failure_reason: reason, transaction_date: "2026-11-08T12:00:01Z", merchant: { name: "Purser test merchant____", category_code: body.merchant_category_code } };
      txs.push(t);
      return ok(t);
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  /** An older card already at the sandbox (a run before this one). */
  const seed = (c: Omit<FakeCard, "card_id"> & { card_id?: string }) => { const id = c.card_id ?? `card_seed_${String(++n).padStart(4, "0")}`; cards.set(id, { ...c, card_id: id }); return id; };
  return { calls, cards, fetchImpl, seed };
}

