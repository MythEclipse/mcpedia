import { getQueue, INDEX_QUEUE } from "@mcpedia/queue"
import { BULLMQ_PREFIX } from "@mcpedia/queue/client"
import { os } from "@orpc/server"
import { JobStatusInput } from "../schemas"

/**
 * BullMQ job status. Public — these expose queue counters, which the metrics
 * endpoint already publishes unauthenticated.
 *
 * `getQueue()` is called per request rather than at module load so importing
 * this router never opens a Redis connection. The web dashboard's own status
 * route already does exactly this.
 */
export const queueRouter = os.router({
	job: os.input(JobStatusInput).handler(async ({ input }) => {
		const queue = getQueue()
		const job = await queue.getJob(input.id)
		if (!job) return { exists: false as const }
		const state = await job.getState()
		return {
			exists: true as const,
			id: job.id,
			name: job.name,
			state,
			progress: job.progress,
			failedReason: job.failedReason,
			returnvalue: job.returnvalue,
			attemptsMade: job.attemptsMade,
		}
	}),

	status: os.handler(async () => {
		const queue = getQueue()
		const [waiting, active, completed, failed, delayed] = await Promise.all([
			queue.getWaitingCount(),
			queue.getActiveCount(),
			queue.getCompletedCount(),
			queue.getFailedCount(),
			queue.getDelayedCount(),
		])
		return {
			queue: INDEX_QUEUE,
			prefix: BULLMQ_PREFIX,
			counts: { waiting, active, completed, failed, delayed },
		}
	}),
})
