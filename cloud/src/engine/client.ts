// The Worker's side of a company's engine: the engine's interface (./api.ts) answered by a stub of the company's
// Durable Object (./object.ts). Every method is one call across the stub, with the company's id; the object's answer
// is data, and a refusal in it is thrown here in the object's own words (so the routes treat this engine as they treat
// the one in this process). Only types and the list of method names are imported: nothing of the engine.
import { ENGINE_METHODS, type EngineApi } from "./api.js";
import type { EngineAnswer } from "./object.js";

/** The ENGINE binding: the namespace of the company engines. */
export interface EngineNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { call(tenantId: string, method: keyof EngineApi, args: unknown[]): Promise<EngineAnswer> };
}

/** The only mode there is: the engine pays on a stand-in bank. Any other value leaves the engine off. */
export const ENGINE_MODE = "test_money";

export function engineStubs(ns: EngineNamespace): (tenantId: string) => EngineApi {
  return (tenantId) => {
    const stub = ns.get(ns.idFromName(tenantId));
    const method = (name: keyof EngineApi) => async (...args: unknown[]): Promise<unknown> => {
      const answer = await stub.call(tenantId, name, args);
      if (!answer.ok) throw new Error(answer.error);
      return answer.value;
    };
    return Object.fromEntries(ENGINE_METHODS.map((name) => [name, method(name)])) as unknown as EngineApi;
  };
}
