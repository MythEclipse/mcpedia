import Link from "next/link"
import { listDocuments, listSections } from "@mcpedia/core"
import { getSectionMeta, type SectionConfig } from "@mcpedia/config"
import McpConfigSnippet from "@/components/McpConfigSnippet"
import InteractiveTopology from "@/components/InteractiveTopology"
import {
	Search,
	Plus,
	BookOpen,
	ArrowRight,
	Database,
	Layers,
	Folder,
	FileText,
	Clock,
	Terminal,
} from "lucide-react"

export const dynamic = "force-dynamic"

interface TreeNode {
	name: string
	slug: string
	title: string
	children: TreeNode[]
	isLeaf: boolean
}

function slugToTitle(segment: string): string {
	return segment
		.split(/[-_]/)
		.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
		.join(" ")
}

function buildFolderTree(
	docs: { slug: string; title: string }[],
	section: string,
): TreeNode[] {
	const tree: TreeNode[] = []

	for (const doc of docs) {
		const parts = doc.slug.split("/")
		let current = tree
		let currentPath = section

		for (let i = 1; i < parts.length; i++) {
			const part = parts[i]
			const isLeaf = i === parts.length - 1
			currentPath = `${currentPath}/${part}`

			let node = current.find((n) => n.name === part)
			if (!node) {
				node = {
					name: part,
					slug: currentPath,
					title: isLeaf ? doc.title : slugToTitle(part),
					children: [],
					isLeaf: false,
				}
				current.push(node)
			}

			if (isLeaf) {
				node.isLeaf = true
				node.title = doc.title
			} else if (!node.title) {
				node.title = slugToTitle(part)
			}
			current = node.children
		}
	}

	function sortNodes(nodes: TreeNode[]): TreeNode[] {
		return nodes.sort((a, b) => {
			const aFolder = a.children.length > 0 ? 0 : 1
			const bFolder = b.children.length > 0 ? 0 : 1
			if (aFolder !== bFolder) return aFolder - bFolder
			return (a.title || a.name).localeCompare(b.title || b.name)
		})
	}

	function sortAll(nodes: TreeNode[]): TreeNode[] {
		const sorted = sortNodes(nodes)
		for (const node of sorted) {
			if (node.children.length > 0) sortAll(node.children)
		}
		return sorted
	}

	return sortAll(tree)
}

function renderTree(nodes: TreeNode[]) {
	return (
		<ul className="space-y-1">
			{nodes.slice(0, 5).map((node) => (
				<li key={node.slug}>
					<Link
						href={`/${node.slug}`}
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
					</Link>
					{node.children.length > 0 && (
						<div className="ml-3 border-l border-[var(--border-color)] pl-2 mt-0.5">
							{renderTree(node.children)}
						</div>
					)}
				</li>
			))}
		</ul>
	)
}

function SectionTree({
	section,
	docs,
}: {
	section: string
	docs: { slug: string; title: string }[]
}) {
	const tree = buildFolderTree(
		docs.filter((d) => d.slug.startsWith(`${section}/`)),
		section,
	)

	return (
		<div>
			{tree.length > 0 ? (
				renderTree(tree)
			) : (
				<p className="text-xs text-[var(--text-dim)] pl-2">No documents</p>
			)}
		</div>
	)
}

export default async function HomePage() {
	const [all, sections] = await Promise.all([listDocuments(), listSections()])

	const recent = [...all]
		.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		)
		.slice(0, 6)

	return (
		<div className="space-y-16">
			{/* Hero Section */}
			<section className="relative pt-2 pb-4">
				{/* Status indicator stamp */}
				<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-mono mb-6">
					<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
					<span>PostgreSQL 16 Core · Model Context Protocol</span>
				</div>

				{/* Primary Title with strong monolithic weight */}
				<h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-[var(--text-primary)] tracking-tight mb-5 leading-[1.1]">
					Knowledge Base for <br />
					Humans and AI Agents.
				</h1>

				{/* Subtitle */}
				<p className="text-base sm:text-lg text-[var(--text-muted)] max-w-2xl leading-relaxed mb-8">
					A high-performance technical knowledge repository. Humans read the web
					interface; AI assistants connect directly via native MCP tools. Both
					share one unified database source of truth.
				</p>

				{/* Quick Action Buttons */}
				<div className="flex flex-wrap items-center gap-3 mb-10">
					<Link
						href="/docs"
						className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] rounded-lg font-semibold text-sm transition-all shadow-xs cursor-pointer"
					>
						<BookOpen className="w-4 h-4" />
						<span>Browse Documentation</span>
						<ArrowRight className="w-4 h-4 ml-0.5" />
					</Link>

					<Link
						href="/search"
						className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-primary)] rounded-lg font-semibold text-sm transition-colors shadow-xs"
					>
						<Search className="w-4 h-4 text-[var(--text-muted)]" />
						<span>Hybrid Search</span>
					</Link>

					<Link
						href="/create"
						className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg text-sm transition-colors shadow-xs"
					>
						<Plus className="w-4 h-4" />
						<span>Create Document</span>
					</Link>
				</div>

				{/* Live Telemetry Metric Strip */}
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:p-5 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]">
							<Database className="w-4 h-4" />
						</div>
						<div>
							<div className="text-xl font-bold text-[var(--text-primary)] font-mono">
								{all.length}
							</div>
							<div className="text-[11px] text-[var(--text-muted)] font-mono">
								DB Documents
							</div>
						</div>
					</div>

					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]">
							<Layers className="w-4 h-4" />
						</div>
						<div>
							<div className="text-xl font-bold text-[var(--text-primary)] font-mono">
								{sections.length}
							</div>
							<div className="text-[11px] text-[var(--text-muted)] font-mono">
								Active Sections
							</div>
						</div>
					</div>

					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]">
							<Search className="w-4 h-4" />
						</div>
						<div>
							<div className="text-xl font-bold text-[var(--text-primary)] font-mono">
								RRF
							</div>
							<div className="text-[11px] text-[var(--text-muted)] font-mono">
								FTS + Cosine Vectors
							</div>
						</div>
					</div>

					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]">
							<Terminal className="w-4 h-4" />
						</div>
						<div>
							<div className="text-xl font-bold text-[var(--text-primary)] font-mono">
								13 Tools
							</div>
							<div className="text-[11px] text-[var(--text-muted)] font-mono">
								HTTP :4021 MCP
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Interactive System Architecture & Topology */}
			<section>
				<InteractiveTopology />
			</section>

			{/* Browse Knowledge by Section */}
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
					{sections.map((s) => {
						const sectionDocs = all.filter(
							(d) => (d.section || "docs").toLowerCase() === s.id,
						)
						return (
							<div
								key={s.id}
								className="group flex flex-col justify-between bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-5 transition-all shadow-xs"
							>
								<div>
									<div className="flex items-center justify-between gap-2 mb-3">
										<span className="text-2xl">{s.icon}</span>
										<Link
											href={`/${s.id}`}
											className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] font-semibold"
										>
											{sectionDocs.length} docs →
										</Link>
									</div>
									<h3 className="font-bold text-sm text-[var(--text-primary)] mb-1">
										{s.label}
									</h3>
									<p className="text-xs text-[var(--text-muted)] mb-4 line-clamp-2 leading-relaxed">
										{s.desc}
									</p>
								</div>

								{/* Inline folder directory preview */}
								<div className="pt-3 border-t border-[var(--border-color)]">
									<SectionTree
										section={s.id}
										docs={all.map((d) => ({ slug: d.slug, title: d.title }))}
									/>
								</div>
							</div>
						)
					})}
				</div>
			</section>

			{/* Recently Updated Knowledge */}
			{recent.length > 0 && (
				<section>
					<div className="flex items-center justify-between mb-5">
						<div className="flex items-center gap-2">
							<Clock className="w-4 h-4 text-[var(--text-muted)]" />
							<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
								Recently Updated
							</h2>
						</div>
						<Link
							href="/docs"
							className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] font-semibold flex items-center gap-1 font-mono"
						>
							<span>View all ({all.length})</span>
							<ArrowRight className="w-3 h-3" />
						</Link>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
						{recent.map((d) => {
							const sInfo = getSectionMeta(d.section)
							return (
								<Link
									key={d.slug}
									href={`/${d.slug}`}
									className="group block bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-4.5 transition-all shadow-xs"
								>
									<div className="flex items-center justify-between gap-2 mb-2">
										<span className="text-[11px] font-mono font-semibold text-[var(--text-muted)] uppercase flex items-center gap-1">
											<span>{sInfo?.icon}</span>
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
								</Link>
							)
						})}
					</div>
				</section>
			)}

			{/* Connect AI Assistant Showcase */}
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
