/**
 * The document / folder / export route (`/:section/*`).
 *
 * Ported from app/[section]/[...slug]/page.tsx, which was the worst offender:
 * a Next server component importing getDocument, listDocuments,
 * getExportDocuments, classifyPath and extractFoldersForSection from
 * @mcpedia/core, plus WEBHOOK_SECRET from @mcpedia/config. All of that is now
 * HTTP. The decisions the page used to make in-process are made here from two
 * queries:
 *
 *   documents.folderInfo  -> "doc" | "folder" | "none", the classification
 *   documents.get         -> the document, or null
 *
 * WHAT IS DELIBERATELY NOT HERE: the edit form. DocForm needs WEBHOOK_SECRET,
 * a server-only env read from @mcpedia/config (whose barrel also touches
 * node:fs), and it is a write surface gated by x-webhook-secret. Porting it
 * belongs to the authenticated route group, not this one. So `?edit=1` is
 * recognised and ignored here, and the Edit button links to the Next route that
 * still serves it.
 */
import { Link, notFound, useParams } from "@tanstack/react-router"
import {
	CheckCircle2,
	Clock,
	FileDown,
	FileText,
	Folder,
	Tag,
	Target,
	Trophy,
	XCircle,
	Zap,
} from "lucide-react"
import DocActions from "#/components/DocActions"
import { DocLink } from "#/components/DocLink"
import { EmptyState } from "#/components/EmptyState"
import Markdown from "#/components/Markdown"
import RelatedGrid from "#/components/RelatedGrid"
import TOC from "#/components/TOC"
import {
	type DocumentResult,
	useDocumentQuery,
	useDocumentsQuery,
	useFolderInfoQuery,
	useSectionsQuery,
} from "#/lib/queries"
import type { DocSummary } from "#/lib/shape"
import {
	customFieldEntries,
	customFieldLabel,
	exportTargetSlug,
	folderContents,
	isExportPath,
	joinSlug,
	readingTime,
	sectionMeta,
	sectionsOrDefaults,
	slugToTitle,
} from "#/lib/shape"

/**
 * The custom frontmatter badges — CTF documents carry points, difficulty,
 * category and event, and the Next page surfaced them as coloured chips.
 *
 * Colour and icon are chosen by value shape first (number, boolean, array) and
 * only then by value pattern, which is the order the original used.
 */
function CustomFieldBadges({ doc }: { doc: Record<string, unknown> }) {
	const entries = customFieldEntries(doc)
	if (entries.length === 0) return null

	return (
		<div className="flex flex-wrap items-center gap-2 mt-4 pt-3.5 border-t border-[var(--border-color)]">
			{entries.map(([key, value]) => {
				const label = customFieldLabel(key)
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

/** A folder that exists as a path but holds no documents. */
function FolderIndex({
	section,
	folderSlug,
	docs,
}: {
	section: string
	folderSlug: string
	docs: DocSummary[]
}) {
	const info = sectionMeta(section)
	const { folders, documents } = folderContents(docs, folderSlug)
	const folderName = slugToTitle(folderSlug.split("/").pop() ?? folderSlug)
	const itemCount = folders.length + documents.length

	return (
		<div className="space-y-8">
			<nav className="flex items-center gap-2 text-xs text-[var(--text-dim)] flex-wrap">
				<Link
					to="/"
					className="hover:text-[var(--text-primary)] transition-colors"
				>
					MCPedia
				</Link>
				<span>/</span>
				<DocLink
					to={section}
					className="hover:text-[var(--text-primary)] transition-colors"
				>
					{info.label}
				</DocLink>
				{folderSlug.split("/").map((part, i, all) => {
					const path = `${section}/${all.slice(0, i + 1).join("/")}`
					const isLast = i === all.length - 1
					return (
						<span key={path} className="flex items-center gap-2">
							<span>/</span>
							<DocLink
								to={path}
								className={
									isLast
										? "text-[var(--text-primary)] font-semibold"
										: "hover:text-[var(--text-primary)]"
								}
							>
								{slugToTitle(part)}
							</DocLink>
						</span>
					)
				})}
			</nav>

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
								Directory: <code>{folderSlug}</code>
							</p>
						</div>
					</div>

					<div className="flex items-center gap-2">
						<span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2.5 py-1 rounded">
							{itemCount} item{itemCount !== 1 ? "s" : ""}
						</span>
						<DocLink
							to={`/${folderSlug}/export`}
							className="inline-flex items-center gap-1.5 text-xs bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] px-3 py-1.5 rounded font-semibold transition-all shadow-xs"
							title={`Export all ${folderName} documents as a single PDF report`}
						>
							<FileDown className="w-3.5 h-3.5" />
							<span>Export PDF</span>
						</DocLink>
					</div>
				</div>
			</div>

			{folders.length > 0 && (
				<div>
					<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3 tracking-wider font-mono flex items-center gap-2">
						<Folder className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<span>Subfolders ({folders.length})</span>
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{folders.map((folder) => (
							<DocLink
								key={folder.name}
								to={`/${folderSlug}/${folder.name}`}
								className="group flex items-center gap-3 p-3.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg transition-colors shadow-xs"
							>
								<Folder className="w-4 h-4 text-[var(--text-muted)]" />
								<div className="flex-1 min-w-0">
									<div className="text-xs font-semibold text-[var(--text-primary)] group-hover:underline truncate">
										{slugToTitle(folder.name)}
									</div>
									<div className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">
										{folder.docCount} document{folder.docCount !== 1 ? "s" : ""}
									</div>
								</div>
							</DocLink>
						))}
					</div>
				</div>
			)}

			{documents.length > 0 && (
				<div>
					<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3 tracking-wider font-mono flex items-center gap-2">
						<FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<span>Documents ({documents.length})</span>
					</h2>
					<div className="space-y-2">
						{documents.map((doc) => (
							<DocLink
								key={doc.slug}
								to={doc.slug}
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
							</DocLink>
						))}
					</div>
				</div>
			)}

			{itemCount === 0 && (
				<EmptyState
					title="No documents in this directory"
					description="This path exists but nothing is published under it."
					icon={Folder}
				/>
			)}
		</div>
	)
}

function DocumentView({
	fullSlug,
	doc,
}: {
	fullSlug: string
	doc: NonNullable<DocumentResult>
}) {
	const { data: liveSections } = useSectionsQuery()
	const info = sectionMeta(doc.section, sectionsOrDefaults(liveSections))

	return (
		<div className="flex items-start gap-8">
			<article className="flex-1 min-w-0">
				<nav className="flex items-center gap-2 text-xs text-[var(--text-dim)] mb-4 flex-wrap font-mono">
					<Link
						to="/"
						className="hover:text-[var(--text-primary)] transition-colors"
					>
						MCPedia
					</Link>
					{doc.slug.split("/").map((part, i, all) => {
						const crumb = all.slice(0, i + 1).join("/")
						const isLast = i === all.length - 1
						return (
							<span key={crumb} className="flex items-center gap-2">
								<span>/</span>
								<DocLink
									to={crumb}
									className={
										isLast
											? "text-[var(--text-primary)] font-semibold font-sans"
											: "hover:text-[var(--text-primary)] transition-colors font-sans"
									}
								>
									{i === 0 ? info.label : slugToTitle(part)}
								</DocLink>
							</span>
						)
					})}
				</nav>

				<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 sm:p-7 mb-8 shadow-xs">
					<div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 mb-2 flex-wrap text-xs">
								<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] uppercase">
									<span>{info.icon}</span>
									<span>{info.label}</span>
								</span>
								<span className="text-xs text-[var(--text-dim)]">·</span>
								<span className="text-xs text-[var(--text-muted)] font-mono">
									{doc.type}
								</span>
								<span className="text-xs text-[var(--text-dim)]">·</span>
								<span className="text-xs text-[var(--text-muted)] font-mono flex items-center gap-1">
									<Clock className="w-3 h-3" />
									<span>{readingTime(doc.body)}</span>
								</span>
							</div>

							<h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight leading-tight">
								{doc.title}
							</h1>
						</div>

						<DocActions slug={doc.slug} body={doc.body} canEdit={false} />
					</div>

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

					<CustomFieldBadges doc={{ ...doc }} />
				</div>

				<div className="xl:hidden mb-6 p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<TOC source={doc.body} />
				</div>

				<div className="mb-14">
					<Markdown source={doc.body} />
				</div>

				<RelatedGrid slug={fullSlug} />
			</article>

			<aside className="hidden xl:block w-64 shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pl-6 border-l border-[var(--border-color)]">
				<TOC source={doc.body} />
			</aside>
		</div>
	)
}

export function DocRoute() {
	const { section, _splat } = useParams({ from: "/$section/$" })

	// `/:section/export` and `/:section/<folder>/export` are export views. The
	// PDF component itself is out of this route group's scope — it depends on
	// @mcpedia/core/export-helpers — so the page says so rather than pretending.
	if (isExportPath(section, _splat)) {
		const target = exportTargetSlug(section, _splat)
		return (
			<EmptyState
				title="PDF export"
				description={
					target
						? `The PDF export view for /${target} is served by the Next route until the export helpers are ported.`
						: "The PDF export view is served by the Next route until the export helpers are ported."
				}
				icon={FileDown}
			/>
		)
	}

	return <DocOrFolder section={section} splat={_splat} />
}

/**
 * Decide between a document, a folder listing, and not-found.
 *
 * Three queries, each answering one question the Next page answered in-process:
 *   folderInfo -> is this path a doc, a folder, or nothing?
 *   get        -> the document, if it is one
 *   list       -> the section's documents, to list a folder's contents
 */
function DocOrFolder({ section, splat }: { section: string; splat?: string }) {
	const fullSlug = joinSlug(section, splat)
	const { data: info, isPending: infoPending } = useFolderInfoQuery(
		section,
		fullSlug,
	)
	const { data: doc, isPending: docPending } = useDocumentQuery(fullSlug)
	const { data: docs = [] } = useDocumentsQuery(section)

	if (infoPending) return <Pending label="Locating document…" />

	if (info?.classification === "none" || (!infoPending && !info)) {
		return (
			<EmptyState
				title="Not found"
				description={`Nothing is published at /${fullSlug}.`}
				icon={FileText}
			/>
		)
	}

	if (info.classification === "folder") {
		return <FolderIndex section={section} folderSlug={fullSlug} docs={docs} />
	}

	if (docPending) return <Pending label="Loading document…" />
	if (!doc) {
		return (
			<EmptyState
				title="Not found"
				description={`Nothing is published at /${fullSlug}.`}
				icon={FileText}
			/>
		)
	}

	return <DocumentView fullSlug={fullSlug} doc={doc} />
}

/** The loading state for a route whose data is in flight. */
function Pending({ label }: { label: string }) {
	return (
		<div
			className="flex items-center justify-center gap-3 py-16 text-[var(--text-muted)] text-xs font-mono"
			role="status"
			aria-live="polite"
		>
			<div className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
			<span>{label}</span>
		</div>
	)
}

export { notFound }
