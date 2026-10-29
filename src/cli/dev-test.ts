// npm run devtest: puts one dev test proposal up for approval (30 minutes). Approving it moves nothing; it is for
// trying the phone approval with a real passkey. The relay runner (npm run relay) must be running on the same ledger.

import { openDb } from "../db/open.js";
import { proposeDevTest } from "../executors/devTest.js";

const p = proposeDevTest(openDb());
console.log(`${p.proposal_id} dev test, hash ${p.terms_sha256.slice(0, 8)}, expires ${p.expires_at}; on the phone: /approve/${p.proposal_id}`);
