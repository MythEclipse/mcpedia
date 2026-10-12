"use client"

import { Search, X } from "lucide-react"
import { useEffect, useRef } from "react"

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
	const inputRef = useRef<HTMLInputElement>(null)

	// Focused imperatively rather than with React's `autoFocus` attribute:
	// `autoFocus` is applied by React at mount and, on a client-side route
	// change, the input is already mounted so the attribute never fires — the
	// effect re-focuses on every mount, which is what the search console wants.
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus()
	}, [autoFocus])

	return (
		<div className="relative">
			<input
				ref={inputRef}
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder ?? "Search knowledge base..."}
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
