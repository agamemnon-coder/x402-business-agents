// A dev checkpoint key for tests (outside audit 1.4): a fresh Ed25519 key in a temporary directory, never a real one
// and never in the repository. useCheckpointKey() switches checkpoints on for this test file's process the way the
// runner is switched on (PURSER_CHECKPOINT_KEY_FILE), and puts the environment back afterwards.
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPublicKey } from "../../src/audit/checkpoint.js";
import { CHECKPOINT_ENV, resetCheckpointMemory } from "../../src/audit/checkpointer.js";

export interface DevKey { file: string; key: KeyObject; publicKey: string }

/** A new Ed25519 key written as PKCS#8 PEM, mode 0600. */
export function devCheckpointKey(dir: string, name = "checkpoint-key.pem"): DevKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  const file = join(dir, name);
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return { file, key: privateKey, publicKey: rawPublicKey(privateKey) };
}

export interface CheckpointFixture {
  dir: string;
  key: DevKey;
  /** The checkpoint file, when the fixture uses one (otherwise an in-memory ledger keeps its checkpoints in memory). */
  file: string | null;
  /** Switches the process to another key, as a restart with a new PURSER_CHECKPOINT_KEY_FILE would. */
  useKey(k: DevKey): void;
  restore(): void;
}

/** Checkpoints on, with a dev key; `file` writes them to a file in the temporary directory. */
export function useCheckpointKey(o: { file?: boolean } = {}): CheckpointFixture {
  const saved = Object.fromEntries(Object.values(CHECKPOINT_ENV).map((k) => [k, process.env[k]]));
  const dir = mkdtempSync(join(tmpdir(), "purser-checkpoints-"));
  const key = devCheckpointKey(dir);
  for (const k of Object.values(CHECKPOINT_ENV)) delete process.env[k];
  process.env[CHECKPOINT_ENV.keyFile] = key.file;
  const file = o.file ? join(dir, "audit.checkpoints.jsonl") : null;
  if (file) process.env[CHECKPOINT_ENV.file] = file;
  resetCheckpointMemory();
  return {
    dir, key, file,
    useKey: (k) => { process.env[CHECKPOINT_ENV.keyFile] = k.file; },
    restore: () => {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      resetCheckpointMemory();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
