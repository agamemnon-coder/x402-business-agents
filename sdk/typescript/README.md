# Purser TypeScript client

A small, typed client for Purser Cloud's API. It lists invoices, proposes an invoice's payment for the CFO's approval
and reads a proposal's status. It has no dependencies (the platform's `fetch`, Node 20 or later) and calls only the
operations of [`openapi/purser.yaml`](../../openapi/purser.yaml), under their `operationId`s
(`test/sdk-typescript.test.ts` checks every one).

**It cannot approve.** Approving a payment is the CFO's passkey over the exact terms, in Purser Cloud. The API refuses
every key there, and this client has no method for it. Test money only until a company goes live.

Status: built and tested locally against Purser Cloud in-process. Not published to npm. Use it from this repository
(`sdk/typescript/src/index.ts`), or copy the one file.

## Quickstart

```sh
export PURSER_URL=https://purser.example.com     # your Purser Cloud
export PURSER_API_KEY=pck_...                    # an owner makes it: scopes read and propose; never in code
```

```ts
import { Purser, PurserError } from "./sdk/typescript/src/index.js";

const purser = Purser.fromEnv();

// 1. List invoices (one page; purser.invoices() walks every page)
const page = await purser.listInvoices({ status: "ready", limit: 20 });
for (const inv of page.items) console.log(inv.id, inv.vendor, inv.currency, inv.total);

// 2. Propose a payment for the CFO's approval (a key with the propose scope)
const payable = (await purser.listPayableInvoices()).find((i) => i.payable && !i.proposal);
if (payable) {
  try {
    const { proposal } = await purser.proposePayment(payable.id);
    console.log(`${proposal.id} waits for the CFO's passkey`);        // nothing is paid yet
  } catch (e) {
    if (e instanceof PurserError && e.status === 409) console.log("Purser did not file it:", e.message);
    else throw e;
  }
}

// 3. Read a proposal's status
const p = await purser.getProposal("P-0009");
console.log(p.status);   // PENDING_APPROVAL, then APPROVED and EXECUTED, or REJECTED or EXPIRED
```

## Notes

- `baseUrl` must be https (http only for localhost). The key is sent as `Authorization: Bearer` and never logged.
- Errors are `PurserError` with `status` and `code`: `forbidden` for a scope the key lacks, `conflict` when Purser
  will not file (held, waiting or paid; the message says why), and `not_found`.
- If the CFO set a pay-alone limit (off unless set), a proposal within it is paid under the CFO's own policy, and the
  answer says so in `alone`.
- Pass `fetch` to use your own (a proxy, a test).
