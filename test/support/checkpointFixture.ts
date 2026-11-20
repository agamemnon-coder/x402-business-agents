// Vitest setup (vitest.config.ts setupFiles), outside audit 1.4: with PURSER_CHECKPOINT_FIXTURE=on the whole suite runs
// with signed audit checkpoints switched on, as a runner with PURSER_CHECKPOINT_KEY_FILE set does: a dev Ed25519 key,
// made fresh in a temporary directory for this worker, never a real one and never in the repository. Every payment,
// policy change and key enrolment the tests make is then checked against the latest checkpoint, so the existing flows
// are shown to keep working with the gate on. Off by default, so the suite's own figures are unchanged.
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.PURSER_CHECKPOINT_FIXTURE === "on" && !process.env.PURSER_CHECKPOINT_KEY_FILE) {
  const dir = mkdtempSync(join(tmpdir(), "purser-checkpoint-fixture-"));
  const file = join(dir, "checkpoint-key.pem");
  writeFileSync(file, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  process.env.PURSER_CHECKPOINT_KEY_FILE = file;
}
