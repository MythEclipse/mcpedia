"use client"

import { Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"

const STORAGE_KEY = "mcpedia-theme"

export default function ThemeToggle() {
	const [mounted, setMounted] = useState(false)
	const [isDark, setIsDark] = useState(true)

	useEffect(() => {
		setMounted(true)
		const stored = localStorage.getItem(STORAGE_KEY)
		const darkActive =
			stored === "dark" ||
			(stored === null &&
				window.matchMedia("(prefers-color-scheme: dark)").matches)
		setIsDark(darkActive)
		if (darkActive) {
			document.documentElement.classList.add("dark")
		} else {
			document.documentElement.classList.remove("dark")
		}
	}, [])

	function toggle() {
		const next = !isDark
		setIsDark(next)
		localStorage.setItem(STORAGE_KEY, next ? "dark" : "light")
		if (next) {
			document.documentElement.classList.add("dark")
		} else {
			document.documentElement.classList.remove("dark")
		}
	}

	if (!mounted) {
		return (
			<div className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] opacity-40" />
		)
	}

	return (
		<button
			onClick={toggle}
			type="button"
			aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
			title={isDark ? "Switch to light mode" : "Switch to dark mode"}
			className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-transparent hover:border-[var(--border-color)] transition-all flex items-center justify-center cursor-pointer"
		>
			{isDark ? (
				<Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
			) : (
				<Moon className="w-4 h-4 text-indigo-600 hover:-rotate-12 transition-transform" />
			)}
		</button>
	)
}
