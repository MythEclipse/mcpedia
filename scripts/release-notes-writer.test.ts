/**
 * Tests for the semantic-release `writeReleaseNotes` cap.
 *
 * ## WHY THIS EXISTS
 *
 * The writer protects against a release body that GitHub refuses outright
 * (125,000-character maximum). It had no test, and the truncation branch was
 * wrong in a way that only fires on the FIRST release of a repository — the one
 * release a project gets, and the one nobody can afford to have fail.
 *
 * The bug: it sliced the body on blank-line-separated "sections". Generated
 * notes are a few headings, each followed by an arbitrarily long bullet list,
 * and consecutive bullets have NO blank line between them — so a 1,600-entry
 * list counted as ONE section. The code kept whole sections until the budget ran
 * out, and its own safety net ("always keep at least the first section") then
 * returned a 140 KB body as the single word `### Features`. Measured: 89
 * characters of output, every commit dropped, and the cap technically honoured.
 *
 * So these tests assert BEHAVIOUR on realistic shapes rather than the size
 * arithmetic alone: that the output fits, AND that it still contains content.
 * A test checking only `out.length <= LIMIT` passes on the broken version, which
 * is exactly how the bug survived.
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const writeReleaseNotes = require(
	join(REPO, "scripts/release-notes-writer.cjs"),
) as (context: { nextRelease?: { notes?: string } }, options: unknown) => string

/** The cap this writer enforces; GitHub's own maximum is 125,000. */
const LIMIT = 120000
/** The limit GitHub actually validates the body against. */
const GITHUB_MAX = 125000

function notes(over: { notes?: string } = {}) {
	return { nextRelease: over }
}

/** A commit entry, as the generator emits it. */
function bullet(i: number): string {
	return `* commit ${i}: ${"x".repeat(60)} (abc123${i})`
}

function bulletList(n: number): string {
	return Array.from({ length: n }, (_, i) => bullet(i)).join("\n")
}

describe("writeReleaseNotes", () => {
	test("returns the generator's text untouched when it is under the cap", () => {
		// Byte-identical matters: the built-in writer's output is what a normal
		// release should show, and this plugin should be invisible for it.
		const text = "### Features\n\n* a thing (abc1234)\n"
		expect(writeReleaseNotes(notes({ notes: text }), {})).toBe(text)
	})

	test("returns an empty string when there are no notes", () => {
		expect(writeReleaseNotes(notes(), {})).toBe("")
		expect(writeReleaseNotes(notes({ notes: "" }), {})).toBe("")
	})

	test("caps a first release whose Features list is one huge section", () => {
		// The exact shape that broke it. Before the fix this returned 89
		// characters — the heading and nothing else — so the length assertion
		// here is NOT what catches the regression; the content assertion is.
		const text = `### Features\n\n${bulletList(1600)}\n\n### Bug Fixes\n\n* one fix (def5678)`
		const out = writeReleaseNotes(notes({ notes: text }), {})

		expect(out.length).toBeLessThanOrEqual(LIMIT)
		expect(out.length).toBeLessThanOrEqual(GITHUB_MAX)
		expect(out).toContain("earlier changes omitted")

		// The point: the body still says something. Count the commits that
		// survived rather than eyeballing the length.
		const survivors = out.match(/^\* commit \d+/gm)?.length ?? 0
		expect(survivors).toBeGreaterThan(1000)
	})

	test("caps a body built from many small sections", () => {
		const text = Array.from(
			{ length: 4000 },
			(_, i) => `### Section ${i}\n\n* item ${i} (abc${i})`,
		).join("\n\n")
		const out = writeReleaseNotes(notes({ notes: text }), {})
		expect(out.length).toBeLessThanOrEqual(LIMIT)
		expect(out.match(/^\* item \d+/gm)?.length ?? 0).toBeGreaterThan(1000)
	})

	test("caps a body that is one pathological line", () => {
		// Commit subjects are never this long, but the notes are derived from
		// commit messages. Keeping such a line whole would return a body that
		// still fails GitHub's validation — a cap that does not cap.
		const out = writeReleaseNotes(notes({ notes: "y".repeat(300000) }), {})
		expect(out.length).toBeLessThanOrEqual(LIMIT)
		expect(out).toContain("earlier changes omitted")
	})

	test("stays within the cap across the boundary", () => {
		// A sweep, because the failure mode is an off-by-one in the suffix
		// accounting: `\n\n` + MARKER + `\n` is MARKER.length + 3, and trimming
		// by one character less left the output over LIMIT by exactly 1.
		for (const n of [
			LIMIT - 1,
			LIMIT,
			LIMIT + 1,
			LIMIT + 2,
			LIMIT + 50,
			LIMIT * 2,
		]) {
			const out = writeReleaseNotes(notes({ notes: "a".repeat(n) }), {})
			expect(
				out.length,
				`input of ${n} chars produced ${out.length}`,
			).toBeLessThanOrEqual(LIMIT)
		}
	})

	test("only appends the elision marker when something was actually dropped", () => {
		// A marker saying "earlier changes omitted" on a body that omitted
		// nothing is a lie in the one place a reader is looking for the rest of
		// the history.
		const exact = writeReleaseNotes(notes({ notes: "z".repeat(LIMIT) }), {})
		expect(exact.length).toBe(LIMIT)
		expect(exact).not.toContain("earlier changes omitted")

		const over = writeReleaseNotes(notes({ notes: "z".repeat(LIMIT + 1) }), {})
		expect(over).toContain("earlier changes omitted")
	})
})
