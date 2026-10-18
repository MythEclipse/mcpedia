/**
 * The home page (`/`).
 *
 * Ported from app/page.tsx. The structural change is one line: where the Next
 * server component awaited `listDocuments()` and `listSections()` from
 * @mcpedia/core in-process, this reads the same two procedures over oRPC via
 * the query hooks.
 *
 * ## WHAT THIS PAGE NO LONGER RENDERS, AND WHY
 *
 * It used to be a landing page for the deployment rather than a door into the
 * corpus: a hero addressed to AI agents, a metric derived from the tool count
 * of a protocol gateway, an interactive architecture diagram of the services,
 * and an integration section holding copy-paste client configs. A reader who
 * arrived for a document had to scroll past all of it.
 *
 * The diagram and the config block are gone from the page. Both described how
 * the site is built rather than what is in it, and the config block in
 * particular was instructions for connecting a tool, not reading material.
 * Their components went with them; InteractiveTopology and McpConfigSnippet are
 * deleted rather than left unrendered, and src/lib/mcp-tools.ts — the constant
 * that only existed to keep the topology's tool count honest — went with them.
 * The gateway and its tools are untouched: this is a change to the web app.
 *
 * What is left is the shape a wiki actually has: what this is, how to search it,
 * what it covers, and what changed recently.
 */

import { useNavigate } from "@tanstack/react-router"
import {
	ArrowRight,
	BookOpen,
	Clock,
	FileText,
	Folder,
	Layers,
	Plus,
	Search,
	Tag,
} from "lucide-react"
import { useState } from "react"
import { DocLink, SearchLink } from "#/components/DocLink"
import SearchBar from "#/components/SearchBar"
import { useDocumentsQuery, useSectionsQuery } from "#/lib/queries"
import type { DocSummary } from "#/lib/shape"
import {
	buildFolderTree,
	byUpdatedDesc,
	docsInSection,
	sectionMeta,
	sectionsOrDefaults,
} from "#/lib/shape"
import { SITE_NAME, SITE_TAGLINE } from "#/lib/site"
import { countUniqueTags } from "#/routes/dashboard-data"

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
	const navigate = useNavigate()

	// The hero search box is a doorway to /search, not a second search
	// implementation: it navigates with `?q=`, where the real console owns
	// debouncing, modes and results. A wiki's front page should let a reader
	// type immediately without the front page also having to answer.
	const [query, setQuery] = useState("")

	// Both lists gate the same page; one spinner covers either being in flight.
	const loading = docsPending || sectionsPending
	const recent = byUpdatedDesc(all).slice(0, 6)

	return (
		<div className="space-y-14">
			<section className="pt-2">
				<h1 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
					{SITE_NAME}
				</h1>
				<p className="text-sm text-[var(--text-muted)] leading-relaxed mb-6">
					{SITE_TAGLINE}
				</p>

				<form
					action="/search"
					method="get"
					className="max-w-2xl mb-6"
					onSubmit={(e) => {
						// The form exists for the no-scripting path, where the browser
						// performs the GET and `name="q"` is what puts the query in the
						// URL. With scripting, the router handles the same navigation
						// client-side so the query cache is not thrown away — and an
						// empty box must not navigate at all.
						e.preventDefault()
						const q = query.trim()
						if (!q) return
						void navigate({ to: "/search", search: { q, mode: "hybrid" } })
					}}
				>
					<SearchBar
						value={query}
						onChange={setQuery}
						placeholder="Search the wiki…"
						onClear={() => setQuery("")}
						name="q"
					/>
					<input type="hidden" name="mode" value="hybrid" />
				</form>

				<div className="flex flex-wrap items-center gap-3">
					<DocLink
						to="docs"
						className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] rounded-lg font-semibold text-sm transition-all shadow-xs cursor-pointer"
					>
						<BookOpen className="w-4 h-4" />
						<span>Browse all pages</span>
						<ArrowRight className="w-4 h-4 ml-0.5" />
					</DocLink>

					<SearchLink className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-primary)] rounded-lg font-semibold text-sm transition-colors shadow-xs">
						<Search className="w-4 h-4 text-[var(--text-muted)]" />
						<span>Search</span>
					</SearchLink>

					<a
						href="/create"
						className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg text-sm transition-colors shadow-xs"
					>
						<Plus className="w-4 h-4" />
						<span>New page</span>
					</a>
				</div>
			</section>

			<section>
				<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 sm:p-5 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<Metric
						icon={<FileText className="w-4 h-4" />}
						value={loading ? "—" : String(all.length)}
						label="Pages"
					/>
					<Metric
						icon={<Layers className="w-4 h-4" />}
						value={loading ? "—" : String(sections.length)}
						label="Sections"
					/>
					<Metric
						icon={<Tag className="w-4 h-4" />}
						value={loading ? "—" : String(countUniqueTags(all))}
						label="Tags"
					/>
				</div>
			</section>

			<section>
				<div className="flex items-center justify-between mb-5">
					<div className="flex items-center gap-2">
						<Layers className="w-4 h-4 text-[var(--text-muted)]" />
						<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
							Browse by section
						</h2>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{sections.map((s) => (
						<div
							key={s.id}
							className="group flex flex-col justify-between bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-5 transition-all shadow-xs"
						>
							<div>
								<div className="flex items-center justify-between gap-2 mb-3">
									<span className="text-xl">{s.icon}</span>
									<DocLink
										to={s.id}
										className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] font-semibold"
									>
										{docsInSection(all, s.id).length} pages →
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
								Recently updated
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
