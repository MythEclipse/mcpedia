/**
 * Repository ports: what the domain needs from the outside world, expressed as
 * interfaces the domain owns.
 *
 * ## WHY THE INTERFACES LIVE HERE AND NOT IN infrastructure/
 *
 * Dependency inversion: the arrow of a dependency must point INWARD, toward the
 * policy. A use case in application/ needs to load a document. If it imported
 * the Drizzle repository directly, `application` would depend on `postgres`,
 * Redis and the schema, and every unit test of that use case would need a live
 * database — which is the reason the previous services could only be tested
 * end-to-end.
 *
 * Declaring the port here means:
 *   - application/ imports this file and nothing else from the outside world;
 *   - infrastructure/ imports this file and implements it;
 *   - a test can pass an object literal of `vi.fn()`s and exercise the whole
 *     use case with no I/O at all.
 *
 * The compile-time consequence is that infrastructure/ cannot forget a method
 * (the object is typed against the port) and application/ cannot accidentally
 * reach a query builder (it has no symbol to import).
 *
 * ## WHAT IS *NOT* HERE, AND WHY
 *
 * Search is absent. The search implementation lives in infrastructure/hindsight.ts
 * with its FTS generated column and its pgvector queries, and the brief is
 * explicit that it is reused as-is rather than rewritten behind a port. A port
 * that nothing routes through would be decoration. The same applies to
 * `searchForQuery`: search is a read the presentation layer delegates straight
 * to infrastructure/hindsight.ts, exactly as it did before.
 *
 * Likewise nothing here knows about HTTP, oRPC, zod or Hono. Those belong to
 * presentation/ and are one-directional dependencies that point at this layer.
 */
import type {
	CreateDocInput,
	Document,
	DocumentMeta,
	ExportOptions,
	IndexFileResult,
	IndexResult,
	RestoreResult,
	RevisionDetail,
	RevisionMeta,
	RevisionSummary,
} from "./entities"

/**
 * IndexOptions / RestoreResult / RevisionDetail are re-exported for callers
 * that only import the port file; they are named here so the import above is
 * not dead.
 */
export type {
	ExportOptions,
	IndexFileResult,
	IndexResult,
	RestoreResult,
	RevisionDetail,
	RevisionSummary,
}

/**
 * Durable document storage.
 *
 * The single seam through which the application layer reaches Postgres. Note
 * what is NOT on it: no Drizzle types, no query builder, no row shapes. The
 * port speaks in entities, so swapping the ORM cannot change a use case.
 */
export interface DocumentRepository {
	list(opts: { section?: string; status?: string }): Promise<DocumentMeta[]>

	getBySlug(slug: string): Promise<Document | null>

	getRelated(slug: string, limit: number): Promise<DocumentMeta[]>

	/** Section ids with their document counts, newest activity included. */
	listSections(): Promise<
		Array<{ section: string; count: number; latestUpdate: string }>
	>

	insert(
		input: CreateDocInput & { path: string; meta: DocumentMeta },
	): Promise<void>

	update(slug: string, updated: DocumentMeta, body: string): Promise<void>

	remove(slug: string): Promise<{ deleted: boolean }>

	/**
	 * Upsert a document from a parsed content file.
	 *
	 * Distinct from `insert` because indexing is an UPSERT on slug: re-indexing
	 * an unchanged file must refresh it rather than fail on a duplicate key,
	 * which is the entire reason the indexer can be run repeatedly. `insert`
	 * deliberately does NOT upsert — a duplicate create is a user-visible error.
	 */
	upsertFromFile(input: {
		meta: DocumentMeta
		body: string
		updatedAt: string
	}): Promise<void>

	/**
	 * Every document an export should consider, bodies included.
	 *
	 * The four-way selection (explicit slug list, path prefix, section, or
	 * everything published) is a STORAGE question — only SQL can answer it
	 * efficiently — so it lives here rather than in the use case. The use case
	 * receives rows already scoped and is left with ordering and summarizing,
	 * which is policy.
	 */
	listForExport(opts: ExportOptions): Promise<Document[]>

	/**
	 * The markdown file backing a document, for the on-disk backup sync.
	 *
	 * Returned rather than written: the repository owns the path, the
	 * infrastructure layer owns the disk, and the use case decides what to do
	 * with it. A failed disk sync must never fail a successful database write,
	 * so this is separated from `insert`/`update` on purpose.
	 */
	readContentFile(relPath: string): Promise<string>

	/** Every markdown file under CONTENT_ROOT, as paths relative to it. */
	listContentFiles(): Promise<string[]>
}

/**
 * Revision history storage.
 *
 * Separate from DocumentRepository because it answers a different question, and
 * the two tables have different lifetimes. Keeping them apart means a use case
 * that only reads history cannot reach document writes by accident.
 */
export interface RevisionRepository {
	list(slug: string, limit: number, offset: number): Promise<RevisionSummary[]>

	getById(id: string): Promise<RevisionDetail | null>

	/**
	 * The newest revision's body, or null when the document has never been
	 * snapshotted. `shouldCreateRevision` consumes this to decide whether an
	 * edit is worth a new revision — see domain/pure.ts.
	 */
	getLatestBody(
		slug: string,
	): Promise<{ body: string; revisionNo: number } | null>

	insert(input: {
		slug: string
		revisionNo: number
		title: string
		body: string
		meta: RevisionMeta
		reason: string
	}): Promise<void>

	/** The document a revision belongs to, for a restore. */
	getDocumentRef(
		id: string,
	): Promise<{ documentId: string; slug: string } | null>
}

/**
 * Chunk + embedding side effects.
 *
 * Indexing is the expensive part of every write, and it is the part that fails
 * independently: a missing embedding provider must degrade to "FTS still
 * works", never to "the write was lost". Keeping it behind a port makes that
 * policy explicit at the call site instead of relying on a try/catch in the
 * middle of a service.
 */
export interface IndexingPort {
	/** Chunk and embed a body. Returns the chunk count. */
	chunkAndEmbed(slug: string, body: string): Promise<number>

	/** Rebuild chunks from a slug's CURRENT stored body. Returns chunk count. */
	rebuild(slug: string): Promise<number>

	/**
	 * Drop a document's indexed facts.
	 *
	 * An indexing port that can add facts and change them, but not remove them,
	 * cannot express "this document no longer exists" — so a deleted document
	 * stays searchable at its old content and the search page links to a slug
	 * that 404s. It lives on THIS port rather than on the document repository
	 * because the index is where the facts are; the row and the index are two
	 * different stores and only one of them is deleted by `documents.remove`.
	 */
	forget(slug: string): Promise<void>
}

/**
 * The markdown-backup mirror.
 *
 * The database is the source of truth; this is the on-disk copy. It is a port
 * because "where does the backup live and how is it serialized" is an
 * infrastructure decision, while "attempt the backup after a successful write,
 * and never let it fail the write" is a use-case decision.
 */
export interface ContentMirror {
	write(input: {
		relPath: string
		meta: DocumentMeta
		body: string
	}): Promise<void>

	/** Remove a document's backup. Returns false when there was no file. */
	remove(relPath: string): Promise<boolean>

	read(relPath: string): Promise<string>
}

/** The filesystem walk used by a full-corpus index run. */
export type ContentLister = DocumentRepository["listContentFiles"]

/**
 * Who performed a write.
 *
 * ## WHY THIS IS A VALUE AND NOT A SESSION
 *
 * The audit entry has to survive the request. A session cookie is gone by the
 * time anyone reads the trail, and it does not exist at all for the indexer. So
 * the domain names its own tiny shape and the presentation layer is responsible
 * for translating whatever it holds into it — which means a use case can be
 * tested without a session, a user table, or a request object.
 *
 * Every field is optional except `via`, because the honest default for "I do not
 * know who did this" is to say so. An actor that claims a user id it cannot
 * substantiate is worse than an actor that admits it has none.
 */
export interface AuditActor {
	/** The better-auth user id, absent for a machine-initiated write. */
	readonly userId?: string
	/** "admin" | "user" as of the write. Recorded, not re-derived on read. */
	readonly role?: string
	/** Which credential performed it. Required: the one fact that always exists. */
	readonly via: "webhook-secret" | "session" | "system"
}

/** What a write did. Kept as a union so a typo fails to compile. */
export type AuditAction = "create" | "update" | "delete" | "restore" | "index"

/** One recorded write. */
export interface AuditEntry {
	readonly action: AuditAction
	readonly resource: string
	readonly resourceId: string
	readonly actor: AuditActor
	readonly metadata: Record<string, unknown>
}

/**
 * The append-only audit trail.
 *
 * ## WHY THIS IS A PORT AND NOT A CALL TO THE REPOSITORY
 *
 * Auditing is a cross-cutting concern that applies to every write, in every use
 * case. Putting it on `DocumentRepository` would mean every repository grew a
 * `record()` method and every write path grew a call to remember it — which is
 * exactly the property that produces audit logs with gaps in them. As its own
 * port, the dependency is one collaborator in `DocumentUseCaseDeps`, and the
 * policy for what gets recorded lives in one place (see application/audit.ts)
 * rather than being re-derived at each site.
 *
 * Reads are on the port too because an audit trail nobody can read is a cost
 * with no benefit.
 */
export interface ActivityRepository {
	record(entry: AuditEntry): Promise<void>

	/** Newest first. `resourceId` filters to one document. */
	list(opts: {
		resourceId?: string
		limit: number
		offset: number
	}): Promise<ActivityRecord[]>
}

/**
 * An audit row as read back.
 *
 * Separate from `AuditEntry` because the two differ in the only way that
 * matters to a reader: an entry is a request to record something, and a record
 * is a statement about the past that already happened, with an id and a
 * timestamp the caller did not supply and cannot change.
 */
export interface ActivityRecord extends AuditEntry {
	readonly id: string
	readonly actor: AuditActor
	readonly createdAt: string
}
