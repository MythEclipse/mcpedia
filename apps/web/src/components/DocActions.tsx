"use client"

import {
	Check,
	Copy,
	Edit3,
	FileDown,
	FileText,
	Loader2,
	Share2,
} from "lucide-react"
import { useState } from "react"
import { DocLink } from "#/components/DocLink"
import { downloadDocumentDocx } from "#/lib/export-docx"
import { exportFilename } from "#/lib/export-filename"

interface DocActionsProps {
	slug: string
	title: string
	section: string
	body: string
	canEdit: boolean
}

export default function DocActions({
	slug,
	title,
	section,
	body,
	canEdit,
}: DocActionsProps) {
	const [copiedMd, setCopiedMd] = useState(false)
	const [copiedLink, setCopiedLink] = useState(false)
	const [docxState, setDocxState] = useState<"idle" | "working" | "error">(
		"idle",
	)

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

	/**
	 * Build the .docx in the browser and download it.
	 *
	 * ## WHY THIS IS NOT A LINK ANY MORE
	 *
	 * It was `<a href="/api/export?path=...&format=docx">`, pointing at the Next
	 * app's route handler. That route was deleted with the Next tree, so the URL
	 * fell through to the SPA's catch-all and the browser saved an HTML page —
	 * reported as a successful download, with no error anywhere. The export
	 * toolbar's equivalent button was disabled with a title blaming the Next app.
	 *
	 * Both are now one client-side build. See lib/export-docx.ts for why the docx
	 * package works in a browser, and why the import behind it is dynamic.
	 *
	 * The button carries its own working state because the dynamic import plus
	 * the OpenXML build is not instant on a large document: without it, a slow
	 * click looks exactly like a broken one.
	 */
	async function handleDownloadDocx() {
		setDocxState("working")
		try {
			await downloadDocumentDocx(
				{ slug, title, section, body },
				`${exportFilename(title)}.docx`,
			)
			setDocxState("idle")
		} catch {
			// A failure here is a build problem (an out-of-memory tab, a busted
			// chunk), not a network one, so there is nothing to retry against.
			// Surfacing it on the button keeps the message next to the control
			// that caused it rather than in a console nobody is watching.
			setDocxState("error")
			setTimeout(() => setDocxState("idle"), 3000)
		}
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

			{/* Export Word (.docx) — built in the browser; see handleDownloadDocx. */}
			<button
				onClick={handleDownloadDocx}
				type="button"
				disabled={docxState === "working"}
				title="Download editable Microsoft Word (.docx) file"
				className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-wait"
			>
				{docxState === "working" ? (
					<>
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
						<span>Building…</span>
					</>
				) : docxState === "error" ? (
					<>
						<FileText className="w-3.5 h-3.5 text-rose-500" />
						<span className="text-rose-500 font-medium">Failed</span>
					</>
				) : (
					<>
						<FileText className="w-3.5 h-3.5" />
						<span>Word (.docx)</span>
					</>
				)}
			</button>

			{/*
			 Edit Link. Editing is a write surface and lives on the /create group,
			 not on this read-only route: `canEdit` is false here, so this always
			 lands on /login. Kept as a plain anchor rather than a TanStack Link
			 because /login is a different route group and the redirect parameter
			 is a plain query string.
			*/}
			<a
				href={
					canEdit
						? `/create?slug=${encodeURIComponent(slug)}`
						: `/login?redirect=/${slug}`
				}
				className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md transition-colors font-medium shadow-xs"
			>
				<Edit3 className="w-3.5 h-3.5" />
				<span>Edit</span>
			</a>
		</div>
	)
}
