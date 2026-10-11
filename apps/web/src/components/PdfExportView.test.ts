import { describe, expect, it } from "vitest"
import { exportFilename, printableExtraFields } from "./PdfExportView"

describe("printableExtraFields", () => {
	it("drops keys already rendered as a labelled field", () => {
		// category/points/difficulty have their own labelled spans above; printing
		// them again would show "Category: Web" twice on every challenge.
		expect(
			printableExtraFields({
				category: "Web",
				points: 500,
				difficulty: "Easy",
				solved: true,
				author: "asepharyana",
			}),
		).toEqual([])
	})

	it("drops empty values, which render as a label with nothing after it", () => {
		expect(
			printableExtraFields({ flag: "", note: null, other: undefined }),
		).toEqual([])
	})

	it("matches the skip list case-insensitively", () => {
		// The Next filter lowercased the key before testing it, so `Category`
		// (a very common frontmatter casing) was skipped too.
		expect(printableExtraFields({ Category: "Web", Points: "100" })).toEqual([])
	})

	it("keeps genuinely extra fields and stringifies them", () => {
		// `event` and `solved` are on the original skip list (verified against
		// app/components/PdfExportView.tsx) even though they are not rendered as
		// a labelled field above — that asymmetry is the ported behaviour, not
		// an oversight, so it is pinned here rather than quietly "fixed".
		expect(
			printableExtraFields({
				event: "GEMASTIK 2026",
				round: 2,
				flag: "CTF{ok}",
			}),
		).toEqual([
			{ key: "round", value: "2" },
			{ key: "flag", value: "CTF{ok}" },
		])
	})

	it("preserves falsy-but-meaningful values", () => {
		// `0` is real frontmatter; a truthiness check would eat it. (`false` is
		// skipped, but because `solved` is on the skip list, not because it is
		// falsy — see the test below.)
		expect(printableExtraFields({ round: 0, sla: false })).toEqual([
			{ key: "round", value: "0" },
			{ key: "sla", value: "false" },
		])
	})

	it("skips `solved` because it is named, not because it is falsy", () => {
		// Pinning this separately so the falsy-value test above cannot be
		// "passed" by a truthiness filter that happens to drop `solved` anyway.
		expect(printableExtraFields({ solved: false })).toEqual([])
		expect(printableExtraFields({ solved: true })).toEqual([])
	})

	it("handles an absent extraFields map", () => {
		expect(printableExtraFields({})).toEqual([])
	})
})

describe("exportFilename", () => {
	it("slugifies the title", () => {
		expect(exportFilename("GEMASTIK 2026 Warmup")).toBe("gemastik-2026-warmup")
	})

	it("collapses runs of separators and trims the edges", () => {
		expect(exportFilename("  --Hello___World--  ")).toBe("hello-world")
	})

	it("falls back rather than producing a dotfile", () => {
		// A title made entirely of stripped characters would otherwise yield
		// ".md", which browsers treat as a hidden dotfile and may refuse to save.
		expect(exportFilename("!!!")).toBe("export")
		expect(exportFilename("")).toBe("export")
		expect(exportFilename("---")).toBe("export")
	})

	it("honours an explicit fallback", () => {
		expect(exportFilename("", "mcpedia-export")).toBe("mcpedia-export")
	})
})
