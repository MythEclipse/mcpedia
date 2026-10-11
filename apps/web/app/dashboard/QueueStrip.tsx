"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export default function DashboardQueueStrip() {
	const { data } = useSWR<{
		waiting: number
		active: number
		completed: number
		failed: number
		delayed: number
	}>("/api/queue/status", fetcher, {
		refreshInterval: 6000,
		revalidateOnFocus: false,
	})
	if (!data) return null
	return (
		<div
			className="flex flex-wrap gap-2 text-[11px] font-mono"
			role="status"
			aria-live="polite"
		>
			<span className="px-2.5 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-color)]">
				waiting: <strong>{data.waiting}</strong>
			</span>
			<span className="px-2.5 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] text-sky-600 dark:text-sky-400">
				active: <strong>{data.active}</strong>
			</span>
			<span
				className={`px-2.5 py-1 rounded bg-[var(--bg-surface)] border ${data.failed ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "border-[var(--border-color)] text-[var(--text-dim)]"}`}
			>
				failed: <strong>{data.failed}</strong>
			</span>
			<span className="px-2.5 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] text-emerald-600 dark:text-emerald-400">
				completed: <strong>{data.completed}</strong>
			</span>
			{data.delayed ? (
				<span className="px-2.5 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-color)]">
					delayed: <strong>{data.delayed}</strong>
				</span>
			) : null}
		</div>
	)
}
