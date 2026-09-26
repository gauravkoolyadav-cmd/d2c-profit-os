import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison that never throws.
 *
 * Both inputs are hashed to a fixed length first, so differing lengths neither
 * throw (as crypto.timingSafeEqual would) nor leak length through timing.
 */
export function safeCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB) && a.length === b.length;
}
