import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Constant-time secret comparison.
 *
 * Both sides are hashed to a fixed 32 bytes before comparison, so no branch
 * depends on the inputs' lengths. Comparing the raw strings needs a length
 * pre-check (timingSafeEqual throws on a mismatch), and that pre-check leaks:
 * a wrong-length guess returns measurably faster than an equal-length wrong
 * guess, revealing the secret's length one character at a time.
 *
 * Hashing also removes the need for a try/catch — `createHash` on a string
 * cannot fail — so a malformed secret yields a 401 rather than a 500.
 *
 * This lives in its own leaf module rather than in `app.ts` because both
 * `app.ts` and `router.ts` need it, and `app.ts` already imports `router.ts`.
 * Defining it in `app.ts` would make those two a cycle: TypeScript accepts it,
 * but the ESM binding is only initialized once each module body runs, so the
 * import order would decide whether this is defined at call time.
 */
export function safeSecretEqual(a: string, b: string): boolean {
	const digest = (s: string) => createHash("sha256").update(s).digest()
	return timingSafeEqual(digest(a), digest(b))
}
