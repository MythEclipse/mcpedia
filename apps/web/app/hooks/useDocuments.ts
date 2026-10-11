"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { DocumentMeta } from "@mcpedia/types"

type DocsEnvelope = DocumentMeta[] | { docs: DocumentMeta[] }

function normalize(data: DocsEnvelope | undefined): DocumentMeta[] {
	if (!data) return []
	if (Array.isArray(data)) return data
	return (data as { docs: DocumentMeta[] }).docs ?? []
}

export function useDocuments(section?: string, status = "published") {
	const params = new URLSearchParams()
	if (section) params.set("section", section)
	if (status) params.set("status", status)
	const qs = params.toString()
	const key = qs ? `/api/docs?${qs}` : "/api/docs"

	const swr = useSWR<DocsEnvelope>(key, fetcher, {
		revalidateOnFocus: false,
	})

	return {
		...swr,
		docs: normalize(swr.data),
	}
}
