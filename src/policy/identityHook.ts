// Where a principal's signing key pair is made (./agentIdentity.ts registers itself here when it is loaded: the runner's
// ledger opener and the agent API load it). The cloud's engine does not, so its bundle does not carry the signing code;
// a principal made there has no signing key until one is rotated in on the runner. No imports: safe from any cycle.
export const identityHook: { issue: ((db: never, principalId: string, now: Date) => { key_id: string; private_pem: string } | null) | null } = { issue: null };
