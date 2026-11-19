# Badges from the records

Each JSON file here is a [shields.io endpoint badge](https://shields.io/badges/endpoint-badge). `npm run badges`
(`scripts/badges.ts`, rules in `src/proof/badges.ts`) computes it from one committed record, named in its `record`
field. Nothing is typed by hand, and nothing is run to make it. `test/badges.test.ts` fails while a file here differs
from its record.

| Badge | Record | What it counts |
|---|---|---|
| [tamper-matrix.json](tamper-matrix.json) | [tamper-matrix.json](../evidence/tamper-matrix.json) | changed copies of signed receipts and bundles refused, of all tried |
| [airwallex-endpoints.json](airwallex-endpoints.json) | [airwallex-api-coverage.json](../evidence/airwallex-api-coverage.json) | Airwallex endpoints the code calls that a committed sandbox run record holds, of all it calls |
| [chaos.json](chaos.json) | [chaos-money.json](../evidence/chaos-money.json) | invariant breaks across all chaos scenarios |
| [fuzz.json](fuzz.json) | [fuzzing.json](../evidence/fuzzing.json) | fuzz runs, and properties that failed (orange while any did) |
| [dafny.json](dafny.json) | [formal-proofs.json](../evidence/formal-proofs.json) | the Dafny verifier's summary for formal/dafny (red on any error); `npm run formal:dafny` fails while the record or this badge differs from what the verifier prints |

No mutation-score badge: no mutation record is committed. The script writes one only if `docs/evidence/mutation.json` exists.

To show one, point shields at the raw file on `main`, for example:

```
https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fbadges%2Fchaos.json
```
