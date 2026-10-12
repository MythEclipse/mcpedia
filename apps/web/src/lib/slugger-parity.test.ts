import GithubSlugger from "github-slugger"
import { expect, test } from "vitest"
import { extractToc, headingSlug } from "./shape"

/**
 * The TOC has to agree with rehype-slug about anchor ids, and rehype-slug uses
 * github-slugger. shape.ts inlines that algorithm (rather than importing
 * github-slugger) to keep it a pure function; this test is what makes the
 * inlining trustworthy — it runs the real github-slugger over a corpus of
 * awkward headings and demands identical ids.
 */
const CASES = [
	"Getting Started",
	"Install",
	"What's inside the box?",
	"API Reference",
	"Monorepo Layout",
	"100% Coverage",
	"Deploy — to production",
	"café & crème",
	"Multiple   Spaces",
	"Trailing punctuation??",
	"UPPER CASE",
	"snake_case_heading",
	"a/b",
]

test("inlined slugger matches github-slugger exactly", () => {
	for (const text of CASES) {
		const expected = new GithubSlugger().slug(text)
		expect(headingSlug(text, new Set()), `case: ${text}`).toBe(expected)
	}
})

test("duplicate headings get the same suffixes rehype-slug produces", () => {
	const body = ["## Setup", "## Setup", "## Setup"].join("\n")
	// The real slugger is the reference: run it over the same sequence.
	const reference = new GithubSlugger()
	const expected = ["## Setup", "## Setup", "## Setup"].map((line) =>
		reference.slug(line.replace(/^##\s+/, "").trim()),
	)
	expect(extractToc(body).map((e) => e.id)).toEqual(expected)
})
