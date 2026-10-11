import Link from "next/link"

export function SectionCard({
	id,
	label,
	icon,
	desc,
	docCount,
}: {
	id: string
	label: string
	icon: string
	desc: string
	docCount: number
}) {
	return (
		<div className="group flex flex-col justify-between bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-5 transition-all shadow-xs">
			<div>
				<div className="flex items-center justify-between gap-2 mb-3">
					<span className="text-2xl">{icon}</span>
					<Link
						href={`/${id}`}
						className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] font-semibold"
					>
						{docCount} docs →
					</Link>
				</div>
				<h3 className="font-bold text-sm text-[var(--text-primary)] mb-1">
					{label}
				</h3>
				<p className="text-xs text-[var(--text-muted)] mb-4 line-clamp-2 leading-relaxed">
					{desc}
				</p>
			</div>
			<div className="pt-3 border-t border-[var(--border-color)] text-xs text-[var(--text-dim)] font-mono">
				/{id} · {docCount} document{docCount !== 1 ? "s" : ""}
			</div>
		</div>
	)
}
