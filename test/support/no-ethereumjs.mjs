// A preload for a child process (node --import): it refuses to resolve any @ethereumjs package. A command that runs
// under it and succeeds has not loaded the in-memory chain. test/tokenize-cli.test.ts runs every live tokenize
// command under it, and the stand-in (which needs the chain) as the control.
import { register } from "node:module";

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@ethereumjs/")) throw new Error("the in-memory chain was loaded: " + specifier);
  return next(specifier, context);
}`)}`);
