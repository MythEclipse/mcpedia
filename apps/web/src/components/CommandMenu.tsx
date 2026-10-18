"use client"

import { useNavigate } from "@tanstack/react-router"
import { ArrowRight, Plus, Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { SearchLink } from "#/components/DocLink"
import { useDebounced, useSearchQuery, useSectionsQuery } from "#/lib/queries"
import { paletteSectionsFrom } from "#/lib/sections"

/**
 * A palette row. Two shapes, because two genuinely different things appear here:
 *
 *   - an APP route ("Create New Document", "Search Console"), which is a fixed
 *     part of the application and carries a lucide icon component;
 *   - a SECTION, which is content: its label, glyph and subtitle come from the
 *     `sections` table, so a section registered through MCP shows up here with
 *     no code change, and a renamed one is renamed here too.
 *
 * `glyph` holds the former, `icon` the latter. Keeping them distinct means the
 * section rows cannot silently fall back to a wrong lucide icon when the
 * database holds an emoji — which is what the section table holds by design.
 */
interface QuickAction {
	id: string
	title: string
	subtitle: string
	href: string
	icon?: React.ComponentType<{ className?: string }>
	glyph?: string
}

/**
 * The two shortcuts that are application surfaces rather than sections.
 *
 * These stay hardcoded on purpose: /create and /search are routes this app
 * defines, not entries in the section registry. Nothing an operator does to the
 * registry should remove or rename them.
 */
const APP_ACTIONS: QuickAction[] = [
	{
		id: "create-doc",
		title: "New page",
		subtitle: "Write a page in Markdown",
		icon: Plus,
		href: "/create",
	},
	{
		id: "hybrid-search",
		title: "Search",
		subtitle: "Search every page in the wiki",
		icon: Search,
		href: "/search",
	},
]

/**
 * The leading badge on a palette row.
 *
 * A section's glyph is an emoji string from the database; an app action's icon
 * is a lucide component. Rendering the glyph as TEXT is what lets an operator
 * pick any icon by editing the row — the set is not limited to what this bundle
 * happens to import. Extracted from the row so the optional `icon` narrows
 * through early returns rather than through a nested ternary, which TypeScript
 * cannot narrow.
 */
function ActionGlyph({ action }: { action: QuickAction }) {
	if (action.glyph) {
		return <span className="text-xs leading-none">{action.glyph}</span>
	}
	const Icon = action.icon
	if (!Icon) return null
	return <Icon className="w-3.5 h-3.5" />
}

export default function CommandMenu() {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const navigate = useNavigate()
	const inputRef = useRef<HTMLInputElement>(null)

	// Debounced so the palette does not fire a request per keystroke.
	const debouncedQuery = useDebounced(query, 180)
	const { data, isPending } = useSearchQuery(debouncedQuery, "hybrid", 10)
	const results = query.trim() ? (data ?? []) : []
	const loading = isPending && debouncedQuery.trim().length > 0

	// Section shortcuts come from the live registry, not from a table in this
	// file. See paletteSectionsFrom for why the literals that used to live here
	// were removed; `sectionsOrDefaults` is deliberately NOT used, since its
	// fallback id list would advertise sections the operator deleted.
	//
	// No hidden-section filter here: documents.sections already omits hidden
	// sections server-side (see the reader in @mcpedia/core), and SectionInfo
	// carries no `hidden` flag for the client to re-check.
	const { data: liveSections } = useSectionsQuery()
	const quickActions = useMemo<QuickAction[]>(
		() => [...APP_ACTIONS, ...paletteSectionsFrom(liveSections)],
		[liveSections],
	)

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault()
				setOpen((prev) => !prev)
			} else if (
				e.key === "/" &&
				!["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)
			) {
				e.preventDefault()
				setOpen(true)
			} else if (e.key === "Escape" && open) {
				setOpen(false)
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [open])

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50)
			setQuery("")
			setSelectedIndex(0)
		}
	}, [open])

	useEffect(() => {
		setSelectedIndex(0)
	}, [query])

	/**
	 * Navigate and close.
	 *
	 * The quick actions are static routes (/create, /docs, ...) and the results
	 * are slugs, so both are resolved by the router rather than by assigning
	 * location.href — a full page load would throw away the query cache.
	 */
	function handleNavigate(to: { path: string }) {
		setOpen(false)
		void navigate({ to: to.path })
	}

	const totalItems = query.trim() ? results.length : quickActions.length

	function handleKeyNavigation(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault()
			setSelectedIndex((prev) => (totalItems > 0 ? (prev + 1) % totalItems : 0))
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setSelectedIndex((prev) =>
				totalItems > 0 ? (prev - 1 + totalItems) % totalItems : 0,
			)
		} else if (e.key === "Enter") {
			e.preventDefault()
			if (query.trim() && results[selectedIndex]) {
				handleNavigate({ path: `/${results[selectedIndex].slug}` })
			} else if (!query.trim() && quickActions[selectedIndex]?.href) {
				handleNavigate({ path: quickActions[selectedIndex].href! })
			}
		}
	}

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				type="button"
				className="hidden md:flex items-center gap-2.5 px-3 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] hover:border-[var(--text-muted)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-all shadow-xs cursor-pointer group"
			>
				<Search className="w-3.5 h-3.5 text-[var(--text-dim)] group-hover:text-[var(--text-primary)] transition-colors" />
				<span className="font-sans">Search...</span>
				<kbd className="ml-2 font-mono bg-[var(--bg-surface)] px-1.5 py-0.2 rounded border border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">
					⌘K
				</kbd>
			</button>
		)
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4">
			<button
				type="button"
				aria-label="Close command menu"
				className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity cursor-default"
				onClick={() => setOpen(false)}
			/>
			<div className="relative w-full max-w-2xl bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden animate-fade-in">
				<div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-[var(--border-color)] bg-[var(--bg-elevated)]">
					<Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyNavigation}
						placeholder="Search pages, sections, tags..."
						className="w-full bg-transparent text-[var(--text-primary)] placeholder-[var(--text-dim)] text-sm focus:outline-none"
					/>
					{loading && (
						<div className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin shrink-0" />
					)}
					<button
						onClick={() => setOpen(false)}
						type="button"
						className="text-[10px] font-mono text-[var(--text-dim)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded border border-[var(--border-color)]"
					>
						ESC
					</button>
				</div>

				<div className="max-h-[22rem] overflow-y-auto p-2">
					{query.trim() === "" ? (
						<div className="p-1 space-y-0.5">
							<div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
								Quick Shortcuts
							</div>
							{quickActions.map((action, idx) => {
								const isSelected = idx === selectedIndex
								return (
									<button
										type="button"
										key={action.id}
										onClick={() => handleNavigate({ path: action.href })}
										onMouseEnter={() => setSelectedIndex(idx)}
										className={`w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isSelected ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"}`}
									>
										<div className="flex items-center gap-2.5">
											<div
												className={`p-1.5 rounded ${isSelected ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}
											>
												<ActionGlyph action={action} />
											</div>
											<div>
												<div className="text-xs font-semibold text-[var(--text-primary)]">
													{action.title}
												</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													{action.subtitle}
												</div>
											</div>
										</div>
										<ArrowRight
											className={`w-3.5 h-3.5 text-[var(--text-dim)] ${isSelected ? "text-[var(--text-primary)]" : ""}`}
										/>
									</button>
								)
							})}
						</div>
					) : results.length === 0 && !loading ? (
						<div className="px-4 py-10 text-center text-xs text-[var(--text-muted)] space-y-1">
							<p>No pages matched &quot;{query}&quot;</p>
						</div>
					) : (
						<ul className="space-y-1 p-1">
							{results.map((hit, index) => {
								const isSelected = index === selectedIndex
								return (
									<li
										key={hit.slug}
										onMouseEnter={() => setSelectedIndex(index)}
										className={`rounded-lg transition-colors ${isSelected ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]" : "hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-transparent"}`}
									>
										<button
											type="button"
											onClick={() => handleNavigate({ path: `/${hit.slug}` })}
											className="w-full text-left flex items-start justify-between gap-3 px-3 py-2.5 cursor-pointer"
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2 mb-0.5">
													<span className="text-[10px] font-mono px-1.5 py-0.2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-[var(--text-muted)] uppercase font-semibold">
														{hit.section}
													</span>
													<span className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] truncate">
														{hit.title}
													</span>
												</div>
												{hit.snippet && (
													<p
														className="text-xs text-[var(--text-muted)] line-clamp-1 mt-1 [&>mark]:bg-[var(--bg-elevated-hover)] [&>mark]:text-[var(--text-primary)] [&>mark]:font-semibold"
														// biome-ignore lint/security/noDangerouslySetInnerHtml: value escaped by sanitizeSnippet in normalizeSearchHits; only <mark> survives
														dangerouslySetInnerHTML={{ __html: hit.snippet }}
													/>
												)}
											</div>
											<span className="text-[10px] font-mono text-[var(--text-dim)] shrink-0 self-center">
												/{hit.slug}
											</span>
										</button>
									</li>
								)
							})}
						</ul>
					)}
				</div>

				<div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-color)] bg-[var(--bg-elevated)] text-[10px] text-[var(--text-muted)] font-mono">
					<div className="flex items-center gap-2">
						<span>[ ↑↓ NAVIGATE ]</span>
						<span>[ ↵ SELECT ]</span>
					</div>
					<SearchLink
						q={query}
						onClick={() => setOpen(false)}
						className="hover:text-[var(--text-primary)] font-medium flex items-center gap-1"
					>
						<span>Full Search Console</span>
						<ArrowRight className="w-3 h-3" />
					</SearchLink>
				</div>
			</div>
		</div>
	)
}
