import { Worker, type Job } from "bullmq"
import { getConnection, BULLMQ_PREFIX } from "./client"
import { INDEX_QUEUE } from "./queue"
import { indexContentFile, runFullIndex } from "@mcpedia/core"

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
					return await runFullIndex(reason)
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
