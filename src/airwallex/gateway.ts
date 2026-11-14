// The Airwallex gateway, Purser Cloud's side (the contract both Workers import is ./gatewayRules.ts): the same
// call(method, path, body, query) as src/airwallex/client.ts, over the service binding to kit11's AwxGateway entrypoint.
import { AirwallexAmbiguous, AirwallexError } from "./client.js";
import { gatewayCheck, GatewayRefused, type GatewayAnswer, type GatewayRequest, type GatewayRule } from "./gatewayRules.js";

export * from "./gatewayRules.js";

/** What the Cloud holds: the service binding's named entrypoint. */
export interface GatewayPort { call(r: GatewayRequest): Promise<GatewayAnswer> }

/**
 * The Cloud's side: the call of src/airwallex/client.ts over the gateway. A refusal is an AirwallexError (Airwallex's
 * code, its HTTP status); a POST without an answer is AirwallexAmbiguous (looked up by request_id, never resent blind).
 * `onBehalfOf` is null: the gateway acts for Purser's sandbox account only.
 */
export function gatewayApi(port: GatewayPort, onCall?: (r: GatewayRequest, rule: GatewayRule) => void) {
  return {
    onBehalfOf: null as string | null,
    async call<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
      const req: GatewayRequest = { method, path, ...(body === undefined ? {} : { body }), ...(query ? { query } : {}) };
      const checked = gatewayCheck(req);
      if ("refused" in checked) throw new GatewayRefused(checked.refused);
      onCall?.(req, checked.rule);
      let a: GatewayAnswer;
      try {
        a = await port.call(req);
      } catch (e) {
        if (method === "POST") throw new AirwallexAmbiguous(path, e);
        throw e;
      }
      if (a.ok) return a.json as T;
      if (a.refused) throw new GatewayRefused(a.refused);
      if (a.ambiguous && method === "POST") throw new AirwallexAmbiguous(path, new Error(`no answer (HTTP ${a.status})`));
      throw new AirwallexError(a.status, a.code ?? undefined, { code: a.code }, path, { traceId: a.trace_id });
    },
  };
}
