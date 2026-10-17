/**
 * Re-retain every stored document into the current hindsight bank.
 *
 * ## WHY THIS EXISTS
 *
 * A document's facts live in whichever bank it was indexed into, and the bank is
 * named by `HINDSIGHT_BANK_ID`. Repointing that variable — as happened when
 * production moved onto the shared `hermes-gemini` bank — leaves the new bank
 * holding nothing while the table still lists every document. Search then
 * returns nothing and nothing reports an error, because the documents are
 * present in the source of truth and absent from the index.
 *
 * `pnpm run index` cannot fix that on a deploy host: it walks CONTENT_ROOT on
 * disk, and the mirror there may be absent or stale (`content/` is gitignored
 * and only written as a backup). Postgres is authoritative, so this reads the
 * bodies FROM THE DATABASE — see `makeReindexFromStore`, which is where the
 * logic lives; this file is only the CLI wrapper around it.
 *
 * The retain is idempotent on the hindsight side (`document_id` +
 * `update_mode: "replace"`, exactly as the normal write path sends), so running
 * this twice is harmless and a second run repairs an interrupted first one.
 *
 * Usage:
 *   pnpm run reindex:hindsight                # every published document
 *   pnpm run reindex:hindsight -- --all       # published AND draft
 *   pnpm run reindex:hindsight -- --slug=writeups/gemastik-2026/wraith
 */
import { indexingUseCases } from "@mcpedia/core"

async function main() {
	const argv = process.argv.slice(2)
	const includeDrafts = argv.includes("--all")
	const slugArg = argv.find((a) => a.startsWith("--slug="))
	const slugs = slugArg ? [slugArg.slice("--slug=".length)] : undefined

	const { reindexFromStore } = indexingUseCases()

	// `draft` is a separate pass rather than a second status in one query: the
	// repository's export selector takes exactly one status, and a draft's body
	// is deliberately not published — indexing it is how a draft would start
	// appearing in search, so it is opt-in.
	const published = await reindexFromStore(
		slugs ? { slugs } : { status: "published" },
	)
	const drafts =
		includeDrafts && !slugs
			? await reindexFromStore({ status: "draft" })
			: { retained: 0, missing: 0, failed: 0 }

	const retained = published.retained + drafts.retained
	const missing = published.missing + drafts.missing
	const failed = published.failed + drafts.failed

	console.log(`\nretained ${retained}, missing ${missing}, failed ${failed}`)
	if (failed > 0 || missing > 0) process.exitCode = 1
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
