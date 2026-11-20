# Roles in Purser Cloud: who may do what

Since 20 November 2026 (review finding 5). Before that day a CFO in Purser Cloud could only read: every approval and
passkey route needed `admin`, so only owners approved, and owners also managed people, keys, webhooks and exports.

Now approving is its own scope, `approve`, and it belongs to the CFO:

- **owner**: `read` + `admin`. Manages the company: people and their invites, API keys, the alert webhook and alert
  targets, connector tokens, exports, the company's name and closing, and files payments for approval.
- **cfo**: `read` + `approve`. Approves and rejects payments with their own approval passkey, enrols that passkey
  (under the rules of [the approval key's life](#the-approval-keys-life)), registers their own security key, and reads
  the signing views (a proposal's exact terms). Manages nothing.
- **accountant**, **viewer**: `read`.
- **API keys**: `read`, `sync`, `propose`, `admin`, never `approve`. No key approves, whatever its scopes: approving is
  a signed-in person's passkey over the exact terms. A key row that says `approve` is read without it.

**Does owner imply approve? No** (separation of duties): in a company that has a CFO, the owner does not approve. A
company "has a CFO" when a CFO who is not erased has a passkey to sign in with. A company without one keeps working as
before: there the owner also holds `approve`, and the console says so on the payment card ("You approve as owner: this
company has no CFO"). Adding a CFO who signs in takes `approve` from the owners at their next request.

The signing views are read routes (`GET /v1/engine/proposals/{id}` and, on /try, `GET /v1/engine/proposals/{id}/terms`):
anyone who reads may see what is to be signed; only `approve` signs it.

## The matrix

`yes`: the role's session may call the route. `no`: refused with 403. The API key column names the scope a key needs,
or `never`. "owner (no CFO)" is an owner of a company without a CFO who can sign in. `test/cloud-roles.test.ts` reads
this table and holds every cell to the code (cloud/src/auth.ts `scopesOf`, the route table's `need`).

| Action | Route | owner | owner (no CFO) | cfo | accountant | viewer | API key |
|---|---|---|---|---|---|---|---|
| Read the books and the payments | `GET /v1/invoices` | yes | yes | yes | yes | yes | read |
| See a payment's exact terms (signing view) | `GET /v1/engine/proposals/{id}` | yes | yes | yes | yes | yes | read |
| See the exact terms as signed (/try signing view) | `GET /v1/engine/proposals/{id}/terms` | yes | yes | yes | yes | yes | read |
| Approve a payment with one's own passkey | `POST /v1/engine/proposals/{id}/approve` | no | yes | yes | no | no | never |
| Pay with one's signature (/try) | `POST /v1/engine/proposals/{id}/pay` | no | yes | yes | no | no | never |
| Reject a held invoice (/try) | `POST /v1/engine/invoices/{id}/reject` | no | yes | yes | no | no | never |
| Start one's own approval passkey | `POST /v1/engine/passkey/start` | no | yes | yes | no | no | never |
| Finish one's own approval passkey | `POST /v1/engine/passkey/finish` | no | yes | yes | no | no | never |
| Start one's own security key | `POST /v1/engine/security-key/start` | no | yes | yes | no | no | never |
| Finish one's own security key | `POST /v1/engine/security-key/finish` | no | yes | yes | no | no | never |
| File an invoice's payment for approval | `POST /v1/engine/invoices/{id}/pay` | yes | yes | no | no | no | propose |
| Upload a supplier invoice | `POST /v1/engine/documents` | yes | yes | no | no | no | admin |
| Pay all approved (one batch proposal) | `POST /v1/engine/batch` | yes | yes | no | no | no | admin |
| Run a failed approved payment again | `POST /v1/engine/proposals/{id}/retry` | yes | yes | no | no | no | admin |
| Propose the CFO's rule for high-risk payments | `POST /v1/engine/policy/second-key` | yes | yes | no | no | no | admin |
| Add a person | `POST /v1/users` | yes | yes | no | no | no | admin |
| Start a person's passkey enrolment | `POST /v1/users/{id}/enrolment` | yes | yes | no | no | no | admin |
| See the company's security events | `GET /v1/security/events` | yes | yes | no | no | no | admin |
| Make an API key | `POST /v1/keys` | yes | yes | no | no | no | admin |
| Set the alert webhook | `POST /v1/webhook` | yes | yes | no | no | no | admin |
| Export the company | `POST /v1/export/staged` | yes | yes | no | no | no | admin |
| Close the company | `POST /v1/close` | yes | yes | no | no | no | admin |
| Push the runner's records | `POST /v1/sync` | no | no | no | no | no | sync |

Some routes add their own rule on top of the scope: the passkey, security-key and approve routes take a signed-in
person only (a key is refused whatever its scopes); alert targets and the security setting take a signed-in owner; with
"Ask again before sensitive changes" on, sensitive routes need a fresh passkey check (cloud/src/stepUp.ts).

## The approval key's life

Review finding 2 (20 November 2026): before that day a new approval passkey needed nothing but the signed-in owner,
and one platform admin could issue a recovery for any owner, so the operator could reach an owner's session, then a new
approval key, then approvals. Now (src/engine/host.ts `passkeyFinish`, cloud/src/engine/routes.ts):

- **The company's first approval key** is enrolled as before: the signed-in person is the confirmation.
- **Any key added while one is active** (another person's, or a replacement of one's own) counts only with one of:
  - an **endorsement**: an active approval key's signature over the new key's id and the SHA-256 of its public key
    (`purser.approval-key.endorse/v1`), verified by the engine; a key still in its cooling-off cannot vouch;
  - a **second owner's co-signature**: an owner other than the person enrolling signs the same challenge with their
    own sign-in passkey, verified by the cloud;
  - an **account recovery** of that person by two platform admins (below), good for one approval key.
  Without one the new key stays pending for its ten-minute window and the answer (409 `endorsement_required`) names
  the challenge to sign; a bad endorsement or co-signature is refused (403 `endorsement_refused`).
- **Cooling-off**: such a key approves nothing for 72 hours (`APPROVAL_KEY_COOLING_HOURS`, never below 24 in the
  deployed Worker). An approval it signs in that time is refused (403 `cooling_off`, with the time it ends); nothing is
  paid. A test company of /try waits 0, and the answer says so.
- **Told and logged**: every new key, every refusal and every recovery step is a security event every owner reads in
  the console and an event to the company's alert webhook; refusals are also in the cloud's security log
  (`access.denied` with the reason) and the engine's audit log (`passkey.endorsement_required`,
  `passkey.endorsement_refused`, `passkey.key_authorised`, `passkey.cooling_off_refused`).

**Owner recovery takes two platform admins.** `POST /v1/admin/tenants/{id}/recovery` by one named admin key asks for
it (how the owner was checked: `video_call`, `in_person` or `phone_callback`); no key is issued. A second, different
named admin key approves it with `POST /v1/admin/tenants/{id}/recovery/{request}/approve`, and only then is the
one-day recovery key issued. The legacy single admin token takes no part. Both admin key ids are in the security event.
