import { startWorker } from "@mcpedia/queue/worker"

// Keep the process alive: the worker listens on the BullMQ queue until a
// SIGINT/SIGTERM closes it (handled inside startWorker).
const worker = await startWorker()

// Heartbeat so the supervisor/operator can see liveness without scraping logs.
const heartbeat = setInterval(() => {
	console.log(`[worker] alive, ${worker.name} queue="${worker.name}"`)
}, 30_000)

worker.on("closed", () => clearInterval(heartbeat))
