/**
 * @mcpedia/core — the hexagonal core.
 *
 * ## LAYERS
 *
 *   domain/          pure logic + the ports the outside world implements
 *   application/     use cases, built by `make*` factories
 *   infrastructure/  Drizzle repositories, embeddings, the disk mirror, wiring
 *   presentation/    transport-shaped helpers
 *
 * Dependencies point INWARD. domain/ imports nothing from this package;
 * application/ imports only domain/; infrastructure/ implements domain/'s
 * interfaces and is the only layer that touches Postgres, Redis or the disk.
 *
 * ## WHY THE BARREL STILL LOOKS FLAT
 *
 * Every function the old flat barrel exported is still exported here, under the
 * same name and with the same signature. apps/mcp, packages/queue's worker and
 * scripts/indexer.ts import these symbols directly and are explicitly out of
 * scope for the hexagonal move — they are not part of the kana stack and need no
 * HTTP hop. Rewriting their imports would be churn against a stated constraint,
 * so the reorg stops at the internal structure and the public surface is
 * unchanged.
 *
 * That means the layer boundary is a real constraint (enforced by what each
 * layer imports) rather than a naming convention, while callers keep importing
 * `@mcpedia/core` exactly as before.
 *
 * ## WHAT WAS MOVED VERBATIM
 *
 * `validateSlug`, `slugToRelPath`, `extractFoldersForSection` and `classifyPath`
 * are byte-for-byte the implementations from the former document.service.ts —
 * they are domain logic, already covered, and a rewrite there would be a silent
 * behaviour change. `shouldCreateRevision` is likewise the same expression, now
 * in domain/pure.ts. Search is hindsight-backed and re-exported
 * untouched; `export.docx.ts` and `export.helpers.ts` are reused as-is in
 * application/.
 */

export type {
	DocSection,
	DocStatus,
	DocType,
	Document,
	DocumentMeta,
	ExportCategorySummary,
	ExportData,
	ExportQueryOptions,
	ExportSortOption,
	ExportSummary,
	SearchHit,
	SectionInfo,
} from "@mcpedia/types"
// --- application: use cases ---
export {
	makeAuditor,
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
	metadataFor,
	SYSTEM_ACTOR,
} from "./application"
export type { DocxExportOptions } from "./application/export.docx"
export {
	convertMarkdownToDocx,
	generateExportDocx,
	parseInlineMarkdown,
} from "./application/export.docx"
// --- export helpers: reused as-is, and browser-safe via ./export-helpers ---
export {
	buildExportSummary,
	CTF_CATEGORY_PRIORITY,
	compileExportMarkdown,
	extractDocCategory,
	extractDocDifficulty,
	extractDocPoints,
	extractDocSolved,
	formatScopeTitle,
	getCategoryPriority,
	sortExportDocuments,
} from "./application/export.helpers"
// The audit trail's types are part of the public surface because the
// PRESENTATION layer builds one: `auditActorOf` in apps/api translates a
// request session into an AuditActor. Keeping these type-only (the port and the
// entries are interfaces; there is nothing runtime to export here) means a
// consumer can type an actor without pulling in the repositories.
export type {
	ActivityRecord,
	ActivityRepository,
	AppErrorCode,
	AuditAction,
	AuditActor,
	AuditEntry,
	ContentFile,
	ContentMirror,
	ContentParser,
	CreateDocInput,
	DocumentRepository,
	ExportOptions,
	FolderInfo,
	IndexFileResult,
	IndexingPort,
	IndexResult,
	RestoreResult,
	RevisionDetail,
	RevisionRepository,
	RevisionSummary,
	UpdateDocInput,
} from "./domain"
// --- domain: pure logic and ports ---
// Typed errors. The API's presentation layer maps AppErrorCode to a status, so
// these are part of the package's public surface, not just an internal detail.
export {
	AppError,
	asAppError,
	badRequest,
	classifyPath,
	conflict,
	extractFoldersForSection,
	forbidden,
	internal,
	notFound,
	shouldCreateRevision,
	slugToRelPath,
	unauthorized,
	validateSlug,
} from "./domain"
// --- infrastructure: wiring, repositories, adapters ---
export {
	activityUseCases,
	contentMirror,
	contentParser,
	createActivityRepository,
	createDocumentRepository,
	createRevisionRepository,
	documentUseCases,
	getActivityRepository,
	getDocumentRepository,
	getRevisionRepository,
	indexingUseCases,
	revisionUseCases,
	sectionUseCases,
	withAudit,
} from "./infrastructure"
// --- content files on disk ---
export {
	listContentFiles,
	readContentFile,
} from "./infrastructure/content.service"
// --- search: hindsight-backed ---
// `toTsQuery` and `cosine` are GONE with the stack they belonged to: the first
// built a Postgres tsquery, the second compared two float arrays by hand.
// Neither has a meaning now that ranking is hindsight's, and re-exporting a
// stub for either would be a lie about what the caller is getting.
// `ChunkHit` went with them — hindsight returns facts, not chunks, and every
// mode now yields document-level hits.
export {
	consolidate,
	forgetDocument,
	hybridSearch,
	keywordSearch,
	recallDocumentFacts,
	recallForTest,
	reflect,
	semanticSearch,
} from "./infrastructure/search.service"
// --- the flat, dependency-bound surface apps/mcp, the worker and scripts/ use ---
export {
	createDocument,
	deleteDocument,
	getDocument,
	getExportDocuments,
	getRelated,
	getRevision,
	indexContentFile,
	listDocuments,
	listRevisions,
	listSections,
	restoreRevision,
	runFullIndex,
	updateDocument,
} from "./legacy"
export { toMeta } from "./row-map"
