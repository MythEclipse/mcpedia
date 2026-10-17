/**
 * The BullMQ indexing worker: consumes queued index jobs and applies them to the
 * STORE.
 *
 * ## WHY THESE JOBS READ POSTGRES, NOT DISK
 *
 * There are two legitimate meanings of "index this document", and this worker was
 * wired to the wrong one:
 *
 *   `runFullIndex` / `indexContentFile`  — ingest a CHECKOUT. They walk
 *       CONTENT_ROOT and parse each file, which is right when the files ARE the
 *       input (a developer's clone, `pnpm run index`, the git-sync hook).
 *   `reindexFromStore`                   — re-retain the bodies Postgres already
 *       holds. Right whenever the store is authoritative and the on-disk mirror
 *       may be absent or stale.
 *
 * This worker is the second case, and it was running the first. It executes from
 * `/opt/mcpedia-worker/current/dist/index.js`, so `CONTENT_ROOT` resolves through
 * `resolve(REPO_ROOT, "content")` to `<payload>/content` — INSIDE the immutable
 * release directory, where the gitignored mirror never exists. Every job failed
 * with ENOENT and was recorded as a failed indexing job: 87 of them (71
 * `index-all` scandir, 16 `index-doc` open), while `queue_status` reported the
 * corpus as merely "not indexed yet", so nothing looked broken enough to notice.
 *
 * Postgres is the source of truth (see AGENTS.md), so the fix is to re-retain the
 * stored bodies through the ONE implementation that already does it, rather than
 * teaching this file to read a disk it does not have. `pnpm run index` keeps the
 * disk path, which remains correct in a checkout.
 *
 * ## WHY THE DISPATCH IS A FACTORY
 *
 * `makeIndexJobProcessor` takes its collaborators as an argument, so the policy
 * in here — slug derivation, published+draft coverage, and what counts as a
 * failure — is testable with plain object literals. No Redis, no Postgres, no
 * BullMQ. That matters because the interesting decisions below are exactly the
 * ones a live queue can only demonstrate by failing in production.
 */
import { consolidate, indexingUseCases } from "@mcpedia/core"
import { type Job, Worker } from "bullmq"
import { BULLMQ_PREFIX, getConnection } from "./client"
import { INDEX_QUEUE } from "./queue"

/** Counts every store-backed reindex reports. */
export interface ReindexCounts {
	retained: number
	missing: number
	failed: number
}

/**
 * The slice of a BullMQ job this module actually uses.
 *
 * Structural rather than `Job` so a test can pass an object literal. `Job`
 * satisfies it, which is what keeps the two from drifting.
 *
 * `log` returns whatever BullMQ returns (`number` bytes appended) rather than
 * `void`; narrowing it to `void` here would make a real `Job` unassignable — the
 * compiler rejecting the only implementation that matters. The processor's own
 * return type is `unknown` for the same reason: BullMQ reports the returned value
 * to the caller, so it must stay permissive.
 */
export interface IndexJobLike {
	name: string
	data: unknown
	log: (message: string) => Promise<unknown>
}

/** Collaborators for the job processor. */
export interface IndexJobDeps {
	reindexFromStore: (opts: {
		slugs?: string[]
		status?: string
	}) => Promise<ReindexCounts>
	consolidate: () => Promise<{ operationId?: string }>
	/** Injected so tests capture output instead of printing it. */
	log?: (message: string) => void
}

/** `docs/x.md` and `docs/x.mdx` both name the slug `docs/x`. */
function slugFromRelPath(relPath: string): string {
	return relPath.replace(/\.mdx?$/, "")
}

/**
 * True when a reindex retained nothing while something DID fail.
 *
 * This is the one reindex outcome that must not report success. A single
 * unretainable document is a degradation — the corpus is still mostly indexed,
 * and re-running the whole thing to fix one document costs more than it buys, so
 * the counts are returned and logged instead. Zero retained with failures is
 * different in kind: hindsight is unreachable or the bank is wrong, and a green
 * job there would mean "nothing is searchable" and "everything is fine" are the
 * same signal. An empty corpus is NOT a failure — nothing to do, nothing failed.
 */
function isTotalFailure(counts: ReindexCounts): boolean {
	return counts.retained === 0 && counts.failed > 0
}

function summarise(counts: ReindexCounts): string {
	return `retained ${counts.retained}, missing ${counts.missing}, failed ${counts.failed}`
}

/**
 * Build the job processor for the indexing queue.
 *
 * Exported so the dispatch policy can be unit-tested without a queue.
 */
export function makeIndexJobProcessor(deps: IndexJobDeps) {
	const log = deps.log ?? ((m: string) => console.log(m))

	return async function processIndexJob(job: IndexJobLike): Promise<unknown> {
		switch (job.name) {
			case "index-doc": {
				const { relPath, reason } = job.data as {
					relPath: string
					reason: string
				}
				const slug = slugFromRelPath(relPath)
				await job.log(`re-retaining ${slug} (${reason})`)

				const counts = await deps.reindexFromStore({ slugs: [slug] })
				log(`[worker] index-doc ${slug}: ${summarise(counts)}`)
				await job.log(summarise(counts))

				// All three counts at zero means the slug matched NO row at all:
				// `listForExport` selected nothing, so the loop never ran and
				// there was no candidate to retain, miss OR fail. That is
				// indistinguishable from a successful retain if only the counts
				// are read, and it is the same class of silence this worker was
				// just fixed for — a job reporting success while having indexed
				// nothing. It is NOT thrown: the document may simply have been
				// deleted between enqueue and processing, which is a normal race
				// that a retry cannot win. It is logged so the cause is visible.
				if (counts.retained + counts.missing + counts.failed === 0) {
					const warning = `no row matches slug "${slug}" — nothing retained`
					log(`[worker] index-doc WARNING: ${warning}`)
					await job.log(warning)
				}

				if (isTotalFailure(counts)) {
					throw new Error(
						`index-doc retained nothing for ${slug} (${counts.failed} failed)`,
					)
				}
				return counts
			}

			case "index-all": {
				const { reason } = job.data as { reason: string }
				await job.log(`store reindex (${reason})`)

				// BOTH statuses, summed. A full disk walk indexed every file it
				// found regardless of frontmatter, and the write path embeds a
				// draft as readily as a published document — so covering only
				// `published` here would let a full reindex DROP drafts from
				// search that writing them had put there. The asymmetry would be
				// silent, which is the failure mode this whole file exists to
				// stop repeating.
				const counts = await deps.reindexFromStore({ status: "published" })
				const draftCounts = await deps.reindexFromStore({ status: "draft" })
				const total: ReindexCounts = {
					retained: counts.retained + draftCounts.retained,
					missing: counts.missing + draftCounts.missing,
					failed: counts.failed + draftCounts.failed,
				}

				log(`[worker] index-all (${reason}): ${summarise(total)}`)
				await job.log(summarise(total))

				// Consolidate ONCE, here, and only after every document landed.
				// Retain writes per-document facts; nothing else creates the
				// cross-document observations that reflect reasons over. This is
				// the one moment the corpus is known complete, so it is the only
				// moment a corpus-wide pass is worth paying for — a single-document
				// edit must not trigger it.
				//
				// Failures are logged, not thrown: a consolidation failure leaves
				// search working on facts alone, which is degraded but correct.
				// Failing the job instead would mark a perfectly successful reindex
				// as failed and re-run the entire corpus on retry.
				try {
					const { operationId } = await deps.consolidate()
					await job.log(`consolidation queued (${operationId || "sync"})`)
				} catch (err) {
					console.error(
						`[worker] consolidation failed after ${reason}:`,
						err instanceof Error ? err.message : err,
					)
					await job.log(
						`consolidation FAILED: ${err instanceof Error ? err.message : String(err)}`,
					)
				}

				if (isTotalFailure(total)) {
					throw new Error(`index-all retained nothing (${total.failed} failed)`)
				}
				return total
			}

			default:
				throw new Error(`unknown job type: ${job.name}`)
		}
	}
}

export function createWorker(): Worker {
	const { reindexFromStore } = indexingUseCases()
	// Built ONCE, outside the job callback. Constructing the processor per job
	// would rebuild its closures on every item for no benefit — the collaborators
	// are stable singletons for the life of the process.
	const processIndexJob = makeIndexJobProcessor({
		reindexFromStore,
		consolidate,
	})

	const worker = new Worker(INDEX_QUEUE, (job: Job) => processIndexJob(job), {
		connection: getConnection(),
		prefix: BULLMQ_PREFIX,
		concurrency: 4,
	})

	worker.on("completed", (job) => {
		console.log(`[worker] completed ${job.name} (${job.id})`)
	})
	worker.on("failed", (job, err) => {
		console.error(`[worker] failed ${job?.name} (${job?.id}): ${err.message}`)
	})
	worker.on("error", (err) => {
		console.error(`[worker] error:`, err.message)
	})

	return worker
}

/** Start the worker and wire graceful shutdown. */
export async function startWorker(): Promise<Worker> {
	const worker = createWorker()
	console.log("[worker] indexing worker started")

	const shutdown = async (sig: string) => {
		console.log(`[worker] ${sig} received, closing...`)
		await worker.close()
		process.exit(0)
	}
	process.on("SIGINT", () => void shutdown("SIGINT"))
	process.on("SIGTERM", () => void shutdown("SIGTERM"))

	return worker
}
