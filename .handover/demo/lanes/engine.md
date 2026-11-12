# Lane A: engine

You are the build session of lane A of the hands-on demo. Read these, in this order. All paths are in your checkout of `engine-do-1112`.

1. This file.
2. If you are a new session of this stream, `.handover/RESUME.md` and `git log` first. Do not redo finished work.
3. `.handover/plan.md` (plan E) sections 3 and 5, and the task texts named below (plan E section 6, or `.handover/SPEC.md`).
4. Plan K is `.handover/demo/design-final.md` and `.handover/demo/tasks.json`. You need them only where a task cites them.

The plan of record is `.handover/demo/plan-of-record.md`. Where this file and a source document disagree, this file wins.

## Goal

The product's real engine runs in one Durable Object per company on a deployment of its own, `purser-try` (the cloud Worker), accepted and measured by Cloudflare. It reads with real Claude and runs the product's own Checker and Payer agents under hard dollar ceilings that fail closed. It writes every agent step as an event a page can show while the request is still running, including a row the moment each Claude call is sent. On Saturday 13:00 UTC it is frozen with a runbook. Lanes B (the page) and C (visitor companies, the pay route, export, guard, rail) build on your routes and events.

## Branch, base, rules

- Branch `engine-do-1112`, the integration branch. At 13:26 UTC its head was `b511a54`. It holds:
  - A1's object commits (`dd8e682` to `9b8f709`) and main (`3c6f4cd`);
  - a retry route for a failed payment (`84a4961`, `993efdf`);
  - refusals in plain words (`99c9852`, `6022d72`);
  - a D1 document store for a deployment without R2 (`6cc478e`);
  - `cloud/wrangler.try.jsonc` (`ec3cfe6`) and `npm run cloud:smoke` (`b511a54`).

  This stream's session stopped at about 12:45 UTC for usage credits and resumed at 13:14. A later new session reads `.handover/RESUME.md` first.
- The orchestrator merges lanes B (`try-page-1112`), C (`try-core-1112`) and the console lane (`engine-console-1112`) into `engine-do-1112` after their reviews. Pull before every task.
- Test command, worktree, commit identity, no network, no secrets: `.handover/plan.md` section 5 and `.handover/RULES.md`, unchanged, with lean mode. Small commits. Push at most once per task, plus at each milestone you report. Never force-push.
- You never deploy. The orchestrator deploys `purser-try` and runs your smoke script on the owner's word. You prepare everything so it is one command.
- Do not start any `console-*`, `try-lifecycle`, `try-world`, `try-console`, `truth-and-guard` or `try-signer` task of `.handover/SPEC.md`. Lanes B and C own them in changed form; the console's remaining tasks move to after the submission.

## Neighbours (who owns what)

- **Lane C** owns:
  - `cloud/src/try/*` (`switches.ts`, `start.ts` with `tryScopes`, `admin.ts`, `sweep.ts`, `rail*.ts`), the `/v1/try/*` route block, the try-only gate in the router, and the router's handling of a try session's 401.
  - The engine routes `samples`, `suppliers`, `compose`, `proposals/{id}/terms`, `proposals/{id}/pay` and `export`.
  - The D1 tables `try_companies`, `try_switches`, `try_admin_log`, `try_rail_calls` and `try_rail_day`.
  - The host methods it needs (`samples`, `uploadSample`, `suppliers`, `compose`, `terms`, `paySigned`, `exportBatch`).
  - Two small changes in your files, each one `if`, tested so that Node is unchanged: `hold` on `EngineHost.approve`, and the document cap `EngineDeps.maxDocuments`, set for `t_try_` companies by one line in `cloud/src/engine/hostWorker.ts`.

  Do not edit those. If your task needs a change there, write it in your handover note.
- **Lane B** owns `cloud/src/tryPage.ts`, `cloud/src/tryCopy.ts`, `cloud/src/tryEvents.ts` and the `/try` line in `consoleResponse`. It reads your event shapes from `.handover/agent-events.md` (A4).
- **The console lane** (`engine-console-1112`) owns `src/ui/engineEvents.ts` and the console's engine panel.
- **Stream `cloud-demo-1112`** edits `cloud/src/app.ts`, `cloud/src/worker.ts` and `src/ui/i18n.ts`, and owns `cloud/src/demo.ts`. Keep your changes in their own blocks.
- **Stream `ap-agents-1112`** owns `src/ap/checkerCore.ts`, `src/ap/payerCore.ts`, `src/ap/checkerAgent.ts`, `src/ap/payerAgent.ts`, `src/ap/agentRun.ts` and `src/config/agents.ts`. You merge it (A6). You add seams; you do not change their behaviour in Node.

## Tasks, in order

### A1 engine-object (source `engine-plan:engine-object`, pushed)

The object, the Worker's entry and the tests are on origin (`dd8e682` to `9b8f709`). Confirm gate G0: the workerd test runs the chain through the routes against the real object, D1 and R2; the bundle test shows the engine only behind the dynamic import; `wrangler deploy --dry-run -c cloud/wrangler.jsonc` prints the `ENGINE` binding.

Then send milestone (b) to the orchestrator as `.handover/RESUME.md` message 2 asks. It holds:

- the head commit and the config's bindings;
- the dry-run and deploy commands for `purser-try`;
- the names of the secrets and variables;
- the bundle size, raw and gzip;
- what the smoke runs must show;
- the retry route built for a payment whose execute failed (`993efdf`).

Target Thursday 15:00 UTC, hard limit 20:00.

### A2 deploy-prep (source `engine-plan:deploy-gate`, steps 1 and 2; the orchestrator does step 3)

**Already on the branch:**

- `cloud/wrangler.try.jsonc` (`ec3cfe6`). It has its own D1 `purser-try` and R2 `purser-try-docs`, never the product's `purser-cloud` or `purser-cloud-docs`, and the `ENGINE` binding and migration `v1` exactly as in `cloud/wrangler.jsonc`. `test/cloud-try-config.test.ts` holds the two files to each other key by key.
- `npm run cloud:smoke` (`scripts/engine-smoke.ts`, `b511a54`): one chain through the admin path, with the admin token read from `PURSER_ADMIN_TOKEN`.

Keep both, and keep the migration list unchanged forever.

**Next, pushed on its own by Thursday 16:00 UTC** so the orchestrator can deploy at 18:00 (gate G1a), changes to `cloud/wrangler.try.jsonc`. Update the config test's list of allowed differences with them.

- **Vars:** add `HANDS_ON` = `on` and `ENGINE_CLAUDE` = `on`. These are capabilities only: at run time lane C's switches decide, and a missing switch is off.
- **Cron:** `triggers.crons: ["17 * * * *"]`, hourly, for lane C's sweep. The cloud's own daily job is safe to run hourly.
- **Comment:** add to the top comment that this is never the product's deployment, and that without R2 the `DOCS` binding is removed and documents go to D1 (`sqlBlobs`).

**Then extend the smoke script** (keep the existing default run unchanged):

- **`--plain`** checks the cloud alone: health, create a company with the admin token, sign in, `GET /v1/invoices`. This is the first deploy of the cloud Worker with the engine. The documents say a private preview of the cloud alone may exist; the owner confirms.
- **`--try`**, used once lane C lands, starts companies through `POST /v1/try/start` with the token in `SMOKE_TRY_TOKEN`. It approves (held), pays with one cent more (expects `refused` with both layers and transfers unchanged), then pays the signed terms (expects `paid` and transfers +1).
- **`--parallel N --poll <ms>`** runs N fresh companies at once. Each polls `GET /v1/engine/events?after=` every `<ms>` (default 1000) while its upload and its proposal are in flight, as the page does. It reports p50 and p95 per step and per poll, every non-2xx word for word, and every 429 and 5xx by route.

The script reads its tokens from the environment, never prints a token, and exits non-zero on any mismatch.

**Also:**

- **`docs/runs/2026-11-13-engine-in-cloud.md`**: a template with the fields the orchestrator fills: the upload size wrangler reported, start-up and first-request time, time per step, the bursts with polling (p50 and p95, D1 errors), errors word for word, and what was not tried.
- **`docs/cloud.md`**: a short "Deploying purser-try" section with the exact commands:
  - create D1 and R2 under the names above;
  - `wrangler secret put SESSION_SECRET` and `ADMIN_TOKEN_SHA256`, and later `KIT11_ANTHROPIC_API_KEY`;
  - deploy with `-c cloud/wrangler.try.jsonc`;
  - run the smoke.

  The secret named `KIT11_ANTHROPIC_API_KEY` on `purser-try` holds the demo's own capped key; the owner sets it by hand.

  Add one warning line to the product's own deploy step: since the engine merge, `cloud/wrangler.jsonc` adds the `CompanyEngine` class and migration `v1`, which cannot be rolled back. It is not deployed before 15 November without the owner's word.

Tests first:

- `test/engine-smoke.test.ts` (extended) runs the script's flow against `testCloud({ engine: true })`: the plain part, the engine part, and `--parallel 3 --poll 50`.
- `test/cloud-try-config.test.ts` (extended): the config names neither `purser-cloud` nor `purser-cloud-docs`, and holds no secret-looking value.

Done when the smoke passes locally and `wrangler deploy --dry-run -c cloud/wrangler.try.jsonc` succeeds. Then write a handover note for the orchestrator (the exact command list) and stop. Never deploy `spike/do-lead/wrangler.jsonc`: it names the product's stores.

### A3 review-fix-a1 (new)

The orchestrator runs a review of A1 and A2 with two lenses. The first is correctness of the object and the config. The second is security: tenancy pinning, no secret in the config or logs, and the bundle's static graph. Fix what it finds.

Add one limit inside the object: at most 2 `events` reads a second per company, counted in memory. Past that, the answer is `429 {code: "slow_down", retry_ms}`. Lane C removes the router's rate-bucket write for a try session's event polls, so this is the polling limit that remains. Test it.

If G1a or G1 reports that Cloudflare refused the Worker for size or start-up time, do the one allowed retry of `.handover/plan.md` Task 7:

- a payables-only executor entry, `src/executors/payables.ts`, so viem, ox and browser code leave the bundle;
- pdfkit and unpdf loaded with `import()`;
- the bundle test's ceiling lowered to what the retry reaches.

A second refusal is the fallback (plan of record section 6): stop and say so.

### A4 event-shapes (new; Thursday night, so lane B can build B5 on Friday morning)

Read, do not merge, `origin/ap-agents-1112` at its head of the day (`5203bf5` had the payloads; `df5df1a` at 13:22 UTC added evals). The payloads are:

- `agent.tool`, `agent.nudged` and `agent.run` in `src/agents/loop.ts`;
- `ap.checker_decided` (`recordChecked` in `src/ap/checkerAgent.ts`);
- `ap.payer_proposed` (`recordProposed` in `src/ap/payerAgent.ts`).

Add each to the allowlist of `src/engine/events.ts`, with the three rows A5 and A6 add. Every field is masked: no IBAN, key or full account number. Tool inputs are never shown, only the tool's name.

- `claude.asking` → `{ agent?, role?, model, turn? }`. It is written just before a Claude call is sent: by the reader with `role` (`classify`, `read` or `review`), by the agent loop with `agent` and `turn`. No prompt.
- `agent.tool` → `{ agent, tool, turn, model, request_id, ms, answer }`. `answer` is the first sentence of the row's `result`, at most 160 characters, with IBANs masked to their last four.
- `agent.said` → `{ agent, turn, model, text }`, the text masked the same way, at most 600 characters.
- `agent.nudged` → `{ agent, reason }`.
- `agent.run` → `{ agent, model, status, turns, cost_usd_micros, latency_ms }`.
- `ap.checker_decided` → `{ source, model, action, outcome, overridden, overridden_by, code_requires, codes }`. `codes` holds the codes of `code_findings` only, never their detail.
- `ap.payer_proposed` → `{ source, model, rail, pay_on, pay_currency, outcome, overridden, overridden_by }`.
- `claude.capped` → `{ reason }`. The reason is one of `switch_off`, `no_key`, `action_budget`, `company_cap`, `pool_day_cap`, `address_cap`, `all_time_cap` or `busy`.

Each new event gets a test against a row with the real payload shape. Write `.handover/agent-events.md` for lane B: each event, its public fields, and what writes it and when. Push and tell the orchestrator.

### A5 try-claude (source `engine-plan:try-claude`, extended with hard ceilings)

Differences from the source:

- **A reservation per action, equal to its worst case.** Before an engine action that may call Claude (`upload`, `uploadSample`, `compose`, `propose`), the host asks `spend.reserve(scopes, micros)`. `micros` is the action's ceiling: the smaller of the switch `cap_action_micros` (the runbook proposes USD 0.25) and what the company, pool, address and all-time caps still allow. If it says no, the action runs with `parserOnly` and the agents off, and every event it writes says why (`claude.capped`). After the action the host settles down to the sum of `cost_usd_micros` of the action's `claude.read` and `agent.run` rows. A failed or cut action settles what the rows say, or the whole reservation when nothing is known.
- **A hard ceiling per call.** `src/engine/budget.ts` defines `interface Budget { left(): number; spend(micros: number): void }`, made per action from the reservation. Before each call, the reader (and the agent loop, A6) computes the call's worst case from `src/claude/pricing.ts`: `max_tokens` × the output price, plus the request's input tokens, estimated as characters ÷ 3, × the input price at the cache-write price. If that exceeds `left()`, the call is not made: the reader falls back to the parser and writes `claude.capped {reason: "action_budget"}`. `ClaudeReader` gets this as a constructor option `{ budget?, maxTokens?, announce? }`. Without the option, Node is unchanged (a test).
- **Smaller answers for try companies.** `max_tokens` is 4,000 for the reader. Each agent turn gets 2,000 (A6). A7 measures. A cut-off answer falls back to code, labelled.
- **The try host's Anthropic client:** `new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 })`. SDK retries are off; the agent loop's own single retry stays and stays inside the budget. A timed-out call is a labelled fallback.
- **`claude.asking` for the reader.** With `announce: true`, `ClaudeReader` writes one audit row `claude.asking {role, model}` just before each call is sent. It is off by default, so Node writes nothing new (a test).
- **`cloud/src/engine/spend.ts`** (new), `d1Spend(sql, switches, scopes, now)`:
  - **Tables**, added to `cloud/migrations/0001_init.sql` and `cloud/src/schema.ts` in a block of their own: `try_spend (scope TEXT PRIMARY KEY, micros INTEGER NOT NULL)` and `try_resv (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, micros INTEGER NOT NULL, started_at TEXT NOT NULL, state TEXT NOT NULL)`.
  - **Scopes:** `all`, `day:<pool>:<YYYY-MM-DD>`, `co:<tenant>`, and `addr:<hash>:<YYYY-MM-DD>` (public pool only). The pool and address hash come from lane C's `tryScopes(sql, tenantId)` (`cloud/src/try/start.ts`); stub it until C1 is merged. An admin-made company is pool `smoke` with no address.
  - **`reserve` checks**, in one D1 batch with conditional `UPDATE`s, every scope's cap against spent plus open reservations plus this one, and the number of open reservations against `max_inflight`.
  - **In flight.** A reservation counts in flight until it is settled, whatever its age. One older than 10 minutes, longer than any action can run, is settled at its full amount by the next `reserve` or by the sweep, and then stops counting.
  - **Caps** come from lane C's `readSwitches(sql)`, with these keys:
    - `claude` and `agents` (on or off);
    - `cap_action_micros`, `cap_company_micros`, `cap_addr_micros`;
    - `cap_day_micros_public`, `cap_day_micros_event`, `cap_day_micros_jury`, `cap_day_micros_smoke`;
    - `cap_all_micros` and `max_inflight`.

    A missing key is off or 0, so nothing is spent until the owner sets them. Defaults the runbook proposes: action USD 0.25; company 0.40; address 1.20 a day; public 4, jury 3 and event 0 a day (event 25 on the Demo Day evening); smoke 1; all-time 75; in flight 8.
- **`cloud/src/engine/hostWorker.ts`**. With `ENGINE_CLAUDE=on` and the key present, the reader is `new ClaudeReader(db, { budget, maxTokens: 4000, announce: true })` per action, on the try client above, and `spend` is `d1Spend`. A models override is allowed only through a switch key `reader_models`, if A7's measurement says so. Without the key: `parserOnly`, and nothing is reserved.
- **`status()`** gains `reader: "claude" | "parser"`, `agents: "live" | "code"`, `spent_micros` (this company) and `cap_micros`.

Tests first (`test/engine-budget.test.ts`). The Anthropic client runs on a stand-in fetch as in `spike/do-runtime/probes/p5-claude.ts`. No real API call in any test.

- A Claude reading is counted, and its event carries model, request id and cost.
- A `claude.asking` row comes before the reading's row.
- At each cap the next action is the parser's, with the right reason.
- With the switch off or no key, nothing is reserved.
- A call whose worst case exceeds the action's budget is not made. Use a stand-in that would report the maximum usage, and assert the action records no more than its reservation.
- 20 parallel reservations against a pool day cap of 3 actions admit exactly 3.
- 20 parallel reservations against `max_inflight` 3 admit 3 while none settles, and the next is admitted after one settles.
- An open reservation older than 10 minutes is settled at its full amount.
- A failed call settles its reservation.
- The try client has a 30 s timeout and no SDK retries.

Done when the tests pass, the workerd test still passes with `ENGINE_CLAUDE` unset, and `GET /v1/engine` reports the reader and the caps.

### A6 agents-live (new)

Goal: the product's Checker and Payer agents run inside the object under A5's ceilings. Every step they take is an event the page can show while the request is still running, and switching them on for one company never touches another.

Steps:

1. **Merge.** Merge `origin/ap-agents-1112` into `engine-do-1112` at the head the orchestrator names on Friday 06:00 UTC (`5203bf5` or later). Do not wait for it to reach main. When it lands in main later, the orchestrator merges main in. Conflicts are expected in `src/ap/inbox.ts` (the document-store seam here, the Checker's wiring there): keep both. The shim suite (`npm run test:shim`) and the engine's own tests must stay green.
2. **Per-call switches, no global.** Durable Objects of one class share an isolate, and actions interleave at every `await`. A module-level switch would turn one company's agents on for another company's action. So:
   - `InboxDeps` gains `agents?: boolean`. When present, it overrides `apAgentsOn()` in `src/ap/inbox.ts` (both calls).
   - `payApInvoice`'s `agents` argument (`PayAgents`) gains `on?: boolean`, overriding `apAgentsOn()` in `src/ap/pay.ts`.
   - `claude` already exists in both.
   - `EngineHost` passes both per action from A5's reservation: `agents` is on only when Claude is reserved and the `agents` switch is on; `claude` is the reserved try client, or null.
   - With the fields absent, Node is unchanged (a test).
3. **`AgentSpec` fields in `src/agents/loop.ts`, per call.**
   - `budget?: Budget`: the loop refuses a turn whose worst case exceeds `left()`, the same rule as A5, with the reason `action_budget`.
   - `maxTokens?: number`, default 16,000 as today; try companies 2,000.
   - `announce?: boolean`: writes `claude.asking {agent, model, turn}` just before each call is sent.
   - `sayRows?: boolean`: after each model response with text, writes one row `agent.said {agent, model, request_id, turn, text}`, text redacted as the loop already does, at most 600 characters.

   `runChecker` and `payerGate` pass them through from their `opts`. With none set, Node writes nothing new (a test). Add `checker` and `payer` to `AGENT_HOURLY_CAP_MICROS` at the default's value, 500,000, so the cap is visible and pinned by a test, with behaviour unchanged.
4. **Events.** If the merged payloads differ from A4's shapes, update the allowlist and `.handover/agent-events.md` in the first commit, and tell the orchestrator.
5. **The polling contract lane B relies on, checked by a test.** While an `upload` (or `propose`) request is waiting on Claude, a `GET /v1/engine/events?after=` request to the same company is answered with the rows written so far, including the `claude.asking` row of the call in flight. In the host this holds because reads do not wait for the action queue. Test it with a stand-in fetch that blocks until the test releases it: through the Node engine, and with `CLOUD_DB=d1` through the object in workerd.

Tests first:

- the tests named above;
- **two companies in one process** running interleaved actions, one reserved and one capped: the capped company makes no Claude call and its rows say code; the reserved one's agents run; neither changes the other;
- **one chain** with the Checker and Payer on a stand-in Anthropic that answers a scripted tool loop, asserting the order of events (`claude.asking` before each turn's rows) and that the verdict row comes after code's check row.

Done when the engine's own tests, the shim suite, the workerd test and the new tests pass, and the handover note is up to date. Gate GA: Friday 11:00 UTC.

### A7 review-fix-a2 (new)

Review of A4 to A6, with two lenses. The first is money and caps: ceilings per call, per action, per company, per pool and per address; in-flight counting; no leak between companies. The second is honesty of events: nothing unmasked, nothing claimed. Fix what it finds.

Then, with the orchestrator, on `purser-try` (no migration change):

1. Deploy.
2. Set the switches with lane C's admin route to small caps.
3. Run `scripts/engine-smoke.ts --try --parallel 50 --poll 1000` with Claude off, then ten visits with Claude on.
4. Write into the run record: the Claude cost per visit (p50, p95); the time from a `claude.asking` row to its answer; the time to the first agent event; the share of runs that fell to code, and why; the share of cut-off answers; D1 latency and errors under polling.
5. Propose cap values from the measurement (company cap about three times the p95 visit) and `max_tokens` values if cut-offs pass 5 %.

If the Checker on the product's default model costs more than USD 0.15 a visit, propose the model override through a switch key and say so in the record. The label always names the model that ran. Gate G3.

### A8 go-live (source `design-final:go-live`, reduced)

With the owner, Saturday 08:00 to 13:00 UTC:

- **The final deploy** to `purser-try` from the merged `engine-do-1112`, with the previous and the new version id written down.
- **The switches set:** starts on; Claude and agents on; caps from A7; rail as gate GR2 says.
- **If GR2 failed:** the owner runs `wrangler secret delete TRY_AWX_CLIENT_ID` and `wrangler secret delete TRY_AWX_API_KEY` on `purser-try` before the freeze. Write down that version id. Change lane C's one sentence constant so no document says the deployment holds a sandbox key.
- **`docs/runbook-try.md`** (one page, English and Dutch):
  - pause (switch `starts` off);
  - the caps and how to raise the event pool for Demo Day;
  - the event and jury tokens and the QR code;
  - the rail switch, and deleting its secrets;
  - rollback: `wrangler rollback <id>` for `purser-try`; the kit11 site flag off sends the Try tab back to `/try/sign`;
  - never deploy `cloud/wrangler.jsonc` before 15 November;
  - where the run records are.
- **Three rehearsals** (owner's iPhone with Face ID, a second phone, a laptop) with a stopwatch; the medians go into the run record.
- **The freeze** at 13:00.

## Out of scope for lane A

The page, the console, the visitor's company lifecycle, samples, the pay route, the export, the rail and the claims pass (lanes B and C); word-by-word model text; recorded agent runs; Metal; the overspend scene; any deploy to kit11 or to the product's own `purser-cloud`.

## Honesty rules for what you write

- An event says who acted: `claude` with the model and request id, or code. Never an event that suggests Claude decided when code did.
- A `claude.asking` row says a call was sent, to which model, and nothing else. It never anticipates the answer.
- The bank is the engine's simulated bank. API texts already say "stand-in bank"; on the page, lane B says "simulated bank · test money". Do not add the word "real" to anything that moves test money.
- Caps fail closed: no switch, no key, no reservation or no budget left means the parser reads and code decides, and the event says why.
