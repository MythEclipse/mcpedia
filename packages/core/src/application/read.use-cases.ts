/**
 * Read use cases: list, browse by section, and answer the folder question.
 *
 * These are thin by design. That is not an accident of an incomplete refactor —
 * a read that filters a list and maps it is a list that filters and maps, and
 * wrapping it in a factory would add an indirection that buys no testability
 * (there is no I/O to fake beyond the repository itself, which the caller can
 * already substitute).
 *
 * `makeFolderInfo` earns its factory because it COMBINES two collaborators: the
 * document list and the pure `classifyPath`/`extractFoldersForSection` pair.
 * The combination is the logic — deciding whether a path is a document, a
 * folder, or neither, from the section's live slugs — and it is what a slug page
 * needs to choose between rendering, listing and 404ing.
 */
import {
	classifyPath,
	extractFoldersForSection,
	type ContentMirror,
	type Document,
	type DocumentMeta,
	type DocumentRepository,
	type FolderInfo,
	type RevisionRepository,
	type SectionInfo,
} from "../domain"
/**
 * `@mcpedia/config/sections`, NOT the bare `@mcpedia/config` barrel.
 *
 * Both symbols used here live in the subpath, and the subpath has ZERO imports
 * (packages/config/src/sections.ts). The barrel is a different story: it reads
 * and parses the repo .env at import time and pulls in node:fs and zod, so
 * importing it here would drag filesystem access into a module that otherwise
 * has none — and would make this file unimportable in any environment without a
 * .env, including the unit tests that fake every other collaborator.
 *
 * This is the same distinction src/build/no-server-imports.ts encodes for the
 * browser bundle: the sections registry is safe anywhere, the config barrel is
 * not.
 */
import { DEFAULT_SECTIONS, getSectionMeta } from "@mcpedia/config/sections"

export interface ReadDeps {
	documents: DocumentRepository
	revisions?: RevisionRepository
	mirror?: ContentMirror
}

/** List documents, optionally filtered by section and/or status. */
export function makeListDocuments(deps: Pick<ReadDeps, "documents">) {
	const { documents } = deps
	return (
		opts: { section?: string; status?: string } = {},
	): Promise<DocumentMeta[]> => documents.list(opts)
}

/** Documents related to `slug` by shared tags. */
export function makeGetRelated(deps: Pick<ReadDeps, "documents">) {
	const { documents } = deps
	return (slug: string, limit = 5): Promise<DocumentMeta[]> =>
		documents.getRelated(slug, limit)
}

/**
 * List active sections with their document counts.
 *
 * An empty corpus is not an error — it is a fresh install, and the API is
 * supposed to answer with the preset sections at zero so a new deployment can
 * navigate to a section that does not exist yet. That fallback lives here, in
 * the application layer, because "what should an empty wiki show" is a policy
 * decision and not a query.
 */
export function makeListSections(deps: Pick<ReadDeps, "documents">) {
	const { documents } = deps
	return async function listSections(): Promise<SectionInfo[]> {
		const rows = await documents.listSections()
		if (rows.length === 0) {
			return DEFAULT_SECTIONS.map((s) => ({ ...s, docCount: 0 }))
		}
		return rows.map((r) => ({
			...getSectionMeta(r.section, r.count),
			docCount: r.count,
			updatedAt: r.latestUpdate,
		}))
	}
}

/**
 * Everything a slug page needs to decide what it is looking at.
 *
 * Both the classification and the folder tree are computed from the SAME live
 * document list, in one read. Computing them from two reads would let them
 * disagree: a document created between the two queries would make
 * `classifyPath` say "none" while the folder tree shows its parent, and the page
 * would 404 on a document that exists.
 */
export function makeFolderInfo(deps: Pick<ReadDeps, "documents">) {
	const { documents } = deps
	return async function folderInfo(
		section: string,
		path: string,
	): Promise<FolderInfo> {
		const docs = await documents.list({ section })
		const docSlugs = docs.map((d) => d.slug)
		return {
			classification: classifyPath(docSlugs, path),
			folders: extractFoldersForSection(docSlugs, section),
			docCount: docSlugs.length,
		}
	}
}

/**
 * Read a document, falling back to the on-disk backup when the stored body is
 * empty.
 *
 * The fallback covers the window between a migration that created the rows and
 * the first index run that filled their bodies. It is policy rather than data
 * access — which source wins is a decision — so it lives here, and it is
 * testable because the mirror is a port.
 */
export function makeGetDocument(
	deps: Pick<ReadDeps, "documents"> & { mirror?: ContentMirror },
) {
	const { documents, mirror } = deps

	return async function getDocument(slug: string): Promise<Document | null> {
		const row = await documents.getBySlug(slug)
		if (!row) return null
		if (row.body || !mirror) return row

		try {
			return { ...row, body: await mirror.read(row.path) }
		} catch {
			// No usable backup: return the row with an empty body rather than
			// throwing. A missing backup is a degraded render, not a 500.
			return { ...row, body: "" }
		}
	}
}
