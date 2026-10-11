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
 * The fetch moved from SWR-over-/api/queue/status to useSWR over the oRPC
 * client. SWR is kept rather than replaced with a hand-rolled interval because
 * it already handles the failure mode this component cares about: with
 * shouldRetryOnError off and the API returning zeroed counters when Redis is
 * down, the badge settles on "index idle" instead of spinning forever.
 */
import useSWR from "swr"
import { Clock, CheckCircle2, AlertTriangle, Hourglass } from "lucide-react"
import { fetchQueueStatus, type QueueCounts } from "../lib/orpc"

/**
 * SWR key. A constant rather than an inline string so the badge and the strip
 * share ONE cache entry — two keys would mean two independent pollers for the
 * same five integers.
 */
export const QUEUE_STATUS_KEY = "orpc:queue/status" as const

/** The fetcher SWR calls. Adapts the oRPC shape to the flat counters. */
export const fetchQueueCounts = () => fetchQueueStatus()

export function QueueBadge() {
	const { data, error, isLoading } = useSWR<QueueCounts>(
		QUEUE_STATUS_KEY,
		fetchQueueCounts,
		{
			refreshInterval: 8_000,
			dedupingInterval: 4_000,
			revalidateOnFocus: false,
		},
	)

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
	const { data } = useSWR<QueueCounts>(QUEUE_STATUS_KEY, fetchQueueCounts, {
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
