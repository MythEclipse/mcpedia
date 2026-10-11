import { z } from "zod"

/**
 * Input schemas for every procedure.
 *
 * These are the same zod objects the tRPC router used, unchanged — including the
 * `.default()` limits, so a caller that omits `limit` still gets the old value.
 * Centralised here (rather than inline per procedure) so the router files read
 * as "what does this do" and this file reads as "what does this accept".
 */

const searchInput = (defaultLimit: number) =>
	z.object({
		q: z.string(),
		limit: z.number().int().min(1).max(50).default(defaultLimit),
	})

export const SearchInput = searchInput(20)
export const SemanticSearchInput = searchInput(10)
export const HybridSearchInput = searchInput(10)

export const RelatedInput = z.object({
	slug: z.string(),
	limit: z.number().int().min(1).max(20).default(5),
})

export const ListDocumentsInput = z
	.object({
		section: z.string().optional(),
		status: z.string().optional(),
	})
	.optional()

export const SlugInput = z.object({ slug: z.string() })

export const RevisionListInput = z.object({
	slug: z.string(),
	limit: z.number().int().min(1).max(50).default(20),
})

export const IdInput = z.object({ id: z.string() })

export const JobStatusInput = z.object({ id: z.string() })

// --- Write-gated CRUD -------------------------------------------------------

export const CreateDocumentInput = z.object({
	slug: z.string().min(1),
	title: z.string().min(1),
	section: z.string().min(1),
	body: z.string(),
	type: z.string().optional(),
	status: z.enum(["published", "draft"]).optional(),
	author: z.string().optional(),
	tags: z.array(z.string()).optional(),
	extraFields: z.record(z.string(), z.unknown()).optional(),
})

export const UpdateDocumentInput = z.object({
	slug: z.string().min(1),
	title: z.string().min(1).optional(),
	body: z.string().optional(),
	section: z.string().min(1).optional(),
	type: z.string().optional(),
	status: z.enum(["published", "draft"]).optional(),
	tags: z.array(z.string()).optional(),
	author: z.string().optional(),
	extraFields: z.record(z.string(), z.unknown()).optional(),
})

// --- New: server-component data paths the web app used to run in-process ----

/**
 * Folder classification for one path within a section.
 *
 * The slug page needs this to decide between rendering a document, listing a
 * folder, and 404ing — today it calls `classifyPath`/`extractFoldersForSection`
 * directly, which means a Next server component reaches into Postgres.
 */
export const FolderInfoInput = z.object({
	section: z.string(),
	path: z.string(),
})

/** Mirrors ExportQueryOptions in @mcpedia/types. */
export const ExportInput = z.object({
	path: z.string().optional(),
	section: z.string().optional(),
	slugs: z.array(z.string()).optional(),
	status: z.string().optional(),
	sortBy: z
		.enum([
			"category_points",
			"path",
			"title",
			"points_desc",
			"difficulty",
			"updated_at",
		])
		.optional(),
})
