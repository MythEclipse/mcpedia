/**
 * Flat, dependency-bound wrappers — the surface apps/mcp, apps/worker and
 * scripts/ import today.
 *
 * ## WHY THESE EXIST RATHER THAN REWRITING THE CALLERS
 *
 * The hexagonal reorg changed how @mcpedia/core is put together internally. It
 * did NOT change what the package exports, because three callers are explicitly
 * out of scope and depend on the flat surface:
 *
 *   apps/mcp/src/index.ts    — the MCP server; stdio, so no HTTP hop is possible
 *   packages/queue/worker.ts — the BullMQ worker; in-process by design
 *   scripts/indexer.ts       — the CLI indexer
 *
 * Rewriting their imports to reach into `./application` or `./infrastructure`
 * would couple three out-of-scope packages to the new internal layout, which is
 * the coupling this refactor exists to remove. So the layout moves behind a
 * stable surface instead.
 *
 * ## WHY THEY ARE LAZY
 *
 * Each wrapper calls a composition-root accessor at CALL time, not at import
 * time. Resolving a use case touches a repository, and a repository touches
 * `@mcpedia/db`, which opens a Postgres connection when it is imported. An
 * eager binding would therefore connect merely because something imported
 * @mcpedia/core — including a test that wants nothing but a pure helper. So
 * importing the package stays free of side effects; only calling into the data
 * path connects, which is what the caller was going to do anyway.
 */

import type {
	AuditActor,
	CreateDocInput,
	Document,
	DocumentMeta,
	ExportData,
	ExportQueryOptions,
	IndexFileResult,
	IndexResult,
	RestoreResult,
	RevisionDetail,
	RevisionSummary,
	SectionInfo,
	UpdateDocInput,
} from "./domain"
import {
	documentUseCases,
	indexingUseCases,
	revisionUseCases,
} from "./infrastructure/compose"

/** Document reads. */
export const listSections = (): Promise<SectionInfo[]> =>
	documentUseCases().sections()

export const listDocuments = (
	opts: { section?: string; status?: string } = {},
): Promise<DocumentMeta[]> => documentUseCases().list(opts)

export const getDocument = (slug: string): Promise<Document | null> =>
	documentUseCases().get(slug)

export const getRelated = (slug: string, limit = 5): Promise<DocumentMeta[]> =>
	documentUseCases().related(slug, limit)

export const getExportDocuments = (
	opts: ExportQueryOptions = {},
): Promise<ExportData> => documentUseCases().export(opts)

/**
 * Document writes.
 *
 * ## WHY THESE TAKE AN OPTIONAL ACTOR
 *
 * These wrappers are the pre-router surface — the one the MCP server and the
 * worker call. They still record to the audit trail, but as SYSTEM writes, because
 * an MCP call over stdio genuinely has no better-auth user behind it: the only
 * credential is the shared secret, and a shared secret identifies a credential
 * rather than a person.
 *
 * The actor parameter exists for the callers that DO have one. Anything that
 * introduces a third caller should pass it rather than letting the default
 * mislabel a human action as a system one — which is the failure mode this
 * parameter's existence is meant to prevent.
 */
export const createDocument = (
	input: CreateDocInput,
	actor?: AuditActor,
): Promise<DocumentMeta> => documentUseCases(actor).create(input)

export const updateDocument = (
	slug: string,
	input: UpdateDocInput,
	actor?: AuditActor,
): Promise<DocumentMeta> => documentUseCases(actor).update(slug, input)

export const deleteDocument = (
	slug: string,
	actor?: AuditActor,
): Promise<{ deleted: boolean }> => documentUseCases(actor).remove(slug)

/** Revisions. */
export const listRevisions = (
	slug: string,
	limit = 20,
	offset = 0,
): Promise<RevisionSummary[]> => revisionUseCases().list(slug, limit, offset)

export const getRevision = (id: string): Promise<RevisionDetail | null> =>
	revisionUseCases().get(id)

export const restoreRevision = (
	id: string,
	actor?: AuditActor,
): Promise<RestoreResult | null> => revisionUseCases(actor).restore(id)

/** Indexing. */
export const indexContentFile = (
	relPath: string,
	reason?: string,
): Promise<IndexFileResult> => indexingUseCases().indexFile(relPath, reason)

export const runFullIndex = (reason?: string): Promise<IndexResult> =>
	indexingUseCases().runFullIndex(reason)

/** Read a markdown backup off disk. */
export { readContentFile } from "./infrastructure/content.service"
