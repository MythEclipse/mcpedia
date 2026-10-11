"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export interface RevisionSummary {
	id: string
	slug: string
	revisionNo: number
	title: string
	reason: string
	createdAt: string
	bodyLength: number
}

export function useRevisions(slug: string, limit = 10) {
	const key = slug
		? `/api/revisions?slug=${encodeURIComponent(slug)}&limit=${limit}`
		: null
	const swr = useSWR<{ revisions: RevisionSummary[] }>(key, fetcher, {
		revalidateOnFocus: false,
		keepPreviousData: true,
	})
	return {
		...swr,
		revisions: swr.data?.revisions ?? [],
	}
}
