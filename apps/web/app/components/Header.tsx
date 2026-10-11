"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { DEFAULT_SECTIONS } from "@mcpedia/config/sections"
import { useSections } from "@/hooks/useSections"
import ThemeToggle from "@/components/ThemeToggle"
import CommandMenu from "@/components/CommandMenu"
import { Plus, Search, Menu, X, Lock } from "lucide-react"

export default function Header() {
	const pathname = usePathname()
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
	const { data: liveSections } = useSections()
	const sections =
		liveSections && liveSections.length > 0 ? liveSections : DEFAULT_SECTIONS

	return (
		<header className="site-header no-print sticky top-0 z-40 border-b border-[var(--border-color)] glass-nav transition-all">
			<div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between gap-3 sm:gap-4">
				{/* Brand */}
				<div className="flex items-center gap-3">
					<Link href="/" className="flex items-center gap-2.5 group">
						<div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--brand)] text-[var(--brand-fg)] font-mono font-bold text-xs shadow-xs group-hover:opacity-90 transition-opacity">
							M
						</div>
						<div className="flex items-center gap-2">
							<span className="font-bold text-[var(--text-primary)] text-sm tracking-tight leading-none">
								MCPedia
							</span>
							<span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-muted)] hidden sm:inline-block">
								CORE::DB
							</span>
						</div>
					</Link>
				</div>

				{/* Center: Desktop Sections Nav */}
				<nav className="hidden md:flex items-center gap-1">
					{sections.map((s) => {
						const isActive =
							pathname === `/${s.id}` || pathname.startsWith(`/${s.id}/`)
						return (
							<Link
								key={s.id}
								href={`/${s.id}`}
								className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
									isActive
										? "text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-color)] font-semibold"
										: "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
								}`}
							>
								<span>{s.icon}</span>
								<span>{s.label}</span>
							</Link>
						)
					})}
				</nav>

				{/* Right Tools & Navigation Deck */}
				<div className="flex items-center gap-2">
					<CommandMenu />

					<Link
						href="/search"
						className="md:hidden p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md bg-[var(--bg-surface)] border border-[var(--border-color)] transition-colors"
						title="Search knowledge base"
					>
						<Search className="w-4 h-4" />
					</Link>

					<Link
						href="/create"
						className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] text-xs font-semibold rounded-md shadow-xs transition-all cursor-pointer"
					>
						<Plus className="w-3.5 h-3.5" />
						<span>New Doc</span>
					</Link>

					<Link
						href="/login"
						className={`p-1.5 sm:px-2.5 sm:py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
							pathname === "/login"
								? "text-[var(--text-primary)] bg-[var(--bg-elevated)] font-semibold border border-[var(--border-color)]"
								: "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
						}`}
						title="Admin Login"
					>
						<Lock className="w-3.5 h-3.5" />
						<span className="hidden sm:inline">Admin</span>
					</Link>

					<div className="border-l border-[var(--border-color)] pl-2 flex items-center">
						<ThemeToggle />
					</div>

					{/* Mobile menu toggle */}
					<button
						onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
						className="md:hidden p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-elevated)] transition-colors"
						aria-label="Toggle navigation"
					>
						{mobileMenuOpen ? (
							<X className="w-5 h-5" />
						) : (
							<Menu className="w-5 h-5" />
						)}
					</button>
				</div>
			</div>

			{/* Mobile Drawer */}
			{mobileMenuOpen && (
				<div className="md:hidden border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-4 space-y-2 animate-fade-in shadow-lg">
					<div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] px-1 mb-1">
						Knowledge Sections
					</div>
					<div className="grid grid-cols-2 gap-1.5">
						{sections.map((s) => {
							const isActive =
								pathname === `/${s.id}` || pathname.startsWith(`/${s.id}/`)
							return (
								<Link
									key={s.id}
									href={`/${s.id}`}
									onClick={() => setMobileMenuOpen(false)}
									className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
										isActive
											? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-color)] font-semibold"
											: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
									}`}
								>
									<span>{s.icon}</span>
									<span className="truncate">{s.label}</span>
								</Link>
							)
						})}
					</div>

					<div className="pt-3 border-t border-[var(--border-color)] flex gap-2">
						<Link
							href="/search"
							onClick={() => setMobileMenuOpen(false)}
							className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md font-medium border border-[var(--border-color)]"
						>
							<Search className="w-3.5 h-3.5" />
							<span>Search</span>
						</Link>
						<Link
							href="/create"
							onClick={() => setMobileMenuOpen(false)}
							className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs bg-[var(--brand)] text-[var(--brand-fg)] rounded-md font-semibold shadow-xs"
						>
							<Plus className="w-3.5 h-3.5" />
							<span>Create Doc</span>
						</Link>
					</div>
				</div>
			)}
		</header>
	)
}
