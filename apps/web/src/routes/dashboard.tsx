/**
 * /dashboard — corpus metrics, live queue strip, and a tag cloud.
 *
 * Ported from apps/web/app/dashboard/page.tsx. The structural change is forced
 * by the target platform: that page was an async server component calling
 * @mcpedia/core directly, and it had to become a route loader that fetches over
 * oRPC. Everything it computed from the data still happens, now in the browser
 * (see src/routes/dashboard-data.ts, where the shaping lives and is tested).
 *
 * The two client islands of the old page — the queue strip and the tag cloud —
 * stay islands. They poll on their own SWR intervals rather than being folded
 * into the loader, because a queue that goes busy right now should update
 * without a navigation.
 *
 * BOTH ISLANDS RENDER null UNTIL THEIR FIRST SUCCESSFUL POLL, as before: the old
 * page did `if (!data) return null`, so the dashboard never reserved space for a
 * strip that has not loaded.
 */

import { QueueStrip } from "../components/QueueBadge"
import TagCloud from "../components/TagCloud"
import { fetchDocuments, fetchSections } from "../lib/orpc"
import {
	countUniqueTags,
	type DashboardData,
	recentDocuments,
	sectionShare,
} from "./dashboard-data"

/**
 * Plain anchors, not TanStack <Link>, for destinations this route does not own.
 *
 * TanStack types `to` against the registered route tree, and /search, /create
 * and /:slug belong to other port groups whose routes are not in this tree yet.
 * A <Link to="/search"> would be a typecheck error until every group is merged,
 * and using `as any` to dodge that would trade a compile-time guarantee for
 * nothing. A full page load to those URLs is correct in the interim — the Next
 * app still serves them — and each becomes a <Link> when its route lands. The
 * /export/pdf "Back" button in PdfExportView is an <a> for the same reason.
 */

/**
 * The loader, exported for src/routes.tsx.
 *
 * WHY THE ROUTE IS BUILT THERE AND NOT HERE. TanStack infers loader-data types
 * from the literal `createRoute({...})` call site and the assembled tree. A
 * route built inside a factory function loses that entirely — `useLoaderData`
 * degrades to `never`, which is not a type error you can see, it is a silently
 * untyped surface. So each route module exports its loader and its component,
 * and src/routes.tsx composes the tree from literals, where inference works.
 */
export async function dashboardLoader(): Promise<DashboardData> {
	// Independent reads, issued together: half the time-to-first-paint versus
	// awaiting in sequence.
	const [docs, sections] = await Promise.all([
		fetchDocuments(),
		fetchSections(),
	])
	return { docs, sections }
}

/**
 * The presentation, split from the route wiring so this module is only about
 * data flow. Every number comes from the loader; nothing fetches here.
 */
export function DashboardView({ data }: { data: DashboardData }) {
	const { docs, sections } = data
	const totalTags = countUniqueTags(docs)
	const recent = recentDocuments(docs)

	return (
		<div className="space-y-8 max-w-5xl">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
						Site overview
					</h1>
					<p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
						Every page in the wiki, by section and tag, with the most recent
						edits.
					</p>
				</div>
				<a
					href="/create"
					className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--brand)] text-[var(--brand-fg)] rounded-md text-xs font-semibold shadow-xs"
				>
					+ New page
				</a>
			</div>

			{/* Metric strip. Three cards, matching the three things a wiki has:
			    pages, the sections they live in, and the tags that cut across
			    both. The fourth slot used to restate a service port. */}
			<div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
				<div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
						Pages
					</div>
					<div className="text-2xl font-bold font-mono text-[var(--text-primary)] mt-1">
						{docs.length}
					</div>
					<div className="text-[11px] text-[var(--text-dim)] font-mono">
						in the wiki
					</div>
				</div>
				<div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs">
					<div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
						Sections
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
						Tags
					</div>
					<div className="text-2xl font-bold font-mono text-[var(--text-primary)] mt-1">
						{totalTags}
					</div>
					<div className="text-[11px] text-[var(--text-dim)] font-mono">
						unique, across all pages
					</div>
				</div>
			</div>

			{/* Queue strip — polls on its own interval. */}
			<QueueStrip />

			<section className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 shadow-xs">
				<h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] font-mono mb-3">
					Section Breakdown
				</h2>
				<div className="space-y-2">
					{sections.map((s) => {
						const pct = sectionShare(s.docCount, docs.length)
						return (
							<a
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
							</a>
						)
					})}
				</div>
			</section>

			{/*
				One tag list, not two.

				This section used to render the tags TWICE: a chip row of the top
				12 (topTags, derived from the loader's documents) and then
				TagCloud's weighted cloud of the top 30 (fetched separately),
				under two different headings — "Top Tags" and "Popular Tags" —
				one directly under the other. Same tags, two shapes, on one
				screen, which reads as a rendering mistake rather than a feature.

				TagCloud is the survivor: it is the dedicated component, it
				weights each tag's opacity by frequency, and it owns the
				"/tags?limit" query. `topTags` in dashboard-data went with the
				chip row — it had no other caller.
			*/}
			<section className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 shadow-xs">
				<TagCloud limit={30} />
			</section>

			{recent.length > 0 && (
				<section>
					<h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] font-mono mb-3">
						Recently Updated
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{recent.map((d) => (
							<a
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
								{(d.tags?.length ?? 0) > 0 && (
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
							</a>
						))}
					</div>
				</section>
			)}
		</div>
	)
}
