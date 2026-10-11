"use client"

import { mutate } from "swr"
import { useRevisions } from "@/hooks/useRevisions"
import { History } from "lucide-react"

export default function RevisionList({
	slug,
	canEdit,
}: {
	slug: string
	canEdit: boolean
}) {
	const {
		revisions,
		isLoading,
		error,
		mutate: revalidate,
	} = useRevisions(slug, 10)

	if (isLoading) {
		return (
			<div className="space-y-2 animate-pulse">
				{Array.from({ length: 3 }).map((_, i) => (
					<div
						key={i}
						className="h-12 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg"
					/>
				))}
			</div>
		)
	}

	if (error) {
		return (
			<p className="text-xs text-amber-600 dark:text-amber-400">
				Failed to load revisions: {(error as Error).message}
			</p>
		)
	}

	if (revisions.length === 0) return null

	return (
		<aside className="mt-10 pt-8 border-t border-[var(--border-color)]">
			<div className="flex items-center justify-between mb-3.5">
				<div className="flex items-center gap-2">
					<History className="w-4 h-4 text-[var(--text-muted)]" />
					<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
						Revision History ({revisions.length})
					</h2>
				</div>
			</div>
			<div className="space-y-2">
				{revisions.map((rev) => (
					<div
						key={rev.id}
						className="flex items-center justify-between gap-3 p-3 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg text-xs shadow-xs"
					>
						<div className="flex items-center gap-2 min-w-0 font-mono">
							<span className="text-[var(--text-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--border-color)] font-bold text-[10px]">
								v{rev.revisionNo}
							</span>
							<span className="text-[var(--text-secondary)] font-sans truncate text-xs">
								{rev.reason || "Updated document in PostgreSQL"}
							</span>
							<span className="text-[var(--text-dim)] hidden sm:inline text-[11px]">
								· {new Date(rev.createdAt).toLocaleString()}
							</span>
						</div>
						{canEdit && (
							<form
								action="/api/revisions/restore"
								method="post"
								onSubmit={() => {
									// Optimistically revalidate after form post navigates back
									setTimeout(() => {
										revalidate()
										mutate(
											(k) => typeof k === "string" && k.startsWith("/api/docs"),
										)
									}, 800)
								}}
							>
								<input type="hidden" name="id" value={rev.id} />
								<button
									type="submit"
									className="text-xs text-[var(--text-primary)] hover:text-black dark:hover:text-white bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] px-2.5 py-1 rounded border border-[var(--border-color)] transition-colors font-medium cursor-pointer"
								>
									Restore
								</button>
							</form>
						)}
					</div>
				))}
			</div>
		</aside>
	)
}
