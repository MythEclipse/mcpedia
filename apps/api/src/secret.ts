import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, so the length
 * check runs first and the call is wrapped — otherwise a malformed secret would
 * surface as a 500 instead of a 401, and the exception itself would leak the
 * expected length.
 *
 * This lives in its own leaf module rather than in `app.ts` because both
 * `app.ts` and `router.ts` need it, and `app.ts` already imports `router.ts`.
 * Defining it in `app.ts` would make those two a cycle: TypeScript accepts it,
 * but the ESM binding is only initialized once each module body runs, so the
 * import order would decide whether this is defined at call time.
 */
export function safeSecretEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}