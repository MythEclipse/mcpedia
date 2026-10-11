import Link from "next/link"
import { listDocuments, listSections } from "@mcpedia/core"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
	const [all, sections] = await Promise.all([listDocuments(), listSections()])

	const totalTags = new Set(all.flatMap((d) => d.tags)).size
	const recentDocs = [...all]
		.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		)
		.slice(0, 8)

	// Tag aggregation server-side for SSR snapshot (client TagCloud will hydrate live via SWR)
	const tagCounts = new Map<string, number>()
	for (const d of all)
		for (const t of d.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
	const topTags = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12)

	return (
		<div className="space-y-8 max-w-5xl">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
						Dashboard
					</h1>
					<p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
						Live overview of the MCPedia knowledge base. Data via PostgreSQL
						Core + BullMQ queue.
					</p>
				</div>
				<Link
					href="/create"
					className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--brand)] text-[var(--brand-fg)] rounded-md text-xs font-semibold shadow-xs"
				>
					+ New Doc
				</Link>
			</div>

			{/* Metric strip — SSR snapshot */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
				<div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
						DB Documents
					</div>
					<div className="text-2xl font-bold font-mono text-[var(--text-primary)] mt-1">
						{all.length}
					</div>
					<div className="text-[11px] text-[var(--text-dim)] font-mono">
						{totalTags} unique tags
					</div>
				</div>
				<div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
						Active Sections
					</div>
					<div className="text-2xl font-bold font-mono text-[var(--text-primary)] mt-1">
						{sections.length}
					</div>
					<div className="text-[11px] text-[var(--text-dim)] font-mono truncate">
						{sections.map((s) => s.id).join(" · ")}
					</div>
				</div>
				<div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
						Search
					</div>
					<div className="text-2xl font-bold font-mono text-[var(--text-primary)] mt-1">
						RRF
					</div>
					<div className="text-[11px] text-[var(--text-dim)] font-mono">
						FTS + Cosine Vectors
					</div>
				</div>
				<div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
						MCP Tools
					</div>
					<div className="text-2xl font-bold font-mono text-[var(--text-primary)] mt-1">
						13
					</div>
					<div className="text-[11px] text-[var(--text-dim)] font-mono">
						HTTP :4021
					</div>
				</div>
			</div>

			{/* Queue strip — client component polls live */}
			<DashboardQueueStrip />

			{/* Section breakdown */}
			<section className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 shadow-xs">
				<h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] font-mono mb-3">
					Section Breakdown
				</h2>
				<div className="space-y-2">
					{sections.map((s) => {
						const pct = all.length
							? Math.round((s.docCount / all.length) * 100)
							: 0
						return (
							<Link
								key={s.id}
								href={`/${s.id}`}
								className="flex items-center gap-3 group"
							>
								<span className="text-sm w-6 text-center">{s.icon}</span>
								<span className="text-xs font-semibold text-[var(--text-primary)] group-hover:underline w-28 truncate">
									{s.label}
								</span>
								<div className="flex-1 h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden border border-[var(--border-color)]">
									<div
										className="h-full bg-[var(--brand)] rounded-full transition-all"
										style={{ width: `${pct}%` }}
									/>
								</div>
								<span className="text-[11px] font-mono text-[var(--text-muted)] w-14 text-right">
									{s.docCount} docs · {pct}%
								</span>
							</Link>
						)
					})}
				</div>
			</section>

			{/* Top tags */}
			{topTags.length > 0 && (
				<section className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 shadow-xs">
					<h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] font-mono mb-3">
						Top Tags
					</h2>
					<div className="flex flex-wrap gap-1.5">
						{topTags.map(([tag, count]) => (
							<Link
								key={tag}
								href={`/search?q=${encodeURIComponent(tag)}`}
								className="px-2.5 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)] text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]"
							>
								#{tag}{" "}
								<span className="text-[10px] bg-[var(--bg-surface)] px-1 py-0.2 rounded ml-1">
									{count}
								</span>
							</Link>
						))}
					</div>
					<div className="mt-3">
						<TagCloudClient />
					</div>
				</section>
			)}

			{/* Recent */}
			{recentDocs.length > 0 && (
				<section>
					<h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] font-mono mb-3">
						Recently Updated
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{recentDocs.map((d) => (
							<Link
								key={d.slug}
								href={`/${d.slug}`}
								className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl shadow-xs group"
							>
								<div className="text-[10px] font-mono uppercase text-[var(--text-muted)]">
									{d.section} · {new Date(d.updatedAt).toLocaleDateString()}
								</div>
								<div className="text-sm font-semibold text-[var(--text-primary)] group-hover:underline line-clamp-1 mt-1">
									{d.title}
								</div>
								{d.tags.length > 0 && (
									<div className="flex gap-1 mt-2 flex-wrap">
										{d.tags.slice(0, 3).map((t) => (
											<span
												key={t}
												className="text-[10px] px-1.5 py-0.2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded font-mono text-[var(--text-muted)]"
											>
												#{t}
											</span>
										))}
									</div>
								)}
							</Link>
						))}
					</div>
				</section>
			)}
		</div>
	)
}

// Client islands — isolated so the page stays RSC
import DashboardQueueStrip from "./QueueStrip"
import TagCloudClient from "./TagCloudClient"
