// workerd only (wrangler alias "node:crypto" -> this file): node:crypto with randomUUID, randomBytes and randomInt
// taken from the counted stream (det.ts). In Node the same three are replaced through syncBuiltinESMExports (detNode.ts).
// "crypto" (no prefix) is the real module: the alias only catches the "node:crypto" the engine's files import.
import * as real from "crypto";
import { detBytes, detInt, detUuid } from "./det.js";

export * from "crypto";
export const randomUUID = (): string => detUuid();
export const randomBytes = (n: number): Buffer => detBytes(n);
export const randomInt = (min: number, max?: number): number => detInt(min, max);
export default { ...real, randomUUID, randomBytes, randomInt };
