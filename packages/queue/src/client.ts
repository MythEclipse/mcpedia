import { QUEUE_PREFIX, REDIS_PASSWORD, REDIS_URL } from "@mcpedia/config"
import IORedis, { type RedisOptions } from "ioredis"

/**
 * Shared ioredis connection for BullMQ. BullMQ requires an ioredis instance and
 * internally duplicates it for blocking commands, so we keep the option objects
 * explicit (maxRetriesPerRequest: null is REQUIRED for the blocking
 * connection — a finite retry count causes "Connection in key mode" errors).
 */
function buildOptions(): RedisOptions {
	const opts: RedisOptions = {
		maxRetriesPerRequest: null,
		lazyConnect: true,
		enableOfflineQueue: true,
	}
	if (REDIS_PASSWORD) opts.password = REDIS_PASSWORD
	return opts
}

let _connection: IORedis | null = null

/** Lazily-created singleton ioredis connection. */
export function getConnection(): IORedis {
	if (!_connection) {
		_connection = new IORedis(REDIS_URL, buildOptions())
		_connection.on("error", (err) => {
			// Log but don't crash the process on transient Redis errors.
			console.error("[queue] redis error:", err.message)
		})
	}
	return _connection
}

export const BULLMQ_PREFIX = QUEUE_PREFIX
