import { Queue, type Job } from "bullmq"
import { getConnection, BULLMQ_PREFIX } from "./client"

export const INDEX_QUEUE = "mcpedia-index"

/** Lazily-created singleton BullMQ queue. */
let _queue: Queue | null = null

export function getQueue(): Queue {
	if (!_queue) {
		_queue = new Queue(INDEX_QUEUE, {
			connection: getConnection(),
			prefix: BULLMQ_PREFIX,
		})
	}
	return _queue
}

export interface IndexDocJobData {
	relPath: string
	reason: string
}

export interface IndexAllJobData {
	reason: string
}

export type JobType = "index-doc" | "index-all"

/**
 * Enqueue a single-document reindex job. Keyed by slug so repeated edits
 * collapse into one pending job (BullMQ dedup by jobId within the window).
 */
export async function enqueueIndexDoc(
	relPath: string,
	reason = "index",
): Promise<Job<IndexDocJobData>> {
	const slug = relPath.replace(/\.mdx?$/, "")
	return getQueue().add(
		"index-doc",
		{ relPath, reason },
		{
			jobId: `doc__${slug}`,
			removeOnComplete: 1000,
			removeOnFail: 5000,
			attempts: 3,
			backoff: { type: "exponential", delay: 2000 },
		},
	)
}

/** Enqueue a full-corpus reindex (used by the git-sync hook). */
export async function enqueueFullIndex(
	reason = "reindex",
): Promise<Job<IndexAllJobData>> {
	return getQueue().add(
		"index-all",
		{ reason },
		{
			jobId: `full__${Date.now()}`,
			removeOnComplete: 100,
			removeOnFail: 1000,
			attempts: 1,
		},
	)
}
