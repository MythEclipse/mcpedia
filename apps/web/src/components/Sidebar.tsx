"use client"

import { useState, useMemo } from "react"
import { useRouterState } from "@tanstack/react-router"
import { DocLink } from "#/components/DocLink"
import { useDocumentsQuery } from "#/lib/queries"
import { buildFolderTree, sectionMeta } from "#/lib/shape"
import type { TreeNode } from "#/lib/shape"
import {
	Folder,
	FolderOpen,
	FileText,
	ChevronRight,
	Search,
	X,
	Plus,
} from "lucide-react"

/**
 * The folder tree comes from #/lib/shape now, not from a second copy in this
 * file. The Next app had three near-identical tree builders — one here, one on
 * the home page, one on the section page — that had already drifted apart. They
 * collapse into one exported `buildFolderTree`, covered by
 * src/lib/shape.test.ts. The `Doc` and `TreeNode` interfaces that went with the
 * local copy are gone with it; `DocSummary` and `TreeNode` are the shapes now.
 */
function TreeNodeItem({
	node,
	depth,
	pathname,
	collapsedMap,
	toggleCollapse,
}: {
	node: TreeNode
	depth: number
	pathname: string
	collapsedMap: Record<string, boolean>
	toggleCollapse: (slug: string) => void
}) {
	const isFolder = node.children.length > 0
	const isActive = pathname === `/${node.slug}`
	const isParentOfActive = pathname.startsWith(`/${node.slug}/`)
	const isCollapsed = collapsedMap[node.slug] ?? false

	return (
		<li
			className={`select-none ${depth > 0 ? "ml-3.5 pl-2 border-l border-[var(--border-color)]" : ""}`}
		>
			<div
				className={`group flex items-center justify-between gap-1 text-xs py-1.5 px-2 rounded-md transition-all ${
					isActive
						? "text-[var(--text-primary)] bg-[var(--bg-elevated)] font-semibold border border-[var(--border-color)] shadow-xs"
						: isParentOfActive
							? "text-[var(--text-primary)] bg-[var(--bg-elevated)]/60"
							: "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
				}`}
			>
				<DocLink
					to={node.slug}
					className="flex items-center gap-2 min-w-0 flex-1 py-0.5"
					title={node.title || node.name}
				>
					<span className="shrink-0 text-[var(--text-dim)] group-hover:text-[var(--text-primary)] transition-colors">
						{isFolder ? (
							isCollapsed ? (
								<Folder className="w-3.5 h-3.5" />
							) : (
								<FolderOpen className="w-3.5 h-3.5 text-[var(--text-primary)]" />
							)
						) : (
							<FileText className="w-3.5 h-3.5" />
						)}
					</span>
					<span className="truncate">{node.title || node.name}</span>
				</DocLink>

				{isFolder && (
					<div className="flex items-center gap-1 shrink-0">
						<span className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] border border-[var(--border-color)] px-1.5 py-0.2 rounded font-mono">
							{node.docCount}
						</span>
						<button
							type="button"
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								toggleCollapse(node.slug)
							}}
							className="p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-elevated-hover)] transition-transform cursor-pointer"
							aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
						>
							<ChevronRight
								className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? "rotate-0" : "rotate-90"}`}
							/>
						</button>
					</div>
				)}
			</div>

			{isFolder && !isCollapsed && (
				<ul className="mt-1 space-y-0.5 animate-fade-in">
					{node.children.map((child) => (
						<TreeNodeItem
							key={child.slug}
							node={child}
							depth={depth + 1}
							pathname={pathname}
							collapsedMap={collapsedMap}
							toggleCollapse={toggleCollapse}
						/>
					))}
				</ul>
			)}
		</li>
	)
}

export default function Sidebar() {
	const { data: docs = [] } = useDocumentsQuery()
	const [filterText, setFilterText] = useState("")
	const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({})
	const pathname = useRouterState({ select: (s) => s.location.pathname })

	function toggleCollapse(slug: string) {
		setCollapsedMap((prev) => ({ ...prev, [slug]: !prev[slug] }))
	}

	const filteredDocs = useMemo(() => {
		if (!filterText.trim()) return docs
		const lower = filterText.toLowerCase()
		return docs.filter(
			(d) =>
				d.title.toLowerCase().includes(lower) ||
				d.slug.toLowerCase().includes(lower) ||
				d.tags.some((t: string) => t.toLowerCase().includes(lower)),
		)
	}, [docs, filterText])

	const distinctSections = useMemo(() => {
		const map = new Map<string, { id: string; label: string; icon: string }>()
		for (const doc of filteredDocs) {
			const s = (doc.section || "docs").toLowerCase()
			if (!map.has(s)) {
				map.set(s, sectionMeta(s))
			}
		}
		return Array.from(map.values()).sort((a, b) =>
			a.label.localeCompare(b.label),
		)
	}, [filteredDocs])

	return (
		<nav className="h-full flex flex-col py-4 px-3 select-none">
			{/* Sidebar search filter */}
			<div className="mb-3">
				<div className="relative">
					<input
						type="text"
						value={filterText}
						onChange={(e) => setFilterText(e.target.value)}
						placeholder="Filter index..."
						className="w-full pl-8 pr-7 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-md text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--text-primary)] transition-all"
					/>
					<Search className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-2.5 top-2.5 pointer-events-none" />
					{filterText && (
						<button
							onClick={() => setFilterText("")}
							className="absolute right-2 top-2 p-0.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] rounded"
							aria-label="Clear filter"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			</div>

			{/* Summary count */}
			<div className="flex items-center justify-between px-1 mb-2 text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider">
				<span>Knowledge Index</span>
				<span>{filteredDocs.length} items</span>
			</div>

			{/* Section Trees */}
			<div className="flex-1 overflow-y-auto space-y-4 pr-1">
				{distinctSections.map(({ id, label, icon }) => {
					const sectionDocs = filteredDocs.filter(
						(d) => (d.section || "docs").toLowerCase() === id,
					)
					if (sectionDocs.length === 0) return null

					const tree = buildFolderTree(filteredDocs, id)
					const isSectionActive =
						pathname === `/${id}` || pathname.startsWith(`/${id}/`)

					return (
						<div
							key={id}
							className="border-b border-[var(--border-color)] pb-3 last:border-0"
						>
							<DocLink
								to={id}
								className={`flex items-center justify-between gap-1.5 px-2 py-1 mb-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
									isSectionActive
										? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
										: "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
								}`}
							>
								<div className="flex items-center gap-2">
									<span className="text-xs">{icon}</span>
									<span>{label}</span>
								</div>
								<span className="text-[10px] text-[var(--text-muted)] font-normal font-mono bg-[var(--bg-surface)] px-1.5 py-0.2 rounded border border-[var(--border-color)]">
									{sectionDocs.length}
								</span>
							</DocLink>

							<ul className="space-y-0.5 mt-1">
								{tree.map((node) => (
									<TreeNodeItem
										key={node.slug}
										node={node}
										depth={0}
										pathname={pathname}
										collapsedMap={collapsedMap}
										toggleCollapse={toggleCollapse}
									/>
								))}
							</ul>
						</div>
					)
				})}

				{filteredDocs.length === 0 && (
					<div className="text-center py-8 text-xs text-[var(--text-dim)] font-mono">
						No matching documents
					</div>
				)}
			</div>

			{/* Bottom quick links */}
			<div className="pt-3 border-t border-[var(--border-color)] mt-auto">
				<a
					href="/create"
					className="flex items-center justify-center gap-2 w-full py-2 text-xs bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-primary)] rounded-md transition-all font-medium shadow-xs"
				>
					<Plus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
					<span>Create Document</span>
				</a>
			</div>
		</nav>
	)
}
