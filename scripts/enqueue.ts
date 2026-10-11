import { enqueueIndexDoc, enqueueFullIndex } from "@mcpedia/queue"

// One-shot enqueue helper (no worker required to schedule work).
// Usage:
//   bun run enqueue --all                 # full reindex
//   bun run enqueue docs/websocket/contract  # single doc (slug or rel path)
async function main() {
	const arg = process.argv[2]
	if (!arg || arg === "--all") {
		const job = await enqueueFullIndex("manual")
		console.log(`enqueued full reindex job ${job.id}`)
	} else {
		const relPath =
			arg.endsWith(".md") || arg.endsWith(".mdx") ? arg : `${arg}.md`
		const job = await enqueueIndexDoc(relPath, "manual")
		console.log(`enqueued doc reindex job ${job.id} -> ${relPath}`)
	}
	await new Promise((r) => setTimeout(r, 500)) // allow the event loop to flush
	process.exit(0)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
