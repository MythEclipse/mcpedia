/**
 * Adapters for the on-disk markdown mirror and the parser.
 *
 * These are thin on purpose. Their value is that they exist as named,
 * swappable pieces: a use case takes `mirror`, so a test can substitute a
 * `vi.fn()` and assert the CALL (was the backup attempted? did it fail
 * harmlessly?) rather than the effect.
 *
 * The third port that lived here — chunking and embedding — is GONE. hindsight
 * chunks and embeds internally, so `IndexingPort` is now implemented in
 * `hindsight.ts`. The deletion took `@mcpedia/embeddings` with it.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { CONTENT_ROOT } from "@mcpedia/config"
import { parseFile, stringifyFile } from "@mcpedia/parser"
import type { ContentMirror, ContentParser } from "../domain"

/**
 * The on-disk markdown mirror.
 *
 * The database is the source of truth and these files are backups, so nothing
 * here is allowed to be load-bearing. Every caller wraps these calls; this
 * module does not swallow errors itself, because a caller that wants to log the
 * failure needs to see it.
 */
export const contentMirror: ContentMirror = {
	async write({ relPath, meta, body }) {
		stringifyFile(join(CONTENT_ROOT, relPath), relPath, meta, body)
	},
	async remove(relPath: string): Promise<boolean> {
		const abs = join(CONTENT_ROOT, relPath)
		if (!existsSync(abs)) return false
		unlinkSync(abs)
		return true
	},
	async read(relPath: string): Promise<string> {
		return readFileSync(join(CONTENT_ROOT, relPath), "utf8")
	},
}

/**
 * The parser port.
 *
 * `parseFile` takes (absPath, relPath) and reads the file itself — verified in
 * packages/parser/src/index.ts line 40; there is no raw-text overload. So this
 * adapter ignores the `raw` the use case already holds and lets the parser read
 * the file, which is exactly what the indexer did before this refactor.
 *
 * The alternative (a `parseRaw(raw, relPath)` overload on @mcpedia/parser) would
 * remove the second disk read, but @mcpedia/parser is outside this task's scope.
 * The port still earns its place: a use-case test supplies a stub parser and
 * never touches the disk.
 */
export const contentParser: ContentParser = {
	parse({ relPath }) {
		return parseFile(join(CONTENT_ROOT, relPath), relPath)
	},
}
