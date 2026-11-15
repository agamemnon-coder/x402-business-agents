# /try polish pass (15 Nov)

From `npx tsx test/browser/try.check.ts <dir>` on this branch: a local cloud with the real engine, stand-in rails and a
virtual passkey, so no live calls. The check now also asserts that no two visible blocks overlap on any screen at 390,
1024 and 1440 px.

| File | What it shows |
|---|---|
| `work-390-light.png` | Screen 2 at 390 px: "Nothing is paid…" directly above Pay (the 200 px gap is gone), then the step bar, then Activity. |
| `activity-agents-390.png` | The Activity panel at 390 px with the three agents' lines: larger text, room between a line and what code enforced. |
| `work-1024-light.png` | Screen 2 at 1024 px. |
| `approve-1024-light.png` | Screen 3 at 1024 px. |
| `work-1440-dark.png` | Screen 2 at 1440 px, dark. |
| `trace-1440-light.png` | The Checker's trace open at 1440 px, with the step bar clear of the script button. |
