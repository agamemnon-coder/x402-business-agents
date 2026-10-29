// Local approval page: the browser twin of `npm run approve`. Listens on loopback only.

import { openDb } from "../db/open.js";
import { execute } from "../executors/index.js";
import { approvalsApp } from "../servers/approvals.js";

const port = Number(process.env.KIT11_APPROVALS_PORT ?? 4200);
const approver = process.env.KIT11_APPROVER ?? "max";

const app = approvalsApp(openDb(), { approver, execute });
// 127.0.0.1 only: the page can approve payments, so it must not be reachable from the network.
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`approvals page for ${approver}: http://127.0.0.1:${port}/`);
});
server.on("error", (e) => {
  console.error(`cannot listen on 127.0.0.1:${port}: ${(e as Error).message}`);
  process.exit(1);
});
