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
	makeSnapshotRevision,
	makeUpdateDocument,
} from "../application"
import { createDocumentRepository } from "./drizzle.document.repository"
import { createRevisionRepository } from "./drizzle.revision.repository"
import { contentMirror, contentParser, embeddingIndex } from "./adapters"
import type { DocumentRepository, RevisionRepository } from "../domain"

let documents: DocumentRepository | null = null
let revisions: RevisionRepository | null = null

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

/** The wired document use cases. */
export function documentUseCases() {
	const deps = {
		documents: getDocumentRepository(),
		revisions: getRevisionRepository(),
		index: embeddingIndex,
		mirror: contentMirror,
	}
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
export function revisionUseCases() {
	return {
		list: makeListRevisions({ revisions: getRevisionRepository() }),
		get: makeGetRevision({ revisions: getRevisionRepository() }),
		restore: makeRestoreRevision({
			revisions: getRevisionRepository(),
			documents: getDocumentRepository(),
			index: embeddingIndex,
			mirror: contentMirror,
		}),
		snapshot: makeSnapshotRevision({ revisions: getRevisionRepository() }),
	}
}

/** The wired indexing use cases. */
export function indexingUseCases() {
	const deps = {
		documents: getDocumentRepository(),
		revisions: getRevisionRepository(),
		index: embeddingIndex,
		parser: contentParser,
	}
	return {
		indexFile: makeIndexContentFile(deps),
		runFullIndex: makeRunFullIndex(deps),
	}
}

/** The markdown mirror, for callers that read a backup directly. */
export { contentMirror, contentParser, embeddingIndex }
