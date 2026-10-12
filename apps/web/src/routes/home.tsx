/**
 * The home page (`/`).
 *
 * Ported from app/page.tsx. The structural change is one line: where the Next
 * server component awaited `listDocuments()` and `listSections()` from
 * @mcpedia/core in-process, this reads the same two procedures over oRPC via
 * the query hooks. The rendering below is unchanged.
 */

import {
	ArrowRight,
	BookOpen,
	Clock,
	Database,
	FileText,
	Folder,
	Layers,
	Plus,
	Search,
	Terminal,
} from "lucide-react"
import { DocLink, SearchLink } from "#/components/DocLink"
import InteractiveTopology from "#/components/InteractiveTopology"
import McpConfigSnippet from "#/components/McpConfigSnippet"
import { useDocumentsQuery, useSectionsQuery } from "#/lib/queries"
import type { DocSummary } from "#/lib/shape"
import {
	buildFolderTree,
	byUpdatedDesc,
	docsInSection,
	sectionMeta,
	sectionsOrDefaults,
} from "#/lib/shape"

/**
 * The first five entries of a section, rendered as an indented file tree.
 *
 * `buildFolderTree` is shared with the sidebar and the section page; the Next
 * home page had its own copy with a subtly different leaf rule, which is why
 * this is now one function rather than three.
 */
function SectionTree({
	section,
	docs,
}: {
	section: string
	docs: DocSummary[]
}) {
	const tree = buildFolderTree(docsInSection(docs, section), section)
	return tree.length > 0 ? (
		<TreeList nodes={tree} />
	) : (
		<p className="text-xs text-[var(--text-dim)] pl-2">No documents</p>
	)
}

function TreeList({ nodes }: { nodes: ReturnType<typeof buildFolderTree> }) {
	return (
		<ul className="space-y-1">
			{nodes.slice(0, 5).map((node) => (
				<li key={node.slug}>
					<DocLink
						to={node.slug}
						className="flex items-center gap-2 text-xs py-1 px-2 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors group"
						title={node.title}
					>
						<span className="shrink-0 text-[var(--text-dim)] group-hover:text-[var(--text-primary)] transition-colors">
							{node.isLeaf && node.children.length === 0 ? (
								<FileText className="w-3.5 h-3.5" />
							) : (
								<Folder className="w-3.5 h-3.5" />
							)}
						</span>
						<span className="truncate">{node.title || node.name}</span>
					</DocLink>
					{node.children.length > 0 && (
						<div className="ml-3 border-l border-[var(--border-color)] pl-2 mt-0.5">
							<TreeList nodes={node.children} />
						</div>
					)}
				</li>
			))}
		</ul>
	)
}

export function HomePage() {
	const { data: all = [], isPending: docsPending } = useDocumentsQuery()
	const { data: liveSections, isPending: sectionsPending } = useSectionsQuery()
	const sections = sectionsOrDefaults(liveSections)

	// Both lists gate the same page; one spinner covers either being in flight.
	const loading = docsPending || sectionsPending
	const recent = byUpdatedDesc(all).slice(0, 6)

	return (
		<div className="space-y-16">
			<section className="relative pt-2 pb-4">
				<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-mono mb-6">
					<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
					<span>PostgreSQL 16 Core · Model Context Protocol</span>
				</div>

				<h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-[var(--text-primary)] tracking-tight mb-5 leading-[1.1]">
					Knowledge Base for <br />
					Humans and AI Agents.
				</h1>

				<p className="text-base sm:text-lg text-[var(--text-muted)] max-w-2xl leading-relaxed mb-8">
					A high-performance technical knowledge repository. Humans read the web
					interface; AI assistants connect directly via native MCP tools. Both
					share one unified database source of truth.
				</p>

				<div className="flex flex-wrap items-center gap-3 mb-10">
					<DocLink
						to="docs"
						className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] rounded-lg font-semibold text-sm transition-all shadow-xs cursor-pointer"
					>
						<BookOpen className="w-4 h-4" />
						<span>Browse Documentation</span>
						<ArrowRight className="w-4 h-4 ml-0.5" />
					</DocLink>

					<SearchLink className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-primary)] rounded-lg font-semibold text-sm transition-colors shadow-xs">
						<Search className="w-4 h-4 text-[var(--text-muted)]" />
						<span>Hybrid Search</span>
					</SearchLink>

					<a
						href="/create"
						className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg text-sm transition-colors shadow-xs"
					>
						<Plus className="w-4 h-4" />
						<span>Create Document</span>
					</a>
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:p-5 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<Metric
						icon={<Database className="w-4 h-4" />}
						value={loading ? "—" : String(all.length)}
						label="DB Documents"
					/>
					<Metric
						icon={<Layers className="w-4 h-4" />}
						value={loading ? "—" : String(sections.length)}
						label="Active Sections"
					/>
					<Metric
						icon={<Search className="w-4 h-4" />}
						value="RRF"
						label="FTS + Cosine Vectors"
					/>
					<Metric
						icon={<Terminal className="w-4 h-4" />}
						value="13 Tools"
						label="HTTP :4021 MCP"
					/>
				</div>
			</section>

			<section>
				<InteractiveTopology />
			</section>

			<section>
				<div className="flex items-center justify-between mb-5">
					<div className="flex items-center gap-2">
						<Layers className="w-4 h-4 text-[var(--text-muted)]" />
						<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
							Knowledge Sections
						</h2>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
					{sections.map((s) => (
						<div
							key={s.id}
							className="group flex flex-col justify-between bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-5 transition-all shadow-xs"
						>
							<div>
								<div className="flex items-center justify-between gap-2 mb-3">
									<span className="text-2xl">{s.icon}</span>
									<DocLink
										to={s.id}
										className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] font-semibold"
									>
										{docsInSection(all, s.id).length} docs →
									</DocLink>
								</div>
								<h3 className="font-bold text-sm text-[var(--text-primary)] mb-1">
									{s.label}
								</h3>
								{s.desc && (
									<p className="text-xs text-[var(--text-muted)] mb-4 line-clamp-2 leading-relaxed">
										{s.desc}
									</p>
								)}
							</div>

							<div className="pt-3 border-t border-[var(--border-color)]">
								<SectionTree section={s.id} docs={all} />
							</div>
						</div>
					))}
				</div>
			</section>

			{recent.length > 0 && (
				<section>
					<div className="flex items-center justify-between mb-5">
						<div className="flex items-center gap-2">
							<Clock className="w-4 h-4 text-[var(--text-muted)]" />
							<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
								Recently Updated
							</h2>
						</div>
						<DocLink
							to="docs"
							className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] font-semibold flex items-center gap-1 font-mono"
						>
							<span>View all ({all.length})</span>
							<ArrowRight className="w-3 h-3" />
						</DocLink>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
						{recent.map((d) => {
							const info = sectionMeta(d.section)
							return (
								<DocLink
									key={d.slug}
									to={d.slug}
									className="group block bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-4.5 transition-all shadow-xs"
								>
									<div className="flex items-center justify-between gap-2 mb-2">
										<span className="text-[11px] font-mono font-semibold text-[var(--text-muted)] uppercase flex items-center gap-1">
											<span>{info.icon}</span>
											<span>{d.section}</span>
										</span>
										<time className="text-[11px] text-[var(--text-dim)] font-mono">
											{new Date(d.updatedAt).toLocaleDateString(undefined, {
												month: "short",
												day: "numeric",
											})}
										</time>
									</div>
									<h3 className="font-semibold text-sm text-[var(--text-primary)] group-hover:underline line-clamp-1 mb-2">
										{d.title}
									</h3>
									{d.tags.length > 0 && (
										<div className="flex flex-wrap gap-1 mt-2.5">
											{d.tags.slice(0, 3).map((t) => (
												<span
													key={t}
													className="text-[10px] px-1.5 py-0.2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-muted)] font-mono"
												>
													#{t}
												</span>
											))}
										</div>
									)}
								</DocLink>
							)
						})}
					</div>
				</section>
			)}

			<section className="border-t border-[var(--border-color)] pt-12 pb-6">
				<div className="mb-6">
					<div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] text-xs font-mono mb-2">
						<span>[ MCP_INTEGRATION ]</span>
					</div>
					<h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-1.5">
						Model Context Protocol Configuration
					</h2>
					<p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-xl leading-relaxed">
						Equip Claude Desktop, Cursor, Antigravity, or custom agents with
						direct access to your knowledge base via semantic search, read
						resources, and document tools.
					</p>
				</div>

				<McpConfigSnippet />
			</section>
		</div>
	)
}

function Metric({
	icon,
	value,
	label,
}: {
	icon: React.ReactNode
	value: string
	label: string
}) {
	return (
		<div className="flex items-center gap-3">
			<div className="p-2 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]">
				{icon}
			</div>
			<div>
				<div className="text-xl font-bold text-[var(--text-primary)] font-mono">
					{value}
				</div>
				<div className="text-[11px] text-[var(--text-muted)] font-mono">
					{label}
				</div>
			</div>
		</div>
	)
}
