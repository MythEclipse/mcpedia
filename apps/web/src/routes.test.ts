/**
 * Route-matching regression tests.
 *
 * ## WHY THIS FILE IS NOT OPTIONAL
 *
 * A hand-written route tree fails SILENTLY. Every route here typechecks, the
 * app builds, the dev server serves, and there is no error anywhere — but a
 * route that loses to another route never renders, and the symptom is a page
 * that looks plausible and shows the wrong content.
 *
 * That is not hypothetical: with `/$section` and `/$section/$` declared as
 * SIBLINGS under the root, the installed router matches every deep path to
 * `/$section`:
 *
 *     /docs/setup -> __root__ > /$section   params={"section":"docs"}
 *     /login      -> __root__ > /$section   params={"section":"login"}
 *
 * so DocRoute was unreachable, every document URL showed the section index, and
 * /login showed a section. Nothing errored. Nesting the splat under `$section`
 * is the fix, and these tests are what stops it being "simplified" back.
 */
import { describe, expect, it } from "vitest"
import { createAppRouter } from "./routes"

/** The route id of the LEAF match for a path, or undefined if nothing matched. */
function leaf(pathname: string): string | undefined {
	const router = createAppRouter()
	const matches = router.matchRoutes(pathname, {})
	if (!matches || matches.length === 0) return undefined
	const leaf = matches[matches.length - 1]
	return leaf?.routeId
}

/** The whole matched chain, root first. */
function chain(pathname: string): string[] {
	const router = createAppRouter()
	const matches = router.matchRoutes(pathname, {})
	return (matches ?? []).map((m) => m.routeId)
}

describe("route matching", () => {
	it("serves the home page at /", () => {
		expect(leaf("/")).toBe("/")
	})

	it("serves /search to the search route, not to $section", () => {
		// $section would match "search" as a section name. A static route
		// declared above it must win.
		expect(leaf("/search")).toBe("/search")
	})

	it("serves each static segment to its own route", () => {
		// The same hazard, one case per static segment that shadows $section.
		expect(leaf("/login")).toBe("/login")
		expect(leaf("/create")).toBe("/create")
		expect(leaf("/dashboard")).toBe("/dashboard")
		expect(leaf("/export/pdf")).toBe("/export/pdf")
	})

	it("serves a one-segment section path to the section INDEX route", () => {
		// The index is now its own child route (`/$section/`) under the
		// component-less `/$section` layout. It used to be `/$section` itself,
		// matched via the splat with an empty _splat.
		expect(leaf("/docs")).toBe("/$section/")
	})

	it("serves a deep document path to the splat, NOT to $section", () => {
		// THE regression. Before the splat was nested under $section, this
		// resolved to /$section and DocRoute never rendered.
		expect(leaf("/docs/setup")).toBe("/$section/$")
		expect(leaf("/ctf/gemastik-2026/warmup/pwn-baby-heap")).toBe("/$section/$")
	})

	it("nests the splat under $section rather than beside it", () => {
		// The chain is the structural claim. A sibling declaration produces
		// ["__root__", "/$section"] here, which is the bug.
		expect(chain("/docs/setup")).toEqual([
			"__root__",
			"/$section",
			"/$section/$",
		])
	})

	it("still routes the section index to the section page route", () => {
		// The nesting must not have broken the one-segment case: /docs matches
		// the index child, with the layout as its parent, and its params carry
		// the section. SectionPage reads {section} from this route.
		const router = createAppRouter()
		const matches = router.matchRoutes("/docs", {})
		const ids = (matches ?? []).map((m) => m.routeId)
		const params = matches?.[matches.length - 1]?.params as {
			section?: string
		}
		expect(ids).toEqual(["__root__", "/$section", "/$section/"])
		expect(params?.section).toBe("docs")
	})

	it("splits a deep path into section and _splat", () => {
		// DocLink.tsx depends on this exact shape to build a document href.
		const router = createAppRouter()
		const matches = router.matchRoutes("/docs/setup", {})
		const params = matches?.[matches.length - 1]?.params as {
			section?: string
			_splat?: string
		}
		expect(params?.section).toBe("docs")
		expect(params?._splat).toBe("setup")
	})
})
