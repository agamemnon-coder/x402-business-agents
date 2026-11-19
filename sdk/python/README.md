# Purser Python client

A small client for Purser Cloud's API, standard library only (`urllib`, Python 3.8 or later). It lists invoices,
proposes an invoice's payment for the CFO's approval and reads a proposal's status. It calls only the operations of
[`openapi/purser.yaml`](../../openapi/purser.yaml), under their `operationId`s (`test/sdk-python.test.ts` checks every
one).

**It cannot approve.** Approving a payment is the CFO's passkey over the exact terms, in Purser Cloud. The API refuses
every key there, and this client has no method for it. Test money only until a company goes live.

Status: built and tested locally, against a local mock (`tests/test_client.py`) and against Purser Cloud in-process.
Not published to PyPI. Put `sdk/python` on your path, or copy the `purser` folder.

## Quickstart

```sh
export PURSER_URL=https://purser.example.com     # your Purser Cloud
export PURSER_API_KEY=pck_...                    # an owner makes it: scopes read and propose; never in code
```

```python
import sys; sys.path.insert(0, "sdk/python")
from purser import Purser, PurserError

purser = Purser.from_env()

# 1. List invoices (one page; purser.invoices() walks every page)
page = purser.list_invoices(status="ready", limit=20)
for inv in page["items"]:
    print(inv["id"], inv.get("vendor"), inv.get("currency"), inv.get("total"))

# 2. Propose a payment for the CFO's approval (a key with the propose scope)
payable = [i for i in purser.list_payable_invoices() if i["payable"] and not i["proposal"]]
if payable:
    try:
        proposal = purser.propose_payment(payable[0]["id"])["proposal"]
        print(proposal["id"], "waits for the CFO's passkey")      # nothing is paid yet
    except PurserError as e:
        if e.status != 409:
            raise
        print("Purser did not file it:", e)

# 3. Read a proposal's status
print(purser.get_proposal("P-0009")["status"])   # PENDING_APPROVAL, then APPROVED and EXECUTED, or REJECTED or EXPIRED
```

## Notes

- `base_url` must be https (http only for localhost). The key is sent as `Authorization: Bearer`, and `repr()` never
  shows it.
- Errors are `PurserError` with `status` and `code`: `forbidden` for a scope the key lacks, `conflict` when Purser
  will not file (held, waiting or paid; the message says why), and `not_found`.
- Tests: `python3 sdk/python/tests/test_client.py`.
