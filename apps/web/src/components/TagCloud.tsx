/**
 * The popular-tags cloud.
 *
 * Ported from apps/web/app/components/TagCloud.tsx. Two changes, both forced by
 * the data source rather than chosen:
 *
 *   1. `next/link` becomes a plain <a>. TanStack's Link types `to` against the
 *      registered route tree, and /search is owned by another port group that
 *      is not in this tree yet — so a <Link to="/search"> would be a typecheck
 *      error until every group merges. The href comes from the shared
 *      searchHref() rather than being written inline, because the tag has to be
 *      URL-encoded and unencoded "#"/"&" tags silently truncate the query.
 *
 *   2. The tag list is derived client-side (fetchTags) rather than fetched from
 *      /api/tags. There is no tags procedure on the oRPC router, so this
 *      reproduces exactly what the Next route did: aggregate documents.list.
 *      See src/lib/api.ts for why.
 *
 * The `limit` prop is kept because TagCloudClient renders it at 30 while the
 * default is 24, and that difference is visible in the header count.
 */
import useSWR from "swr"
import { Tag } from "lucide-react"
import { fetchTags, searchHref, type TagCount } from "../lib/orpc"

/** SWR key. Includes the limit so the two limits never share a cache entry. */
export const tagCloudKey = (limit: number) => `orpc:tags:${limit}` as const

/**
 * Font weight per tag, relative to the most common one.
 *
 * The Next component wrote `opacity: 0.45 + intensity * 0.55`, i.e. a range of
 * 0.45..1. That is kept. `max` is floored at 1 so a corpus where every tag has
 * count 0 (possible only for an empty tag list, but the guard costs nothing)
 * cannot divide by zero.
 */
export function tagOpacity(count: number, max: number): number {
	const intensity = count / max
	return 0.45 + intensity * 0.55
}

export default function TagCloud({ limit = 24 }: { limit?: number }) {
	const { data, isLoading } = useSWR<TagCount[]>(
		tagCloudKey(limit),
		() => fetchTags(limit),
		{ revalidateOnFocus: false },
	)
	const tags = data ?? []

	if (isLoading) {
		return (
			<div className="flex flex-wrap gap-1.5 animate-pulse">
				{Array.from({ length: 8 }).map((_, i) => (
					<div key={i} className="h-6 w-16 bg-[var(--bg-elevated)] rounded" />
				))}
			</div>
		)
	}

	if (tags.length === 0) return null

	const max = Math.max(...tags.map((t) => t.count), 1)

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Tag className="w-3.5 h-3.5 text-[var(--text-muted)]" />
				<h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
					Popular Tags
				</h3>
				<span className="text-[11px] text-[var(--text-dim)] font-mono">
					({tags.length})
				</span>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{tags.map(({ tag, count }) => (
					<a
						key={tag}
						href={searchHref(tag)}
						className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono transition-all hover:scale-[1.02] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
						style={{ opacity: tagOpacity(count, max) }}
						title={`${count} document${count !== 1 ? "s" : ""}`}
					>
						<span>#{tag}</span>
						<span className="text-[10px] bg-[var(--bg-elevated)] px-1 py-0.2 rounded font-semibold">
							{count}
						</span>
					</a>
				))}
			</div>
		</div>
	)
}
