"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { DocumentMeta } from "@mcpedia/types"

export function useRelated(slug: string, limit = 4) {
	const key = slug
		? `/api/related?slug=${encodeURIComponent(slug)}&limit=${limit}`
		: null
	const swr = useSWR<{ results: DocumentMeta[] }>(key, fetcher, {
		revalidateOnFocus: false,
		keepPreviousData: true,
	})
	return {
		...swr,
		related: swr.data?.results ?? [],
	}
}
