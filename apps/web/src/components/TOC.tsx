"use client"

import GithubSlugger from "github-slugger"
import { AlignLeft, ArrowUp } from "lucide-react"
import { useEffect, useState } from "react"

interface TOCEntry {
	id: string
	text: string
	level: number
}

export default function TOC({ source }: { source: string }) {
	const [toc, setToc] = useState<TOCEntry[]>([])
	const [activeId, setActiveId] = useState<string>("")

	useEffect(() => {
		const slugger = new GithubSlugger()
		const lines = source.split("\n")
		const entries: TOCEntry[] = []
		for (const line of lines) {
			const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/)
			if (m) {
				// Both capture groups are mandatory in the pattern, so neither
				// default is reachable — they exist only to satisfy
				// `noUncheckedIndexedAccess`, which types every group as
				// `string | undefined` no matter what the regex guarantees.
				const [, hashes = "", raw = ""] = m
				const level = hashes.length
				const text = raw.trim()
				entries.push({ id: slugger.slug(text), text, level })
			}
		}
		setToc(entries)
	}, [source])

	// Scroll spy using IntersectionObserver
	useEffect(() => {
		if (toc.length === 0) return

		const headingElements = toc
			.map((entry) => document.getElementById(entry.id))
			.filter((el): el is HTMLElement => el !== null)

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveId(entry.target.id)
						break
					}
				}
			},
			{
				rootMargin: "-80px 0% -60% 0%",
				threshold: 0.1,
			},
		)

		headingElements.forEach((el) => {
			observer.observe(el)
		})
		return () => observer.disconnect()
	}, [toc])

	if (toc.length === 0) return null

	function scrollToTop() {
		window.scrollTo({ top: 0, behavior: "smooth" })
	}

	return (
		<nav className="text-xs space-y-4">
			<div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)]">
				<div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[var(--text-muted)] text-[11px] font-mono">
					<AlignLeft className="w-3.5 h-3.5 text-[var(--brand)] dark:text-[var(--accent)]" />
					<span>On This Page</span>
				</div>
				<button
					onClick={scrollToTop}
					type="button"
					className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text-primary)] flex items-center gap-0.5 hover:underline"
					title="Scroll to top"
				>
					<ArrowUp className="w-3 h-3" />
					<span>Top</span>
				</button>
			</div>

			<ul className="space-y-1.5 border-l border-[var(--border-color)] pl-3">
				{toc.map((entry) => {
					const isActive = activeId === entry.id
					return (
						<li
							key={entry.id}
							className={`transition-all ${entry.level === 3 ? "ml-3" : ""}`}
						>
							<a
								href={`#${entry.id}`}
								onClick={(e) => {
									e.preventDefault()
									const target = document.getElementById(entry.id)
									if (target) {
										const offset = 80
										const top =
											target.getBoundingClientRect().top +
											window.scrollY -
											offset
										window.scrollTo({ top, behavior: "smooth" })
										setActiveId(entry.id)
										history.pushState(null, "", `#${entry.id}`)
									}
								}}
								className={`block py-0.5 transition-all line-clamp-1 ${
									isActive
										? "text-[var(--brand)] dark:text-[var(--accent)] font-semibold translate-x-0.5"
										: "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
								}`}
								title={entry.text}
							>
								{entry.text}
							</a>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
