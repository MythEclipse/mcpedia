/**
 * Render tests for the route tree.
 *
 * ## WHY THIS FILE EXISTS
 *
 * src/routes.test.ts asserts which route MATCHES a URL, and every one of those
 * assertions passed while the app was broken. Opening
 * /writeups/gemastik-2026/wraith in a browser rendered the WRITEUPS SECTION
 * INDEX — not the document. Matching was never wrong: matchRoutes returned
 * `__root__ > /$section > /$section/$` for that URL the whole time.
 *
 * The failure was in RENDERING, and it comes from one line of the installed
 * router (dist/esm/Match.js:100):
 *
 *     const Comp = route.options.component ?? router.options.defaultComponent;
 *     return Comp ? jsx(Comp, {}) : jsx(Outlet, {});
 *
 * A matched route renders its OWN component if it has one, and only falls back
 * to a passthrough <Outlet/> if it has none. `/$section` declared
 * `component: SectionPage`, and SectionPage renders no <Outlet/> — so for a deep
 * URL the router rendered the parent (the section index) and the matched child
 * was never rendered at all. Every ancestor of a deep route must either declare
 * no component or render an Outlet; this file is what enforces that, because a
 * matching assertion cannot see it.
 *
 * ## WHY renderToString AND NOT A DOM
 *
 * No DOM test environment is installed (no jsdom, no happy-dom, no
 * @testing-library/react) and adding one is a dependency change, not a bug fix.
 * renderToStaticMarkup is enough for the claim being made: which component's
 * markup reaches the page for a given URL. The data comes from a PRE-SEEDED
 * query cache rather than the network, so the test is hermetic — and the routes
 * exercised here have no loaders, so no async work is involved.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { qk } from "#/lib/queries"
import type { DocSummary } from "#/lib/shape"
import { createAppRouter } from "./routes"

const DOC_SLUG = "writeups/gemastik-2026/wraith"
const SECTION = "writeups"

const summary: DocSummary = {
	slug: DOC_SLUG,
	title: "GEMASTIK 2026 - wraith",
	section: SECTION,
	type: "writeup",
	tags: ["ctf"],
	author: "asepharyana",
	updatedAt: new Date("2026-08-01T00:00:00Z").toISOString(),
} as DocSummary

const sectionDoc: DocSummary = {
	...summary,
	slug: `${SECTION}/gemastik-2026`,
	title: "Gemastik 2026",
}

/**
 * A query client holding exactly the reads the document route makes, so the
 * render never touches the network. Seeding by the real `qk` factory (rather
 * than by hand-written key arrays) means a key change breaks this test loudly
 * instead of silently leaving the component in a pending state.
 */
function seededClient(): QueryClient {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
		},
	})
	client.setQueryData(qk.sections, [{ id: SECTION, label: "Writeups" }])
	client.setQueryData(qk.documents(SECTION), [summary, sectionDoc])
	client.setQueryData(qk.documents(undefined), [summary, sectionDoc])
	client.setQueryData(qk.document(DOC_SLUG), {
		slug: DOC_SLUG,
		title: "GEMASTIK 2026 - wraith",
		section: SECTION,
		type: "writeup",
		tags: ["ctf"],
		author: "asepharyana",
		body: "## Recon\n\nThe wraith binary walks its own import table here.",
		updatedAt: new Date("2026-08-01T00:00:00Z").toISOString(),
	})
	client.setQueryData(qk.folderInfo(SECTION, DOC_SLUG), {
		classification: "doc",
	})
	// The folder URL's classification, so the folder branch renders rather
	// than sitting in its pending state.
	client.setQueryData(qk.folderInfo(SECTION, `${SECTION}/gemastik-2026`), {
		classification: "folder",
	})
	client.setQueryData(qk.related(DOC_SLUG), [])
	return client
}

/**
 * Render one URL through the REAL router tree and return its HTML.
 *
 * `router.load()` is REQUIRED before rendering, and it is a promise: without it
 * RouterProvider has no matched matches yet and renderToStaticMarkup returns an
 * empty string. That empty string is a silent trap — `expect(html).not.toContain(...)`
 * passes against it, which would make half of these assertions vacuous. Hence
 * every test below asserts on something that must be PRESENT.
 */
async function renderUrl(url: string): Promise<string> {
	const router = createAppRouter()
	router.update({ history: createMemoryHistory({ initialEntries: [url] }) })
	await router.load()
	return renderToStaticMarkup(
		<QueryClientProvider client={seededClient()}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	)
}

describe("route rendering", () => {
	it("renders the DOCUMENT at a deep document URL", async () => {
		// THE regression. This URL rendered the section index — the parent —
		// because /$section declared a component that renders no Outlet.
		const html = await renderUrl(`/${DOC_SLUG}`)

		// The document's own body is on the page...
		expect(html).toContain("wraith binary walks its own import table")
		// ...and the section index is NOT, which is only true if DocRoute
		// rendered in place of SectionPage.
		expect(html).not.toContain("Folder &amp; Chapter Structure")
	})

	it("still renders the SECTION INDEX at a one-segment URL", async () => {
		// The nesting must not have traded one broken page for another: the
		// section page moved to a child route and must remain reachable.
		const html = await renderUrl(`/${SECTION}`)

		expect(html).toContain("Folder &amp; Chapter Structure")
	})

	it("builds folder breadcrumbs without doubling the section", async () => {
		// The folder view receives folderSlug as the FULL slug
		// ("writeups/gemastik-2026"), so rendering every segment after the
		// already-linked section crumb produced "Writeups / Writeups /
		// Gemastik 2026" pointing at /writeups/writeups/… — a doubled path
		// that 404s. The bug was invisible in the section index and in a
		// document; it only appears on a FOLDER url.
		const html = await renderUrl(`/${SECTION}/gemastik-2026`)

		expect(html).not.toContain(`/${SECTION}/${SECTION}`)
		expect(html).toContain(`href="/${SECTION}/gemastik-2026"`)
	})

	it("gives every route with children a component that renders an Outlet", () => {
		// The invariant behind the bug, asserted on the tree itself: a route
		// with children and its own component can never render those children
		// unless that component renders <Outlet/>. Only __root__ (Shell) may
		// declare a component here, and it does render one.
		const router = createAppRouter()
		for (const route of Object.values(router.routesById)) {
			// `children` is typed `{}` on the generic route union, so the cast is
			// the only way to read it without pinning every route parameter.
			const children = (route.children ?? []) as unknown as unknown[]
			if (children.length === 0) continue
			if (route.id === "__root__") {
				expect(route.options.component).toBeDefined()
				continue
			}
			// A layout route: no component of its own, so the router supplies
			// the passthrough Outlet.
			//
			// IF THIS FAILS and the component is intentional, the fix is not to
			// delete this assertion — it is to render an <Outlet/> in that
			// component (like Shell does) and replace this structural check with
			// a URL render test above. The assertion exists because a layout
			// that renders no Outlet silently swallows every deep URL, which is
			// precisely the bug this file was written for.
			expect(
				route.options.component,
				`route ${route.id} has ${children.length} child(ren) and declares a component, so its children can never render — remove the component or render an <Outlet/> in it`,
			).toBeUndefined()
		}
	})
})
