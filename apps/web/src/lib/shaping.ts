/**
 * Pure shaping helpers for the oRPC read surface.
 *
 * SPLIT OUT OF api.ts ON PURPOSE: everything in this module is a pure function
 * of its arguments, which is what makes it testable without a network and what
 * lets the fetch wrappers in api-client.ts import it. Three sibling agents each
 * wrote a transport; this file is the one piece of dashboard logic worth
 * keeping, because the wire shapes genuinely differ from what the UI wants:
 *
 *   queue.status   returns { queue, prefix, counts: { waiting, ... } }
 *                 the Next route returned { waiting, ... } flat.
 *                 -> flattenQueueCounts does that, in one place.
 *
 *   tags           has NO oRPC procedure at all. The Next app's /api/tags route
 *                 aggregated client-side from the document list, and so does
 *                 this. There is nothing to call; inventing one would have
 *                 meant editing apps/api.
 *
 * Return types are the @mcpedia/types interfaces — the exact types
 * @mcpedia/core returns for these same values server-side — so drift between
 * the two sides is a typecheck error rather than a blank panel in production.
 */
import type { DocumentMeta } from "@mcpedia/types"

export interface QueueCounts {
	waiting: number
	active: number
	completed: number
	failed: number
	delayed: number
}

export interface TagCount {
	tag: string
	count: number
}

/**
 * Flatten the oRPC queue payload into the shape the badge and strip render.
 *
 * Pure and total on purpose: `counts` is missing whenever the API could not
 * reach Redis, and the Next route degraded to zeroed counters in exactly that
 * case rather than failing the render. Anything non-numeric becomes 0 so a
 * surprise payload cannot render "NaN" in the UI.
 */
export function flattenQueueCounts(raw: unknown): QueueCounts {
	const src =
		typeof raw === "object" && raw !== null && "counts" in raw
			? ((raw as { counts?: unknown }).counts ?? {})
			: (raw ?? {})
	const num = (key: keyof QueueCounts): number => {
		const v = (src as Record<string, unknown>)[key]
		const n = Number(v)
		return Number.isFinite(n) ? n : 0
	}
	return {
		waiting: num("waiting"),
		active: num("active"),
		completed: num("completed"),
		failed: num("failed"),
		delayed: num("delayed"),
	}
}

/**
 * Count tag occurrences across documents, most frequent first.
 *
 * `split(/[,\s]+/)` matches what the Next /api/tags route did, so the rendered
 * cloud is unchanged. Ties break alphabetically so the output is stable between
 * renders — otherwise the cloud reshuffles on every refetch.
 */
export function aggregateTags(docs: DocumentMeta[], limit = 30): TagCount[] {
	const counts = new Map<string, number>()
	for (const doc of docs) {
		for (const raw of doc.tags ?? []) {
			for (const tag of raw.split(/[,\s]+/)) {
				const key = tag.trim()
				if (!key) continue
				counts.set(key, (counts.get(key) ?? 0) + 1)
			}
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
		.slice(0, limit)
}

/**
 * Build the /search href for a query string.
 *
 * Shared by the dashboard's tag links and TagCloud. Single source because the
 * encoding is load-bearing and duplicated href builders drift: tags are
 * user-authored and routinely contain "#" (fragment delimiter) and "&" (query
 * separator), either of which silently truncates an unencoded query.
 */
export function searchHref(query: string): string {
	return `/search?q=${encodeURIComponent(query)}`
}
