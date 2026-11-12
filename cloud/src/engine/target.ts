// The cloud's read model as the target of the engine's feed (src/engine/feed.ts): where it stands is what a runner is
// told by GET /v1/sync/state, and a batch goes through the same applySync a runner's push goes through, with the same
// checks (the schema, both hash chains, the documents' hashes). No caller is named, so there is no key guard: the
// engine is not a sync key; it runs for the company whose TenantDb it is handed.
import type { FeedTarget } from "../../../src/engine/feed.js";
import type { Blobs } from "../store.js";
import { applySync, SyncBatch, syncState } from "../sync.js";
import type { TenantDb } from "../tenant.js";

export function cloudTarget(db: TenantDb, blobs: Blobs, now: () => Date): FeedTarget {
  return {
    state: () => syncState(db),
    apply: async (batch) => applySync(db, blobs, SyncBatch.parse(batch), now()),
  };
}
