"use client"

import { useState, useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { SearchLink } from "#/components/DocLink"
import { useSearchQuery, useDebounced } from "#/lib/queries"
import {
	Search,
	Plus,
	ArrowRight,
	BookOpen,
	Flag,
	Sparkles,
} from "lucide-react"

interface QuickAction {
	id: string
	title: string
	subtitle: string
	icon: React.ComponentType<{ className?: string }>
	href?: string
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

	const quickActions: QuickAction[] = [
		{
			id: "create-doc",
			title: "Create New Document",
			subtitle: "Write technical doc, writeup, or note",
			icon: Plus,
			href: "/create",
		},
		{
			id: "hybrid-search",
			title: "Multi-Modal Hybrid Search",
			subtitle: "Full-text + Semantic vector search console",
			icon: Search,
			href: "/search",
		},
		{
			id: "browse-docs",
			title: "Documentation Hub",
			subtitle: "System setup, API references, protocol specs",
			icon: BookOpen,
			href: "/docs",
		},
		{
			id: "browse-writeups",
			title: "CTF & Writeups Directory",
			subtitle: "Pwn, Reverse, Web, Crypto writeups and solutions",
			icon: Flag,
			href: "/writeups",
		},
		{
			id: "browse-research",
			title: "Research & Benchmarks",
			subtitle: "Architecture notes, benchmarks, experiments",
			icon: Sparkles,
			href: "/research",
		},
	]

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
			<div
				className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
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
						placeholder="Search documents, writeups, concepts, or tools..."
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
								const Icon = action.icon
								const isSelected = idx === selectedIndex
								return (
									<div
										key={action.id}
										onClick={() =>
											action.href && handleNavigate({ path: action.href })
										}
										onMouseEnter={() => setSelectedIndex(idx)}
										className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isSelected ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"}`}
									>
										<div className="flex items-center gap-2.5">
											<div
												className={`p-1.5 rounded ${isSelected ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}
											>
												<Icon className="w-3.5 h-3.5" />
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
									</div>
								)
							})}
						</div>
					) : results.length === 0 && !loading ? (
						<div className="px-4 py-10 text-center text-xs text-[var(--text-muted)] space-y-1">
							<p>No knowledge base items matched &quot;{query}&quot;</p>
						</div>
					) : (
						<ul className="space-y-1 p-1">
							{results.map((hit, index) => {
								const isSelected = index === selectedIndex
								return (
									<li
										key={hit.slug}
										onClick={() => handleNavigate({ path: `/${hit.slug}` })}
										onMouseEnter={() => setSelectedIndex(index)}
										className={`flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${isSelected ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)]" : "hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-transparent"}`}
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
													// snippet is server-sanitized ts_headline output
													dangerouslySetInnerHTML={{ __html: hit.snippet }}
												/>
											)}
										</div>
										<span className="text-[10px] font-mono text-[var(--text-dim)] shrink-0 self-center">
											/{hit.slug}
										</span>
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
