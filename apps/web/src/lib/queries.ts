/**
 * TanStack Query hooks: the one place the SPA talks to the API.
 *
 * Route components call these instead of importing @mcpedia/core. Every read
 * the ported routes need is here, and each hook names the procedure it calls so
 * the data path is readable from the call site.
 *
 * TWO DELIBERATE CHOICES:
 *
 * 1. No `retry`. The Next pages rendered whatever the API returned, including
 *    an error. A knowledge base that 404s once should say so rather than
 *    silently refetching three times and flashing — and oRPC errors carry real
 *    status codes, so a retry on a 4xx is wasted work by construction.
 *
 * 2. `staleTime` per hook rather than globally. The document list and section
 *    registry change rarely; search results are per-keystroke and should never
 *    be served stale. One global value would be wrong for one of those.
 */

import type { ExportSortOption, SectionInfo } from "@mcpedia/types"
import {
	queryOptions,
	type UseQueryResult,
	useQuery,
} from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { RPC_BASE, rpcCall } from "#/lib/api-client"
import { type MeResponse, fetchMe } from "#/lib/api-client"
import type { QueueCounts, TagCount } from "#/lib/orpc"
import { fetchExportData, fetchQueueStatus, fetchTags } from "#/lib/orpc"
import type { ProcedureResult } from "#/lib/orpc-client"
import type {
	DocSummary,
	FolderContents,
	SearchMode,
	SearchResult,
} from "#/lib/shape"
import {
	folderContents,
	normalizeSearchHits as normalize,
	toDocSummary,
} from "#/lib/shape"

/**
 * Shared query-key factory.
 *
 * Keys are structural so a component can invalidate everything under
 * "documents" without knowing each hook's argument shape.
 */
export const qk = {
	/** Who the caller is; see useMeQuery for why this is cached. */
	me: ["auth", "me"] as const,
	sections: ["documents", "sections"] as const,
	documents: (section?: string) =>
		["documents", "list", section ?? "all"] as const,
	document: (slug: string) => ["documents", "get", slug] as const,
	related: (slug: string) => ["documents", "related", slug] as const,
	folderInfo: (section: string, path: string) =>
		["documents", "folderInfo", section, path] as const,
	search: (q: string, mode: SearchMode) => ["search", mode, q] as const,
	queue: ["queue", "status"] as const,
	tags: (limit: number) => ["tags", String(limit)] as const,
	/**
	 * The export payload for one scope.
	 *
	 * Keyed by BOTH the path and the sort, and neither is redundant: `path`
	 * selects which documents are in scope, while `sortBy` is applied
	 * server-side by `getExportDocuments` and changes the document ORDER the
	 * summary's category list is built from. Keying on path alone would serve a
	 * cached result sorted the other way.
	 */
	exportData: (path: string | undefined, sortBy: string) =>
		["documents", "export", path ?? "all", sortBy] as const,
	/** A document's revision history, newest first. */
	revisions: (slug: string) => ["revisions", "list", slug] as const,
	/** One revision's full body. */
	revision: (id: string) => ["revisions", "get", id] as const,
}

/** The section registry. Rarely changes; cached for a minute. */
export function useSectionsQuery(): UseQueryResult<SectionInfo[]> {
	return useQuery(
		queryOptions({
			queryKey: qk.sections,
			queryFn: () => rpcCall(RPC_BASE, ["documents", "sections"] as const),
			staleTime: 60_000,
			retry: false,
		}),
	)
}

/**
 * Who the caller is: `auth.me`.
 *
 * ## WHY THIS IS A QUERY AND NOT A ROUTE CONTEXT
 *
 * /create reads `me` in its beforeLoad because it must REDIRECT before render,
 * and a loader is the only place that can. Everywhere else the question is
 * "should this control be shown", which is a render-time decision: a redirect
 * would be wrong (a signed-out reader must still see the document) and a second
 * beforeLoad would gate a page that is deliberately public.
 *
 * `auth.me` is public and non-throwing — it answers `authenticated: false` with
 * a 200 when signed out — so a failed call is a transport problem, not an
 * authorization answer. `retry: false` and a short staleTime keep it from
 * hammering the API on every navigation while still picking up a sign-in.
 *
 * This is UX ONLY. Every write it enables is gated server-side by
 * `requireWriteAuthOrSession`; rendering a button it should not have granted
 * gets a 401, and rendering none it should have granted costs a click.
 */
export function useMeQuery(): UseQueryResult<MeResponse> {
	return useQuery(
		queryOptions({
			queryKey: qk.me,
			queryFn: () => fetchMe(),
			staleTime: 60_000,
			retry: false,
		}),
	)
}

/**
 * Every published document, optionally narrowed to one section.
 *
 * `undefined` input is meaningful here: the API's ListDocumentsInput is itself
 * optional, and omitting it lists everything. Passing `{}` would also be legal,
 * so the call below spells out the undefined case rather than relying on it.
 */
export function useDocumentsQuery(
	section?: string,
): UseQueryResult<DocSummary[]> {
	return useQuery(
		queryOptions({
			queryKey: qk.documents(section),
			queryFn: async () =>
				(
					await rpcCall(
						RPC_BASE,
						["documents", "list"] as const,
						section ? { section } : undefined,
					)
				).map(toDocSummary),
			staleTime: 30_000,
			retry: false,
		}),
	)
}

/** What documents.get returns: the full Document, or null when absent. */
export type DocumentResult = ProcedureResult<["documents", "get"]>

/** One document with its markdown body. Null when it does not exist. */
export function useDocumentQuery(slug: string): UseQueryResult<DocumentResult> {
	return useQuery(
		queryOptions({
			queryKey: qk.document(slug),
			queryFn: () => rpcCall(RPC_BASE, ["documents", "get"] as const, { slug }),
			staleTime: 30_000,
			retry: false,
		}),
	)
}

/** Documents the API considers related to this slug. */
export function useRelatedQuery(slug: string, limit = 4) {
	return useQuery(
		queryOptions({
			queryKey: [...qk.related(slug), limit],
			queryFn: async () =>
				(
					await rpcCall(RPC_BASE, ["documents", "related"] as const, {
						slug,
						limit,
					})
				).map(toDocSummary),
			staleTime: 60_000,
			retry: false,
		}),
	)
}

/**
 * Whether a path is a document, a folder, or neither — computed server-side by
 * documents.folderInfo.
 *
 * This is what the splat route branches on to decide between rendering a
 * document, listing a folder, and rendering not-found. It exists as a procedure
 * precisely so this decision does not require importing classifyPath into the
 * browser bundle.
 */
export function useFolderInfoQuery(
	section: string,
	path: string,
	enabled = true,
) {
	return useQuery(
		queryOptions({
			queryKey: qk.folderInfo(section, path),
			queryFn: () =>
				rpcCall(RPC_BASE, ["documents", "folderInfo"] as const, {
					section,
					path,
				}),
			enabled,
			retry: false,
		}),
	)
}

/**
 * Search across the three modes, debounced at the input rather than in the hook.
 *
 * An empty query short-circuits without touching the network: `enabled: false`
 * means the popular-queries state never fires a request, which is what the Next
 * page did by passing a null SWR key.
 */
export function useSearchQuery(
	query: string,
	mode: SearchMode,
	limit = 30,
): UseQueryResult<SearchResult[]> {
	const trimmed = query.trim()
	return useQuery(
		queryOptions({
			queryKey: [...qk.search(trimmed, mode), limit],
			queryFn: async () => {
				const input = { q: trimmed, limit }
				// Three procedures still exist and are still called separately, but
				// they no longer return three shapes: the API maps every mode onto
				// document hits via hindsight, so one normalizer serves all of them.
				//
				// Which procedure is called is kept rather than collapsed into one,
				// because the mode is part of the query key and of the MCP tool
				// surface — collapsing it would change which procedure a caller
				// reaches for, which is a product decision rather than a cleanup.
				const procedure =
					mode === "keyword"
						? "keyword"
						: mode === "semantic"
							? "semantic"
							: "hybrid"
				return normalize(
					await rpcCall(RPC_BASE, ["search", procedure] as const, input),
				)
			},
			enabled: trimmed.length > 0,
			// Search is per-keystroke: never show a previous query's results.
			staleTime: 0,
			retry: false,
		}),
	)
}

/**
 * Live queue counters, polled.
 *
 * ## WHY THE POLL INTERVALS DIFFER FROM EACH OTHER
 *
 * The badge polls at 8s and the dashboard strip at 6s. That asymmetry is
 * inherited from the Next implementation and is deliberate: the strip is the
 * operational view an operator watches while a job runs, so it wants to be
 * fresher; the badge is ambient chrome next to the page title. Both used to run
 * as two independent SWR pollers over one key, which meant two requests per
 * window and two chances for the two screens to disagree.
 *
 * With TanStack there is ONE cache entry, and the shorter interval simply wins
 * for both — see the note on `useQueueCounts` about why the strip's 6s survives
 * at all.
 */
const QUEUE_POLL_MS = 8_000

/**
 * Queue counters, shared by the badge and the dashboard strip.
 *
 * The interval is a CONSTANT rather than a per-call argument even though the
 * Next version passed different values. Under SWR the differing intervals at
 * least shared a cache entry, so the effective poll rate was the faster of the
 * two and neither component drove it alone. TanStack's `refetchInterval` is a
 * property of the observing query rather than of the cache, so two observers
 * with different intervals would fetch on their own schedules and reintroduce
 * exactly the disagreement the shared key prevented. One interval, one poller.
 *
 * `retry: false` is load-bearing rather than inherited. When Redis is down the
 * API returns zeroed counters instead of failing, so this query normally cannot
 * error; and if it does, a retry would fight the poll interval and keep the badge
 * spinning where the previous behaviour settled it on "index idle".
 */
export function useQueueCounts(): UseQueryResult<QueueCounts> {
	return useQuery(
		queryOptions({
			queryKey: qk.queue,
			queryFn: () => fetchQueueStatus(),
			refetchInterval: QUEUE_POLL_MS,
			staleTime: QUEUE_POLL_MS,
			retry: false,
		}),
	)
}

/**
 * The popular-tags cloud.
 *
 * `limit` is part of the query key, not a closure variable, so the header's 30 and
 * the default's 24 are two cache entries rather than one list whichever mounted
 * last — which is what the SWR key `orpc:tags:${limit}` did, and the reason the
 * key factory takes the limit at all.
 */
export function useTagsQuery(limit: number): UseQueryResult<TagCount[]> {
	return useQuery(
		queryOptions({
			queryKey: qk.tags(limit),
			queryFn: () => fetchTags(limit),
			staleTime: 5 * 60_000,
			retry: false,
		}),
	)
}

/**
 * A document's revision history, newest first.
 *
 * `revisions.list` is public — restoring is the gated half — so this needs no
 * credential. It was reachable only through the Next app's `/api/revisions`
 * route before, and nothing in the SPA called the procedure at all, so the
 * revision history that the document page used to render below the body had
 * simply gone missing in the port.
 *
 * The 50 limit is the schema's own maximum (RevisionListInput caps at 50), so
 * passing it is a deliberate "as many as the API will give" rather than an
 * arbitrary number that silently truncates a busy document's history.
 */
export function useRevisionsQuery(slug: string, limit = 50) {
	return useQuery(
		queryOptions({
			queryKey: [...qk.revisions(slug), limit],
			queryFn: () =>
				rpcCall(RPC_BASE, ["revisions", "list"] as const, { slug, limit }),
			staleTime: 30_000,
			retry: false,
		}),
	)
}

/**
 * One revision's full body, for the diff/review pane.
 *
 * Enabled on demand: the history list carries metadata only, and fetching every
 * revision's body to render a collapsed list would pull the document's entire
 * edit history on page load. The caller enables it when a row is expanded.
 */
export function useRevisionQuery(id: string, enabled = true) {
	return useQuery(
		queryOptions({
			queryKey: qk.revision(id),
			queryFn: () => rpcCall(RPC_BASE, ["revisions", "get"] as const, { id }),
			enabled: enabled && Boolean(id),
			// A revision is immutable by definition: the row is never rewritten.
			staleTime: Number.POSITIVE_INFINITY,
			retry: false,
		}),
	)
}

/**
 * The export payload for one scope: full documents plus the summary.
 *
 * ## WHY THIS IS A QUERY AND NOT A ROUTE LOADER
 *
 * /export/pdf is a route with its own loader (see routes/export-pdf.tsx). This
 * hook exists for the INLINE export: the section page and the folder page each
 * offer an "Export PDF" button that must render the same printable view without
 * navigating away from where the user is. That button previously rendered a
 * placeholder saying the view was "served by the Next route until the export
 * helpers are ported" — a route that had already been deleted.
 *
 * ## WHY `enabled` IS A PARAMETER
 *
 * The payload carries every document's FULL BODY. Fetching it on page load would
 * make opening a section index pull the entire section's text, for a button the
 * user may never press. So the caller enables it on demand — the button toggles
 * a state that flips this to true — and the query is then cached, which is what
 * makes a second press instant.
 */
export function useExportDataQuery(
	path: string | undefined,
	sortBy: ExportSortOption = "category_points",
	enabled = true,
) {
	return useQuery(
		queryOptions({
			queryKey: qk.exportData(path, sortBy),
			queryFn: () =>
				fetchExportData({
					...(path ? { path } : {}),
					sortBy,
				}),
			enabled,
			// Export bodies are stable and expensive to fetch; a minute of
			// staleness is right for a print-preview surface.
			staleTime: 60_000,
			retry: false,
		}),
	)
}

/** The six sort modes, in the order the export toolbar lists them. */
export const EXPORT_SORT_OPTIONS = [
	"category_points",
	"points_desc",
	"difficulty",
	"title",
	"path",
	"updated_at",
] as const satisfies readonly ExportSortOption[]

/**
 * Debounce a value. 180ms is what the Next search page used, and it is the
 * number that keeps a fast typist from firing one request per character
 * without making the results feel laggy.
 */
export function useDebounced<T>(value: T, delayMs = 180): T {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs)
		return () => clearTimeout(timer)
	}, [value, delayMs])
	return debounced
}

/**
 * The immediate child folders and documents of a folder path.
 *
 * Derived from the section's document list rather than fetched: the API returns
 * no folder tree, and recomputing from the list the section view already has is
 * both cheaper and impossible to get out of sync with it.
 */
export function useFolderContents(
	docs: DocSummary[] | undefined,
	folderSlug: string,
): FolderContents {
	return folderContents(docs ?? [], folderSlug)
}
