/**
 * Live queue status, polled.
 *
 * Ported from apps/web/app/components/QueueBadge.tsx. Behaviour is preserved
 * deliberately, including the two things that are not obvious:
 *
 *   - `QueueStrip` (the dashboard's five-chip strip) lives in the SAME file as
 *     the badge on the Next side and was exported alongside it. The dashboard
 *     imported it from app/dashboard/QueueStrip.tsx, which was a near-duplicate
 *     that did NOT gate the delayed chip on `data.delayed` and DID always show
 *     all five chips in a fixed order. Both are kept, as two functions, because
 *     "preserve existing behaviour" means the dashboard strip keeps hiding the
 *     delayed chip when it is zero — merging the two would have silently changed
 *     the dashboard.
 *
 *   - `role="status"` / `aria-live="polite"` are kept on both so a screen
 *     reader announces polling updates instead of silently mutating the page.
 *
 * The fetch is now `useQueueCounts` from lib/queries, so the polling lives in
 * the same place as every other read and SWR is gone from the app entirely.
 * The failure mode this component cares about is unchanged: with `retry: false`
 * and the API returning zeroed counters when Redis is down, the badge settles on
 * "index idle" instead of spinning forever.
 */
import { AlertTriangle, CheckCircle2, Clock, Hourglass } from "lucide-react"
import { useQueueCounts } from "#/lib/queries"

export function QueueBadge() {
	const { data, error, isLoading } = useQueueCounts()

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

/**
 * The dashboard's queue strip — five chips, fixed order, delayed hidden at zero.
 *
 * Kept distinct from QueueBadge on purpose: see the note at the top of the file.
 */
export function QueueStrip() {
	// Same hook as the badge, so one cache entry and one poller serve both. The
	// Next version gave the strip a faster 6s interval; see useQueueCounts for why
	// that is now a single constant rather than two schedules.
	const { data } = useQueueCounts()

	if (!data) return null

	const items: { label: string; value: number; tone: string }[] = [
		{ label: "waiting", value: data.waiting, tone: "text-[var(--text-muted)]" },
		{
			label: "active",
			value: data.active,
			tone: "text-sky-600 dark:text-sky-400",
		},
		// Present only when non-zero. This is the dashboard strip's one
		// behavioural difference from the badge's inline summary.
		...(data.delayed
			? [
					{
						label: "delayed",
						value: data.delayed,
						tone: "text-[var(--text-muted)]",
					},
				]
			: []),
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
		<div
			className="flex flex-wrap gap-2 text-[11px] font-mono"
			role="status"
			aria-live="polite"
		>
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
