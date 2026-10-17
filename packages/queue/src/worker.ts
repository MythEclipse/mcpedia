import { consolidate, indexContentFile, runFullIndex } from "@mcpedia/core"
import { type Job, Worker } from "bullmq"
import { BULLMQ_PREFIX, getConnection } from "./client"
import { INDEX_QUEUE } from "./queue"

export function createWorker(): Worker {
	const worker = new Worker(
		INDEX_QUEUE,
		async (job: Job) => {
			switch (job.name) {
				case "index-doc": {
					const { relPath, reason } = job.data as {
						relPath: string
						reason: string
					}
					await job.log(`indexing ${relPath}`)
					const r = await indexContentFile(relPath, reason)
					return r
				}
				case "index-all": {
					const { reason } = job.data as { reason: string }
					await job.log(`full index (${reason})`)
					const result = await runFullIndex(reason)

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
						const { operationId } = await consolidate()
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

					return result
				}
				default:
					throw new Error(`unknown job type: ${job.name}`)
			}
		},
		{
			connection: getConnection(),
			prefix: BULLMQ_PREFIX,
			concurrency: 4,
		},
	)

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
