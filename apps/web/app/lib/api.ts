import type { Document, DocumentMeta, SectionInfo } from "@mcpedia/types"
import { fetcher } from "./fetcher"

export interface SearchApiHit {
	slug: string
	title: string
	section: string
	score: number
	snippet: string
}

export interface SearchApiResponse {
	results: SearchApiHit[]
	error?: string
}

export interface DocsApiResponse {
	docs?: DocumentMeta[]
	error?: string
}

export interface SectionsApiResponse extends Array<SectionInfo> {}

export interface SingleDocResponse {
	doc: Document
}

export interface RelatedResponse {
	results: DocumentMeta[]
}

export interface RevisionsResponse {
	revisions: {
		id: string
		slug: string
		revisionNo: number
		title: string
		reason: string
		createdAt: string
		bodyLength: number
	}[]
}

export interface QueueStatusResponse {
	waiting: number
	active: number
	completed: number
	failed: number
	delayed: number
}

export interface TagsResponse {
	tags: { tag: string; count: number }[]
}

export function docsUrl(section?: string, status = "published"): string {
	const p = new URLSearchParams()
	if (section) p.set("section", section)
	if (status) p.set("status", status)
	const qs = p.toString()
	return qs ? `/api/docs?${qs}` : "/api/docs"
}

export function searchUrl(q: string, mode = "hybrid", limit = 30): string {
	return `/api/search?q=${encodeURIComponent(q)}&mode=${mode}&limit=${limit}`
}

export type FetchDocs = () => Promise<DocumentMeta[]>
export const fetchDocs: FetchDocs = async () => {
	const data = await fetcher<DocsApiResponse | DocumentMeta[]>("/api/docs")
	if (Array.isArray(data)) return data
	return data.docs ?? []
}

export const fetchSections = () => fetcher<SectionInfo[]>("/api/sections")
export const fetchSearch = (q: string, mode = "hybrid", limit = 30) =>
	fetcher<SearchApiResponse>(searchUrl(q, mode, limit))
export const fetchRelated = (slug: string, limit = 5) =>
	fetcher<RelatedResponse>(
		`/api/related?slug=${encodeURIComponent(slug)}&limit=${limit}`,
	)
export const fetchRevisions = (slug: string, limit = 20) =>
	fetcher<RevisionsResponse>(
		`/api/revisions?slug=${encodeURIComponent(slug)}&limit=${limit}`,
	)
export const fetchSingleDoc = (slug: string) =>
	fetcher<SingleDocResponse>(`/api/docs/${encodeURIComponent(slug)}`)
export const fetchQueueStatus = () =>
	fetcher<QueueStatusResponse>("/api/queue/status")
export const fetchTags = () => fetcher<TagsResponse>("/api/tags")
