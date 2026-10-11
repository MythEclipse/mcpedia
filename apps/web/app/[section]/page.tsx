import Link from "next/link"
import { listDocuments } from "@mcpedia/core"
import { getSectionMeta } from "@mcpedia/config"
import { Folder, FileText, FileDown, Plus, Clock } from "lucide-react"

export const dynamic = "force-dynamic"

interface DocMeta {
	slug: string
	title: string
	section: string
	tags: string[]
	updatedAt: string
	path: string
}

interface TreeNode {
	name: string
	slug: string
	doc?: DocMeta
	children: TreeNode[]
	docCount: number
}

function buildFolderTree(docs: DocMeta[], section: string): TreeNode[] {
	const root: TreeNode[] = []

	for (const doc of docs.filter(
		(d) => (d.section || "").toLowerCase() === section.toLowerCase(),
	)) {
		const rel = doc.slug.startsWith(`${section}/`)
			? doc.slug.slice(section.length + 1)
			: doc.slug
		const parts = rel.split("/")

		let current = root
		let currentPath = section

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i]
			const isLeaf = i === parts.length - 1
			currentPath = `${currentPath}/${part}`

			let node = current.find((n) => n.name === part)
			if (!node) {
				node = {
					name: part,
					slug: currentPath,
					children: [],
					docCount: 0,
				}
				current.push(node)
			}

			if (isLeaf) {
				node.doc = doc
				node.docCount = 1
			}
			current = node.children
		}
	}

	function countDocs(node: TreeNode): number {
		if (node.doc) return 1
		return node.children.reduce((sum, child) => sum + countDocs(child), 0)
	}

	for (const node of root) {
		node.docCount = countDocs(node)
	}

	return root
}

function renderTree(nodes: TreeNode[], pathname: string) {
	return (
		<ul className="space-y-1">
			{nodes.map((node) => {
				const isFolder = node.children.length > 0
				const isActive = pathname === `/${node.slug}`
				const hasActiveChild = pathname.startsWith(`/${node.slug}/`)

				return (
					<li key={node.slug}>
						<Link
							href={`/${node.slug}`}
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
									{node.doc?.title || node.name}
								</span>
							</span>
							{isFolder && (
								<span className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] border border-[var(--border-color)] px-1.5 py-0.2 rounded font-mono">
									{node.docCount} docs
								</span>
							)}
						</Link>
						{node.children.length > 0 && (
							<div className="ml-3.5 border-l border-[var(--border-color)] pl-2.5 mt-0.5 space-y-0.5">
								{renderTree(node.children, pathname)}
							</div>
						)}
					</li>
				)
			})}
		</ul>
	)
}

export default async function SectionIndexPage({
	params,
}: {
	params: Promise<{ section: string }>
}) {
	const { section } = await params
	const sectionInfo = getSectionMeta(section)

	const allDocs = await listDocuments()
	const sectionDocs = allDocs.filter(
		(d) => (d.section || "").toLowerCase() === section.toLowerCase(),
	)
	const tree = buildFolderTree(allDocs, section)

	return (
		<div className="space-y-8">
			{/* Breadcrumb Navigation */}
			<nav className="flex items-center gap-2 text-xs text-[var(--text-dim)] font-mono">
				<Link
					href="/"
					className="hover:text-[var(--text-primary)] transition-colors"
				>
					MCPedia
				</Link>
				<span>/</span>
				<span className="text-[var(--text-muted)] font-semibold font-sans">
					{sectionInfo.label}
				</span>
			</nav>

			{/* Hero Card */}
			<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 shadow-xs">
				<div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-3">
					<div className="flex items-center gap-3.5">
						<div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)] flex items-center justify-center text-2xl">
							{sectionInfo.icon}
						</div>
						<div>
							<h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
								{sectionInfo.label}
							</h1>
							<p className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-wider mt-0.5">
								Section: <code>{section}</code>
							</p>
						</div>
					</div>

					<div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
						<span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-elevated)] border border-[var(--border-color)] px-2.5 py-1 rounded">
							{sectionDocs.length} document{sectionDocs.length !== 1 ? "s" : ""}
						</span>

						{sectionDocs.length > 0 && (
							<Link
								href={`/${section}/export`}
								className="inline-flex items-center gap-1.5 text-xs bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-primary)] px-3 py-1 rounded-md font-semibold transition-all shadow-xs"
								title={`Export all ${sectionInfo.label} documents to publication-grade PDF`}
							>
								<FileDown className="w-3.5 h-3.5" />
								<span>Export PDF</span>
							</Link>
						)}

						<Link
							href="/create"
							className="inline-flex items-center gap-1.5 text-xs bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] px-3 py-1 rounded-md font-semibold transition-all shadow-xs"
						>
							<Plus className="w-3.5 h-3.5" />
							<span>Create Doc</span>
						</Link>
					</div>
				</div>

				<p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed max-w-2xl mt-2">
					{sectionInfo.desc}
				</p>
			</div>

			{/* Hierarchical Folder Directory */}
			{tree.length > 0 && (
				<section className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 shadow-xs">
					<div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--border-color)]">
						<Folder className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
							Folder & Chapter Structure
						</h2>
					</div>
					{renderTree(tree, section)}
				</section>
			)}

			{/* Document List */}
			{sectionDocs.length > 0 ? (
				<section>
					<div className="flex items-center gap-2 mb-3.5">
						<FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
						<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
							All Documents in {sectionInfo.label}
						</h2>
					</div>

					<div className="space-y-2">
						{[...sectionDocs]
							.sort(
								(a, b) =>
									new Date(b.updatedAt).getTime() -
									new Date(a.updatedAt).getTime(),
							)
							.map((d) => (
								<Link
									key={d.slug}
									href={`/${d.slug}`}
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
								</Link>
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
