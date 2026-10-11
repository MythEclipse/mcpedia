"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export interface SearchHit {
	slug: string
	title: string
	section: string
	score: number
	snippet: string
}

export type SearchMode = "hybrid" | "keyword" | "semantic"

function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), delayMs)
		return () => clearTimeout(t)
	}, [value, delayMs])
	return debounced
}

export function useSearch(q: string, mode: SearchMode = "hybrid", limit = 30) {
	const debouncedQ = useDebounced(q, 180)
	const trimmed = debouncedQ.trim()
	const key = trimmed
		? `/api/search?q=${encodeURIComponent(trimmed)}&mode=${mode}&limit=${limit}`
		: null

	const swr = useSWR<{ results: SearchHit[] }>(key, fetcher, {
		keepPreviousData: true,
		revalidateOnFocus: false,
		dedupingInterval: 2_000,
	})

	return {
		...swr,
		hits: swr.data?.results ?? [],
		isSearching: !!trimmed && swr.isLoading,
	}
}
