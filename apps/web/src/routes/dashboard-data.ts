/**
 * Data shaping for /dashboard.
 *
 * The Next page computed all of this inline inside an async server component.
 * Under TanStack Router the equivalent runs in a browser loader, so the shaping
 * is worth extracting for a different reason than usual: it is now the only
 * place that knows how three API responses become one view model, and it is
 * directly testable without a DOM, a router or a database.
 *
 * Every rule below is ported from apps/web/app/dashboard/page.tsx. The two that
 * are easy to get subtly wrong, and why they are the way they are:
 *
 *   - Recent documents sort by `updatedAt` DESC and then cap at 8. The sort
 *     must copy first: Array.prototype.sort mutates in place, and the array is
 *     the loader's own value which other cards also read.
 *
 *   - Top tags sort by count DESC only, with NO alphabetical tiebreak. That is
 *     the Next behaviour verbatim. It looks like an inconsistency with the tag
 *     cloud (which does tiebreak) but the two lists are independently fetched
 *     and never rendered in the same order, so stabilising one and not the other
 *     preserves both exactly.
 */
import type { DocumentMeta, SectionInfo } from "@mcpedia/types"

export interface DashboardData {
	docs: DocumentMeta[]
	sections: SectionInfo[]
}

/** Distinct tags across every document. */
export function countUniqueTags(docs: readonly DocumentMeta[]): number {
	const tags = new Set<string>()
	for (const doc of docs) {
		for (const tag of doc.tags ?? []) tags.add(tag)
	}
	return tags.size
}

/** The 8 most recently updated documents, newest first. Does not mutate input. */
export function recentDocuments(
	docs: readonly DocumentMeta[],
	limit = 8,
): DocumentMeta[] {
	return [...docs]
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.slice(0, limit)
}

/** The 12 most-used tags, by count descending. */
export function topTags(
	docs: readonly DocumentMeta[],
	limit = 12,
): { tag: string; count: number }[] {
	const counts = new Map<string, number>()
	for (const doc of docs) {
		for (const tag of doc.tags ?? [])
			counts.set(tag, (counts.get(tag) ?? 0) + 1)
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
}

/**
 * A section's share of the corpus, as a whole percentage.
 *
 * The zero guard is load-bearing: with no documents the denominator is 0 and
 * `Math.round(NaN)` is NaN, which React renders as the literal text "NaN" in
 * the middle of the bar. The Next page had the same guard.
 */
export function sectionShare(docCount: number, totalDocs: number): number {
	if (!totalDocs) return 0
	return Math.round((docCount / totalDocs) * 100)
}
