# Reserve run, 2 November: started, then stopped by Max after step 1

Max ran it alone. There was no second person: the second approver was a labelled **test-controller**, a virtual
passkey in headless Chromium on the runner's machine, which signed only when Claude told it to ("Second approver: a
labelled test passkey in this demo. In production this is a second person."). Code: tag `reserve-run-2026-11-02`
(eff08b4); world `data/live-1.sqlite`; agents off (scripted steps); hosted relay as deployed on 1 November (no deploy).

| Time (UTC) | What happened | Snapshot (local only) |
|---|---|---|
| 10:17 | Runner started against the hosted relay, CFO enrolment window opened | `01-before-start` |
| 10:20 | Max's first enrol attempt in a second private Safari tab: "this relay needs its viewer link" (see Safari) | — |
| 10:22 | Max's passkey enrolled in the same tab as link 1; fingerprint E3CA-8517-C0EC-A174 confirmed on his message | `02-cfo-enrolled` |
| 10:23 | test-controller enrolled (virtual passkey); fingerprint 2741-72EA-90F9-B16A confirmed on Max's message | `03-both-enrolled` |
| 10:24–10:25 | P-0001, four eyes above EUR 1,000, approved by Max alone with Face ID; `approval.four_eyes_eur` = 1000.00 | `04-four-eyes-on` |
| 10:25–10:28 | Step 1: 40 sales per query at 0.05 (upstream 0.02), each a Metal testnet payment; exit 0 | — |
| 10:29 | Max: "stop": no more scripted runs today; an agent run instead. Runner and test-controller stopped cleanly, nothing half-done | `05-stopped-after-step1` |

`npm run verify` on live-1 after the stop: **all checks pass** (audit chain 99 rows, four mandates, P-0001 signed by
Max's passkey, policy v1 → v2, 80 finality certificates; 2 looked up after the node dropped their certificate).

## Safari (iPhone), what differed from the dry runs

1. **Private tabs do not share storage.** Link 2 (the enrol page) opened in a second private tab did not know the
   viewer link from link 1, and said "this relay needs its viewer link". Fix in the run: open the enrol page in the
   same tab as link 1. For the next run: one link that works in one tab, or the enrol page reached from that tab.

## Not done

Steps 2–14 did not run. live-1 stays as it is (four eyes on, 40 sales, two passkeys enrolled) as a reserve until
Thursday. The scratch change in the reserve worktree is untouched.
