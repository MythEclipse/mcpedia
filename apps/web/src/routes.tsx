/**
 * Hand-written (code-based) route tree.
 *
 * WHY CODE AND NOT FILE-BASED: the file-based alternative needs a generator —
 * either @tanstack/router-plugin in the Vite pipeline or `tsr generate` as a CI
 * step — plus a generated src/routeTree.gen.ts that must already exist before
 * typecheck and before build. That is a build-ordering hazard (a stale or
 * missing generated file silently typechecks against the wrong tree) and
 * another tool to keep in step. The tree below has the same shape and the same
 * type inference, with no codegen and nothing to keep in sync.
 *
 * THE ONE GOTCHA, confirmed in the installed source rather than recalled
 * (@tanstack/router-core/src/route.ts: "Route cannot have both an 'id' and a
 * 'path' option"): a hand-written route takes EITHER `path` OR `id`, never
 * both. The generated file sets both only because it constructs a bare route
 * and then calls .update(). Passing both here throws at construction time. So:
 * `path` for anything with a URL segment, `id` alone for a pathless layout.
 *
 * `addChildren` RETURNS A NEW, RETYPED ROOT — CAPTURE IT. Every id-keyed type
 * lookup (`getRouteApi`, `Link`'s `to`, `useLoaderData`'s `from`) resolves
 * through the root's `children` type, which the compiler only knows about on
 * the value addChildren RETURNS. Passing the old root to createRouter compiles,
 * runs and matches URLs correctly while every route id collapses to just the
 * root's — the symptom is `Type '"/login"' is not assignable to type '"/"'`,
 * which reads like a typo rather than a lost type. So `routeTree` below is the
 * RETURN VALUE.
 *
 * **THE SPLAT IS A CHILD OF `$section`, NOT A SIBLING.** This is verified, not
 * stylistic. With `/$section` and `/$section/$` declared as SIBLINGS under the
 * root, matching was measured against the installed router and every deep path
 * lands on `/$section`:
 *
 *     /docs/setup -> __root__ > /$section      params={"section":"docs"}
 *     /login      -> __root__ > /$section      params={"section":"login"}
 *
 * so `DocRoute` never renders — every document URL silently shows the section
 * index, and `/login` shows a section too. A splat declared at the same level
 * as the segment it is supposed to extend loses to it, because `$section`
 * matches one segment and satisfies the match before the longer, less specific
 * route is considered.
 *
 * Nesting the splat under `$section` gives the correct shapes:
 *
 *     /docs       -> __root__ > /$section > /$section/$   _splat=""
 *     /docs/setup -> __root__ > /$section > /$section/$   _splat="setup"
 *     /login      -> __root__ > /$login                   (static, declared first)
 *
 * The regression test for this is src/routes.test.ts — the tree below and the
 * nested shape must not be "simplified" back to siblings without it failing.
 */
import {
	createRootRoute,
	createRoute,
	createRouter,
	getRouteApi,
	redirect,
	useLoaderData,
} from "@tanstack/react-router"
import { Shell } from "#/routes/shell"
import { HomePage } from "#/routes/home"
import { SearchPage, validateSearch } from "#/routes/search"
import { SectionPage } from "#/routes/section"
import { DocRoute } from "#/routes/document"
import { dashboardLoader, DashboardView } from "#/routes/dashboard"
import {
	exportLoaderDeps,
	exportPdfLoader,
	ExportPdfPage,
	validateExportSearch,
} from "#/routes/export-pdf"
import { fetchMe, fetchSections } from "#/lib/api-client"
import { sectionIdsFrom } from "#/lib/sections"
import { shouldRedirectToLogin } from "#/screens/gate"
import LoginPage from "#/screens/login"
import CreatePage from "#/screens/create"

const rootRoute = createRootRoute({
	component: Shell,
})

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: HomePage,
})

/**
 * STATIC SEGMENTS FIRST.
 *
 * `/search`, `/login`, `/create`, `/dashboard` and `/export/pdf` all sit above
 * `/$section`, which would match all of them. TanStack does sort by
 * specificity, but declaring the specific ones first makes the intent legible
 * and the result independent of the sorter's behaviour. There is a test for
 * this too: a static segment must never be swallowed by `$section`.
 */
const searchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/search",
	// validateSearch gives `useSearch({ from: "/search" })` a typed {q, mode}.
	// An unrecognised mode falls back to hybrid rather than erroring, which is
	// what the Next page's `includes(initialMode)` check did.
	validateSearch,
	component: SearchPage,
})

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	component: LoginPage,
})

/**
 * /create — gated.
 *
 * beforeLoad runs on every entry, including client-side navigations, and is the
 * UX half of the gate: an unauthenticated caller is sent to /login instead of
 * being shown an editor that cannot save. It returns a partial CONTEXT, not a
 * value (verified in the installed route.d.ts).
 *
 * THE AUTHORITATIVE HALF IS SERVER-SIDE and is not affected by anything here:
 * documents.create goes through requireWriteAuth, which rejects anything without
 * the secret header. This redirect improves the experience; it grants nothing.
 */
const createRoute_ = createRoute({
	getParentRoute: () => rootRoute,
	path: "/create",
	beforeLoad: async () => {
		// "cannot tell" (a failed auth.me) must read as "not allowed", or a dead
		// API would render the editor and fail at submit instead of at the door.
		const me = await fetchMe().catch(() => null)
		if (shouldRedirectToLogin(me)) {
			throw redirect({ to: "/login" })
		}
		return { context: { me } }
	},
	loader: async () => {
		// sections only: the folder tree is fetched on demand by the page, since
		// it depends on which section the form is showing.
		const sections = await fetchSections().catch(() => [])
		return { sectionIds: sectionIdsFrom(sections) }
	},
	// TanStack does NOT pass loader output as a `loaderData` prop: `component` is
	// declared once in router-core as `component?: RouteComponent`, and in
	// @tanstack/react-router `type RouteComponent = AsyncRouteComponent<{}>` — a
	// single non-generic type with an empty props argument, so the prop is typed
	// `{}`. The supported way to read a loader's result is useLoaderData, keyed
	// by route id.
	component: () => {
		const { sectionIds } = useLoaderData({ from: "/create" })
		return <CreatePage sectionIds={sectionIds} />
	},
})

const dashboardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dashboard",
	loader: dashboardLoader,
	component: () => <DashboardView data={useDashboardLoaderData()} />,
})

const exportPdfRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/export/pdf",
	validateSearch: validateExportSearch,
	loaderDeps: ({ search }) => exportLoaderDeps(search),
	loader: ({ deps }) => exportPdfLoader(deps),
	component: () => <ExportPdfPage {...useExportPdfLoaderData()} />,
})

/**
 * `/:section` — the section index. $section is ONE segment; the splat below it
 * catches everything deeper.
 */
const sectionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/$section",
	component: SectionPage,
})

/**
 * `/:section/*` — documents, folders, and export views.
 *
 * Written as `$` (NOT `/$section/$`) and parented to sectionRoute, because it
 * is a CHILD of it: see the header note on why the sibling form makes every
 * document URL unreachable. Naming the splat explicitly is also what makes
 * `useParams({ from })` typed as `{ section: string; _splat?: string }` instead
 * of an opaque positional array — and that is the property
 * src/components/DocLink.tsx relies on.
 */
const docRoute = createRoute({
	getParentRoute: () => sectionRoute,
	path: "$",
	component: DocRoute,
})

const routeTree = rootRoute.addChildren([
	indexRoute,
	searchRoute,
	loginRoute,
	createRoute_,
	dashboardRoute,
	exportPdfRoute,
	sectionRoute.addChildren([docRoute]),
])

export { routeTree, rootRoute }

/*
 * Typed accessors. `getRouteApi` resolves a route id to its loader-data type.
 * Verified, not assumed: a call site reading a property that does not exist is
 * a type error here, which is the property that makes the loaders' return types
 * worth annotating.
 */
const dashboardApi = getRouteApi("/dashboard")
const exportPdfApi = getRouteApi("/export/pdf")

function useDashboardLoaderData() {
	return dashboardApi.useLoaderData()
}

function useExportPdfLoaderData() {
	return exportPdfApi.useLoaderData()
}

export function createAppRouter() {
	return createRouter({ routeTree })
}

// REQUIRED for type inference. Without this declaration Link, useNavigate and
// every route helper fall back to `any` paths and params.
declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createAppRouter>
	}
}
