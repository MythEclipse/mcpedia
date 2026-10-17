import { titleCaseSection } from "@mcpedia/config/sections"
import { describe, expect, test } from "vitest"
import type { DocSummary } from "./shape"
import {
	buildFolderTree,
	byUpdatedDesc,
	countBySection,
	customFieldEntries,
	customFieldLabel,
	docsInSection,
	exportTargetSlug,
	extractToc,
	folderContents,
	isExportPath,
	joinSlug,
	mostRecent,
	normalizeSearchHits,
	parseSearchMode,
	readingTime,
	sectionMeta,
	sectionsOrDefaults,
	slugToTitle,
	sortTree,
	toDocSummary,
} from "./shape"

/** A document with only the fields the shapers read. */
function doc(slug: string, over: Partial<DocSummary> = {}): DocSummary {
	return {
		slug,
		title: slug.split("/").pop() ?? slug,
		section: slug.split("/")[0] ?? "docs",
		tags: [],
		updatedAt: "2026-01-01T00:00:00.000Z",
		...over,
	}
}

describe("slugToTitle", () => {
	test("title-cases hyphen and underscore segments", () => {
		expect(slugToTitle("getting-started")).toBe("Getting Started")
		expect(slugToTitle("a_b_c")).toBe("A B C")
		expect(slugToTitle("already")).toBe("Already")
	})

	test("drops empty segments rather than emitting stray spaces", () => {
		expect(slugToTitle("double--dash")).toBe("Double  Dash")
		expect(slugToTitle("")).toBe("")
	})
})

describe("toDocSummary", () => {
	test("keeps only the fields a card renders", () => {
		const summary = toDocSummary({
			...doc("docs/a"),
			body: "# body",
			extraFields: { points: 100 },
		} as never)
		expect(summary).toEqual({
			slug: "docs/a",
			title: "a",
			section: "docs",
			tags: [],
			updatedAt: "2026-01-01T00:00:00.000Z",
		})
		expect("body" in summary).toBe(false)
		expect("extraFields" in summary).toBe(false)
	})

	test("tolerates a document with no tags array", () => {
		const summary = toDocSummary({ ...doc("docs/a"), tags: undefined } as never)
		expect(summary.tags).toEqual([])
	})
})

describe("mostRecent / byUpdatedDesc", () => {
	const docs = [
		doc("docs/a", { updatedAt: "2026-01-01T00:00:00.000Z" }),
		doc("docs/b", { updatedAt: "2026-03-01T00:00:00.000Z" }),
		doc("docs/c", { updatedAt: "2026-02-01T00:00:00.000Z" }),
	]

	test("mostRecent sorts newest first and applies the limit", () => {
		expect(mostRecent(docs, 2).map((d) => d.slug)).toEqual(["docs/b", "docs/c"])
	})

	test("mostRecent defaults to six", () => {
		expect(mostRecent(docs)).toHaveLength(3)
	})

	test("neither mutates its input", () => {
		const before = docs.map((d) => d.slug)
		mostRecent(docs)
		byUpdatedDesc(docs)
		expect(docs.map((d) => d.slug)).toEqual(before)
	})

	test("an unparseable date sorts last rather than throwing", () => {
		const mixed = [doc("docs/bad", { updatedAt: "not-a-date" }), ...docs]
		expect(() => byUpdatedDesc(mixed)).not.toThrow()
		expect(byUpdatedDesc(mixed).map((d) => d.slug)).toContain("docs/bad")
	})
})

describe("buildFolderTree", () => {
	test("nests by slug and gives leaves the document title", () => {
		const tree = buildFolderTree(
			[doc("docs/setup/install/linux", { title: "Install on Linux" })],
			"docs",
		)

		expect(tree).toHaveLength(1)
		expect(tree[0]).toMatchObject({
			name: "setup",
			slug: "docs/setup",
			title: "Setup",
			isLeaf: false,
			docCount: 1,
		})

		// Positional reads use `?.` so a missing entry still fails the assertion
		// below (vitest reports `undefined` against the expected object) instead
		// of throwing a raw TypeError that hides which fixture broke.
		const install = tree[0]?.children[0]
		expect(install).toMatchObject({
			name: "install",
			slug: "docs/setup/install",
		})

		const leaf = install?.children[0]
		expect(leaf).toMatchObject({
			name: "linux",
			slug: "docs/setup/install/linux",
			title: "Install on Linux",
			isLeaf: true,
		})
	})

	test("a folder's docCount is the number of documents at or below it", () => {
		const tree = buildFolderTree(
			[
				doc("docs/a/one"),
				doc("docs/a/two"),
				doc("docs/a/deep/three"),
				doc("docs/b/four"),
			],
			"docs",
		)
		const a = tree.find((n) => n.name === "a")!
		expect(a.docCount).toBe(3)
		expect(a.children.find((c) => c.name === "deep")!.docCount).toBe(1)
	})

	test("a top-level document is a leaf at the root", () => {
		const tree = buildFolderTree(
			[doc("docs/intro", { title: "Intro" })],
			"docs",
		)
		expect(tree[0]).toMatchObject({
			name: "intro",
			isLeaf: true,
			title: "Intro",
			docCount: 1,
		})
	})

	test("folders sort before files, then alphabetically", () => {
		const tree = buildFolderTree(
			[doc("docs/zebra"), doc("docs/alpha/one"), doc("docs/beta/two")],
			"docs",
		)
		// alpha and beta are folders (they have children), zebra is a file.
		expect(tree.map((n) => n.name)).toEqual(["alpha", "beta", "zebra"])
	})

	test("two documents under the same folder share one node", () => {
		const tree = buildFolderTree(
			[doc("docs/guide/a"), doc("docs/guide/b")],
			"docs",
		)
		expect(tree).toHaveLength(1)
		expect(tree[0]?.children).toHaveLength(2)
	})

	test("an empty input yields an empty tree", () => {
		expect(buildFolderTree([], "docs")).toEqual([])
	})
})

describe("sortTree", () => {
	test("does not mutate the array it is given", () => {
		const nodes = buildFolderTree(
			[doc("docs/zebra"), doc("docs/alpha")],
			"docs",
		)
		const before = nodes.map((n) => n.name)
		sortTree(nodes)
		expect(nodes.map((n) => n.name)).toEqual(before)
	})
})

describe("docsInSection / countBySection", () => {
	const docs = [
		doc("docs/a", { section: "docs" }),
		doc("notes/b", { section: "notes" }),
		doc("docs/c", { section: "DOCS" }),
	]

	test("matches case-insensitively, as the Next pages did", () => {
		expect(docsInSection(docs, "docs").map((d) => d.slug)).toEqual([
			"docs/a",
			"docs/c",
		])
	})

	test("a document with no section counts as docs", () => {
		const orphan = [doc("docs/x", { section: "" })]
		expect(docsInSection(orphan, "docs")).toHaveLength(1)
	})

	test("countBySection keys by lowercased section", () => {
		expect([...countBySection(docs).entries()]).toEqual([
			["docs", 2],
			["notes", 1],
		])
	})
})

describe("folderContents", () => {
	const docs = [
		doc("docs/setup/install"),
		doc("docs/setup/linux"),
		doc("docs/setup/deep/nested"),
		doc("docs/setup/deep/other"),
		doc("docs/setup/deeper/x"),
		doc("docs/other/thing"),
	]

	test("splits immediate folders from immediate documents", () => {
		const { folders, documents } = folderContents(docs, "docs/setup")
		expect(documents.map((d) => d.slug)).toEqual([
			"docs/setup/install",
			"docs/setup/linux",
		])
		expect(folders).toEqual([
			{ name: "deep", docCount: 2 },
			{ name: "deeper", docCount: 1 },
		])
	})

	test("counts every descendant of a subfolder, not just its direct children", () => {
		const { folders } = folderContents(docs, "docs/setup")
		const deep = folders.find((f) => f.name === "deep")!
		expect(deep.docCount).toBe(2)
	})

	test("a path with no matches returns empty lists rather than throwing", () => {
		expect(folderContents(docs, "docs/nothing-here")).toEqual({
			folders: [],
			documents: [],
		})
	})

	test("an empty corpus yields empty lists", () => {
		expect(folderContents([], "docs/setup")).toEqual({
			folders: [],
			documents: [],
		})
	})
})

describe("joinSlug", () => {
	test("joins section and remainder", () => {
		expect(joinSlug("docs", "setup/install")).toBe("docs/setup/install")
	})

	test("collapses duplicate and trailing slashes", () => {
		expect(joinSlug("docs", "/setup//install/")).toBe("docs/setup/install")
		expect(joinSlug("docs", "")).toBe("docs")
		expect(joinSlug("docs", "/")).toBe("docs")
		expect(joinSlug("docs")).toBe("docs")
	})
})

describe("isExportPath / exportTargetSlug", () => {
	test("recognises the bare section export", () => {
		expect(isExportPath("export", undefined)).toBe(true)
	})

	test("recognises a trailing export segment", () => {
		expect(isExportPath("docs", "export")).toBe(true)
		expect(isExportPath("docs", "setup/install/export")).toBe(true)
		expect(isExportPath("docs", "setup/export/")).toBe(true)
	})

	test("does not mistake a folder merely named export-like for the view", () => {
		expect(isExportPath("docs", "exports")).toBe(false)
		expect(isExportPath("docs", undefined)).toBe(false)
		expect(isExportPath("docs", "setup/install")).toBe(false)
	})

	test("exportTargetSlug drops the trailing export segment", () => {
		expect(exportTargetSlug("docs", "setup/install/export")).toBe(
			"docs/setup/install",
		)
		expect(exportTargetSlug("docs", "export")).toBe("docs")
	})

	test("the section-only export view has no document target", () => {
		expect(exportTargetSlug("export", undefined)).toBeUndefined()
	})
})

describe("readingTime", () => {
	test("rounds up at 200 words per minute", () => {
		expect(readingTime("word ".repeat(200))).toBe("1 min read")
		expect(readingTime("word ".repeat(201))).toBe("2 min read")
		expect(readingTime("word ".repeat(600))).toBe("3 min read")
	})

	test("an empty body is a zero-minute read, not NaN", () => {
		expect(readingTime("")).toBe("0 min read")
		expect(readingTime("   \n\t  ")).toBe("0 min read")
	})
})

describe("parseSearchMode", () => {
	test("accepts the three real modes", () => {
		expect(parseSearchMode("keyword")).toBe("keyword")
		expect(parseSearchMode("semantic")).toBe("semantic")
		expect(parseSearchMode("hybrid")).toBe("hybrid")
	})

	test("falls back to hybrid for anything else", () => {
		expect(parseSearchMode(undefined)).toBe("hybrid")
		expect(parseSearchMode(null)).toBe("hybrid")
		expect(parseSearchMode("nonsense")).toBe("hybrid")
		expect(parseSearchMode("")).toBe("hybrid")
	})
})

describe("normalizeSearchHits", () => {
	// The signature lost its `mode` argument. There used to be two upstream
	// shapes — a document hit for keyword/hybrid, a chunk hit for semantic —
	// and the mode decided which normalizer ran. hindsight returns facts and the
	// API maps every one of them back to its document, so there is one shape now
	// and one normalizer for it. These tests therefore assert that every mode's
	// payload takes the SAME path, which is the property that replaced the branch.
	test("a document hit reads its fields off `doc`", () => {
		const [hit] = normalizeSearchHits([
			{
				doc: { slug: "docs/a", title: "A", section: "docs" },
				rank: 0.5,
				snippet: "<mark>x</mark>",
			},
		])
		expect(hit).toEqual({
			slug: "docs/a",
			title: "A",
			section: "docs",
			score: 0.5,
			snippet: "<mark>x</mark>",
		})
	})

	test("rank maps to score unchanged", () => {
		const [hit] = normalizeSearchHits([
			{
				doc: { slug: "ctf/b", title: "B", section: "ctf" },
				rank: 0.9,
				snippet: "s",
			},
		])
		// `hit` is possibly undefined under `noUncheckedIndexedAccess`. Comparing
		// against `undefined` when it is, and failing, is the same signal the
		// previous code gave by throwing.
		expect(hit?.score).toBe(0.9)
		expect(hit?.slug).toBe("ctf/b")
	})

	test("a fact whose slug was resolved server-side keeps the real title", () => {
		// The OLD semantic path derived the title from the slug ("pwn" from
		// "ctf/heap/pwn") because a chunk carried no document record. hindsight
		// hands back a fact and the API joins it to its document, so the real
		// title arrives. This pins that the fallback is genuinely gone: a hit
		// whose slug is "ctf/heap/pwn" and whose title is "Heap Exploitation"
		// must report the latter.
		const [hit] = normalizeSearchHits([
			{
				doc: {
					slug: "ctf/heap/pwn",
					title: "Heap Exploitation",
					section: "ctf",
				},
				rank: 0.7,
				snippet: "a whole fact, not a headline passage",
			},
		])
		expect(hit?.title).toBe("Heap Exploitation")
		expect(hit?.section).toBe("ctf")
		expect(hit?.snippet).toBe("a whole fact, not a headline passage")
	})

	test("a non-array response yields no hits instead of throwing", () => {
		expect(normalizeSearchHits(null)).toEqual([])
		expect(normalizeSearchHits(undefined)).toEqual([])
		expect(normalizeSearchHits({ error: "boom" })).toEqual([])
	})

	test("an empty array yields an empty array", () => {
		expect(normalizeSearchHits([])).toEqual([])
	})
})

describe("extractToc", () => {
	test("takes h2 and h3 but not h1 or h4", () => {
		const source = [
			"# Title",
			"## Two",
			"### Three",
			"#### Four",
			"not a heading",
		].join("\n")
		expect(extractToc(source).map((e) => [e.text, e.level])).toEqual([
			["Two", 2],
			["Three", 3],
		])
	})

	test("strips closing hashes (closed ATX)", () => {
		expect(extractToc("## Closed ##")[0]?.text).toBe("Closed")
	})

	test("requires whitespace after the hashes, so #hashtag is not a heading", () => {
		expect(extractToc("##nospace")).toEqual([])
	})

	test("assigns distinct ids to repeated headings", () => {
		const ids = extractToc("## Setup\n## Setup\n## Setup").map((e) => e.id)
		expect(new Set(ids).size).toBe(3)
	})

	test("an empty body yields no entries", () => {
		expect(extractToc("")).toEqual([])
	})
})

describe("sectionsOrDefaults", () => {
	test("prefers the live list when it has entries", () => {
		const live = [
			{ id: "docs", label: "Live", icon: "X", desc: "", docCount: 3 },
		]
		expect(sectionsOrDefaults(live)[0]?.label).toBe("Live")
	})

	test("returns an EMPTY list when the API has not answered yet", () => {
		// This used to return a hardcoded four-section registry, which meant the
		// header advertised sections no document could belong to and disagreed
		// with the database. Section names are content now, so the honest answer
		// to "we do not know yet" is nothing — not an invented guess.
		expect(sectionsOrDefaults([])).toEqual([])
		expect(sectionsOrDefaults(undefined)).toEqual([])
	})
})

describe("sectionMeta", () => {
	test("prefers the live entry", () => {
		const live = [
			{ id: "docs", label: "Live Docs", icon: "★", desc: "", docCount: 1 },
		]
		expect(sectionMeta("docs", live).label).toBe("Live Docs")
	})

	test("derives the label when there is no live entry", () => {
		// It used to find "CTF" in a hardcoded preset table. That table is gone:
		// the curated label lives in the `sections` table and arrives via the
		// live list, so without it the id is title-cased.
		expect(sectionMeta("ctf").label).toBe("Ctf")
		expect(
			sectionMeta("ctf", [
				{ id: "ctf", label: "CTF", icon: "🚩", desc: "", docCount: 0 },
			]).label,
		).toBe("CTF")
	})

	test("an unknown section still renders rather than throwing", () => {
		// Mirrors the server's deriveSectionMeta: an unregistered id keeps its
		// slug but gets a humanised label and the folder icon, not a blank tile.
		const info = sectionMeta("brand-new-section")
		expect(info.id).toBe("brand-new-section")
		expect(info.label).toBe("Brand New Section")
		expect(info.icon).toBe("📁")
	})

	test("matches case-insensitively against the live list", () => {
		const live = [
			{ id: "docs", label: "Documentation", icon: "📄", desc: "", docCount: 2 },
		]
		expect(sectionMeta("DOCS", live).label).toBe("Documentation")
	})

	test("a blank section falls back to docs", () => {
		expect(sectionMeta("").id).toBe("docs")
	})

	test("the derivation agrees with @mcpedia/config/sections", () => {
		// Both sides must title-case identically, otherwise the API and the
		// browser would render different headings for the same unregistered
		// section — which is the drift the removed duplication used to cause.
		expect(sectionMeta("ctf-writeups").label).toBe(
			titleCaseSection("ctf-writeups"),
		)
		expect(sectionMeta("docs").icon).toBe("📁")
	})
})

describe("customFieldEntries", () => {
	test("keeps custom fields and drops the standard ones", () => {
		const entries = customFieldEntries({
			title: "Doc",
			body: "# body",
			points: 100,
			solved: true,
			_event: "internal",
		})
		expect(entries.map(([k]) => k)).toEqual(["points", "solved"])
	})

	test("drops empty, null, undefined and underscore-prefixed keys", () => {
		const entries = customFieldEntries({
			empty: "",
			nul: null,
			undef: undefined,
			_private: "x",
			real: "y",
		})
		expect(entries.map(([k]) => k)).toEqual(["real"])
	})

	test("returns nothing when a document has only standard fields", () => {
		expect(
			customFieldEntries({ id: "1", slug: "docs/a", title: "A", tags: [] }),
		).toEqual([])
	})
})

describe("customFieldLabel", () => {
	test("capitalises the first letter and humanises underscores", () => {
		expect(customFieldLabel("event_name")).toBe("Event name")
		expect(customFieldLabel("points")).toBe("Points")
		expect(customFieldLabel("")).toBe("")
	})
})
