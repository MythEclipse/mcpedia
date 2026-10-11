import { FileQuestion, SearchX, AlertCircle, Inbox } from "lucide-react"
import { Link } from "@tanstack/react-router"

export function EmptyState({
	title = "No results",
	description,
	icon: Icon = Inbox,
	action,
}: {
	title?: string
	description?: string
	icon?: typeof Inbox
	action?: { label: string; href: string }
}) {
	return (
		<div className="text-center py-12 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs space-y-3">
			<div className="w-10 h-10 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
				<Icon className="w-5 h-5" />
			</div>
			<h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
			{description && (
				<p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto leading-relaxed">
					{description}
				</p>
			)}
			{action && (
				<Link
					to={action.href}
					className="inline-flex items-center gap-1.5 text-xs bg-[var(--brand)] text-[var(--brand-fg)] px-3 py-1.5 rounded-md font-semibold mt-2"
				>
					{action.label}
				</Link>
			)}
		</div>
	)
}

export function ErrorState({
	message,
	onRetry,
}: {
	message?: string
	onRetry?: () => void
}) {
	return (
		<div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
			<AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
			<div className="flex-1 min-w-0">
				<div className="font-semibold">Something went wrong</div>
				{message && (
					<div className="text-[11px] opacity-80 mt-1 break-words">
						{message}
					</div>
				)}
			</div>
			{onRetry && (
				<button
					onClick={onRetry}
					type="button"
					className="shrink-0 px-2.5 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] text-[var(--text-primary)] font-semibold hover:bg-[var(--bg-elevated)]"
				>
					Retry
				</button>
			)}
		</div>
	)
}
