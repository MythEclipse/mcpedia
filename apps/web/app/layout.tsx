import type { Metadata } from "next"
import "./globals.css"
import Header from "@/components/Header"
import Sidebar from "@/components/Sidebar"
import SWRProvider from "@/lib/swr"
import Link from "next/link"
import { Database } from "lucide-react"

export const metadata: Metadata = {
	title: "MCPedia — Archival Knowledge Base for Humans & AI Agents",
	description:
		"A content-first knowledge base. Humans read the Web UI; AI agents use the Model Context Protocol (MCP). Both share one Core.",
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en" className="h-full scroll-smooth" suppressHydrationWarning>
			<head>
				<script
					dangerouslySetInnerHTML={{
						__html: `
              (function() {
                try {
                  var stored = localStorage.getItem('mcpedia-theme');
                  var isDark = stored === 'dark' || (stored === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch(e) {}
              })();
            `,
					}}
				/>
			</head>
			<body className="min-h-screen bg-[var(--bg-app)] text-[var(--text-secondary)] font-sans antialiased selection:bg-[var(--text-primary)] selection:text-[var(--bg-app)] flex flex-col transition-colors duration-150">
				<div hidden>
					<div id="a11y-live-region" aria-live="polite" aria-atomic="true" />
				</div>

				<SWRProvider>
					<Header />

					<div className="mx-auto max-w-7xl w-full flex-1 flex flex-col">
						<div className="flex flex-1">
							<aside className="no-print hidden lg:block w-72 shrink-0 border-r border-[var(--border-color)] sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto bg-[var(--bg-app)]">
								<Sidebar />
							</aside>
							<main className="flex-1 min-w-0">
								<div className="px-4 sm:px-8 py-8 sm:py-10 print:p-0 print:m-0 print:max-w-none max-w-4xl mx-auto xl:max-w-5xl">
									{children}
								</div>
							</main>
						</div>
					</div>

					{/* Global Precision Status Footer */}
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
								<span>pgvector</span>
							</div>

							<div className="flex items-center gap-4 text-[11px] text-[var(--text-muted)]">
								<Link
									href="/dashboard"
									className="hover:text-[var(--text-primary)] transition-colors"
								>
									Dashboard
								</Link>
								<span>·</span>
								<Link
									href="/search"
									className="hover:text-[var(--text-primary)] transition-colors"
								>
									RRF Hybrid Search
								</Link>
								<span>·</span>
								<Link
									href="/export/pdf"
									className="hover:text-[var(--text-primary)] transition-colors"
								>
									Publication PDF
								</Link>
								<span>·</span>
								<span>HTTP :4021</span>
							</div>
						</div>
					</footer>
				</SWRProvider>
			</body>
		</html>
	)
}
