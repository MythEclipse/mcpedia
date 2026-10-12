/**
 * The search page (`/search?q=...&mode=...`).
 *
 * Ported from app/search/page.tsx. Two Next-specific things are gone:
 *
 *  - `useSearchParams` + `router.replace` URL syncing is now TanStack Router's
 *    own search-param handling. `validateSearch` parses and defaults `q` and
 *    `mode`, so a hand-rolled "does the URL match?" effect would only fight the
 *    router; `router.navigate({ search })` writes the URL when the query or
 *    mode changes, which is what the old effect was doing.
 *
 *  - `Suspense` existed because `useSearchParams` opts a Next page into
 *    client-side rendering. TanStack loaders and hooks read the location
 *    synchronously, so there is nothing to suspend on.
 */

import { useNavigate, useSearch } from "@tanstack/react-router"
import { SearchX } from "lucide-react"
import { useEffect, useState } from "react"
import { DocLink } from "#/components/DocLink"
import { EmptyState, ErrorState } from "#/components/EmptyState"
import SearchBar from "#/components/SearchBar"
import { useDebounced, useSearchQuery, useSectionsQuery } from "#/lib/queries"
import type { SearchMode } from "#/lib/shape"
import { parseSearchMode, SEARCH_MODES, sectionsOrDefaults } from "#/lib/shape"

const SUGGESTIONS = [
	"stack alignment",
	"ret2win exploit",
	"bullmq worker",
	"streamable http",
	"full-text search",
	"caddy reverse proxy",
	"pgvector cosine",
]

/** The search params this route reads, with their defaults. */
export function validateSearch(params: Record<string, unknown>): {
	q: string
	mode: SearchMode
} {
	const q = typeof params.q === "string" ? params.q : ""
	const mode = parseSearchMode(
		typeof params.mode === "string" ? params.mode : null,
	)
	return { q, mode }
}

export function SearchPage() {
	const { q: initialQ, mode: initialMode } = useSearch({ from: "/search" })
	const navigate = useNavigate({ from: "/search" })

	// Seeded from the URL, then owned by local state so typing is instant.
	// The URL catches up below; it does not drive every keystroke.
	const [query, setQuery] = useState(initialQ)
	const [mode, setMode] = useState<SearchMode>(initialMode)
	const [selectedSection, setSelectedSection] = useState<string>("all")

	// A back/forward navigation changes the URL out from under local state.
	useEffect(() => setQuery(initialQ), [initialQ])
	useEffect(() => setMode(initialMode), [initialMode])

	const { data: liveSections } = useSectionsQuery()
	const sections = sectionsOrDefaults(liveSections)

	// Debounced so a fast typist produces one request, not one per character.
	const debouncedQuery = useDebounced(query, 180)
	const {
		data: hits = [],
		isPending,
		isError,
		error,
		refetch,
	} = useSearchQuery(debouncedQuery, mode, 30)

	const loading = isPending && debouncedQuery.trim().length > 0

	const filteredHits =
		selectedSection === "all"
			? hits
			: hits.filter((r) => r.section === selectedSection)

	// Keep the URL shareable without blocking a keystroke on history writes.
	//
	// The search object is passed as a VALUE, not a reducer, because validateSearch
	// types `q` as `string` (never undefined) — a reducer that dropped the key on
	// an empty query would not typecheck, and dropping it is also not what we
	// want: `?mode=hybrid` alone is a valid shareable URL for a blank search.
	useEffect(() => {
		const q = query.trim()
		if (q === initialQ) return
		void navigate({
			search: { q, mode },
			replace: true,
		})
		// `initialQ` is intentionally excluded: this writes the URL FROM the
		// query, so reacting to it would loop. `navigate` is stable.
	}, [query, mode]) // eslint-disable-line react-hooks/exhaustive-deps

	function handleModeChange(newMode: SearchMode) {
		setMode(newMode)
		const q = query.trim()
		void navigate({
			search: { q, mode: newMode },
			replace: true,
		})
	}

	return (
		<div className="max-w-4xl space-y-8">
			<div>
				<h1 className="text-3xl font-extrabold text-[var(--text-primary)] tracking-tight mb-2">
					Multi-Modal Search Console
				</h1>
				<p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
					Query across knowledge documents and CTF writeups using PostgreSQL
					hindsight's own chunking, keyword arm, embeddings and reranking.
				</p>
			</div>

			<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
				<SearchBar
					value={query}
					onChange={setQuery}
					placeholder="Search by keywords, challenge names, tools, concepts..."
					autoFocus
					onClear={() => setQuery("")}
				/>

				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2.5 border-t border-[var(--border-color)] text-xs">
					<div className="flex items-center gap-1.5 flex-wrap">
						<span className="text-[var(--text-dim)] font-mono uppercase text-[10px] mr-1">
							Algorithm:
						</span>
						{SEARCH_MODES.map((m) => (
							<button
								key={m.id}
								type="button"
								onClick={() => handleModeChange(m.id)}
								title={m.desc}
								className={`px-3 py-1 rounded-md border text-xs font-medium transition-all cursor-pointer ${mode === m.id ? "bg-[var(--brand)] border-[var(--brand)] text-[var(--brand-fg)] font-semibold shadow-xs" : "bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
							>
								{m.label}
							</button>
						))}
					</div>

					<div className="flex items-center gap-1 flex-wrap">
						<button
							type="button"
							onClick={() => setSelectedSection("all")}
							className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${selectedSection === "all" ? "bg-[var(--bg-elevated-hover)] text-[var(--text-primary)] font-semibold" : "text-[var(--text-dim)] hover:text-[var(--text-muted)]"}`}
						>
							All
						</button>
						{sections.map((s) => (
							<button
								key={s.id}
								type="button"
								onClick={() => setSelectedSection(s.id)}
								className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${selectedSection === s.id ? "bg-[var(--bg-elevated-hover)] text-[var(--text-primary)] font-semibold" : "text-[var(--text-dim)] hover:text-[var(--text-muted)]"}`}
							>
								{s.label}
							</button>
						))}
					</div>
				</div>
			</div>

			{isError && (
				<ErrorState
					message={(error as Error)?.message}
					onRetry={() => void refetch()}
				/>
			)}

			{loading && (
				<div
					className="flex items-center justify-center gap-3 py-10 text-[var(--text-muted)] text-xs font-mono"
					role="status"
					aria-live="polite"
				>
					<div className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
					<span>SEARCHING_VECTOR_SPACE...</span>
				</div>
			)}

			{!loading && query.trim() && filteredHits.length === 0 && !isError && (
				<EmptyState
					title="No matching documents found"
					description="Try switching algorithm mode to Hybrid or Semantic, or search with different keywords."
					icon={SearchX}
				/>
			)}

			{!loading && !query.trim() && (
				<div className="p-6 text-center bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl space-y-3 shadow-xs">
					<p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
						Popular Queries:
					</p>
					<div className="flex justify-center flex-wrap gap-2 text-xs">
						{SUGGESTIONS.map((term) => (
							<button
								key={term}
								type="button"
								onClick={() => setQuery(term)}
								className="px-3 py-1 bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all font-mono text-xs cursor-pointer"
							>
								{term}
							</button>
						))}
					</div>
				</div>
			)}

			{!loading && filteredHits.length > 0 && (
				<div className="space-y-3 animate-fade-in">
					<div
						className="flex items-center justify-between text-xs text-[var(--text-dim)] font-mono"
						aria-live="polite"
					>
						<span>
							Found {filteredHits.length} result
							{filteredHits.length !== 1 ? "s" : ""}
						</span>
						<span>Ranked by {mode} score</span>
					</div>
					<div className="space-y-2.5">
						{filteredHits.map((r) => (
							<DocLink
								key={r.slug}
								to={r.slug}
								className="group block bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-xl p-4.5 transition-all shadow-xs"
							>
								<div className="flex items-center justify-between gap-3 mb-2">
									<div className="flex items-center gap-2">
										<span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] uppercase font-semibold">
											{r.section}
										</span>
										<span className="text-xs text-[var(--text-dim)] font-mono truncate">
											/{r.slug}
										</span>
									</div>
									<span className="text-xs font-mono text-[var(--text-dim)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">
										{r.score.toFixed(3)}
									</span>
								</div>
								<h2 className="text-sm font-semibold text-[var(--text-primary)] group-hover:underline mb-1.5">
									{r.title}
								</h2>
								{r.snippet && (
									<p
										className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2 [&>mark]:bg-[var(--bg-elevated-hover)] [&>mark]:text-[var(--text-primary)] [&>mark]:font-semibold"
										// Snippet arrives pre-sanitised by Postgres ts_headline
										// (keyword/hybrid) or as a plain chunk substring
										// (semantic); <mark> is the point of rendering it.
										// biome-ignore lint/security/noDangerouslySetInnerHtml: value escaped by sanitizeSnippet in normalizeSearchHits; only <mark> survives
										dangerouslySetInnerHTML={{ __html: r.snippet }}
									/>
								)}
							</DocLink>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
