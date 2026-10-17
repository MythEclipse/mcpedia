import { expect, test } from "vitest"
import { shouldCreateRevision } from "../domain"

/**
 * Unit tests for the revision-dedup decision rule.
 *
 * `shouldCreateRevision` is the pure predicate that `indexContentFile` consults
 * before writing a new row to `document_revisions`. It is extracted because the
 * dedup correctness is the single most important guarantee of the revision
 * system ("metadata-only edits don't bloat history"), and it must hold without
 * a database.
 *
 * The predicate moved to domain/pure.ts during the hexagonal reorg; the rule is
 * byte-for-byte the expression it always was.
 *
 * The DB-backed paths (`snapshotRevision`, `restoreRevision`) are exercised by
 * the use-case tests in this directory with faked repositories, and
 * end-to-end via the indexer. Here we lock the decision invariant in CI.
 */

test("shouldCreateRevision: first snapshot when no prior revision exists", () => {
	// No prior revision row → always snapshot the first version.
	expect(shouldCreateRevision(null, "body text")).toBe(true)
	expect(shouldCreateRevision(undefined, "body text")).toBe(true)
})

test("shouldCreateRevision: identical body creates no new revision (dedup)", () => {
	// The exact dedup rule that prevents metadata-only edits from bloating
	// history: if the body is byte-identical to the latest revision's body,
	// skip the snapshot.
	expect(shouldCreateRevision("same body", "same body")).toBe(false)
	// The dedup rule applies regardless of body length — large identical bodies
	// also skip the snapshot.
	expect(shouldCreateRevision("a".repeat(5000), "a".repeat(5000))).toBe(false)
})

test("shouldCreateRevision: changed body creates a new revision", () => {
	expect(shouldCreateRevision("old body", "new body")).toBe(true)
	// Whitespace / trailing newline changes count as a real body change.
	expect(shouldCreateRevision("body", "body\n")).toBe(true)
})

test("shouldCreateRevision: empty-string vs non-empty counts as a change", () => {
	expect(shouldCreateRevision("", "content")).toBe(true)
	expect(shouldCreateRevision("content", "")).toBe(true)
})

test("snapshotRevision is wired to the predicate, not a private copy of it", async () => {
	// `shouldCreateRevision` was exported, documented and covered by four tests
	// above while NO production code called it — `snapshotRevision` re-implemented
	// the identical rule inline. This asserts the wiring so the tests above
	// cannot go stale the same way again: if a future refactor reintroduces a
	// private copy, the source no longer routes through the predicate.
	//
	// The caller moved with the hexagonal reorg: `snapshotRevision` is now built
	// by makeSnapshotRevision in application/revision.use-cases.ts.
	const { readFileSync } = await import("node:fs")
	const { fileURLToPath } = await import("node:url")
	const path = fileURLToPath(
		new URL("./revision.use-cases.ts", import.meta.url),
	)
	const source = readFileSync(path, "utf8")

	const callsPredicate = /if\s*\(\s*!\s*shouldCreateRevision\(/.test(source)
	expect(callsPredicate).toBe(true)

	// And the old inline duplicate must be gone.
	expect(source).not.toMatch(
		/if\s*\(\s*latest\s*&&\s*latest\.body\s*===\s*body\s*\)/,
	)
})
