/**
 * Revision history use cases, and the snapshot helper the document use cases
 * share.
 *
 * ## WHY SNAPSHOTTING IS ITS OWN USE CASE
 *
 * `snapshotRevision` was a module-level function in the old index.service that
 * three different call sites reached for: createDocument, updateDocument and
 * indexContentFile. Each passed a slightly different `reason`, and all three
 * depended on it doing the same two things — decide whether the body actually
 * changed, and assign the next revision number.
 *
 * The revision-number assignment is the part that is easy to get wrong by hand.
 * It is `(latest.revisionNo ?? 0) + 1`, read from the newest row for that
 * document. Anything else — a counter in memory, a global sequence, an assumed
 * offset — breaks the first time two writes race or an older snapshot lands out
 * of order, and it breaks silently, producing a history with duplicate or
 * interleaved numbers that nothing validates.
 *
 * So the numbering stays here, behind one function, and the document use cases
 * call it rather than passing a number they invented.
 */
import {
	shouldCreateRevision,
	type DocumentMeta,
	type DocumentRepository,
	type RestoreResult,
	type RevisionDetail,
	type RevisionRepository,
	type RevisionSummary,
} from "../domain"

/** Dependencies for the revision use cases. */
export interface RevisionDeps {
	revisions: RevisionRepository
	documents: DocumentRepository
	index: {
		rebuild(slug: string): Promise<number>
	}
	mirror: {
		write(input: {
			relPath: string
			meta: DocumentMeta
			body: string
		}): Promise<void>
	}
	/** Injected so tests get stable timestamps. Defaults to the wall clock. */
	now?: () => Date
}

/**
 * Record a revision, unless the body is unchanged from the latest snapshot.
 *
 * Returns true when a row was written, false when the dedup rule suppressed it.
 * The rule itself is `shouldCreateRevision` from the domain layer — imported,
 * not restated, so there is exactly one definition of "is this a change".
 */
export function makeSnapshotRevision(deps: Pick<RevisionDeps, "revisions">) {
	const { revisions } = deps

	return async function snapshotRevision(
		slug: string,
		meta: DocumentMeta,
		body: string,
		reason: string,
	): Promise<boolean> {
		const latest = await revisions.getLatestBody(slug)

		// Route through the exported predicate rather than re-implementing the
		// rule inline. The inline copy was the only code that ever ran while the
		// tests covering `shouldCreateRevision` validated a function no
		// production path called — so the behaviour that mattered was the
		// untested one.
		if (!shouldCreateRevision(latest?.body, body)) {
			return false // unchanged → no new revision
		}

		await revisions.insert({
			slug,
			revisionNo: (latest?.revisionNo ?? 0) + 1,
			title: meta.title,
			body,
			meta: {
				type: meta.type,
				section: meta.section,
				status: meta.status,
				author: meta.author,
				tags: meta.tags,
			},
			reason,
		})
		return true
	}
}

/** List a document's revisions, newest first. */
export function makeListRevisions(deps: Pick<RevisionDeps, "revisions">) {
	const { revisions } = deps
	return (slug: string, limit = 20, offset = 0): Promise<RevisionSummary[]> =>
		revisions.list(slug, limit, offset)
}

/** Fetch one revision's full body. */
export function makeGetRevision(deps: Pick<RevisionDeps, "revisions">) {
	const { revisions } = deps
	return (id: string): Promise<RevisionDetail | null> => revisions.getById(id)
}

/**
 * Restore a revision: write its body and metadata back over the live document,
 * sync the backup, and rebuild the derived chunks.
 *
 * ## WHY THE REINDEX IS NOT OPTIONAL
 *
 * `document_chunks` holds the CHUNKED body, and semantic and hybrid search read
 * from it. Restoring `documents.body` without rebuilding chunks leaves the two
 * disagreeing: the page shows the old text while semantic search still matches
 * the new one. The original code made the same call and documented the same
 * hazard; it is load-bearing, not incidental.
 *
 * The rebuild goes through the port so a test can replace it with a `vi.fn()`
 * and assert it ran — the original took an optional `opts.reindex` seam for
 * exactly this reason, and this is the same seam expressed as a dependency.
 *
 * ## WHY THE SNAPSHOT IS THE SOURCE OF TRUTH FOR METADATA
 *
 * The restored document's type/section/status/author/tags come from the
 * revision's own `meta` column, not from the live row. The point of a restore
 * is to return the document to how it was, and a document edited since then
 * carries values the revision never had. A field absent from the snapshot falls
 * back to the same defaults the original used, so a snapshot written by an older
 * build restores rather than crashing.
 */
export function makeRestoreRevision(deps: RevisionDeps) {
	const { revisions, documents, index, mirror } = deps

	return async function restoreRevision(
		id: string,
	): Promise<RestoreResult | null> {
		const detail = await revisions.getById(id)
		if (!detail) return null

		const ref = await revisions.getDocumentRef(id)
		if (!ref) return null

		const m = (detail.meta ?? {}) as {
			type?: string
			section?: string
			status?: string
			author?: string
			tags?: string[]
		}

		const live = await documents.getBySlug(ref.slug)
		const nowIso = (deps.now ?? (() => new Date()))().toISOString()

		const restored: DocumentMeta = {
			// The live row supplies identity and path; the snapshot supplies
			// everything the user is choosing to go back to.
			...(live ?? {
				id: ref.slug,
				slug: ref.slug,
				title: detail.title ?? ref.slug,
				type: "documentation",
				section: m.section ?? "docs",
				status: "published",
				author: "",
				tags: [],
				path: `${m.section ?? "docs"}/${ref.slug}.md`,
				createdAt: nowIso,
				extraFields: {},
			}),
			title: detail.title,
			type: m.type ?? "documentation",
			section: m.section ?? "docs",
			status: m.status ?? "published",
			author: m.author ?? "",
			tags: m.tags ?? [],
			updatedAt: nowIso,
		}

		await documents.update(ref.slug, restored, detail.body)

		// Sync back to disk (source of truth for file-based reads). A failed
		// backup must not fail a restore that already committed.
		try {
			await mirror.write({
				relPath: restored.path,
				meta: restored,
				body: detail.body,
			})
		} catch (err) {
			console.error(
				`restoreRevision: failed to write file to disk for ${ref.slug}:`,
				err,
			)
		}

		// Rebuild semantic chunks + embeddings from the restored body so
		// semantic and hybrid search stay consistent.
		await index.rebuild(ref.slug)

		return { slug: ref.slug, documentId: ref.documentId }
	}
}
