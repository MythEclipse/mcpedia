import { DocLink } from "#/components/DocLink"
import { Clock, FileText } from "lucide-react"
import type { DocumentMeta } from "@mcpedia/types"
import { sectionMeta } from "#/lib/shape"

export function DocumentCard({
	doc,
	showSection = false,
	score,
}: {
	doc: DocumentMeta
	showSection?: boolean
	score?: number
}) {
	const sInfo = sectionMeta(doc.section)
	return (
		<DocLink
			to={doc.slug}
			className="group flex items-center justify-between gap-4 p-4 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl transition-all shadow-xs"
		>
			<div className="flex items-center gap-3 min-w-0">
				<FileText className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
				<div className="min-w-0">
					<h3 className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] group-hover:underline truncate">
						{doc.title}
					</h3>
					<div className="flex flex-wrap items-center gap-1.5 mt-1.5">
						{showSection && (
							<span className="text-[10px] font-mono px-1.5 py-0.2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-muted)] uppercase font-semibold">
								{sInfo.icon} {doc.section}
							</span>
						)}
						{doc.tags.slice(0, 4).map((t: string) => (
							<span
								key={t}
								className="text-[10px] px-1.5 py-0.2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-muted)] font-mono"
							>
								#{t}
							</span>
						))}
						{typeof score === "number" && (
							<span className="text-[10px] font-mono text-[var(--text-dim)] bg-[var(--bg-elevated)] px-1.5 py-0.2 rounded">
								{score.toFixed(3)}
							</span>
						)}
					</div>
				</div>
			</div>
			<time className="text-xs text-[var(--text-dim)] font-mono shrink-0 flex items-center gap-1">
				<Clock className="w-3 h-3" />
				<span>
					{new Date(doc.updatedAt).toLocaleDateString(undefined, {
						month: "short",
						day: "numeric",
					})}
				</span>
			</time>
		</DocLink>
	)
}

export function CompactDocCard({
	doc,
	snippet,
	score,
}: {
	doc: DocumentMeta
	snippet?: string
	score?: number
}) {
	const sInfo = sectionMeta(doc.section)
	return (
		<DocLink
			to={doc.slug}
			className="group block bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-4.5 transition-all shadow-xs"
		>
			<div className="flex items-center justify-between gap-3 mb-2">
				<div className="flex items-center gap-2">
					<span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] uppercase font-semibold">
						{sInfo.icon} {doc.section}
					</span>
					<span className="text-xs text-[var(--text-dim)] font-mono truncate">
						/{doc.slug}
					</span>
				</div>
				{typeof score === "number" && (
					<span className="text-xs font-mono text-[var(--text-dim)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">
						{score.toFixed(3)}
					</span>
				)}
			</div>
			<h2 className="text-sm font-semibold text-[var(--text-primary)] group-hover:underline mb-1.5">
				{doc.title}
			</h2>
			{snippet && (
				<p
					className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2 [&>mark]:bg-[var(--bg-elevated-hover)] [&>mark]:text-[var(--text-primary)] [&>mark]:font-semibold"
					dangerouslySetInnerHTML={{ __html: snippet }}
				/>
			)}
		</DocLink>
	)
}
