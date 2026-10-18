/**
 * The app shell: header, sidebar, footer.
 *
 * Same structure as the Next root layout, minus the three things that only
 * exist because of Next. The `<html>`/`<head>`/`<body>` tags are in
 * index.html now, the theme bootstrap script moved there too (it has to run
 * before first paint to avoid a flash), and there is no <SWRProvider> — the
 * query client is created once in main.tsx.
 *
 * THE FOOTER IS CONTENT-SHAPED, NOT INFRA-SHAPED. It used to render a status
 * ribbon — the database engine, the search backend's product name and a
 * service port — and link to the operations dashboard. That is the deployment
 * describing itself to a reader who came for the content, so it is gone; what
 * remains is the site name, what the site is, and links to the two ways of
 * reading it. The dashboard route itself still exists for the operator (see
 * routes/dashboard.tsx); it is simply not advertised here any more.
 */
import { Outlet } from "@tanstack/react-router"
import { SearchLink } from "#/components/DocLink"
import Header from "#/components/Header"
import Sidebar from "#/components/Sidebar"
import { SITE_TAGLINE } from "#/lib/site"

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

			<footer className="no-print border-t border-[var(--border-color)] bg-[var(--bg-surface)] py-5 text-xs text-[var(--text-muted)]">
				<div className="mx-auto max-w-7xl px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
					<p className="text-[var(--text-muted)] text-center sm:text-left">
						{SITE_TAGLINE}
					</p>

					<nav className="flex items-center gap-4 text-[11px] shrink-0">
						<a
							href="/docs"
							className="hover:text-[var(--text-primary)] transition-colors"
						>
							Browse
						</a>
						<span className="text-[var(--border-color)]">·</span>
						<SearchLink className="hover:text-[var(--text-primary)] transition-colors">
							Search
						</SearchLink>
						<span className="text-[var(--border-color)]">·</span>
						<a
							href="/export/pdf"
							className="hover:text-[var(--text-primary)] transition-colors"
						>
							Print view
						</a>
					</nav>
				</div>
			</footer>
		</>
	)
}
