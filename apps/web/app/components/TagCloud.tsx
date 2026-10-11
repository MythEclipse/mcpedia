"use client"

import Link from "next/link"
import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { Tag, TrendingUp } from "lucide-react"

export default function TagCloud({ limit = 24 }: { limit?: number }) {
	const { data, isLoading } = useSWR<{
		tags: { tag: string; count: number }[]
	}>(`/api/tags?limit=${limit}`, fetcher, { revalidateOnFocus: false })
	const tags = data?.tags ?? []

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
				{tags.map(({ tag, count }) => {
					const intensity = count / max
					const opacity = 0.45 + intensity * 0.55
					return (
						<Link
							key={tag}
							href={`/search?q=${encodeURIComponent(tag)}`}
							className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono transition-all hover:scale-[1.02] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							style={{ opacity }}
							title={`${count} document${count !== 1 ? "s" : ""}`}
						>
							<span>#{tag}</span>
							<span className="text-[10px] bg-[var(--bg-elevated)] px-1 py-0.2 rounded font-semibold">
								{count}
							</span>
						</Link>
					)
				})}
			</div>
		</div>
	)
}
