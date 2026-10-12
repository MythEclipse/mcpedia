/**
 * Typed access to the oRPC surface — the ONE transport this app uses.
 *
 * ## HISTORY (kept because the bug it contained is easy to reintroduce)
 *
 * This module previously held its own client built on @orpc/client:
 *
 *     export const RPC_BASE_URL = "http://127.0.0.1:4020/trpc"
 *     function resolveBaseUrl(origin) { ...return "/trpc"... }
 *     getClient() -> createClient(resolveBaseUrl(window.location.origin))
 *
 * That could not make a single request in a browser. Two independent defects:
 *
 *  1. The hardcoded origin pointed the PRODUCTION build at a dev machine, so a
 *     deployed SPA would call 127.0.0.1 — the visitor's own laptop.
 *  2. Even after (1), it returned the RELATIVE path "/trpc", and the installed
 *     @orpc/client 1.15.5 does `const url = new URL(baseUrl)` with NO second
 *     argument (client.DmANSlrL.mjs:313). `new URL("/trpc")` throws
 *     TypeError: Invalid URL — every call died before leaving the browser.
 *
 * Neither defect was reachable by any gate: pnpm test, typecheck, moon build
 * and vite build all passed, because they never execute a browser fetch. The
 * only things that catch this class are a real runtime exercise and a reviewer
 * reading the dependency's source.
 *
 * ## WHAT REPLACED IT
 *
 * lib/orpc-client.ts: a small hand-written client over plain `fetch`, where a
 * relative base is the CORRECT thing to pass because the browser resolves it
 * against the current origin. It speaks the same wire protocol (verified
 * against the installed @orpc/client, not from memory) and keeps the two
 * failure modes apart — a protocol-level rejection (ORPCError) versus a
 * transport failure (unreachable origin, proxy error page).
 */
import type { DocumentMeta, ExportData, SectionInfo } from "@mcpedia/types"
import { RPC_BASE, rpcCall } from "./api-client"
import type { QueueCounts, TagCount } from "./shaping"
import { aggregateTags, flattenQueueCounts, searchHref } from "./shaping"

export type { QueueCounts, TagCount }
export { aggregateTags, flattenQueueCounts, searchHref }

/** documents.list — published documents with metadata (no bodies). */
export async function fetchDocuments(
	signal?: AbortSignal,
): Promise<DocumentMeta[]> {
	const result = await rpcCall(
		RPC_BASE,
		["documents", "list"] as const,
		undefined,
		{ signal },
	)
	return result ?? []
}

/** documents.sections — section list with doc counts. */
export async function fetchSections(
	signal?: AbortSignal,
): Promise<SectionInfo[]> {
	return await rpcCall(
		RPC_BASE,
		["documents", "sections"] as const,
		undefined,
		{ signal },
	)
}

/** queue.status — flattened counters, zeroed when Redis is unreachable. */
export async function fetchQueueStatus(
	signal?: AbortSignal,
): Promise<QueueCounts> {
	const raw = await rpcCall(RPC_BASE, ["queue", "status"] as const, undefined, {
		signal,
	})
	return flattenQueueCounts(raw)
}

/**
 * The tag cloud, derived client-side exactly as the Next /api/tags route did.
 *
 * There is no oRPC tags procedure to call; this aggregates documents.list, the
 * same query the Next route ran.
 */
export async function fetchTags(
	limit = 30,
	signal?: AbortSignal,
): Promise<TagCount[]> {
	return aggregateTags(await fetchDocuments(signal), limit)
}

/**
 * documents.export — full bodies plus a summary, for the PDF export view.
 *
 * `slugs` is intentionally NOT threaded through: the old /api/export route used
 * it only to build a .docx, which still lives on the Next side behind
 * /api/export. This route loads the same document set the Next page loaded.
 */
export async function fetchExportData(
	input: {
		path?: string
		section?: string
		sortBy?:
			| "category_points"
			| "path"
			| "title"
			| "points_desc"
			| "difficulty"
			| "updated_at"
	},
	signal?: AbortSignal,
): Promise<ExportData> {
	// Only defined keys are sent: an explicit `undefined` is dropped by
	// JSON.stringify, but passing an object with absent keys through the oRPC
	// envelope would still validate against ExportInput differently.
	const payload: Record<string, unknown> = {}
	if (input.path !== undefined) payload.path = input.path
	if (input.section !== undefined) payload.section = input.section
	if (input.sortBy !== undefined) payload.sortBy = input.sortBy

	return await rpcCall(RPC_BASE, ["documents", "export"] as const, payload, {
		signal,
	})
}

/**
 * Run an RPC call, converting any failure into a displayable message.
 *
 * The two error types mean different things to a user: a transport failure is
 * "the backend is down, try again", while an ORPCError is "your request was
 * refused". Collapsing them would show an auth problem as an outage.
 */
export async function safeCall<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run()
	} catch (err) {
		const message = err instanceof Error ? err.message : "Something went wrong."
		throw new Error(message)
	}
}
