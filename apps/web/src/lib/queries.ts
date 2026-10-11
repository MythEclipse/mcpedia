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
import {
	queryOptions,
	useQuery,
	type UseQueryResult,
} from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { RPC_BASE, rpcCall } from "#/lib/api-client"
import type { ProcedureResult } from "#/lib/orpc-client"
import type { SearchMode, SearchResult } from "#/lib/shape"
import { normalizeSearchHits as normalize } from "#/lib/shape"
import type { DocSummary, FolderContents } from "#/lib/shape"
import { toDocSummary, folderContents } from "#/lib/shape"
import type { SectionInfo } from "@mcpedia/types"

/**
 * Shared query-key factory.
 *
 * Keys are structural so a component can invalidate everything under
 * "documents" without knowing each hook's argument shape.
 */
export const qk = {
	sections: ["documents", "sections"] as const,
	documents: (section?: string) =>
		["documents", "list", section ?? "all"] as const,
	document: (slug: string) => ["documents", "get", slug] as const,
	related: (slug: string) => ["documents", "related", slug] as const,
	folderInfo: (section: string, path: string) =>
		["documents", "folderInfo", section, path] as const,
	search: (q: string, mode: SearchMode) => ["search", mode, q] as const,
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
				// The three procedures return different shapes; normalizeSearchHits
				// is what turns them into one SearchResult the page renders.
				if (mode === "keyword") {
					return normalize(
						mode,
						await rpcCall(RPC_BASE, ["search", "keyword"] as const, input),
					)
				}
				if (mode === "semantic") {
					return normalize(
						mode,
						await rpcCall(RPC_BASE, ["search", "semantic"] as const, input),
					)
				}
				return normalize(
					mode,
					await rpcCall(RPC_BASE, ["search", "hybrid"] as const, input),
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
