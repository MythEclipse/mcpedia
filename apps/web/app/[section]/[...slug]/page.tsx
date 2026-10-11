import Link from "next/link"
import { notFound } from "next/navigation"
import { getDocument, listDocuments, getExportDocuments } from "@mcpedia/core"
import { WEBHOOK_SECRET } from "@mcpedia/config"
import { isAdmin } from "@/lib/auth-server"
import Markdown from "@/components/Markdown"
import DocForm from "@/components/DocForm"
import TOC from "@/components/TOC"
import DocActions from "@/components/DocActions"
import PdfExportView from "@/components/PdfExportView"
import RelatedGrid from "@/components/RelatedGrid"
import RevisionList from "@/components/RevisionList"
import { classifyPath, extractFoldersForSection } from "@mcpedia/core"
import { getSectionMeta } from "@mcpedia/config"
import type { DocumentMeta } from "@mcpedia/core"
import {
	Folder,
	FileText,
	Clock,
	FileDown,
	ArrowLeft,
	CheckCircle2,
	XCircle,
	Target,
	Trophy,
	Zap,
	Tag,
} from "lucide-react"

export const dynamic = "force-dynamic"

interface DocPageProps {
	params: Promise<{ section: string; slug: string[] }>
	searchParams: Promise<{ edit?: string; path?: string; sort?: string }>
}

function getSectionInfo(section: string) {
	return getSectionMeta(section)
}

function calculateReadingTime(text: string): string {
	const words = text.trim().split(/\s+/).length
	const minutes = Math.ceil(words / 200)
	return `${minutes} min read`
}

function CustomFieldBadges({
	doc,
	standardKeys,
}: {
	doc: Record<string, unknown>
	standardKeys: Set<string>
}) {
	const docRecord: Record<string, unknown> = { ...doc } as Record<
		string,
		unknown
	>
	const customEntries = Object.entries(docRecord).filter(
		([k, v]) =>
			!standardKeys.has(k) &&
			v !== undefined &&
			v !== null &&
			v !== "" &&
			!k.startsWith("_"),
	)

	if (customEntries.length === 0) return null

	return (
		<div className="flex flex-wrap items-center gap-2 mt-4 pt-3.5 border-t border-[var(--border-color)]">
			{customEntries.map(([key, value]) => {
				const label =
					key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")
				let colorClass =
					"bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-secondary)]"
				let displayValue: string
				let IconComponent = Tag

				if (typeof value === "number") {
					colorClass =
						"bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-primary)] font-semibold"
					IconComponent = Target
					displayValue = `${value} pts`
				} else if (typeof value === "boolean") {
					colorClass = value
						? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold"
						: "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 font-semibold"
					IconComponent = value ? CheckCircle2 : XCircle
					displayValue = value ? "Solved" : "Pending"
				} else if (Array.isArray(value)) {
					colorClass =
						"bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-secondary)]"
					IconComponent = Folder
					displayValue = value.join(", ")
				} else {
					const v = String(value).toLowerCase()
					if (/^(easy|simple|beginner)/i.test(v)) {
						colorClass =
							"bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold"
						displayValue = "Easy"
					} else if (/^(medium|intermediate)/i.test(v)) {
						colorClass =
							"bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 font-semibold"
						displayValue = "Medium"
					} else if (/^(hard|expert|advanced)/i.test(v)) {
						colorClass =
							"bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 font-semibold"
						displayValue = "Hard"
					} else if (
						/^(pwn|web|crypto|misc|forensic|reverse|binary)/i.test(v)
					) {
						colorClass =
							"bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-primary)] font-bold"
						IconComponent = Zap
						displayValue = v.toUpperCase()
					} else if (/ctf|def.?con|event/i.test(v)) {
						colorClass =
							"bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-primary)]"
						IconComponent = Trophy
						displayValue = String(value)
					} else {
						displayValue = String(value)
					}
				}

				return (
					<span
						key={key}
						className={`inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs font-mono transition-colors ${colorClass}`}
					>
						<IconComponent className="w-3.5 h-3.5 opacity-80" />
						<span className="text-[var(--text-muted)] font-sans">{label}:</span>
						<span>{displayValue}</span>
					</span>
				)
			})}
		</div>
	)
}

function FolderIndexPage({
	section,
	slug,
	allDocs,
}: {
	section: string
	slug: string
	allDocs: DocumentMeta[]
}) {
	const prefix = `${section}/${slug}/`
	const folderDocPaths = allDocs
		.filter((d) => d.slug.startsWith(prefix))
		.map((d) => ({
			rel: d.slug.slice(prefix.length),
			doc: d,
		}))
		.sort((a, b) => a.rel.localeCompare(b.rel))

	const immediateFolders = new Map<string, { docCount: number }>()
	const immediateDocs: DocumentMeta[] = []

	for (const { rel, doc } of folderDocPaths) {
		const parts = rel.split("/")
		if (parts.length === 1) {
			immediateDocs.push(doc)
		} else {
			const folder = parts[0]
			const existing = immediateFolders.get(folder) || { docCount: 0 }
			existing.docCount += 1
			immediateFolders.set(folder, existing)
		}
	}

	const folders = [...immediateFolders.entries()].sort(([a], [b]) =>
		a.localeCompare(b),
	)
	const sectionInfo = getSectionInfo(section)
	const folderName = slug
		.split("/")
		.pop()!
		.split(/[-_]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")

	return (
		<div className="space-y-8">
			{/* Breadcrumb Navigation */}
			<nav className="flex items-center gap-2 text-xs text-[var(--text-dim)] flex-wrap">
				<Link
					href="/"
					className="hover:text-[var(--text-primary)] transition-colors"
				>
					MCPedia
				</Link>
				<span>/</span>
				<Link
					href={`/${section}`}
					className="hover:text-[var(--text-primary)] transition-colors"
				>
					{sectionInfo.label}
				</Link>
				{slug.split("/").map((part, i) => {
					const path = `${section}/${slug
						.split("/")
						.slice(0, i + 1)
						.join("/")}`
					const isLast = i === slug.split("/").length - 1
					const label = part
						.split(/[-_]/)
						.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
						.join(" ")
					return (
						<span key={path} className="flex items-center gap-2">
							<span>/</span>
							<span
								className={
									isLast
										? "text-[var(--text-primary)] font-semibold"
										: "hover:text-[var(--text-primary)]"
								}
							>
								{label}
							</span>
						</span>
					)
				})}
			</nav>

			{/* Header Card */}
			<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 shadow-xs">
				<div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
					<div className="flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-primary)]">
							<Folder className="w-5 h-5" />
						</div>
						<div>
							<h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
								{folderName}
							</h1>
							<p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
								Directory:{" "}
								<code>
									{section}/{slug}
								</code>
							</p>
						</div>
					</div>

					<div className="flex items-center gap-2">
						<span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2.5 py-1 rounded">
							{immediateDocs.length + folders.length} item
							{folders.length + immediateDocs.length !== 1 ? "s" : ""}
						</span>
						<Link
							href={`/${section}/${slug}/export`}
							className="inline-flex items-center gap-1.5 text-xs bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] px-3 py-1.5 rounded font-semibold transition-all shadow-xs"
							title={`Export all ${folderName} documents as a single PDF report`}
						>
							<FileDown className="w-3.5 h-3.5" />
							<span>Export PDF</span>
						</Link>
					</div>
				</div>
			</div>

			{/* Subfolders Grid */}
			{folders.length > 0 && (
				<div>
					<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3 tracking-wider font-mono flex items-center gap-2">
						<Folder className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<span>Subfolders ({folders.length})</span>
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{folders.map(([folder, info]) => (
							<Link
								key={folder}
								href={`/${section}/${slug}/${folder}`.replace(/\/+/g, "/")}
								className="group flex items-center gap-3 p-3.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg transition-colors shadow-xs"
							>
								<Folder className="w-4 h-4 text-[var(--text-muted)]" />
								<div className="flex-1 min-w-0">
									<div className="text-xs font-semibold text-[var(--text-primary)] group-hover:underline truncate">
										{folder
											.split(/[-_]/)
											.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
											.join(" ")}
									</div>
									<div className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">
										{info.docCount} document{info.docCount !== 1 ? "s" : ""}
									</div>
								</div>
							</Link>
						))}
					</div>
				</div>
			)}

			{/* Documents List */}
			{immediateDocs.length > 0 && (
				<div>
					<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3 tracking-wider font-mono flex items-center gap-2">
						<FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<span>Documents ({immediateDocs.length})</span>
					</h2>
					<div className="space-y-2">
						{immediateDocs.map((doc) => (
							<Link
								key={doc.slug}
								href={`/${doc.slug}`}
								className="group flex items-center justify-between gap-4 p-4 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg transition-colors shadow-xs"
							>
								<div className="flex items-center gap-3 min-w-0">
									<FileText className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
									<div className="min-w-0">
										<div className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] group-hover:underline truncate">
											{doc.title}
										</div>
										{doc.tags.length > 0 && (
											<div className="flex flex-wrap gap-1 mt-1.5">
												{doc.tags.slice(0, 4).map((t) => (
													<span
														key={t}
														className="text-[10px] px-1.5 py-0.2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-muted)] font-mono"
													>
														#{t}
													</span>
												))}
											</div>
										)}
									</div>
								</div>

								<time className="text-xs text-[var(--text-dim)] shrink-0 font-mono flex items-center gap-1">
									<Clock className="w-3 h-3" />
									<span>
										{new Date(doc.updatedAt).toLocaleDateString(undefined, {
											month: "short",
											day: "numeric",
										})}
									</span>
								</time>
							</Link>
						))}
					</div>
				</div>
			)}

			{folders.length === 0 && immediateDocs.length === 0 && (
				<div className="text-center py-12 border border-[var(--border-color)] rounded-lg bg-[var(--bg-surface)]">
					<p className="text-sm text-[var(--text-muted)]">
						No documents in this directory.
					</p>
				</div>
			)}
		</div>
	)
}

export default async function DocPage({ params, searchParams }: DocPageProps) {
	const { section, slug } = await params
	const searchParamsObj = await searchParams
	const { edit, path: queryPath, sort } = searchParamsObj

	// Handle direct export views
	if (section === "export" || (slug && slug[slug.length - 1] === "export")) {
		const isTrailingExport = slug && slug[slug.length - 1] === "export"
		const targetSlug = isTrailingExport ? slug.slice(0, -1) : slug
		const targetPath =
			queryPath ||
			(targetSlug.length > 0 ? `${section}/${targetSlug.join("/")}` : section)
		const exportData = await getExportDocuments({
			path: targetPath === "export" ? queryPath : targetPath,
			section: targetPath === section ? section : undefined,
			sortBy: (sort as any) || "category_points",
		})
		const backHref =
			targetPath && targetPath !== "export"
				? `/${targetPath}`
				: section !== "export"
					? `/${section}`
					: "/"
		return <PdfExportView exportData={exportData} backHref={backHref} />
	}

	const fullSlug = `${section}/${slug.join("/")}`

	const allDocs = await listDocuments()
	const docSlugs = allDocs.map((d) => d.slug)
	const classification = classifyPath(docSlugs, fullSlug)

	if (classification === "folder") {
		return (
			<FolderIndexPage
				section={section}
				slug={slug.join("/")}
				allDocs={allDocs}
			/>
		)
	}

	const doc = await getDocument(fullSlug)
	if (!doc) notFound()

	// Presence of an admin SESSION, not presence of a cookie. The old check was
	// `cookieStore.get("mcpedia_admin") != null`, which granted the edit UI to
	// anyone holding a cookie with that name.
	const canEdit = await isAdmin()

	const STANDARD_KEYS = new Set([
		"id",
		"slug",
		"title",
		"type",
		"section",
		"status",
		"author",
		"tags",
		"path",
		"createdAt",
		"updatedAt",
		"extraFields",
		"body",
	])

	if (edit === "1" && canEdit) {
		const existingFolders = extractFoldersForSection(docSlugs, doc.section)
		return (
			<div className="space-y-6">
				<Link
					href={`/${doc.slug}`}
					className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
				>
					<ArrowLeft className="w-3.5 h-3.5" />
					<span>Back to document</span>
				</Link>
				<h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
					Edit: {doc.title}
				</h1>
				<DocForm
					mode="edit"
					slug={fullSlug}
					secret={WEBHOOK_SECRET}
					existingSections={Array.from(new Set(allDocs.map((d) => d.section)))}
					existingFolders={{
						[doc.section]: existingFolders,
					}}
					initial={{
						title: doc.title,
						body: doc.body,
						section: doc.section,
						type: doc.type,
						status: doc.status,
						tags: doc.tags,
						author: doc.author,
						extraFields: doc.extraFields,
					}}
				/>
			</div>
		)
	}

	const sectionInfo = getSectionInfo(doc.section)
	const readingTime = calculateReadingTime(doc.body)

	return (
		<div className="flex items-start gap-8">
			{/* Main Content Column */}
			<article className="flex-1 min-w-0">
				{/* Breadcrumbs Navigation */}
				<nav className="flex items-center gap-2 text-xs text-[var(--text-dim)] mb-4 flex-wrap font-mono">
					<Link
						href="/"
						className="hover:text-[var(--text-primary)] transition-colors"
					>
						MCPedia
					</Link>
					{doc.slug.split("/").map((part, i) => {
						const crumbPath = doc.slug
							.split("/")
							.slice(0, i + 1)
							.join("/")
						const isLast = i === doc.slug.split("/").length - 1
						const label =
							i === 0
								? sectionInfo.label
								: part
										.split(/[-_]/)
										.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
										.join(" ")
						return (
							<span key={crumbPath} className="flex items-center gap-2">
								<span>/</span>
								<Link
									href={`/${crumbPath}`}
									className={
										isLast
											? "text-[var(--text-primary)] font-semibold font-sans"
											: "hover:text-[var(--text-primary)] transition-colors font-sans"
									}
								>
									{label}
								</Link>
							</span>
						)
					})}
				</nav>

				{/* Hero Metadata Card */}
				<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 sm:p-7 mb-8 shadow-xs">
					<div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 mb-2 flex-wrap text-xs">
								<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] uppercase">
									<span>{sectionInfo.icon}</span>
									<span>{sectionInfo.label}</span>
								</span>
								<span className="text-xs text-[var(--text-dim)]">·</span>
								<span className="text-xs text-[var(--text-muted)] font-mono">
									{doc.type}
								</span>
								<span className="text-xs text-[var(--text-dim)]">·</span>
								<span className="text-xs text-[var(--text-muted)] font-mono flex items-center gap-1">
									<Clock className="w-3 h-3" />
									<span>{readingTime}</span>
								</span>
							</div>

							<h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight leading-tight">
								{doc.title}
							</h1>
						</div>

						{/* Quick Actions */}
						<DocActions slug={doc.slug} body={doc.body} canEdit={canEdit} />
					</div>

					{/* Author, Date, Tags */}
					<div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)] pt-3.5 border-t border-[var(--border-color)]">
						{doc.author && (
							<div className="flex items-center gap-1.5">
								<div className="w-4 h-4 rounded bg-[var(--brand)] text-[var(--brand-fg)] flex items-center justify-center text-[10px] font-bold font-mono">
									{doc.author.charAt(0).toUpperCase()}
								</div>
								<span className="text-[var(--text-secondary)] font-medium">
									{doc.author}
								</span>
								<span className="text-[var(--text-dim)]">·</span>
							</div>
						)}
						<span className="flex items-center gap-1 font-mono text-[11px]">
							<span>
								Updated{" "}
								{new Date(doc.updatedAt).toLocaleDateString(undefined, {
									month: "short",
									day: "numeric",
									year: "numeric",
								})}
							</span>
						</span>

						{doc.tags.length > 0 && (
							<>
								<span className="text-[var(--text-dim)]">·</span>
								<div className="flex flex-wrap gap-1">
									{doc.tags.map((t) => (
										<span
											key={t}
											className="px-1.5 py-0.2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-muted)] text-[10px] font-mono"
										>
											#{t}
										</span>
									))}
								</div>
							</>
						)}
					</div>

					{/* Dynamic Badges */}
					<CustomFieldBadges doc={{ ...doc }} standardKeys={STANDARD_KEYS} />
				</div>

				{/* Mobile TOC */}
				<div className="xl:hidden mb-6 p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<TOC source={doc.body} />
				</div>

				{/* Markdown Content */}
				<div className="mb-14">
					<Markdown source={doc.body} />
				</div>

				<RelatedGrid slug={fullSlug} />
				<RevisionList slug={fullSlug} canEdit={canEdit} />
			</article>

			{/* Desktop Sticky Table of Contents Column */}
			<aside className="hidden xl:block w-64 shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pl-6 border-l border-[var(--border-color)]">
				<TOC source={doc.body} />
			</aside>
		</div>
	)
}
