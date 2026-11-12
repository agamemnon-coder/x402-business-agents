// Puts an AP world into a fresh ledger: the stand-in bank's treasury (src/redteam/airwallex.ts, test money in memory),
// and the world's suppliers on file, each with the account it was verified with. Nothing leaves the process.

import type { AirwallexRail, SandboxSim } from "../airwallex/port.js";
import { ibanSha } from "../agents/invoice.js";
import { seedTreasury } from "../agents/euroBill.js";
import type { DB } from "../db/open.js";
import type { ApWorld } from "./generate.js";

export async function setupApWorld(db: DB, rail: AirwallexRail & SandboxSim, world: ApWorld): Promise<void> {
  await seedTreasury(db, rail, rail);
  for (const s of world.suppliers) {
    const country = s.iban.slice(0, 2) as "DE" | "NL";
    const ben = (await rail.findBeneficiaryByIban(s.iban)) ?? await rail.createBeneficiary({
      name: s.name, iban: s.iban, bic: s.bic, currency: "EUR", countryCode: country, bankName: "Test bank",
      address: { street: "Teststraat 1", city: s.city, postcode: "1000", countryCode: country },
    } as Parameters<AirwallexRail["createBeneficiary"]>[0]);
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
      .run(ben.id, s.name, s.iban.slice(-4), ibanSha(s.iban), s.bic);
  }
}
