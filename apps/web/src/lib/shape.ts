/**
 * Data shaping between the oRPC API and the view models the pages render.
 *
 * Everything here is a pure function over data that already crossed the wire.
 * That is deliberate: the Next pages did this work inline in server components
 * (and one folder-tree algorithm was copy-pasted three times with small
 * differences). Moving it here makes the differences explicit and — more
 * usefully — testable without a database, a router, or a React tree.
 *
 * These are the shapes the components consume. They deliberately keep the
 * field names the components already used, so no component body changed.
 */
import type { DocumentMeta, SectionInfo } from "@mcpedia/types"

/** A document link, as the cards and lists render it. */
export interface DocSummary {
	slug: string
	title: string
	section: string
	tags: string[]
	updatedAt: string
}

/** One node of a slug-derived folder tree. */
export interface TreeNode {
	/** The raw slug segment, e.g. "getting-started". */
	name: string
	/** Full slug from the section root, e.g. "docs/setup/getting-started". */
	slug: string
	/** Human label: the document title for a leaf, a title-cased segment otherwise. */
	title: string
	children: TreeNode[]
	/** True only when this node IS a document (not merely a folder that contains one). */
	isLeaf: boolean
	/** Documents at or below this node. */
	docCount: number
}

/** "getting-started" -> "Getting Started". Also turns "a_b" into "A B". */
export function slugToTitle(segment: string): string {
	return segment
		.split(/[-_]/)
		.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
		.join(" ")
}

/** Only the fields the card components read. Drops `body` and `extraFields`. */
export function toDocSummary(doc: DocumentMeta): DocSummary {
	return {
		slug: doc.slug,
		title: doc.title,
		section: doc.section,
		tags: doc.tags ?? [],
		updatedAt: doc.updatedAt,
	}
}

/** The six most recently updated documents, newest first. */
export function mostRecent(docs: DocSummary[], limit = 6): DocSummary[] {
	return [...docs]
		.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		)
		.slice(0, limit)
}

/** Newest-first ordering, used by the section list. */
export function byUpdatedDesc(docs: DocSummary[]): DocSummary[] {
	return [...docs].sort(
		(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
	)
}

/**
 * Build a folder tree for one section from its documents.
 *
 * The slug `docs/setup/install/linux` yields nested nodes, each carrying the
 * full slug from the section root so a node can be linked directly. Folder
 * nodes get a title-cased segment as their label; leaf nodes get the document
 * title.
 *
 * `docCount` is the number of documents at or below a node, which is what the
 * sidebar and the folder-page header both display.
 */
export function buildFolderTree(
	docs: DocSummary[],
	section: string,
): TreeNode[] {
	const root: TreeNode[] = []

	for (const doc of docs) {
		const parts = doc.slug.split("/")
		let current = root

		// Start at 1: parts[0] is the section itself, which every slug shares and
		// which the section page already renders above the tree.
		for (let i = 1; i < parts.length; i++) {
			const part = parts[i]
			const isLeaf = i === parts.length - 1

			let node = current.find((n) => n.name === part)
			if (!node) {
				node = {
					name: part,
					slug: parts.slice(0, i + 1).join("/"),
					title: "",
					children: [],
					isLeaf: false,
					docCount: 0,
				}
				current.push(node)
			}

			if (isLeaf) {
				node.isLeaf = true
				node.title = doc.title
			} else if (!node.title) {
				node.title = slugToTitle(part)
			}
			current = node.children
		}
	}

	countDocs(root)
	return sortTree(root)
}

/** Recursively set docCount = documents at or below each node. */
function countDocs(nodes: TreeNode[]): number {
	let total = 0
	for (const node of nodes) {
		// A leaf is one document; a folder is the sum of its children.
		const below =
			node.isLeaf && node.children.length === 0 ? 1 : countDocs(node.children)
		node.docCount = below
		total += below
	}
	return total
}

/** Folders before files, then alphabetical by label — the sidebar's ordering. */
export function sortTree(nodes: TreeNode[]): TreeNode[] {
	const sorted = [...nodes].sort((a, b) => {
		const aFolder = a.children.length > 0 ? 0 : 1
		const bFolder = b.children.length > 0 ? 0 : 1
		if (aFolder !== bFolder) return aFolder - bFolder
		return (a.title || a.name).localeCompare(b.title || b.name)
	})
	for (const node of sorted) sortTree(node.children)
	return sorted
}

/** Documents whose section matches, case-insensitively. */
export function docsInSection(
	docs: DocSummary[],
	section: string,
): DocSummary[] {
	const needle = section.toLowerCase()
	return docs.filter((d) => (d.section || "docs").toLowerCase() === needle)
}

/** How many documents each section holds, keyed by section id. */
export function countBySection(docs: DocSummary[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const doc of docs) {
		const id = (doc.section || "docs").toLowerCase()
		counts.set(id, (counts.get(id) ?? 0) + 1)
	}
	return counts
}

/**
 * The section list to show when the API returns nothing.
 *
 * The API's documents.sections reflects sections that actually have published
 * documents. On a cold or empty database that is an empty list, which would
 * render a header with no navigation at all — so fall back to the static
 * registry, exactly as the Next header did.
 */
export function sectionsOrDefaults(
	live: SectionInfo[] | undefined,
): SectionInfo[] {
	return live && live.length > 0 ? live : DEFAULT_SECTIONS_FALLBACK
}

/**
 * Mirrors DEFAULT_SECTIONS from @mcpedia/config/sections, re-declared rather
 * than imported so this module keeps its dependency on TYPES only.
 *
 * The duplication is deliberate and pinned: shape.test.ts compares this list
 * against the real export by id, label and icon. That test earns its keep — it
 * caught this list drifting to nine entries when the registry only defines four,
 * which would have rendered five section tiles that no document could ever
 * belong to.
 */
export const DEFAULT_SECTIONS_FALLBACK: SectionInfo[] = [
	{ id: "docs", label: "Documentation", icon: "📄", desc: "", docCount: 0 },
	{ id: "writeups", label: "Writeups", icon: "📝", desc: "", docCount: 0 },
	{ id: "research", label: "Research", icon: "🔬", desc: "", docCount: 0 },
	{ id: "notes", label: "Notes", icon: "📌", desc: "", docCount: 0 },
]

/**
 * Every preset, not just the four in DEFAULT_SECTIONS.
 *
 * The section list and the section page both need a label for any section id
 * that appears in a document, and a knowledge base can legitimately hold
 * documents under "ctf" or "guides" even though those are not in the four-entry
 * default header nav. Mirrors SECTION_PRESETS in @mcpedia/config/sections —
 * shape.test.ts asserts this matches it entry for entry.
 */
export const SECTION_PRESETS: Record<
	string,
	{ label: string; icon: string; desc: string }
> = {
	docs: {
		label: "Documentation",
		icon: "📄",
		desc: "Setup guides, API references, and protocol specs.",
	},
	writeups: {
		label: "Writeups",
		icon: "📝",
		desc: "Post-mortems, CTF writeups, debugging stories, and case studies.",
	},
	research: {
		label: "Research",
		icon: "🔬",
		desc: "Deep-dive analysis, architecture notes, and experiments.",
	},
	notes: {
		label: "Notes",
		icon: "📌",
		desc: "Quick references, patterns, and cheat-sheets.",
	},
	guides: {
		label: "Guides",
		icon: "🧭",
		desc: "Step-by-step guides and implementation walkthroughs.",
	},
	tutorials: {
		label: "Tutorials",
		icon: "🎓",
		desc: "Educational lessons and practical tutorials.",
	},
	ctf: {
		label: "CTF",
		icon: "🚩",
		desc: "Capture The Flag challenge writeups and exploit solutions.",
	},
	api: {
		label: "API",
		icon: "⚡",
		desc: "API documentation and endpoint definitions.",
	},
	projects: {
		label: "Projects",
		icon: "🚀",
		desc: "Project overviews and technical architecture roadmaps.",
	},
}

/**
 * The section's own label/icon/desc, from the live list or the presets.
 *
 * `live` is optional because most call sites are cards deep in a component tree
 * with no section list to hand; they get the preset table, which is the same
 * source the Next components used via getSectionMeta.
 *
 * Unknown ids are title-cased rather than dropped, matching getSectionMeta: the
 * API accepts any section string, so a document in an unregistered section still
 * has to render a heading.
 */
export function sectionMeta(
	section: string,
	live?: SectionInfo[],
): SectionInfo {
	const id = (section || "docs").toLowerCase().trim()
	const found = (live ?? []).find((s) => s.id.toLowerCase() === id)
	if (found) return found
	const preset = SECTION_PRESETS[id]
	if (preset) return { id, ...preset, docCount: 0 }
	return {
		id,
		label: slugToTitle(id) || "Custom Section",
		icon: "📁",
		desc: `Documents in the ${slugToTitle(id) || id} section.`,
		docCount: 0,
	}
}

/**
 * One level of a folder's contents: the documents directly inside it and the
 * subfolders beside them, with a count for each subfolder.
 *
 * This is what the section's nested folder view renders. It works off the slug
 * prefix rather than a separately-fetched tree, so it stays correct for
 * arbitrarily deep slugs without the API having to hand back a nested structure.
 */
export interface FolderContents {
	folders: { name: string; docCount: number }[]
	documents: DocSummary[]
}

/** Split a folder prefix into its immediate subfolders and direct documents. */
export function folderContents(
	docs: DocSummary[],
	folderSlug: string,
): FolderContents {
	const prefix = `${folderSlug}/`
	const folders = new Map<string, number>()
	const documents: DocSummary[] = []

	for (const doc of docs) {
		if (!doc.slug.startsWith(prefix)) continue
		const rel = doc.slug.slice(prefix.length)
		const parts = rel.split("/")
		if (parts.length === 1) {
			documents.push(doc)
		} else {
			folders.set(parts[0], (folders.get(parts[0]) ?? 0) + 1)
		}
	}

	return {
		folders: [...folders.entries()]
			.map(([name, docCount]) => ({ name, docCount }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		documents,
	}
}

/** Search modes, matching the three procedures the API exposes. */
export type SearchMode = "hybrid" | "keyword" | "semantic"

export const SEARCH_MODES: { id: SearchMode; label: string; desc: string }[] = [
	{
		id: "hybrid",
		label: "Hybrid (RRF)",
		desc: "Reciprocal Rank Fusion (FTS + Vector)",
	},
	{ id: "keyword", label: "Keyword (FTS)", desc: "PostgreSQL GIN tsvector" },
	{
		id: "semantic",
		label: "Semantic Vector",
		desc: "Cosine Similarity Embeddings",
	},
]

/** A single search result, normalised across the three search shapes. */
export interface SearchResult {
	slug: string
	title: string
	section: string
	score: number
	/**
	 * Already sanitised by Postgres `ts_headline` on the server for keyword and
	 * hybrid hits, and a plain substring for semantic hits. Rendered with
	 * dangerouslySetInnerHTML because <mark> highlighting is the point.
	 */
	snippet: string
}

/**
 * The keyword/hybrid shape: a full DocumentMeta plus a rank and a headline.
 *
 * `doc` is a plain object on the wire rather than a class instance, but the
 * serializer emits the same fields, so reading it directly is safe.
 */
function fromDocumentHit(hit: {
	doc: { slug: string; title: string; section: string }
	rank: number
	snippet: string
}): SearchResult {
	return {
		slug: hit.doc.slug,
		title: hit.doc.title,
		section: hit.doc.section,
		score: hit.rank,
		snippet: hit.snippet,
	}
}

/**
 * The semantic shape: a chunk hit, which carries no document record.
 *
 * Title and section are therefore derived from the slug, which is what the old
 * /api/search route did too — a semantic hit on a chunk has no better source.
 */
function fromChunkHit(hit: {
	slug: string
	content: string
	score: number
}): SearchResult {
	const parts = hit.slug.split("/")
	return {
		slug: hit.slug,
		title: parts[parts.length - 1] ?? hit.slug,
		section: parts[0] ?? "docs",
		score: hit.score,
		snippet: hit.content.slice(0, 160),
	}
}

/**
 * Normalise a raw search response for the mode that produced it.
 *
 * Kept as one function so the page never branches on mode to read fields: the
 * two upstream shapes are genuinely different (a document vs a chunk), and
 * conflating them here means the result list has exactly one shape to render.
 */
export function normalizeSearchHits(
	mode: SearchMode,
	hits: unknown,
): SearchResult[] {
	if (!Array.isArray(hits)) return []
	if (mode === "semantic") {
		return hits.map(fromChunkHit)
	}
	return hits.map(fromDocumentHit)
}

/** Parse a `mode` search param, defaulting to hybrid for anything unrecognised. */
export function parseSearchMode(raw: string | undefined | null): SearchMode {
	if (raw === "keyword" || raw === "semantic" || raw === "hybrid") return raw
	return "hybrid"
}

/** Reading time at 200 words per minute, rounded up. */
export function readingTime(body: string): string {
	const words = body.trim().split(/\s+/).filter(Boolean).length
	return `${Math.ceil(words / 200)} min read`
}

/**
 * The URL-safe slug for a path under the section segment.
 *
 * The Next version joined route params with "/"; TanStack hands the splat over
 * as one string, so the pieces are split and rejoined here. Collapses the
 * duplicate slashes a trailing path segment can produce.
 */
export function joinSlug(section: string, rest?: string): string {
	if (!rest) return section
	const cleaned = rest.split("/").filter(Boolean).join("/")
	return cleaned ? `${section}/${cleaned}` : section
}

/**
 * Whether a splat path is the section's export view.
 *
 * `/:section/export` and `/:section/<anything>/export` are both export views —
 * the PDF component lives under the section segment in the Next tree.
 */
export function isExportPath(section: string, splat?: string): boolean {
	if (section === "export") return true
	if (!splat) return false
	return splat.split("/").filter(Boolean).pop() === "export"
}

/**
 * The slug an export path is exporting.
 *
 * `/:docs/export` means "everything in the docs section", so once the trailing
 * `export` is dropped the section itself is the target. `/:docs/setup/export`
 * means the setup folder, which is `docs/setup`. Returns undefined only for the
 * bare `/export` route, which has no section to export.
 */
export function exportTargetSlug(
	section: string,
	splat?: string,
): string | undefined {
	if (section === "export") return undefined
	const segments = (splat ?? "").split("/").filter(Boolean)
	if (segments[segments.length - 1] === "export") segments.pop()
	// Nothing left after dropping `export`: the section IS the scope.
	return joinSlug(section, segments.join("/"))
}

/** Heading id for a TOC entry, derived from its text. */
export function headingSlug(text: string, taken: Set<string>): string {
	const base = githubSlug(text)
	// rehype-slug appends -1, -2, ... for repeats; mirror that so TOC anchors
	// point at the element the renderer actually produced.
	if (!taken.has(base)) {
		taken.add(base)
		return base
	}
	let n = 1
	while (taken.has(`${base}-${n}`)) n++
	const id = `${base}-${n}`
	taken.add(id)
	return id
}

/**
 * github-slugger's algorithm, inlined.
 *
 * github-slugger is already a dependency and Markdown.tsx still imports it, so
 * this only exists to keep the TOC and the renderer in agreement about what an
 * anchor id looks like without a runtime dependency in a pure function. The
 * cases that matter — duplicates, punctuation, diacritics — are pinned in
 * toc-entries.test.ts against the real github-slugger.
 */
/**
 * github-slugger's algorithm, inlined.
 *
 * Markdown.tsx still pulls the real github-slugger in via rehype-slug, so this
 * exists only to keep anchor-id generation a pure function with no runtime
 * dependency. It is not taken on trust: slugger-parity.test.ts runs the real
 * github-slugger over a corpus of awkward headings and demands identical ids,
 * which is what makes the TOC's anchors land on the headings rehype-slug
 * actually rendered.
 *
 * Built with `new RegExp` rather than written as a literal for two reasons: the
 * character class contains a backtick, which a literal at this position reads
 * as opening a template literal, and the \uXXXX ranges stay legible instead of
 * being silently rendered as the characters themselves.
 */
const SLUG_PUNCTUATION = new RegExp(
	"[\\u2000-\\u206F\\u2E00-\\u2E7F\\\\'!\"#$%&()*+,./:;<=>?@\\[\\]^`{|}~]",
	"g",
)

const SLUG_WHITESPACE = /\s/g

function githubSlug(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(SLUG_PUNCTUATION, "")
		.replace(SLUG_WHITESPACE, "-")
}
/** One entry of the rendered table of contents. */
export interface TocEntry {
	id: string
	text: string
	level: number
}

/**
 * Extract `##` and `###` headings from a markdown body, in document order.
 *
 * The regex is the one the Next TOC used: leading 2-3 hashes, trailing hashes
 * stripped (closed ATX style), and no h1 — h1 is the page title, which the
 * layout already renders above the body.
 */
export function extractToc(source: string): TocEntry[] {
	const taken = new Set<string>()
	const entries: TocEntry[] = []
	for (const line of source.split("\n")) {
		const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/)
		if (!m) continue
		const text = m[2].trim()
		entries.push({ id: headingSlug(text, taken), text, level: m[1].length })
	}
	return entries
}

/** Field names every Document carries; anything else is a custom badge. */
export const STANDARD_DOC_KEYS: ReadonlySet<string> = new Set([
	"id",
	"slug",
	"title",
	"type",
	"section",
	"status",
	"author",
	"tags",
	"path",
	"createdAt",
	"updatedAt",
	"extraFields",
	"body",
])

/**
 * The custom frontmatter fields worth showing as a badge.
 *
 * CTF documents carry event/challenge/category/difficulty/points in
 * frontmatter, and the Next page surfaced them. Empty, null and underscore-
 * prefixed keys are dropped — the underscore convention marks internal fields.
 */
export function customFieldEntries(
	doc: Record<string, unknown>,
	standard: ReadonlySet<string> = STANDARD_DOC_KEYS,
): [string, unknown][] {
	return Object.entries(doc).filter(
		([k, v]) =>
			!standard.has(k) &&
			v !== undefined &&
			v !== null &&
			v !== "" &&
			!k.startsWith("_"),
	)
}

/** The label shown for a custom field: "event_name" -> "Event name". */
export function customFieldLabel(key: string): string {
	return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")
}
