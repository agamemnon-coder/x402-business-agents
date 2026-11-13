# Blind holdouts, 3 November

[holdouts.md](holdouts.md) holds ten scenarios (H1 to H10) for the Northwind Outdoor world (Kit 11: Sourcing on Haiku,
Support on Sonnet, Treasury on Opus; Metal testnet and the Airwallex sandbox). It is copied here **unchanged**
(sha256 `369e21bcf59cc07f0f2496b4c8929e2c93620ff3348e6afb97ac66e41c7db026`).

## Who wrote it, and from what

A separate Claude agent wrote it blind, before this run, for this purpose. It never opened an agent prompt, an agent
profile or an eval. Per its own report it read only:

- `README.md`
- `docs/archive/internal/draaiboek-wereld-donderdag.md` (the world runbook for the main run)
- `src/cli/world.ts`
- `src/world/*.ts`
- the Kit 11 brief

Of any other module it saw the import lines only (as they appear at the top of those files), not their contents. The
scenarios therefore test the world and the ledger, not any instruction the agents are known to have. Its "Known
limits" paragraph names what it could not know (Support's automatic refund limit, the cap's inclusivity, how data age
is shown); [results.md](results.md) says what the code actually does on each, and judges on the code's rule.

## How it was run (agent K, 2 to 3 November)

- **Nothing in the scenarios' agent-visible text was changed.** Where a scenario needed a text published on an existing
  channel (H8, H9, H10), it is the scenario's text word for word; in H9 only the placeholders `#A` to `#D` and `0xNEW`
  are filled in, as the scenario asks. A test (`test/blind-holdouts.test.ts`) checks this against this copy of the file.
- **World names.** The file asks for world names that do not start with `dry-`. This run followed the operator's rule
  instead: fresh `dry-*` worlds only (never `live-1`, `agent-1` or a main-run world), each with its own keys.
- **No approvals.** No passkey was enrolled in any of these worlds and nobody approved anything: where a scenario has
  the CFO approve, the agents' proposal is recorded and the run stops there. What is judged is the proposal, and that
  nothing moved without an approval.
- **Live and simulated.** Live worlds ran through `npm run world` with one small helper added, `npm run world -- inject
  <channel> <file> --from <name>` (src/world/inject.ts): a text from a file on `supplier.notice`, `invoice.received` or
  `dispute.opened`, in the payload shape of the world's own command for that channel. The rest ran on the simulated
  rails of the variation tests (src/evals/simWorld.ts) through `npm run blind-holdouts` (src/evals/blindHoldouts.ts).

Results, per scenario, with the ledger evidence: [results.md](results.md).
