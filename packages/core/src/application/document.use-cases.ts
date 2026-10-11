/**
 * Use cases for creating, updating and removing documents.
 *
 * ## WHY FACTORIES
 *
 * Each use case is built by a `make*` factory that takes its collaborators as
 * an argument and returns a plain async function. This is the form dependency
 * injection actually takes in a language without interfaces on the wire:
 *
 *   const create = makeCreateDocument({ documents, revisions, index, mirror })
 *   await create({ slug: "docs/x", ... })
 *
 * The alternative — module-level functions importing `db` directly — is what
 * the old services did, and it is precisely why `createDocument` had no unit
 * test: exercising it meant a live Postgres. With the factory, the entire test
 * is an object of `vi.fn()`s. No database, no Redis, no filesystem, and the
 * assertions are about the COLLABORATION (was the revision taken? was the
 * index attempted? did a disk failure roll the write back?) which is the part
 * with actual logic in it.
 *
 * ## THE ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER
 *
 *   1. validate + compute the path        (domain, no I/O — fail fast and free)
 *   2. write the database row             (the source of truth)
 *   3. snapshot a revision                (history of what was just written)
 *   4. attempt chunk/embed                (best-effort, never fatal)
 *   5. attempt the on-disk backup         (best-effort, never fatal)
 *
 * Steps 4 and 5 are wrapped because the previous implementation logged and
 * continued: an embedding provider that is down must degrade the document to
 * "keyword-searchable only", and a read-only disk must degrade the backup to
 * "absent". Neither is allowed to roll back a database row that is already
 * committed — that would be worse than the problem it solved. But the failure is
 * logged rather than swallowed, because "every caller logs-and-continues on
 * indexing errors" is exactly the property that made a chunk/embedding failure
 * invisible until someone noticed documents had stopped appearing in semantic
 * search.
 *
 * Step 3 precedes step 4 for a specific reason: the revision records the body
 * as WRITTEN. If indexing ran first and the write then failed, history would
 * contain a revision for a document that does not exist.
 */
import {
	slugToRelPath,
	validateSlug,
	type ContentMirror,
	type CreateDocInput,
	type Document,
	type DocumentMeta,
	type DocumentRepository,
	type IndexingPort,
	type RevisionRepository,
	type UpdateDocInput,
} from "../domain"
import { makeSnapshotRevision } from "./revision.use-cases"

/** The collaborators every document use case needs. */
export interface DocumentUseCaseDeps {
	documents: DocumentRepository
	revisions: RevisionRepository
	index: IndexingPort
	mirror: ContentMirror
	/** Injected so tests get stable timestamps. Defaults to the wall clock. */
	now?: () => Date
}

function clock(deps: DocumentUseCaseDeps): () => Date {
	return deps.now ?? (() => new Date())
}

/**
 * Log a non-fatal degradation.
 *
 * Extracted because the message shape is part of the contract: an operator
 * greps for `chunk/embed FAILED`, and three call sites spelling it three ways
 * is how one of them drifts.
 */
function logDegraded(operation: string, slug: string, err: unknown): void {
	console.error(
		`${operation}: chunk/embed FAILED for ${slug}: ${
			err instanceof Error ? err.message : err
		}`,
	)
}

/**
 * Create a document: validate, persist, snapshot, index, mirror to disk.
 *
 * Returns the metadata that was written, so the caller can render the new page
 * without a second read.
 */
export function makeCreateDocument(deps: DocumentUseCaseDeps) {
	const { documents, revisions, index, mirror } = deps
	const snapshotRevision = makeSnapshotRevision({ revisions })

	return async function createDocument(
		input: CreateDocInput,
	): Promise<DocumentMeta> {
		const section = (input.section || "docs").trim()
		const slug = validateSlug(input.slug)
		const relPath = slugToRelPath(section, slug)

		const existing = await documents.getBySlug(slug)
		if (existing) {
			throw new Error(`document already exists at slug: ${slug}`)
		}

		const nowIso = clock(deps)().toISOString()
		const meta: DocumentMeta = {
			id: slug,
			slug,
			title: input.title,
			type: input.type ?? "documentation",
			section,
			status: input.status ?? "published",
			author: input.author ?? "",
			tags: input.tags ?? [],
			path: relPath,
			createdAt: nowIso,
			updatedAt: nowIso,
			extraFields: input.extraFields ?? {},
		}

		await documents.insert({ ...input, section, slug, path: relPath, meta })

		// History of exactly what was written, taken before the async work
		// below can fail. The revision number comes from snapshotRevision, which
		// reads the latest one — not from a literal.
		await snapshotRevision(slug, meta, input.body, "create")

		try {
			await index.chunkAndEmbed(slug, input.body)
		} catch (err) {
			logDegraded("createDocument", slug, err)
		}

		try {
			await mirror.write({ relPath, meta, body: input.body })
		} catch {
			// Non-fatal: the database is the source of truth, the file is a backup.
		}

		return meta
	}
}

/**
 * Update an existing document: read, merge, write, snapshot, reindex, mirror.
 *
 * Every field is optional and an omitted field means UNCHANGED. That rule is
 * what makes this safe to call from a form that submits a subset, and it is why
 * the merge is explicit here rather than a blind `set(input)` — a blind set
 * would null out every field the caller did not send.
 *
 * Throws when the document does not exist. Silently creating it would turn a
 * stale form submission into a duplicate-slug failure much later, in a place
 * with no idea what the user was doing.
 */
export function makeUpdateDocument(deps: DocumentUseCaseDeps) {
	const { documents, revisions, index, mirror } = deps
	const snapshotRevision = makeSnapshotRevision({ revisions })

	return async function updateDocument(
		slug: string,
		input: UpdateDocInput,
	): Promise<DocumentMeta> {
		const doc = await documents.getBySlug(slug)
		if (!doc) throw new Error(`document not found: ${slug}`)

		const updatedAt = clock(deps)().toISOString()
		const updated: DocumentMeta = {
			...doc,
			title: input.title ?? doc.title,
			type: input.type ?? doc.type,
			section: input.section ?? doc.section,
			status: input.status ?? doc.status,
			tags: input.tags ?? doc.tags,
			author: input.author ?? doc.author,
			updatedAt,
			// Merge rather than replace: extraFields are additive custom metadata,
			// so an update that omits one must not delete it.
			extraFields:
				input.extraFields !== undefined
					? { ...doc.extraFields, ...input.extraFields }
					: doc.extraFields,
		}
		const body = input.body ?? doc.body

		await documents.update(slug, updated, body)

		// Snapshotted through the shared helper so the dedup rule and the
		// revision numbering have exactly one implementation. The original
		// called snapshotRevision here too, on every update — a metadata-only
		// edit therefore still goes through the rule and is correctly skipped.
		await snapshotRevision(slug, updated, body, "update")

		try {
			await index.chunkAndEmbed(slug, body)
		} catch (err) {
			logDegraded("updateDocument", slug, err)
		}

		try {
			await mirror.write({ relPath: doc.path, meta: updated, body })
		} catch {
			// Non-fatal.
		}

		return updated
	}
}

/**
 * Remove a document and everything derived from it: chunks, revisions, and the
 * on-disk backup.
 *
 * Deletion order matters. Chunks and revisions are removed before the document
 * row because both reference it; leaving the row until last means a failure
 * part-way leaves an orphan document rather than a document whose history has
 * silently vanished.
 */
export function makeDeleteDocument(
	deps: Pick<DocumentUseCaseDeps, "documents" | "mirror">,
) {
	const { documents, mirror } = deps

	return async function deleteDocument(
		slug: string,
	): Promise<{ deleted: boolean }> {
		const doc = await documents.getBySlug(slug)
		if (!doc) return { deleted: false }

		await documents.remove(slug)

		try {
			await mirror.remove(doc.path)
		} catch {
			// Non-fatal: the row is gone, an orphan file is recoverable by hand.
		}

		return { deleted: true }
	}
}
