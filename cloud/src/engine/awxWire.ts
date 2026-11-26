// The two banks of a company's engine in Purser Cloud (14 Nov): the simulated bank it always had, and the Airwallex
// sandbox through the kit11 gateway (src/airwallex/gateway.ts), behind one routed rail (src/airwallex/routedRail.ts) and
// the Cloud's guard (./awxGuard.ts). Used by the Durable Object (./hostWorker.ts) and its Node twin (./node.ts).
// This file loads the engine's Airwallex adapters: only the engine's own modules import it.
import { AirwallexRest } from "../../../src/airwallex/adapter.js";
import { AirwallexBatchRest } from "../../../src/airwallex/batchTransfers.js";
import type { Airwallex } from "../../../src/airwallex/client.js";
import { gatewayApi, type GatewayPort } from "../../../src/airwallex/gateway.js";
import { AirwallexPayeeNameRest, type PayeeNameVerifier } from "../../../src/airwallex/payeeName.js";
import { RoutedRail, type ActGuard, type Rails3 } from "../../../src/airwallex/routedRail.js";
import { ActVerifier, type ActStore } from "../../../src/engine/awxActions.js";
import type { Rails } from "../../../src/executors/index.js";
import type { FakeAirwallex } from "../../../src/redteam/airwallex.js";

/** A port for a deployment without the gateway: every call refused (the guard stops them before they get here). */
const noGateway: GatewayPort = { call: async () => ({ ok: false, status: 503, code: "no_gateway", trace_id: null, refused: "this deployment has no Airwallex gateway" }) };

/**
 * `standIn`: local checks only (test/browser/awx-act.check.ts): an in-memory stand-in in Airwallex's place, so the
 * console can be walked on this machine with no network. Never set by the Worker.
 * `stop`: asked immediately before every create that moves money, at either bank (the company's emergency stop,
 * src/policy/emergencyStop.ts railStop); a reason stops it, nothing sent.
 */
export function wireAirwallex(o: { bank: FakeAirwallex; store: ActStore; guard: ActGuard; port: GatewayPort | null; now?: () => Date; standIn?: { rail: Rails3; payees: PayeeNameVerifier }; stop?: (what: "conversion" | "transfer" | "batch", ref: string) => string | null }): { routed: RoutedRail; rails: Rails; verifier: () => PayeeNameVerifier } {
  const now = o.now ?? (() => new Date());
  const api = gatewayApi(o.port ?? noGateway) as unknown as Airwallex;
  const rest = o.standIn?.rail ?? new AirwallexRest(api);
  const routed = new RoutedRail(rest, o.bank as unknown as ConstructorParameters<typeof RoutedRail>[1], o.store, o.guard, new AirwallexBatchRest(api),
    (what, why) => o.store.note({ at: now().toISOString(), ref: "", what, bank: "simulated", label: `${what} on the simulated bank: ${why}` }), o.stop);
  const rails = { rail: routed, sim: routed, get batches() { return routed.batches; } } as Rails;
  const awxVerifier = o.standIn?.payees ?? (o.port ? new AirwallexPayeeNameRest(api) : null);
  const verifier = () => new ActVerifier(awxVerifier, o.guard, (why) => o.store.note({ at: now().toISOString(), ref: "", what: "bank check", bank: "simulated", label: `the payee's bank was not asked through Airwallex (${why}); the stand-in answered, labelled` }));
  return { routed, rails, verifier };
}
