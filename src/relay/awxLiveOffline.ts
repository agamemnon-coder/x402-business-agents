// Live with Airwallex on a local copy (npm run judge, the local relay): the same paths as the site's Worker, answered
// honestly. This copy holds no Airwallex key and receives no webhook, so the reconciliation badge is grey ("Airwallex
// unavailable") and the events feed holds no event. Nothing is made up.
import Database from "better-sqlite3";
import { AWX_EVENTS_PATH, AwxEventFeed } from "../../worker/src/awxEvents.js";
import { AWX_BOOKS_JSON_PATH, AWX_BOOKS_SVG_PATH, awxBooksResponse, booksCache } from "../../worker/src/awxBooks.js";
import { COMMON_HEADERS, type Sql } from "../../worker/src/core.js";

/** An in-memory store (imported by ./local.ts, so it does not import that file back). */
const memory = (): Sql => { const db = new Database(":memory:"); return { exec(q, ...b) { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } }; };

export function offlineAwxLive(): { paths: string[]; fetch(req: Request): Promise<Response> } {
  const books = booksCache(async () => null);
  const feed = new AwxEventFeed(memory());
  return {
    paths: [AWX_BOOKS_JSON_PATH, AWX_BOOKS_SVG_PATH, AWX_EVENTS_PATH],
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === AWX_EVENTS_PATH) return new Response(JSON.stringify(feed.list(new Date(), false)), { headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" } });
      return awxBooksResponse(req, books);
    },
  };
}
