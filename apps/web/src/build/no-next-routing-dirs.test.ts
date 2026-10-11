import { describe, expect, it } from "vitest"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * THE SPA MUST NOT CREATE A DIRECTORY NAME NEXT.JS CLAIMS.
 *
 * apps/web runs both builds at once — `vite build` (the SPA) and `next build`
 * (the rollback path) — so anything under apps/web is inside Next's routing
 * conventions, not just inside Vite's.
 *
 * The SPA's screen components originally lived in `src/pages/`. That broke
 * `next build` immediately:
 *
 *     > `pages` and `app` directories should be under the same folder
 *
 * Next scans for `app/` and `pages/` routing roots anywhere under the project
 * and found the SPA's `src/pages` next to the real `app/`, concluding it had two
 * disagreeing roots. Nothing about the SPA's own build noticed — `vite build`
 * was perfectly happy, and `tsc` was perfectly happy. Only the rollback path
 * broke, which is exactly the kind of failure that surfaces during an incident.
 *
 * Hence `src/screens/`. This test pins the rule so the next person who reaches
 * for the more obvious name gets a clear message instead of a broken rollback.
 */

const WEB = join(dirname(new URL(import.meta.url).pathname), "../..")

/** Directory names that Next.js treats as routing roots. */
const NEXT_ROUTING_DIRS = ["app", "pages", "src/app", "src/pages"] as const

describe("apps/web does not shadow Next's routing roots", () => {
	it("the real Next app/ is still where Next expects it", () => {
		// The rollback path depends on this; the cutover stage removes it, and
		// this assertion is what should be deleted then.
		expect(existsSync(join(WEB, "app"))).toBe(true)
	})

	it("has no SPA-owned directory named app/ or pages/ under src/", () => {
		// src/screens is deliberately NOT in this list: it is an ordinary
		// directory as far as Next is concerned.
		const src = join(WEB, "src")
		expect(existsSync(src)).toBe(true)

		for (const entry of readdirSync(src, { withFileTypes: true })) {
			expect(
				entry.isDirectory() && ["app", "pages"].includes(entry.name),
				`src/${entry.name} would be read by Next as a routing root. ` +
					`Rename it — src/screens is the established location for SPA screens.`,
			).toBe(false)
		}
	})

	it("keeps the SPA screens under src/screens/", () => {
		expect(existsSync(join(WEB, "src/screens"))).toBe(true)
		expect(existsSync(join(WEB, "src/screens/login.tsx"))).toBe(true)
		expect(existsSync(join(WEB, "src/screens/create.tsx"))).toBe(true)
	})
})
