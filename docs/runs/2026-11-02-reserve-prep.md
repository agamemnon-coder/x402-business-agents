# Reserve run, 2 November: the world prepared ("Vooraf")

Prepared at 00:12 to 00:25 UTC by Claude, without Max. Code: tag `reserve-run-2026-11-02` (eff08b4) for every command
in the world. World: `data/live-1.sqlite`, keys in `x402-business-agents-keys/live-1`, agents off. Nothing was reused
from earlier worlds. Test money came from the Metal testnet faucet (it answered again after yesterday's daily limit),
so nothing was recycled.

| Step | Address | Amount | Tx |
|---|---|---|---|
| Business owner key (faucet) | `0xABdF38A841E12E4d69f2fEAA3688D21207776f06` | 100 *USDZ | [0x77bc5185…](https://testnet.metalntwx.com/tx/0x77bc5185a8f70e42941e51078162706f437dbd7ff344f1f4c6a679456d436cb7) |
| Customer owner key (faucet) | `0x503d3195AEe5ce6e487467BfBD51Ba70FC43Fd8E` | 100 *USDZ | [0xbf1c3625…](https://testnet.metalntwx.com/tx/0xbf1c36253692e403c470426df4fec389b1da04326ff66bdf612937e2d89295aa) |
| Business account created (bootstrap) | `0x211CD59816E16d5561DDd32247e5952196d676C6` | | [0x9f16b5ba…](https://testnet.metalntwx.com/tx/0x9f16b5ba3a3045a81560ec313365fdccf4a4804f5a47abaad0986c623fef2cda) |
| Customer account C created (bootstrap) | `0x698dc3A4D2a541cA27725Fb91f5ada30926f021d` | faucet, by bootstrap | [0xc65fd670…](https://testnet.metalntwx.com/tx/0xc65fd6708f62a3e91c3396af3cdfb1b2ebbf0eb468eba66cfdd63f58f1a3376d) |
| Owner to business (bootstrap) | `0x211CD598…` | 20.00 | [0x790c42d4…](https://testnet.metalntwx.com/tx/0x790c42d467844300869f917e0e33e1ccc509ad089029ebcf04bf40c90c717754) |
| Sourcing mandate bound | | cap 0.03, budget 10.00 | [0x6df197ff…](https://testnet.metalntwx.com/tx/0x6df197fff130c8262a7ea743410c97e5dd1fa30cbbce66b4a4ceedf8f90a3961) |
| Support mandate bound | | | [0xbf89f70e…](https://testnet.metalntwx.com/tx/0xbf89f70e77d7f41384d76b70ec1d7a6baff4166f3d6d4b953a4ed97d374a2951) |
| Treasury mandate bound | | | [0x22eb392b…](https://testnet.metalntwx.com/tx/0x22eb392b9bc6824135ca710fc130305a320bc6794b21b5e16122d2c3eab94a3d) |
| Customer mandate bound | | | [0xaebf04e8…](https://testnet.metalntwx.com/tx/0xaebf04e8cd8046b4244e9bcdaceac563581f54ae441de6a304ff8d63cd28cbd5) |
| Sweep wallet gas (from the business owner key) | `0xdd4aFeC8bc3acD7477dB2768Bca6461CAB1c66dE` | 0.50 | [0x339b65e4…](https://testnet.metalntwx.com/tx/0x339b65e4dea2441600f48c7a1880d48c6b185cc6034de6b6d72f4de7978218e9) |
| Four-eyes sponsor (faucet), keys in `live-1/four-eyes` as in the dry runs | `0x629FE39CCF4b2e91e216cad187E23A95c7e5e385` | 100 *USDZ | [0xc4c57ff1…](https://testnet.metalntwx.com/tx/0xc4c57ff1368b1d10e55c889fc32c07edef8aeffb1d3f6a747ab3399c6dd03f65) |

Supplier address (payee only): `0x269Be7444deb92F79bd848924e331cfB01Ca67FA`.

`npm run health` on live-1: green (Metal chain 63825 and finality, x402 facilitator ready, Airwallex sandbox
balances read, Claude key set).

Not done here, by design: the passkey enrolment, the four-eyes policy and every approval are Max's, in the run.
The reserve worktree carries one uncommitted scratch change in `test/browser/dryrun.check.ts` (a hosted-relay switch
for yesterday's check); no reserve-run command uses that file.
