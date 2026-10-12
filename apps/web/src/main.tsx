/**
 * SPA entry point.
 *
 * TanStack Router is CLIENT-FIRST: loaders run in the browser, not on a server
 * (the bundled SSR skill doc is explicit about this, and it is the single
 * biggest difference from the Next App Router this replaces). The Next app's
 * server components read @mcpedia/core straight from Postgres; the SPA cannot,
 * because @mcpedia/core is denied at build time by src/build/no-server-imports.
 * Those reads move to the API (oRPC at /rpc, proxied in dev) and are fetched
 * from TanStack Query hooks — see src/lib/queries.ts.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RPCError } from "#/lib/errors"
import { createAppRouter } from "#/routes"
import "./styles.css"

const container = document.getElementById("root")
if (!container) {
	// A missing mount point is a build/layout mistake, not a runtime condition
	// to render into. Failing loudly beats a blank page.
	throw new Error("#root not found in index.html")
}

/**
 * One query client for the app.
 *
 * Built outside the component tree on purpose: a client created during render
 * is a new client on every render, which silently discards the entire cache.
 *
 * Defaults chosen for a read-mostly knowledge base:
 *  - refetchOnWindowFocus false. The Next app's SWR config had it true with a
 *    10s throttle, but its reads were server-rendered per navigation; in a SPA
 *    every route change is a client fetch, and refetching a document the user
 *    is reading because they alt-tabbed is the kind of thing that makes a page
 *    feel haunted.
 *  - retry once, and only for failures that could plausibly succeed on a
 *    second attempt (see RPCError.retryable). A 404 on a document should not be
 *    retried; a dropped connection should be.
 */
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: false,
			retry: (failureCount, error) => {
				if (error instanceof RPCError && !error.retryable) return false
				return failureCount < 1
			},
		},
	},
})

createRoot(container).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={createAppRouter()} />
		</QueryClientProvider>
	</StrictMode>,
)
