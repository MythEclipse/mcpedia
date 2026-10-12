"use client"

import { Check, Copy, Edit3, FileDown, FileText, Share2 } from "lucide-react"
import { useState } from "react"
import { DocLink } from "#/components/DocLink"

interface DocActionsProps {
	slug: string
	body: string
	canEdit: boolean
}

export default function DocActions({ slug, body, canEdit }: DocActionsProps) {
	const [copiedMd, setCopiedMd] = useState(false)
	const [copiedLink, setCopiedLink] = useState(false)

	function handleCopyMarkdown() {
		navigator.clipboard.writeText(body)
		setCopiedMd(true)
		setTimeout(() => setCopiedMd(false), 2000)
	}

	function handleCopyLink() {
		navigator.clipboard.writeText(window.location.href)
		setCopiedLink(true)
		setTimeout(() => setCopiedLink(false), 2000)
	}

	return (
		<div className="flex items-center gap-1.5 shrink-0 flex-wrap">
			{/* Copy Raw Markdown */}
			<button
				onClick={handleCopyMarkdown}
				type="button"
				title="Copy raw markdown content"
				className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer"
			>
				{copiedMd ? (
					<>
						<Check className="w-3.5 h-3.5 text-emerald-500" />
						<span className="text-emerald-500 font-medium">Copied</span>
					</>
				) : (
					<>
						<Copy className="w-3.5 h-3.5" />
						<span>Raw MD</span>
					</>
				)}
			</button>

			{/* Copy Share Link */}
			<button
				onClick={handleCopyLink}
				type="button"
				title="Copy link to document"
				className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer"
			>
				{copiedLink ? (
					<>
						<Check className="w-3.5 h-3.5 text-emerald-500" />
						<span className="text-emerald-500 font-medium">Copied</span>
					</>
				) : (
					<>
						<Share2 className="w-3.5 h-3.5" />
						<span>Share</span>
					</>
				)}
			</button>

			{/* Export PDF. The `/export` suffix is part of the slug the SPA route
			    recognises (src/routes/document.tsx handles it), so this is a normal
			    doc link rather than a special case. */}
			<DocLink
				to={`${slug}/export`}
				title="Export document to publication-grade PDF"
				className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs"
			>
				<FileDown className="w-3.5 h-3.5" />
				<span>PDF</span>
			</DocLink>

			{/* Export Word (.docx) */}
			<a
				href={`/api/export?path=${encodeURIComponent(slug)}&format=docx`}
				title="Download editable Microsoft Word (.docx) file"
				className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer"
			>
				<FileText className="w-3.5 h-3.5" />
				<span>Word (.docx)</span>
			</a>

			{/* Edit Link. Editing is a write surface and stays on the Next app for now:
			    this route group is read-only, so the edit link is a full navigation
			    to the route that still serves DocForm. `canEdit` is false in the
			    SPA, so this always lands on /login. */}
			<a
				href={canEdit ? `/${slug}?edit=1` : `/login?redirect=/${slug}`}
				className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md transition-colors font-medium shadow-xs"
			>
				<Edit3 className="w-3.5 h-3.5" />
				<span>Edit</span>
			</a>
		</div>
	)
}
