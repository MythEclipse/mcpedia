/**
 * The app shell: header, sidebar, footer.
 *
 * Same structure as the Next root layout, minus the three things that only
 * exist because of Next. The `<html>`/`<head>`/`<body>` tags are in
 * index.html now, the theme bootstrap script moved there too (it has to run
 * before first paint to avoid a flash), and there is no <SWRProvider> — the
 * query client is created once in main.tsx.
 */
import { Outlet } from "@tanstack/react-router"
import { SearchLink } from "#/components/DocLink"
import Header from "#/components/Header"
import Sidebar from "#/components/Sidebar"

export function Shell() {
	return (
		<>
			<div hidden>
				<div id="a11y-live-region" aria-live="polite" aria-atomic="true" />
			</div>

			<Header />

			<div className="mx-auto max-w-7xl w-full flex-1 flex flex-col">
				<div className="flex flex-1">
					<aside className="no-print hidden lg:block w-72 shrink-0 border-r border-[var(--border-color)] sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto bg-[var(--bg-app)]">
						<Sidebar />
					</aside>
					<main className="flex-1 min-w-0">
						<div className="px-4 sm:px-8 py-8 sm:py-10 print:p-0 print:m-0 print:max-w-none max-w-4xl mx-auto xl:max-w-5xl">
							<Outlet />
						</div>
					</main>
				</div>
			</div>

			<footer className="no-print border-t border-[var(--border-color)] bg-[var(--bg-surface)] py-4 text-xs text-[var(--text-muted)]">
				<div className="mx-auto max-w-7xl px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono">
					<div className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
						<span className="text-[var(--text-primary)] font-semibold">
							MCPedia
						</span>
						<span className="text-[var(--border-color)]">/</span>
						<span>PostgreSQL 16 Core</span>
						<span className="text-[var(--border-color)]">/</span>
						<span>Hindsight</span>
					</div>

					<div className="flex items-center gap-4 text-[11px] text-[var(--text-muted)]">
						<a
							href="/dashboard"
							className="hover:text-[var(--text-primary)] transition-colors"
						>
							Dashboard
						</a>
						<span>·</span>
						<SearchLink className="hover:text-[var(--text-primary)] transition-colors">
							Hybrid Search
						</SearchLink>
						<span>·</span>
						<a
							href="/export/pdf"
							className="hover:text-[var(--text-primary)] transition-colors"
						>
							Publication PDF
						</a>
						<span>·</span>
						<span>HTTP :4021</span>
					</div>
				</div>
			</footer>
		</>
	)
}
