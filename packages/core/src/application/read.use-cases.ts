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
	type ContentMirror,
	classifyPath,
	type Document,
	type DocumentMeta,
	type DocumentRepository,
	extractFoldersForSection,
	type FolderInfo,
	type RevisionRepository,
	type SectionInfo,
} from "../domain"
/**
 * `deriveSectionMeta` is defined in THIS file rather than imported from
 * @mcpedia/config/sections, because that module's registry is now only a SEED
 * for the `sections` table (packages/db/src/seed-sections.ts) and is no longer
 * consulted at runtime. Keeping the fallback here means the application layer
 * has no compile-time dependency on a list that is no longer the source of
 * truth — which is what stops it quietly becoming one again.
 */

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
 * ## WHERE THE METADATA COMES FROM NOW
 *
 * This used to decorate each count with `getSectionMeta()` — a hardcoded
 * registry in @mcpedia/config/sections that had to be duplicated into the
 * browser bundle. Section names are CONTENT, so they live in the `sections`
 * table and are read here, alongside the counts.
 *
 * The two sources answer different questions and are joined by id:
 *
 *   - `documents.listSections()` — a GROUP BY over documents. Only knows
 *     sections that HAVE documents.
 *   - `documents.listRegistry()` — the metadata table. Knows sections that are
 *     configured but still empty, which is why a fresh install is navigable.
 *
 * ## ORDERING
 *
 * Registry order (sortOrder, then id) wins, because that is an editorial
 * decision. Counts that have no registry row come after it, alphabetically:
 * a document created in an ad-hoc section is still reachable, it just cannot
 * claim a nav position until someone registers it. Hidden sections are dropped
 * from this list — it is what the header nav renders — but their documents
 * remain readable at their own URL, which is the difference between unlisted
 * and deleted.
 */
/**
 * What listing sections needs from storage.
 *
 * Narrowed to the two reads rather than the whole `DocumentRepository`: the
 * counting read and the registry read are all this use case touches, and stating
 * that lets a test supply a two-method fake instead of standing up a full
 * repository. The real repository satisfies it structurally.
 */
export type SectionReadDeps = {
	documents: Pick<DocumentRepository, "listSections" | "listRegistry">
}

export function makeListSections(deps: SectionReadDeps) {
	const { documents } = deps
	return async function listSections(): Promise<SectionInfo[]> {
		const [counts, registry] = await Promise.all([
			documents.listSections(),
			documents.listRegistry(),
		])

		const countById = new Map(counts.map((c) => [c.section, c]))
		const seen = new Set<string>()
		const out: SectionInfo[] = []

		for (const record of registry) {
			// Recorded as seen BEFORE the hidden check. A hidden section is
			// REGISTERED — it is just unlisted — and if it were not marked seen
			// here it would fall through to the unregistered tail below and
			// reappear in the nav under a derived name, defeating the flag.
			seen.add(record.id)
			if (record.hidden) continue
			const counted = countById.get(record.id)
			out.push({
				id: record.id,
				label: record.label,
				icon: record.icon,
				desc: record.desc,
				docCount: counted?.count ?? 0,
				...(counted?.latestUpdate ? { updatedAt: counted.latestUpdate } : {}),
			})
		}

		// Sections holding documents but absent from the registry. Sorted by id
		// so the tail order is stable across reads — the registry above already
		// supplied the editorial order, and an unordered tail would make the nav
		// visibly reshuffle between deploys.
		const unregistered = counts
			.filter((c) => !seen.has(c.section))
			.sort((a, b) => a.section.localeCompare(b.section))
		for (const c of unregistered) {
			out.push({
				...deriveSectionMeta(c.section),
				docCount: c.count,
				...(c.latestUpdate ? { updatedAt: c.latestUpdate } : {}),
			})
		}

		return out
	}
}

/**
 * Label/icon/desc for a section id with NO registry row.
 *
 * A document's section is a plain string, so a document can exist in a section
 * nobody registered — an MCP `create_document` with an ad-hoc section, or a
 * registry row deleted after the fact. The document still has to render, so the
 * id is title-cased rather than the section being dropped from every listing.
 *
 * The generic glyph and blurb are deliberately plain: inventing something
 * section-specific would make an unregistered section indistinguishable from a
 * curated one, and the whole point of registering is that someone chose those
 * words.
 */
export function deriveSectionMeta(id: string): SectionInfo {
	const clean = (id || "docs").toLowerCase().trim()
	const label = clean
		.split(/[-_]/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")
	return {
		id: clean,
		label: label || "Custom Section",
		icon: "📁",
		desc: `Documents in the ${label || clean} section.`,
		docCount: 0,
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
