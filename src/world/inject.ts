// Blind holdouts (docs/runs/holdouts/2026-11-03-blind): a world event whose text comes from a file, published on one
// of the bus channels the world already uses, in the same payload shape as the world's own command for that channel
// (`supplier.notice` as price-rise, `invoice.received` as invoice, `dispute.opened` as dispute). It only publishes:
// no new rail, no payee, nothing that moves money. What the agents then do is theirs, and code's gates still apply.

import type { AgentName } from "../autonomy/bus.js";

export const INJECT_CHANNELS = { "supplier.notice": "sourcing", "invoice.received": "treasury", "dispute.opened": "support" } as const satisfies Record<string, AgentName>;
export type InjectChannel = keyof typeof INJECT_CHANNELS;

/** The event `npm run world -- inject <channel> <file> --from <name>` publishes; throws on anything else. */
export function injectedEvent(channel: string, o: { from: string; file: string; text: string }): { kind: InjectChannel; payload: Record<string, unknown>; agent: AgentName } {
  if (!Object.hasOwn(INJECT_CHANNELS, channel)) throw new Error(`not a world channel: ${channel} (one of ${Object.keys(INJECT_CHANNELS).join(", ")})`);
  const from = o.from.trim(), text = o.text.trim();
  if (!from) throw new Error("--from names the sender (the supplier, the vendor or the customer)");
  if (!text) throw new Error("the file is empty");
  const kind = channel as InjectChannel;
  const file = o.file.split(/[\\/]/).pop() ?? o.file;
  // The same lengths as the world's own commands (world.ts): an invoice up to 1500 characters, an email up to 2000.
  const payload = kind === "supplier.notice" ? { supplier: from, text: text.slice(0, 1500) }
    : kind === "invoice.received" ? { vendor: from, file, text: text.slice(0, 1500) }
      : { customer: from, email: text.slice(0, 2000) };
  return { kind, payload, agent: INJECT_CHANNELS[kind] };
}
