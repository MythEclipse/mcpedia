"use client"

import Link from "next/link"
import { useRelated } from "@/hooks/useRelated"
import { getSectionMeta } from "@mcpedia/config/sections"
import { Sparkles } from "lucide-react"

export default function RelatedGrid({ slug }: { slug: string }) {
	const { related, isLoading, error } = useRelated(slug, 4)

	if (isLoading) {
		return (
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
				{Array.from({ length: 4 }).map((_, i) => (
					<div
						key={i}
						className="h-24 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg"
					/>
				))}
			</div>
		)
	}

	if (error || related.length === 0) return null

	return (
		<aside className="mt-12 pt-8 border-t border-[var(--border-color)]">
			<div className="flex items-center gap-2 mb-3.5">
				<Sparkles className="w-4 h-4 text-[var(--text-muted)]" />
				<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
					Related Knowledge
				</h2>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{related.map((r) => {
					const rInfo = getSectionMeta(r.section)
					return (
						<Link
							key={r.slug}
							href={`/${r.slug}`}
							className="group block bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg p-4 transition-colors shadow-xs"
						>
							<div className="flex items-center justify-between gap-2 mb-1.5">
								<span className="text-[10px] text-[var(--text-muted)] font-mono uppercase font-semibold">
									{rInfo.icon} {r.section}
								</span>
								<time className="text-[11px] text-[var(--text-dim)] font-mono">
									{new Date(r.updatedAt).toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
									})}
								</time>
							</div>
							<h3 className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] group-hover:underline line-clamp-1">
								{r.title}
							</h3>
						</Link>
					)
				})}
			</div>
		</aside>
	)
}
