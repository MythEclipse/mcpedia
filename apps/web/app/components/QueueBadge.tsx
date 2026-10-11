"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import {
	Clock,
	CheckCircle2,
	AlertTriangle,
	Hourglass,
	Layers,
} from "lucide-react"

export default function QueueBadge() {
	const { data, error, isLoading } = useSWR<{
		waiting: number
		active: number
		completed: number
		failed: number
		delayed: number
	}>("/api/queue/status", fetcher, {
		refreshInterval: 8_000,
		dedupingInterval: 4_000,
		revalidateOnFocus: false,
	})

	if (isLoading) {
		return (
			<span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-dim)] bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2.5 py-1 rounded">
				<Hourglass className="w-3 h-3 animate-spin" /> queue…
			</span>
		)
	}

	if (error || !data) return null

	const total = data.waiting + data.active + data.delayed
	const hasWork = total > 0 || data.failed > 0

	if (!hasWork) {
		return (
			<span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded">
				<CheckCircle2 className="w-3 h-3" /> index idle
			</span>
		)
	}

	return (
		<span
			className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border ${
				data.failed > 0
					? "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30"
					: "text-[var(--text-secondary)] bg-[var(--bg-elevated)] border-[var(--border-color)]"
			}`}
			title={`waiting:${data.waiting} active:${data.active} delayed:${data.delayed} failed:${data.failed}`}
			role="status"
			aria-live="polite"
		>
			{data.failed > 0 ? (
				<AlertTriangle className="w-3 h-3" />
			) : (
				<Clock className="w-3 h-3" />
			)}
			<span>
				q:{data.waiting}w · {data.active}a
				{data.delayed ? ` · ${data.delayed}d` : ""}
				{data.failed ? ` · ${data.failed} ✕` : ""}
			</span>
		</span>
	)
}

export function QueueStrip() {
	const { data } = useSWR<{
		waiting: number
		active: number
		completed: number
		failed: number
		delayed: number
	}>("/api/queue/status", fetcher, {
		refreshInterval: 6_000,
		revalidateOnFocus: false,
	})
	if (!data) return null
	const items: { label: string; value: number; tone: string }[] = [
		{ label: "waiting", value: data.waiting, tone: "text-[var(--text-muted)]" },
		{
			label: "active",
			value: data.active,
			tone: "text-sky-600 dark:text-sky-400",
		},
		{ label: "delayed", value: data.delayed, tone: "text-[var(--text-muted)]" },
		{
			label: "failed",
			value: data.failed,
			tone: data.failed
				? "text-amber-600 dark:text-amber-400"
				: "text-[var(--text-dim)]",
		},
		{
			label: "completed",
			value: data.completed,
			tone: "text-emerald-600 dark:text-emerald-400",
		},
	]
	return (
		<div className="flex flex-wrap gap-2 text-[11px] font-mono">
			{items.map((it) => (
				<span
					key={it.label}
					className={`px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] ${it.tone}`}
				>
					{it.label}: <strong>{it.value}</strong>
				</span>
			))}
		</div>
	)
}
