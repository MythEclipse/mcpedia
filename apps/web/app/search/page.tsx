"use client"

import { useState, Suspense, useEffect } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { useSections } from "@/hooks/useSections"
import { useSearch, type SearchMode } from "@/hooks/useSearch"
import SearchBar from "@/components/SearchBar"
import { EmptyState, ErrorState } from "@/components/EmptyState"
import { Search, SearchX } from "lucide-react"

function SearchContent() {
	const searchParams = useSearchParams()
	const router = useRouter()
	const initialQ = searchParams.get("q") ?? ""
	const initialMode = (searchParams.get("mode") as SearchMode) ?? "hybrid"

	const [query, setQuery] = useState(initialQ)
	const [mode, setMode] = useState<SearchMode>(
		["hybrid", "keyword", "semantic"].includes(initialMode)
			? initialMode
			: "hybrid",
	)
	const [selectedSection, setSelectedSection] = useState<string>("all")

	const { data: liveSections } = useSections()
	const sections = liveSections ?? []

	// SWR search — debounced inside hook (180ms)
	const { hits, error, isValidating, isLoading } = useSearch(query, mode, 30)
	const loading = isLoading || isValidating

	// Keep URL in sync (debounced via hook timing is fine — push without blocking render)
	useEffect(() => {
		const q = query.trim()
		const target = q
			? `/search?q=${encodeURIComponent(q)}&mode=${mode}`
			: `/search?mode=${mode}`
		const current = `${searchParams.toString() ? `/search?${searchParams.toString()}` : "/search"}`
		if (target !== current && q) {
			router.replace(target)
		}
	}, [query, mode]) // eslint-disable-line react-hooks/exhaustive-deps

	const filteredHits =
		selectedSection === "all"
			? hits
			: hits.filter((r) => r.section === selectedSection)

	function handleModeChange(newMode: SearchMode) {
		setMode(newMode)
		const q = query.trim()
		const qs = q
			? `?q=${encodeURIComponent(q)}&mode=${newMode}`
			: `?mode=${newMode}`
		router.replace(`/search${qs}`)
	}

	const suggestions = [
		"stack alignment",
		"ret2win exploit",
		"bullmq worker",
		"streamable http",
		"full-text search",
		"caddy reverse proxy",
		"pgvector cosine",
	]

	return (
		<div className="max-w-4xl space-y-8">
			<div>
				<h1 className="text-3xl font-extrabold text-[var(--text-primary)] tracking-tight mb-2">
					Multi-Modal Search Console
				</h1>
				<p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
					Query across knowledge documents and CTF writeups using PostgreSQL
					Full-Text Search (tsvector), Cosine Vector Embeddings, or Reciprocal
					Rank Fusion (RRF).
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
						{[
							{
								id: "hybrid",
								label: "Hybrid (RRF)",
								desc: "Reciprocal Rank Fusion (FTS + Vector)",
							},
							{
								id: "keyword",
								label: "Keyword (FTS)",
								desc: "PostgreSQL GIN tsvector",
							},
							{
								id: "semantic",
								label: "Semantic Vector",
								desc: "Cosine Similarity Embeddings",
							},
						].map((m) => (
							<button
								key={m.id}
								type="button"
								onClick={() => handleModeChange(m.id as SearchMode)}
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

			{error && (
				<ErrorState
					message={(error as Error).message}
					onRetry={() => setQuery((q) => q + " ")}
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

			{!loading && query.trim() && filteredHits.length === 0 && !error && (
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
						{suggestions.map((term) => (
							<button
								key={term}
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
							<Link
								key={r.slug}
								href={`/${r.slug}`}
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
										// snippet from Postgres ts_headline — sanitized by DB
										dangerouslySetInnerHTML={{ __html: r.snippet }}
									/>
								)}
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

export default function SearchPage() {
	return (
		<Suspense
			fallback={
				<div className="max-w-4xl py-12">
					<h1 className="text-2xl font-bold text-[var(--text-primary)] mb-4">
						Search
					</h1>
					<p className="text-sm text-[var(--text-muted)]">
						Loading search module...
					</p>
				</div>
			}
		>
			<SearchContent />
		</Suspense>
	)
}
