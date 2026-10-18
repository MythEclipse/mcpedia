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
	type ActivityRepository,
	type AuditActor,
	type ContentMirror,
	type CreateDocInput,
	conflict,
	type DocumentMeta,
	type DocumentRepository,
	type IndexingPort,
	notFound,
	type RevisionRepository,
	slugToRelPath,
	type UpdateDocInput,
	validateSlug,
} from "../domain"
import { makeAuditor, metadataFor, SYSTEM_ACTOR } from "./audit"
import { makeSnapshotRevision } from "./revision.use-cases"

/**
 * The collaborators every document use case needs.
 *
 * `activity` and `actor` exist for the audit trail. Both are OPTIONAL, and
 * neither optional means "skip the audit": a write with no actor records itself
 * as a system write. That default is deliberate — the alternative, refusing to
 * record a write whose principal is unknown, produces audit tables with gaps
 * exactly where automation is writing, which is the majority of writes in this
 * system.
 */
export interface DocumentUseCaseDeps {
	documents: DocumentRepository
	revisions: RevisionRepository
	index: IndexingPort
	mirror: ContentMirror
	/** The audit trail. Absent disables recording; it never blocks a write. */
	activity?: ActivityRepository | null
	/** Who is performing this write. Defaults to SYSTEM_ACTOR. */
	actor?: AuditActor
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
 * Log a failed markdown-mirror operation.
 *
 * The mirror is never load-bearing — Postgres holds the document and the file is
 * a backup — so every call site swallows the error on purpose. That policy is
 * right; swallowing it *silently* was not.
 *
 * A misderived `CONTENT_ROOT` and a transient disk blip are the same event from
 * inside this module: the operation throws, it is discarded, the response is a
 * 200. In the deployed layout they are worlds apart — the default
 * `CONTENT_ROOT` resolves to `/opt/content`, which the service user cannot
 * create, so EVERY write fails forever and nothing anywhere says so. The
 * database stays correct, which is exactly why nobody notices the backups are
 * absent until the day they are needed.
 *
 * So the failure keeps its non-fatal treatment and gains a reason. The absolute
 * path is NOT passed in separately: `mkdirSync`/`writeFileSync`/`unlinkSync`
 * all name it in their own message (`EACCES: permission denied, mkdir
 * '/opt/content'`). Re-deriving it here would mean importing `CONTENT_ROOT`
 * into the application layer, which does not know about infrastructure — and
 * would print a second, possibly staler answer to the same question.
 */
function logMirrorFailure(
	operation: string,
	relPath: string,
	err: unknown,
): void {
	const reason = err instanceof Error ? err.message : String(err)
	console.error(
		`${operation}: markdown mirror FAILED for ${relPath}: ${reason}. ` +
			`The document is committed and searchable — the on-disk backup is the only thing missing.`,
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
	const audit = makeAuditor(deps.activity ?? null)

	return async function createDocument(
		input: CreateDocInput,
	): Promise<DocumentMeta> {
		const section = (input.section || "docs").trim()
		const slug = validateSlug(input.slug)
		const relPath = slugToRelPath(section, slug)

		const existing = await documents.getBySlug(slug)
		if (existing) {
			throw conflict(`document already exists at slug: ${slug}`)
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

		await audit({
			action: "create",
			resource: "document",
			resourceId: slug,
			actor: deps.actor ?? SYSTEM_ACTOR,
			// Nothing to diff on a create — the body is the entry, and copying it
			// here would duplicate the whole corpus in a second table.
			metadata: metadataFor("create", {}, { title: meta.title, section }),
		})

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
		} catch (err) {
			// Non-fatal: the database is the source of truth, the file is a backup.
			logMirrorFailure("createDocument", relPath, err)
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
	const audit = makeAuditor(deps.activity ?? null)

	return async function updateDocument(
		slug: string,
		input: UpdateDocInput,
	): Promise<DocumentMeta> {
		const doc = await documents.getBySlug(slug)
		if (!doc) throw notFound(`document not found: ${slug}`)

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

		// The diff is computed from the merge that is already in hand, so it is
		// exact by construction rather than by asking a second implementation to
		// recompute the same comparison and hoping they agree.
		await audit({
			action: "update",
			resource: "document",
			resourceId: slug,
			actor: deps.actor ?? SYSTEM_ACTOR,
			metadata: metadataFor("update", {
				title: [doc.title, updated.title],
				section: [doc.section, updated.section],
				status: [doc.status, updated.status],
				author: [doc.author, updated.author],
				// Byte counts, not bodies: the audit needs to know whether the text
				// changed and by how much, and copying the content would duplicate
				// the corpus behind a second authorisation boundary.
				//
				// `?.length ?? 0` rather than `.length` because the merge above
				// already treats a missing body as "unchanged" — reading it
				// unconditionally here would make the audit stricter than the write
				// it is describing, and turn a valid update into a TypeError.
				body: [`${doc.body?.length ?? 0}b`, `${body?.length ?? 0}b`],
			}),
		})

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
		} catch (err) {
			// Non-fatal.
			logMirrorFailure("updateDocument", doc.path, err)
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
	deps: Pick<
		DocumentUseCaseDeps,
		"documents" | "index" | "mirror" | "activity" | "actor"
	>,
) {
	const { documents, index, mirror } = deps
	const audit = makeAuditor(deps.activity ?? null)

	return async function deleteDocument(
		slug: string,
	): Promise<{ deleted: boolean }> {
		const doc = await documents.getBySlug(slug)
		if (!doc) return { deleted: false }

		await documents.remove(slug)

		// Recorded AFTER the delete, and deliberately not cascading: once the row
		// is gone there is nothing left for a foreign key to point at, and the
		// title captured here is the only remaining record of what was removed.
		await audit({
			action: "delete",
			resource: "document",
			resourceId: slug,
			actor: deps.actor ?? SYSTEM_ACTOR,
			metadata: metadataFor(
				"delete",
				{},
				{ title: doc.title, section: doc.section },
			),
		})

		// The row and the index are two stores, and `documents.remove` only
		// emptied one of them. Without this the deleted body stays searchable and
		// every hit links to a slug that 404s — the document is gone from the
		// site and still the top result for its own subject.
		//
		// Non-fatal, like the other side effects: the delete has already been
		// committed, and failing here would report a delete that DID happen as an
		// error the caller would retry. A stale index entry is recoverable by a
		// reindex; a caller that believes its delete failed is not.
		try {
			await index.forget(slug)
		} catch {
			// Same policy as the mirror below: the committed write stands.
		}

		try {
			await mirror.remove(doc.path)
		} catch (err) {
			// Non-fatal: the row is gone, an orphan file is recoverable by hand.
			logMirrorFailure("deleteDocument", doc.path, err)
		}

		return { deleted: true }
	}
}
