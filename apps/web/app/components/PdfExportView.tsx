"use client"

import React, { useState, useMemo } from "react"
import Link from "next/link"
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

interface PdfExportViewProps {
	exportData: ExportData
	backHref: string
}

export default function PdfExportView({
	exportData,
	backHref,
}: PdfExportViewProps) {
	const { summary, documents: initialDocs } = exportData

	// Filter out any leftover index / meta files
	const cleanDocs = useMemo(() => {
		return initialDocs.filter((d) => {
			const slug = d.slug.toLowerCase()
			return (
				!slug.endsWith("/_index") &&
				!slug.endsWith("/index") &&
				slug !== "_index" &&
				slug !== "index" &&
				d.type !== "writeup-index"
			)
		})
	}, [initialDocs])

	// Configuration and interactive state
	const [sortBy, setSortBy] = useState<ExportSortOption>("category_points")
	const [showTOC, setShowTOC] = useState(cleanDocs.length > 1)
	const [pageBreaks, setPageBreaks] = useState(true)
	const [selectedCategory, setSelectedCategory] = useState<string>("all")
	const [copiedMd, setCopiedMd] = useState(false)

	const sectionMeta = getSectionMeta(summary.section)

	// Available categories for filtering
	const allCategories = useMemo(() => {
		const set = new Set<string>()
		for (const doc of cleanDocs) {
			set.add(extractDocCategory(doc))
		}
		return Array.from(set).sort()
	}, [cleanDocs])

	// Filtered & Sorted documents
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

	// Calculate dynamic stats for currently filtered view
	const currentTotalPoints = useMemo(() => {
		return filteredAndSortedDocs.reduce(
			(sum, d) => sum + extractDocPoints(d),
			0,
		)
	}, [filteredAndSortedDocs])

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
		const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		const safeName = summary.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
		a.download = `${safeName}.md`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	}

	const [downloadingDocx, setDownloadingDocx] = useState(false)

	async function handleDownloadDocx() {
		setDownloadingDocx(true)
		try {
			const slugs = filteredAndSortedDocs.map((d) => d.slug).join(",")
			const safeName =
				summary.title
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-|-$/g, "") || "export"
			const url = `/api/export?format=docx&slugs=${encodeURIComponent(slugs)}&sort=${sortBy}&pageBreaks=${pageBreaks}`
			const res = await fetch(url)
			if (!res.ok) throw new Error("Failed to generate Word document")
			const blob = await res.blob()
			const blobUrl = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = blobUrl
			a.download = `${safeName}.docx`
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			URL.revokeObjectURL(blobUrl)
		} catch (err) {
			console.error("DOCX download error:", err)
			alert("Failed to generate .docx file. Please try again.")
		} finally {
			setDownloadingDocx(false)
		}
	}

	return (
		<div className="pb-16 print:pb-0">
			{/* Export Control Toolbar (Screen Only — Hidden in Print) */}
			<aside className="no-print export-toolbar sticky top-16 z-30 mb-8 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-4 sm:p-5 shadow-xs">
				<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
					{/* Left info & Back button */}
					<div className="flex items-center gap-3">
						<Link
							href={backHref}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shadow-xs"
						>
							<ArrowLeft className="w-3.5 h-3.5" />
							<span>Back</span>
						</Link>
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

					{/* Action Buttons */}
					<div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
						{/* Copy All Markdown */}
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

						{/* Download Markdown */}
						<button
							onClick={handleDownloadMarkdown}
							type="button"
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer"
							title="Download compiled .md file"
						>
							<FileDown className="w-3.5 h-3.5" />
							<span>Download .md</span>
						</button>

						{/* Download Word (.docx) */}
						<button
							onClick={handleDownloadDocx}
							disabled={downloadingDocx}
							type="button"
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50"
							title="Download editable Microsoft Word (.docx) document"
						>
							{downloadingDocx ? (
								<div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
							) : (
								<FileText className="w-3.5 h-3.5" />
							)}
							<span>Download .docx</span>
						</button>

						{/* Print / Save as PDF Button */}
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

				{/* Options & Filters Bar */}
				<div className="mt-3.5 pt-3 border-t border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
					{/* Sort Order Selector */}
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

					{/* Section toggles */}
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

				{/* Category filter pills */}
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

			{/* Writeup Document Flow */}
			<main className="print-container bg-white text-slate-900 max-w-4xl mx-auto px-4 sm:px-8 py-6 print:p-0 print:m-0 print:max-w-none rounded-xl border border-[var(--border-color)] print:border-none shadow-xs print:shadow-none">
				{/* Document Header */}
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

				{/* Table of Contents */}
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

				{/* Challenges Flow */}
				<div className="challenges-flow space-y-10 print:space-y-0">
					{filteredAndSortedDocs.map((doc, idx) => {
						const chNum = idx + 1
						const cat = extractDocCategory(doc)
						const pts = extractDocPoints(doc)
						const diff = extractDocDifficulty(doc)
						const extra = doc.extraFields || {}

						return (
							<article
								key={doc.slug}
								id={`ch-${chNum}`}
								className={`challenge-entry ${
									pageBreaks && idx > 0 ? "page-break-before" : ""
								} pt-6 first:pt-0 print:pt-2.5 print:pb-2 print:border-b print:border-slate-200 print:last:border-none`}
							>
								{/* Challenge Title & Metadata */}
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

										{/* Extra fields */}
										{Object.entries(extra).map(([k, v]) => {
											const lowerKey = k.toLowerCase()
											if (
												[
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
												].includes(lowerKey) ||
												v === null ||
												v === undefined ||
												v === ""
											) {
												return null
											}
											return (
												<span key={k}>
													<strong>{k}:</strong> {String(v)}
												</span>
											)
										})}
									</div>
								</div>

								{/* Markdown Writeup Content */}
								<div className="prose prose-slate max-w-none text-slate-900 mb-8 print:mb-1">
									<Markdown source={doc.body} />
								</div>

								{/* Divider between challenges (screen only) */}
								<hr className="print:hidden border-slate-200 my-8" />
							</article>
						)
					})}
				</div>
			</main>
		</div>
	)
}
