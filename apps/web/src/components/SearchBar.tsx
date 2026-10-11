"use client"

import { Link } from "@tanstack/react-router"
import { Search, X } from "lucide-react"

interface SearchBarProps {
	value: string
	onChange: (v: string) => void
	placeholder?: string
	autoFocus?: boolean
	onClear?: () => void
}

export default function SearchBar({
	value,
	onChange,
	placeholder,
	autoFocus,
	onClear,
}: SearchBarProps) {
	return (
		<div className="relative">
			<input
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder ?? "Search knowledge base..."}
				autoFocus={autoFocus}
				className="w-full pl-10 pr-9 py-3 bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--text-primary)] text-sm transition-all"
			/>
			<Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-3.5 pointer-events-none" />
			{value && (
				<button
					onClick={() => {
						onChange("")
						onClear?.()
					}}
					className="absolute right-3 top-3 p-0.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] rounded"
					aria-label="Clear query"
					type="button"
				>
					<X className="w-4 h-4" />
				</button>
			)}
		</div>
	)
}

export function InlineSearchBar({
	value,
	onChange,
	placeholder,
}: {
	value: string
	onChange: (v: string) => void
	placeholder?: string
}) {
	return (
		<div className="relative">
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder ?? "Filter index..."}
				className="w-full pl-8 pr-7 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-md text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--text-primary)] transition-all"
			/>
			<Search className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-2.5 top-2.5 pointer-events-none" />
			{value && (
				<button
					onClick={() => onChange("")}
					className="absolute right-2 top-2 p-0.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] rounded"
					aria-label="Clear filter"
					type="button"
				>
					<X className="w-3.5 h-3.5" />
				</button>
			)}
		</div>
	)
}
