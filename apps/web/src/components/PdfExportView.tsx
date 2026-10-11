/**
 * The export/print view. Printing is 100% client-side.
 *
 * NOTHING HERE TOUCHES A HEADLESS BROWSER OR A SERVER RENDERER. "Print" is
 * `window.print()` — the browser's own print dialog, which the user drives to
 * "Save as PDF". That is the same mechanism the Next version used and it is the
 * thing the task requires to keep working, so it is preserved verbatim rather
 * than replaced with a PDF library. The reason it still works unchanged is that
 * the page loads app/globals.css (see src/styles.css), whose @media print
 * block is what actually strips the chrome and applies the page breaks.
 *
 * The data now arrives over oRPC (documents.export) instead of an in-process
 * @mcpedia/core call, but every piece of local logic is unchanged:
 *   - filter/sort run on the client via the same stateless helpers
 *   - the summary is used as-is; only `documents` is re-filtered locally
 *
 * The one behavioural difference from the Next version, and it is a fix rather
 * than a regression: the .docx button used to GET /api/export on the Next
 * origin. The SPA does not serve that route, so the button is disabled with a
 * visible reason instead of failing at click time. The server-side .docx
 * generation still lives behind the Next app's /api/export during the
 * migration; wiring it to the API is a separate piece of work.
 */
import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import Markdown from "./Markdown"
import {
	extractDocCategory,
	extractDocPoints,
	extractDocDifficulty,
	sortExportDocuments,
	compileExportMarkdown,
	type Document,
	type ExportData,
	type ExportSortOption,
} from "@mcpedia/core/export-helpers"
import { getSectionMeta } from "@mcpedia/config/sections"
import {
	Printer,
	FileDown,
	FileText,
	Copy,
	Check,
	ArrowLeft,
	BookOpen,
} from "lucide-react"
import { isExportableDocument } from "../routes/export-pdf-params"

/** Frontmatter keys that are already shown as a labelled field, or are noise. */
const REDUNDANT_EXTRA_KEYS = new Set([
	"category",
	"points",
	"score",
	"pts",
	"difficulty",
	"solved",
	"author",
	"authors",
	"scope",
	"slug",
	"event",
	"challenge",
	"path",
])

/**
 * The extra frontmatter fields worth printing under a challenge's heading.
 *
 * Ported from PdfExportView's inline Object.entries(...).filter(...). Kept as a
 * pure function because it encodes a real decision — which keys are dropped —
 * and because that decision is invisible once it is a JSX expression.
 */
export function printableExtraFields(
	extra: Record<string, unknown>,
): { key: string; value: string }[] {
	const out: { key: string; value: string }[] = []
	for (const [key, value] of Object.entries(extra)) {
		const lowerKey = key.toLowerCase()
		if (REDUNDANT_EXTRA_KEYS.has(lowerKey)) continue
		// Empty values render as "author: " with nothing after it, which looks
		// like a bug in the generated PDF.
		if (value === null || value === undefined || value === "") continue
		out.push({ key, value: String(value) })
	}
	return out
}

/**
 * Turn a title into a safe download filename.
 *
 * Ported verbatim, including the "export" fallback in one of its two call
 * sites: a title made entirely of characters the slugger strips (e.g. "!!!")
 * would otherwise produce ".md" — a dotfile the browser refuses to save.
 */
export function exportFilename(title: string, fallback = "export"): string {
	const safe = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
	return safe || fallback
}

/** Trigger a client-side download of a Blob under `filename`. */
function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	document.body.removeChild(anchor)
	URL.revokeObjectURL(url)
}

interface PdfExportViewProps {
	exportData: ExportData
	backHref: string
}

export default function PdfExportView({
	exportData,
	backHref,
}: PdfExportViewProps) {
	const { summary, documents: initialDocs } = exportData

	// Filter out any leftover index / meta files.
	const cleanDocs = useMemo(
		() => initialDocs.filter((d) => isExportableDocument(d)),
		[initialDocs],
	)

	const [sortBy, setSortBy] = useState<ExportSortOption>("category_points")
	const [showTOC, setShowTOC] = useState(cleanDocs.length > 1)
	const [pageBreaks, setPageBreaks] = useState(true)
	const [selectedCategory, setSelectedCategory] = useState<string>("all")
	const [copiedMd, setCopiedMd] = useState(false)

	const sectionMeta = getSectionMeta(summary.section)

	const allCategories = useMemo(() => {
		const set = new Set<string>()
		for (const doc of cleanDocs) set.add(extractDocCategory(doc))
		return Array.from(set).sort()
	}, [cleanDocs])

	const filteredAndSortedDocs = useMemo(() => {
		let docs = [...cleanDocs]
		if (selectedCategory !== "all") {
			docs = docs.filter(
				(d) =>
					extractDocCategory(d).toLowerCase() ===
					selectedCategory.toLowerCase(),
			)
		}
		return sortExportDocuments(docs, sortBy)
	}, [cleanDocs, selectedCategory, sortBy])

	const currentTotalPoints = useMemo(
		() =>
			filteredAndSortedDocs.reduce((sum, d) => sum + extractDocPoints(d), 0),
		[filteredAndSortedDocs],
	)

	function handlePrint() {
		window.print()
	}

	function handleCopyMarkdown() {
		const md = compileExportMarkdown({
			summary,
			documents: filteredAndSortedDocs,
		})
		navigator.clipboard.writeText(md)
		setCopiedMd(true)
		setTimeout(() => setCopiedMd(false), 2000)
	}

	function handleDownloadMarkdown() {
		const md = compileExportMarkdown({
			summary,
			documents: filteredAndSortedDocs,
		})
		downloadBlob(
			new Blob([md], { type: "text/markdown;charset=utf-8" }),
			`${exportFilename(summary.title)}.md`,
		)
	}

	return (
		<div className="pb-16 print:pb-0">
			{/* Toolbar — screen only; globals.css hides .no-print when printing. */}
			<aside className="no-print export-toolbar sticky top-16 z-30 mb-8 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-4 sm:p-5 shadow-xs">
				<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<a
							href={backHref}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shadow-xs"
						>
							<ArrowLeft className="w-3.5 h-3.5" />
							<span>Back</span>
						</a>
						<div>
							<div className="flex items-center gap-2">
								<span className="text-xs font-mono text-[var(--text-primary)] font-bold uppercase">
									{sectionMeta.label}
								</span>
								<span className="text-xs text-[var(--text-dim)]">·</span>
								<span className="text-xs text-[var(--text-muted)] font-mono">
									{filteredAndSortedDocs.length} challenge
									{filteredAndSortedDocs.length !== 1 ? "s" : ""}
									{currentTotalPoints > 0 ? ` (${currentTotalPoints} pts)` : ""}
								</span>
							</div>
							<h2 className="text-sm font-bold text-[var(--text-primary)] truncate max-w-md">
								{summary.title}
							</h2>
						</div>
					</div>

					<div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
						<button
							onClick={handleCopyMarkdown}
							type="button"
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer"
							title="Copy compiled markdown document"
						>
							{copiedMd ? (
								<>
									<Check className="w-3.5 h-3.5 text-emerald-500" />
									<span className="text-emerald-500 font-bold">Copied</span>
								</>
							) : (
								<>
									<Copy className="w-3.5 h-3.5" />
									<span>Copy MD</span>
								</>
							)}
						</button>

						<button
							onClick={handleDownloadMarkdown}
							type="button"
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer"
							title="Download compiled .md file"
						>
							<FileDown className="w-3.5 h-3.5" />
							<span>Download .md</span>
						</button>

						{/*
						 .docx generation is server-side (docx npm package, node:fs).
						 The SPA has no such route, so this is shown disabled with the
						 reason rather than left to fail when clicked.
					 */}
						<button
							type="button"
							disabled
							title="Word export still runs on the Next app's /api/export route"
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-dim)] rounded-md transition-colors shadow-xs cursor-not-allowed disabled:opacity-60"
						>
							<FileText className="w-3.5 h-3.5" />
							<span>Download .docx</span>
						</button>

						<button
							onClick={handlePrint}
							type="button"
							className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-bold bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] rounded-md shadow-xs transition-all cursor-pointer"
							title="Open browser print dialog to save as PDF"
						>
							<Printer className="w-4 h-4" />
							<span>Print / Save PDF</span>
						</button>
					</div>
				</div>

				{/* Options & filters */}
				<div className="mt-3.5 pt-3 border-t border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
					<div className="flex items-center gap-2">
						<span className="text-[var(--text-muted)] font-mono text-[10px] uppercase">
							Sort:
						</span>
						<select
							value={sortBy}
							onChange={(e) => setSortBy(e.target.value as ExportSortOption)}
							className="bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
						>
							<option value="category_points">
								Category & Points (Standard)
							</option>
							<option value="points_desc">Points (Highest First)</option>
							<option value="difficulty">Difficulty (Easy to Hard)</option>
							<option value="title">Challenge Title (A-Z)</option>
							<option value="path">Directory / Chapter Path</option>
							<option value="updated_at">Recently Updated</option>
						</select>
					</div>

					<div className="flex items-center gap-3 flex-wrap text-[var(--text-secondary)]">
						{cleanDocs.length > 1 && (
							<label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
								<input
									type="checkbox"
									checked={showTOC}
									onChange={(e) => setShowTOC(e.target.checked)}
									className="rounded border-[var(--border-color)]"
								/>
								<span>Table of Contents</span>
							</label>
						)}

						<label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={pageBreaks}
								onChange={(e) => setPageBreaks(e.target.checked)}
								className="rounded border-[var(--border-color)]"
							/>
							<span>Page Break per Challenge</span>
						</label>
					</div>
				</div>

				{allCategories.length > 1 && (
					<div className="mt-3 pt-3 border-t border-[var(--border-color)] flex items-center gap-1.5 flex-wrap text-xs">
						<span className="text-[var(--text-muted)] font-mono text-[10px] uppercase mr-1">
							Filter:
						</span>
						<button
							onClick={() => setSelectedCategory("all")}
							type="button"
							className={`px-2.5 py-0.5 rounded text-xs font-mono transition-all cursor-pointer ${
								selectedCategory === "all"
									? "bg-[var(--brand)] text-[var(--brand-fg)] font-bold"
									: "bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
							}`}
						>
							All ({cleanDocs.length})
						</button>
						{allCategories.map((cat) => {
							const count = cleanDocs.filter(
								(d) =>
									extractDocCategory(d).toLowerCase() === cat.toLowerCase(),
							).length
							return (
								<button
									key={cat}
									onClick={() => setSelectedCategory(cat)}
									type="button"
									className={`px-2.5 py-0.5 rounded text-xs font-mono transition-all cursor-pointer ${
										selectedCategory.toLowerCase() === cat.toLowerCase()
											? "bg-[var(--brand)] text-[var(--brand-fg)] font-bold"
											: "bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
									}`}
								>
									{cat} ({count})
								</button>
							)
						})}
					</div>
				)}
			</aside>

			<main className="print-container bg-white text-slate-900 max-w-4xl mx-auto px-4 sm:px-8 py-6 print:p-0 print:m-0 print:max-w-none rounded-xl border border-[var(--border-color)] print:border-none shadow-xs print:shadow-none">
				<header className="doc-header mb-8 pb-4 print:mb-2.5 print:pb-1.5 border-b border-slate-300">
					<h1 className="text-3xl sm:text-4xl print:text-lg font-extrabold text-slate-950 tracking-tight mb-2 print:mb-0.5">
						{summary.title}
					</h1>
					<div className="text-xs print:text-[7.5pt] text-slate-500 font-mono flex flex-wrap items-center gap-x-2 gap-y-1 print:gap-x-1.5 print:gap-y-0.5">
						<span>{filteredAndSortedDocs.length} Challenges</span>
						{currentTotalPoints > 0 && (
							<span>· {currentTotalPoints.toLocaleString()} Total Points</span>
						)}
						<span>
							·{" "}
							{new Date(summary.generatedAt).toLocaleDateString(undefined, {
								dateStyle: "long",
							})}
						</span>
					</div>
				</header>

				{showTOC && filteredAndSortedDocs.length > 1 && (
					<section className="toc-section mb-10 pb-6 print:mb-2.5 print:pb-1.5 border-b border-slate-200 print:border-slate-300">
						<h2 className="text-xs print:text-[8pt] font-bold uppercase font-mono text-slate-700 mb-3 print:mb-1 tracking-wider flex items-center gap-1.5">
							<BookOpen className="w-3.5 h-3.5 print:w-3 print:h-3" />
							<span>Table of Contents</span>
						</h2>
						<ol className="list-decimal list-inside space-y-1.5 print:space-y-0.5 text-xs print:text-[7.5pt] text-slate-800">
							{filteredAndSortedDocs.map((doc, idx) => {
								const cat = extractDocCategory(doc)
								const pts = extractDocPoints(doc)
								return (
									<li key={doc.slug} className="print:leading-tight">
										<a
											href={`#ch-${idx + 1}`}
											className="hover:underline font-medium text-slate-900"
										>
											{doc.title}
										</a>
										<span className="text-slate-500 font-mono ml-2 print:ml-1">
											[{cat}
											{pts > 0 ? ` · ${pts} pts` : ""}]
										</span>
									</li>
								)
							})}
						</ol>
					</section>
				)}

				<div className="challenges-flow space-y-10 print:space-y-0">
					{filteredAndSortedDocs.map((doc: Document, idx: number) => {
						const chNum = idx + 1
						const cat = extractDocCategory(doc)
						const pts = extractDocPoints(doc)
						const diff = extractDocDifficulty(doc)
						const extra = printableExtraFields(doc.extraFields ?? {})

						return (
							<article
								key={doc.slug}
								id={`ch-${chNum}`}
								className={`challenge-entry ${
									pageBreaks && idx > 0 ? "page-break-before" : ""
								} pt-6 first:pt-0 print:pt-2.5 print:pb-2 print:border-b print:border-slate-200 print:last:border-none`}
							>
								<div className="challenge-header mb-4 pb-2 print:mb-1.5 print:pb-1 border-b border-slate-200 print:border-slate-300">
									<h2 className="text-2xl print:text-[11pt] font-bold text-slate-950 tracking-tight leading-tight mb-1.5 print:mb-0.5">
										{chNum}. {doc.title}
									</h2>
									<div className="text-xs print:text-[7.5pt] font-mono text-slate-600 flex flex-wrap items-center gap-x-3 print:gap-x-2 gap-y-1 print:gap-y-0.5">
										<span>
											<strong>Category:</strong> {cat}
										</span>
										{pts > 0 && (
											<span>
												<strong>Points:</strong> {pts} pts
											</span>
										)}
										{diff && (
											<span>
												<strong>Difficulty:</strong> {diff}
											</span>
										)}
										{extra.map(({ key, value }) => (
											<span key={key}>
												<strong>{key}:</strong> {value}
											</span>
										))}
									</div>
								</div>

								<div className="prose prose-slate max-w-none text-slate-900 mb-8 print:mb-1">
									<Markdown source={doc.body} />
								</div>

								<hr className="print:hidden border-slate-200 my-8" />
							</article>
						)
					})}
				</div>
			</main>
		</div>
	)
}
