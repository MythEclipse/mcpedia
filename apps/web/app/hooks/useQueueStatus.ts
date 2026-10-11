"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export interface QueueStatus {
	waiting: number
	active: number
	completed: number
	failed: number
	delayed: number
}

export function useQueueStatus(enabled = false) {
	return useSWR<QueueStatus>(enabled ? "/api/queue/status" : null, fetcher, {
		refreshInterval: 5_000,
		dedupingInterval: 4_000,
		revalidateOnFocus: false,
	})
}

export function useTags(limit = 30) {
	const key = `/api/tags?limit=${limit}`
	return useSWR<{ tags: { tag: string; count: number }[] }>(key, fetcher, {
		revalidateOnFocus: false,
	})
}
