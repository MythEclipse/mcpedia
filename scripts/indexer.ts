import { runFullIndex } from "@mcpedia/core"

// Phase 3: the indexer now goes through `runFullIndex`, the single indexing
// entry point shared with the BullMQ worker and the git-sync hook. It parses
// each content file, upserts `documents`, chunks+embeds, and snapshots a
// revision when the body changed.
async function main() {
	const reason = process.argv[2]?.startsWith("--reason=")
		? process.argv[2].slice("--reason=".length)
		: "index"
	await runFullIndex(reason)
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
