/**
 * The section index (`/:section`).
 *
 * Ported from app/[section]/page.tsx. The Next page ran `listDocuments()` and
 * `getSectionMeta()` in-process; both now arrive over oRPC (documents.list) or
 * from the static registry (sectionMeta). The folder tree comes from the shared
 * builder in #/lib/shape rather than the page's own copy.
 */
import { Link, useParams } from "@tanstack/react-router"
import { Clock, FileDown, FileText, Folder, Plus } from "lucide-react"
import { DocLink } from "#/components/DocLink"
import { useDocumentsQuery, useSectionsQuery } from "#/lib/queries"
import type { TreeNode } from "#/lib/shape"
import {
	buildFolderTree,
	byUpdatedDesc,
	docsInSection,
	sectionMeta,
	sectionsOrDefaults,
} from "#/lib/shape"
import { SITE_NAME } from "#/lib/site"

/**
 * The folder tree, with the current path highlighted.
 *
 * Takes the pathname rather than a matched-segment id because the section page
 * is reached by many URLs (`/docs`, `/docs/setup/install`) and the active row is
 * defined by prefix, not by an exact route match.
 */
function TreeList({
	nodes,
	pathname,
}: {
	nodes: TreeNode[]
	pathname: string
}) {
	return (
		<ul className="space-y-1">
			{nodes.map((node) => {
				const isFolder = node.children.length > 0
				const isActive = pathname === `/${node.slug}`
				const hasActiveChild = pathname.startsWith(`/${node.slug}/`)

				return (
					<li key={node.slug}>
						<DocLink
							to={node.slug}
							className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2.5 rounded-md transition-colors ${
								isActive
									? "text-[var(--text-primary)] bg-[var(--bg-elevated)] font-semibold border border-[var(--border-color)] shadow-xs"
									: hasActiveChild
										? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
										: "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
							}`}
						>
							<span className="flex items-center gap-2 truncate">
								<span className="text-[var(--text-dim)]">
									{isFolder ? (
										<Folder className="w-3.5 h-3.5" />
									) : (
										<FileText className="w-3.5 h-3.5" />
									)}
								</span>
								<span className="truncate font-medium">
									{node.title || node.name}
								</span>
							</span>
							{isFolder && (
								<span className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] border border-[var(--border-color)] px-1.5 py-0.2 rounded font-mono">
									{node.docCount} docs
								</span>
							)}
						</DocLink>
						{node.children.length > 0 && (
							<div className="ml-3.5 border-l border-[var(--border-color)] pl-2.5 mt-0.5 space-y-0.5">
								<TreeList nodes={node.children} pathname={pathname} />
							</div>
						)}
					</li>
				)
			})}
		</ul>
	)
}

export function SectionPage() {
	const { section } = useParams({ from: "/$section/" })
	const { data: all = [] } = useDocumentsQuery()
	const { data: liveSections } = useSectionsQuery()

	const info = sectionMeta(section, sectionsOrDefaults(liveSections))
	const sectionDocs = docsInSection(all, section)
	const tree = buildFolderTree(sectionDocs, section)
	const pathname = `/${section}`

	return (
		<div className="space-y-8">
			<nav className="flex items-center gap-2 text-xs text-[var(--text-dim)] font-mono">
				<Link
					to="/"
					className="hover:text-[var(--text-primary)] transition-colors"
				>
					{SITE_NAME}
				</Link>
				<span>/</span>
				<span className="text-[var(--text-muted)] font-semibold font-sans">
					{info.label}
				</span>
			</nav>

			<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 shadow-xs">
				<div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-3">
					<div className="flex items-center gap-3.5">
						<div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)] flex items-center justify-center text-2xl">
							{info.icon}
						</div>
						<div>
							<h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
								{info.label}
							</h1>
							<p className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-wider mt-0.5">
								Section: <code>{section}</code>
							</p>
						</div>
					</div>

					<div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
						<span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2.5 py-1 rounded">
							{sectionDocs.length} document
							{sectionDocs.length !== 1 ? "s" : ""}
						</span>

						{sectionDocs.length > 0 && (
							<DocLink
								to={`/${section}/export`}
								className="inline-flex items-center gap-1.5 text-xs bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-primary)] px-3 py-1 rounded-md font-semibold transition-all shadow-xs"
								title={`Export all ${info.label} documents to publication-grade PDF`}
							>
								<FileDown className="w-3.5 h-3.5" />
								<span>Export PDF</span>
							</DocLink>
						)}

						<a
							href="/create"
							className="inline-flex items-center gap-1.5 text-xs bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] px-3 py-1 rounded-md font-semibold transition-all shadow-xs"
						>
							<Plus className="w-3.5 h-3.5" />
							<span>Create Doc</span>
						</a>
					</div>
				</div>

				{info.desc && (
					<p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed max-w-2xl mt-2">
						{info.desc}
					</p>
				)}
			</div>

			{tree.length > 0 && (
				<section className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 shadow-xs">
					<div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--border-color)]">
						<Folder className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
							Folder &amp; Chapter Structure
						</h2>
					</div>
					<TreeList nodes={tree} pathname={pathname} />
				</section>
			)}

			{sectionDocs.length > 0 ? (
				<section>
					<div className="flex items-center gap-2 mb-3.5">
						<FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
							All Documents in {info.label}
						</h2>
					</div>

					<div className="space-y-2">
						{byUpdatedDesc(sectionDocs).map((d) => (
							<DocLink
								key={d.slug}
								to={d.slug}
								className="group flex items-center justify-between gap-4 p-4 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl transition-all shadow-xs"
							>
								<div className="flex items-center gap-3 min-w-0">
									<FileText className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
									<div className="min-w-0">
										<h3 className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] group-hover:underline truncate">
											{d.title}
										</h3>
										{d.tags.length > 0 && (
											<div className="flex flex-wrap gap-1 mt-1.5">
												{d.tags.slice(0, 4).map((t) => (
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

								<time className="text-xs text-[var(--text-dim)] font-mono shrink-0 flex items-center gap-1">
									<Clock className="w-3 h-3" />
									<span>
										{new Date(d.updatedAt).toLocaleDateString(undefined, {
											month: "short",
											day: "numeric",
											year: "numeric",
										})}
									</span>
								</time>
							</DocLink>
						))}
					</div>
				</section>
			) : (
				<div className="text-center py-12 border border-[var(--border-color)] rounded-xl bg-[var(--bg-surface)]">
					<p className="text-sm text-[var(--text-muted)]">
						No documents in this section yet.
					</p>
				</div>
			)}
		</div>
	)
}
