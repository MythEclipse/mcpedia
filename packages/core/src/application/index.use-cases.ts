/**
 * Indexing use cases: parse a file into the database, or walk the whole tree.
 *
 * ## WHY THIS IS AN APPLICATION CONCERN
 *
 * Indexing is orchestration. It calls the parser (infrastructure), writes
 * through the repository (infrastructure), chunks and embeds (infrastructure),
 * and decides what happens when the embedding step fails — which is a POLICY,
 * and policy is application. The parts are all replaceable; the ordering and
 * the failure handling are the thing worth testing, and both are here behind a
 * factory.
 *
 * ## THE FAILURE POLICY IS THE INTERESTING PART
 *
 * A missing embedding provider must NOT abort an index run. The corpus is
 * still keyword-searchable through the FTS generated column, and a document
 * that never gets embedded is a much smaller problem than a corpus that stops
 * indexing because one provider was down for thirty seconds. So the embed call
 * is wrapped, the failure is logged loudly, and the run continues.
 *
 * That is a deliberate trade, and it was made before this refactor; it is
 * documented here because "errors are caught and logged" reads like a bug in
 * review unless the reason is written down next to it.
 */
import type {
	ActivityRepository,
	AuditActor,
	DocumentMeta,
	DocumentRepository,
	IndexFileResult,
	IndexingPort,
	IndexResult,
	RevisionRepository,
} from "../domain"
import { makeAuditor, metadataFor, SYSTEM_ACTOR } from "./audit"
import { makeSnapshotRevision } from "./revision.use-cases"

/**
 * The timestamp a freshly-parsed file should carry.
 *
 * A file that declares no `updatedAt` is new to us, so it gets "now"; a file
 * that declares one has an author-chosen date that must be preserved verbatim,
 * or a reindex would rewrite history on every run. The empty-string case is
 * handled explicitly because frontmatter parsing yields "" for a blank field,
 * and "" is falsy but not null.
 */
function resolveTimestamp(
	declared: string | undefined,
	now?: () => Date,
): string {
	return declared && declared !== ""
		? declared
		: (now ?? (() => new Date()))().toISOString()
}

/** The parser port: a markdown file plus its frontmatter. */
export interface ContentParser {
	parse(input: { relPath: string; raw: string }): {
		meta: DocumentMeta
		body: string
	}
}

/** Dependencies for the indexing use cases. */
export interface IndexingDeps {
	documents: DocumentRepository
	revisions: RevisionRepository
	index: IndexingPort
	parser: ContentParser
	/**
	 * The audit trail.
	 *
	 * Indexing writes are the most frequent writes in the system — a full-corpus
	 * run touches every document — so whether they are recorded is a deliberate
	 * choice rather than an obvious one. They ARE recorded, because an
	 * unexplained change to a document is exactly the thing the trail exists to
	 * explain, and "the indexer rewrote it" is an answer that needs a row behind
	 * it to be worth anything.
	 */
	activity?: ActivityRepository | null
	/** Who initiated the index run. Defaults to SYSTEM_ACTOR. */
	actor?: AuditActor
	/** Injected so tests get stable timestamps and deterministic output. */
	now?: () => Date
	/** Injected so tests can capture log output instead of printing it. */
	log?: (message: string) => void
}

/**
 * Index a single content file: parse → upsert `documents` → chunk+embed →
 * snapshot a revision if the body changed since the last indexed revision.
 *
 * THIS IS THE SINGLE INDEXING ENTRY POINT shared by the CLI script, the BullMQ
 * worker, and the git-sync hook — no business logic is duplicated between them.
 */
export function makeIndexContentFile(deps: IndexingDeps) {
	const audit = makeAuditor(deps.activity ?? null)
	const { documents, revisions, index, parser } = deps
	const snapshotRevision = makeSnapshotRevision({ revisions })
	const log = deps.log ?? ((m: string) => console.log(m))

	return async function indexContentFile(
		relPath: string,
		reason = "index",
	): Promise<IndexFileResult> {
		const raw = await documents.readContentFile(relPath)
		const { meta, body } = parser.parse({ relPath, raw })
		const nowIso = resolveTimestamp(meta.updatedAt, deps.now)

		await documents.upsertFromFile({ meta, body, updatedAt: nowIso })

		await audit({
			action: "index",
			resource: "document",
			resourceId: meta.slug,
			actor: deps.actor ?? SYSTEM_ACTOR,
			// `reason` is the CLI/worker/git-sync label ("index", "git-push") and
			// `relPath` is the file this came from. Together they are the
			// difference between "the corpus changed" and "somebody edited a
			// document", which are otherwise indistinguishable in the trail.
			metadata: metadataFor("index", {}, { reason, relPath }),
		})

		// Semantic chunks (embedding). A failure here must not abort the whole
		// index — log and continue; FTS still works without embeddings.
		let chunks = 0
		try {
			chunks = await index.chunkAndEmbed(meta.slug, body)
		} catch (err) {
			log(
				`    embed FAILED for ${meta.slug}: ${
					err instanceof Error ? err.message : err
				}`,
			)
		}

		// Snapshot a revision only when the body actually changed vs the latest
		// revision. Pure metadata/index changes (tags/title) won't create noise.
		const revision = await snapshotRevision(meta.slug, meta, body, reason)

		return { indexed: true, chunks, revision }
	}
}

/**
 * Re-retain every stored document into the current hindsight bank, reading the
 * bodies from the DATABASE.
 *
 * ## WHY THIS IS NOT `runFullIndex`
 *
 * `runFullIndex` walks CONTENT_ROOT on disk and parses each file. That is the
 * right shape for a checkout — the files ARE the input — and the wrong shape for
 * a deploy host, where the mirror is a gitignored backup that may be absent or
 * stale (`content/` is written as a side effect, never guaranteed). Postgres is
 * the source of truth, so a reindex that can only see the disk index cannot
 * repair a host whose bank was repointed.
 *
 * What this is FOR: `HINDSIGHT_BANK_ID` names the bank a document's facts live
 * in, so changing it — as production did when it moved onto a shared bank —
 * leaves every document present in the table and absent from the index. Search
 * then returns nothing, silently, because nothing is broken enough to error.
 * This re-retains the stored bodies, and it is idempotent on the hindsight side
 * (`document_id` + `update_mode: "replace"`), so a re-run repairs a partial one.
 *
 * Sequential on purpose, matching `runFullIndex`: each retain spends a real LLM
 * extraction upstream and hindsight throttles embedding concurrency against a
 * quota, so parallelism converts a slow success into a partial failure.
 */
export function makeReindexFromStore(
	deps: Pick<IndexingDeps, "documents" | "index"> & {
		log?: (message: string) => void
	},
) {
	const log = deps.log ?? ((m: string) => console.log(m))

	return async function reindexFromStore(
		opts: { slugs?: string[]; status?: string } = {},
	): Promise<{ retained: number; missing: number; failed: number }> {
		const rows = await deps.documents.listForExport(
			opts.slugs ? { slugs: opts.slugs } : { status: opts.status },
		)

		let retained = 0
		let missing = 0
		let failed = 0

		for (const doc of rows) {
			try {
				const n = await deps.index.chunkAndEmbed(doc.slug, doc.body)
				if (n === 0) {
					// No row matched the slug. Counted separately from a failure
					// because the cause is different and so is the fix — the slug
					// the caller asked for is not the slug the table holds.
					missing++
					log(`  MISS ${doc.slug} (no row for this slug)`)
					continue
				}
				retained++
				log(`  retained ${doc.slug}`)
			} catch (err) {
				failed++
				log(
					`  FAILED ${doc.slug}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				)
			}
		}

		return { retained, missing, failed }
	}
}

/**
 * Walk the entire content tree and index every file. Returns aggregate counts.
 *
 * Files are processed SEQUENTIALLY, not concurrently. Concurrency here would
 * look like a free speedup and would actually be a correctness hazard: each
 * file takes a revision number from the latest snapshot of its own document,
 * and running the embeddings provider with unbounded parallelism against a
 * local model exhausts memory long before it finishes. The original walked the
 * tree the same way; keeping it is a decision, not an oversight.
 */
export function makeRunFullIndex(deps: IndexingDeps) {
	const indexContentFile = makeIndexContentFile(deps)
	const log = deps.log ?? ((m: string) => console.log(m))

	return async function runFullIndex(reason = "index"): Promise<IndexResult> {
		const files = await deps.documents.listContentFiles()
		let indexed = 0
		let chunks = 0
		let revisions = 0

		for (const rel of files) {
			const r = await indexContentFile(rel, reason)
			indexed++
			chunks += r.chunks
			if (r.revision) revisions++
			log(
				`  indexed ${rel}${r.chunks ? ` (${r.chunks} chunks)` : ""}${
					r.revision ? " [revision]" : ""
				}`,
			)
		}

		log(
			`indexed ${indexed} documents, ${chunks} chunks, ${revisions} new revisions`,
		)
		return { indexed, chunks, revisions }
	}
}
