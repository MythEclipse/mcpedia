/**
 * The composition root: the ONE place where concrete implementations are bound
 * to the domain's ports.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Dependency inversion means the arrows point inward — application/ depends on
 * domain/, and infrastructure/ implements domain/'s interfaces. That leaves a
 * necessary final question: who builds the objects? If each consumer wired its
 * own repositories, then adding a second consumer (say a CLI) would mean a
 * second wiring, and the two could drift into behaving differently with no test
 * to catch it.
 *
 * So wiring lives here, once, and everything else receives use cases already
 * built. This module is the only file in the package that imports both a port
 * and its implementation.
 *
 * ## WHY IT IS LAZY
 *
 * The repositories are created on first access rather than at module scope,
 * because `@mcpedia/db` opens a Postgres connection when it is imported, and a
 * module-scope `db.select()` would connect during the import of any file that
 * merely imports something from this package — including test files that mock
 * the database. Deferring to first call keeps "importing @mcpedia/core" free of
 * side effects, which is what lets the existing unit tests run without a
 * database.
 */
import {
	makeCreateDocument,
	makeDeleteDocument,
	makeFolderInfo,
	makeGetDocument,
	makeGetExportDocuments,
	makeGetRelated,
	makeGetRevision,
	makeIndexContentFile,
	makeListDocuments,
	makeListRevisions,
	makeListSections,
	makeRestoreRevision,
	makeRunFullIndex,
	makeReindexFromStore,
	makeSnapshotRevision,
	makeUpdateDocument,
} from "../application"
import { createActivityRepository } from "./drizzle.activity.repository"
import { createDocumentRepository } from "./drizzle.document.repository"
import { createRevisionRepository } from "./drizzle.revision.repository"
import { contentMirror, contentParser } from "./adapters"
import { hindsightIndex } from "./hindsight.ts"
import type {
	ActivityRepository,
	AuditActor,
	DocumentRepository,
	RevisionRepository,
} from "../domain"

let documents: DocumentRepository | null = null
let revisions: RevisionRepository | null = null
let activity: ActivityRepository | null = null

/** The document repository, bound to the real database. Built once. */
export function getDocumentRepository(): DocumentRepository {
	if (!documents) documents = createDocumentRepository()
	return documents
}

/** The revision repository, bound to the real database. Built once. */
export function getRevisionRepository(): RevisionRepository {
	if (!revisions) revisions = createRevisionRepository()
	return revisions
}

/** The audit trail, bound to the real database. Built once. */
export function getActivityRepository(): ActivityRepository {
	if (!activity) activity = createActivityRepository()
	return activity
}

/**
 * The use cases, with the audit trail attached.
 *
 * ## WHY THE ACTOR IS A PARAMETER HERE
 *
 * `actor` is threaded through from the caller rather than read from a module-level
 * "current user" — an ambient identity would be a lie in a process that serves
 * many concurrent requests, and a global mutable one would be a race. The
 * presentation layer reads the actor from the request and passes it here, which
 * makes the dependency explicit and makes "who did this write" answerable in a
 * unit test by passing an actor literal.
 */
export function withAudit<T extends object>(
	deps: T,
	actor?: AuditActor,
): T & { activity: ActivityRepository; actor?: AuditActor } {
	return {
		...deps,
		activity: getActivityRepository(),
		// A caller with no actor is a SYSTEM write, not an unaudited one.
		...(actor ? { actor } : {}),
	}
}

/** The wired document use cases. */
export function documentUseCases(actor?: AuditActor) {
	const deps = withAudit(
		{
			documents: getDocumentRepository(),
			revisions: getRevisionRepository(),
			index: hindsightIndex,
			mirror: contentMirror,
		},
		actor,
	)
	return {
		create: makeCreateDocument(deps),
		update: makeUpdateDocument(deps),
		remove: makeDeleteDocument(deps),
		list: makeListDocuments(deps),
		get: makeGetDocument(deps),
		related: makeGetRelated(deps),
		sections: makeListSections(deps),
		folderInfo: makeFolderInfo(deps),
		export: makeGetExportDocuments({
			documents: getDocumentRepository(),
			mirror: contentMirror,
		}),
	}
}

/** The wired revision use cases. */
export function revisionUseCases(actor?: AuditActor) {
	return {
		list: makeListRevisions({ revisions: getRevisionRepository() }),
		get: makeGetRevision({ revisions: getRevisionRepository() }),
		restore: makeRestoreRevision(
			withAudit(
				{
					revisions: getRevisionRepository(),
					documents: getDocumentRepository(),
					index: hindsightIndex,
					mirror: contentMirror,
				},
				actor,
			),
		),
		snapshot: makeSnapshotRevision({ revisions: getRevisionRepository() }),
	}
}

/** The wired indexing use cases. */
export function indexingUseCases(actor?: AuditActor) {
	// Indexing runs with no actor unless one is supplied, which is the normal
	// case: the CLI, the worker and the git-sync hook are all system writes.
	const deps = withAudit(
		{
			documents: getDocumentRepository(),
			revisions: getRevisionRepository(),
			index: hindsightIndex,
			parser: contentParser,
		},
		actor,
	)
	return {
		indexFile: makeIndexContentFile(deps),
		runFullIndex: makeRunFullIndex(deps),
		// Reads bodies from Postgres rather than CONTENT_ROOT. The two exist
		// side by side because they answer different questions: `runFullIndex`
		// ingests a checkout's files, this one repairs the INDEX of documents
		// the database already holds — which is the only thing that can fix a
		// deploy host whose bank was repointed, since its mirror may be absent.
		reindexFromStore: makeReindexFromStore(deps),
	}
}

/** The audit trail on its own, for callers that read the trail directly. */
export function activityUseCases() {
	return {
		list: getActivityRepository(),
	}
}

/** The markdown mirror, for callers that read a backup directly. */
export { contentMirror, contentParser }
