// npm run dashboard: the live dashboard on http://127.0.0.1:4300, read-only over the ledger (KIT11_DB).

import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { dashboardApp } from "../servers/dashboard.js";

const path = process.env.KIT11_DB ?? "data/kit11.sqlite";
if (!existsSync(path)) {
  console.error(`no ledger at ${path}; run npm run bootstrap first, or set KIT11_DB`);
  process.exit(1);
}
// Read-only: the dashboard can never write the ledger, whatever a request asks.
const db = new Database(path, { readonly: true, fileMustExist: true });
const port = Number(process.env.KIT11_DASHBOARD_PORT ?? 4300);
const approvalsUrl = process.env.KIT11_APPROVALS_URL ?? `http://127.0.0.1:${process.env.KIT11_APPROVALS_PORT ?? 4200}`;

const server = dashboardApp(db, { approvalsUrl }).listen(port, "127.0.0.1", () => {
  console.log(`dashboard (${path}): http://127.0.0.1:${port}/  (approvals: ${approvalsUrl}, run npm run approvals)`);
});
server.on("error", (e) => {
  console.error(`cannot listen on 127.0.0.1:${port}: ${(e as Error).message}`);
  process.exit(1);
});
