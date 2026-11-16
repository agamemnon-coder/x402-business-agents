// Removes a test's temporary directory. On Windows a SQLite file that a test (or a child process it started) still has
// open cannot be deleted (EPERM/EBUSY), and that is a cleanup detail, not a test result: retry briefly, then leave the
// directory under the OS temp folder (16 Nov, the owner's Windows laptop). Elsewhere any failure still throws.
import { rmSync } from "node:fs";

export function rmTemp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EBUSY")) return;
    throw e;
  }
}
