// Vitest setup (vitest.config.ts setupFiles): the suite runs as the runner does, with an enrolment seal key
// (src/passkey/seal.ts), so every passkey a test enrols through the ceremony is sealed and every check that lets a passkey
// decide also checks its seal. A test value, not a secret; a test that needs sealing off sets useEnrolmentSealKey(null).
process.env.PURSER_ENROLMENT_SEAL_KEY ??= "vitest-enrolment-seal-key-not-a-secret-0123456789";
