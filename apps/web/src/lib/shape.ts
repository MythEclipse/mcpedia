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
	_section: string,
): TreeNode[] {
	const root: TreeNode[] = []

	for (const doc of docs) {
		const parts = doc.slug.split("/")
		let current = root

		// Start at 1: parts[0] is the section itself, which every slug shares and
		// which the section page already renders above the tree. Iterating the
		// already-sliced tail — rather than reading `parts[i]` under an
		// `i < parts.length` guard — yields each segment as a plain `string`.
		// `noUncheckedIndexedAccess` types a raw index read as `string | undefined`,
		// and defaulting it here would fabricate an empty folder name rather than
		// surface a malformed slug, so the read is eliminated instead of asserted.
		const segments = parts.slice(1)

		for (const [offset, part] of segments.entries()) {
			// Slugs stay rooted at the section, so the slice depth is one more
			// than the offset within the tail.
			const depth = offset + 1
			const isLeaf = offset === segments.length - 1

			// `existing ?? { … }` gives `node` a `TreeNode` type from the start.
			// The previous `let node = find(…); if (!node) { node = … }` was one
			// write away from leaving `node` possibly-undefined, which is what
			// every one of the six reads below inherited.
			const existing = current.find((n) => n.name === part)
			const node: TreeNode = existing ?? {
				name: part,
				slug: parts.slice(0, depth + 1).join("/"),
				title: "",
				children: [],
				isLeaf: false,
				docCount: 0,
			}
			if (!existing) current.push(node)

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
 * ## WHY THIS IS NOW EMPTY RATHER THAN A HARDCODED REGISTRY
 *
 * It used to fall back to a re-declared copy of @mcpedia/config/sections — four
 * sections with hardcoded labels and icons. That copy existed because the
 * browser bundle may not import the config barrel, and it was the second of TWO
 * places the same nine names lived (the other being SECTION_PRESETS in that same
 * config module, itself mirrored here). A rename was a two-file edit and the
 * only thing keeping them equal was a test that policed the duplication.
 *
 * Section names are content and live in the `sections` table now, read through
 * the API. The real fallback for "no API response yet" is not a guess at the
 * names — it is an empty list, which renders a header with no section nav until
 * the request lands. That is honest: showing four section tiles before we know
 * which sections exist is how a fresh deployment came to advertise sections no
 * document could belong to.
 *
 * `live` is returned as-is even when empty, and callers that need at least one
 * entry for layout reasons should handle that case explicitly rather than
 * receive invented data.
 */
export function sectionsOrDefaults(
	live: SectionInfo[] | undefined,
): SectionInfo[] {
	return live ?? []
}

/**
 * Label/icon/desc for a section id with NO entry in the live list.
 *
 * The section page, breadcrumbs and PDF cover need a heading for any section id
 * that appears in a document — including one created in an ad-hoc section via
 * MCP, or one whose registry row was deleted. Title-casing the id is the same
 * rule the server applies (deriveSectionMeta in @mcpedia/core), so the two
 * agree without either importing the other.
 *
 * This is a DERIVATION from the id, not a lookup table: no names are hardcoded
 * here any more, which is the point. A curated label always comes from the
 * database.
 */
function deriveSection(section: string): SectionInfo {
	const id = (section || "docs").toLowerCase().trim()
	const label = id
		.split(/[-_]/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")
	return {
		id,
		label: label || "Custom Section",
		icon: "📁",
		desc: `Documents in the ${label || id} section.`,
		docCount: 0,
	}
}

/**
 * The section's own label/icon/desc, from the live list or derived from the id.
 *
 * `live` is optional because most call sites are cards deep in a component tree
 * with no section list to hand. Those callers used to get a hardcoded
 * SECTION_PRESETS table; now they get the id title-cased, which is exactly what
 * the server returns for a section with no registry row. The consequence to be
 * aware of: a component that renders `sectionMeta(id)` with no live list shows
 * the DERIVED name, so a curated label ("Documentation" for `docs`) only appears
 * where the section list has been fetched. Call sites that show a section
 * heading as part of the page chrome pass the live list (see SectionPage and the
 * document view); decorative ones tolerate the derived name.
 *
 * Unknown ids are title-cased rather than dropped, matching the server's
 * deriveSectionMeta: the API accepts any section string, so a document in an
 * unregistered section still has to render a heading.
 */
export function sectionMeta(
	section: string,
	live?: SectionInfo[],
): SectionInfo {
	const id = (section || "docs").toLowerCase().trim()
	const found = (live ?? []).find((s) => s.id.toLowerCase() === id)
	if (found) return found
	return deriveSection(id)
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
		// The immediate subfolder is everything before the first separator.
		// Slicing on `indexOf` keeps the name a plain `string`: `rel.split("/")[0]`
		// is provably in range (`String#split` never returns an empty array), but
		// `noUncheckedIndexedAccess` still types it `string | undefined` and a
		// `?? ""` default would invent a nameless folder entry in the sidebar.
		const separator = rel.indexOf("/")
		if (separator === -1) {
			documents.push(doc)
		} else {
			const name = rel.slice(0, separator)
			folders.set(name, (folders.get(name) ?? 0) + 1)
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

/**
 * The three modes remain distinct in the API, but they are no longer three
 * algorithms. All three are hindsight's recall against the same bank; what
 * differs is the limit and the caller's intent, so the labels say what actually
 * differs. Claiming "RRF", "tsvector" or "cosine" here was describing a stack
 * that no longer exists.
 */
export const SEARCH_MODES: { id: SearchMode; label: string; desc: string }[] = [
	{
		id: "hybrid",
		label: "Hybrid",
		desc: "hindsight — keyword + semantic, fused score",
	},
	{
		id: "keyword",
		label: "Keyword",
		desc: "hindsight — lexical signal weighted",
	},
	{
		id: "semantic",
		label: "Semantic",
		desc: "hindsight — meaning, not wording",
	},
]

/** A single search result, normalised across the three search shapes. */
export interface SearchResult {
	slug: string
	title: string
	section: string
	score: number
	/**
	 * HTML-safe snippet: every character except the `<mark>` / `</mark>` pair
	 * Postgres inserts around query terms is entity-escaped, so the caller can
	 * render it with dangerouslySetInnerHTML.
	 */
	snippet: string
}

/**
 * Escape a search snippet for innerHTML, preserving only `<mark>`/`</mark>`.
 *
 * This is required, not defensive. Postgres documents that `ts_headline`
 * output is NOT safe for direct inclusion in a web page: it returns excerpts of
 * the original document with some simple XML tags removed, which is not
 * guaranteed to remove all HTML. `keywordSearch` calls it with only
 * `StartSel`/`StopSel` set to `<mark>`, so a document body containing markup
 * reaches the client verbatim and would execute.
 *
 * Escaping here rather than trusting the server keeps the guarantee at the
 * point of use: the value that reaches `dangerouslySetInnerHTML` is safe by
 * construction, whichever search mode produced it. Semantic hits are plain
 * substrings with no `<mark>` at all, and are escaped identically.
 *
 * so the snippet arrives already containing those two tags and nothing else
 * authored by us. Everything else in it is untrusted document text.
 *
 * ## WHY THIS IS NOT A `.replace()` CHAIN
 *
 * The obvious implementation — escape `<`, then escape `&`, then escape `>` —
 * cannot work, and did not. Escaping `>` unconditionally also destroys the `>`
 * of the whitelisted `<mark>` tag itself:
 *
 *     "<mark>x</mark>"
 *       .replace(/<(?!\/?mark>)/g, "&lt;")   // no-op: <mark> is allowed
 *       .replace(/>/g, "&gt;")              // hits BOTH closing brackets
 *     => "<mark&gt;x</mark&gt;"
 *
 * The browser then renders the literal text `<mark>x</mark>` instead of
 * highlighting anything. It is a visible, total loss of the feature the escaping
 * exists to support, and it was caught by a test asserting the snippet shape.
 *
 * The fix is to SPLIT on the whitelisted tags, escape each text segment on its
 * own, and re-attach the tags literally. Each segment therefore contains no tag
 * at all, so a plain three-character escape is both sufficient and correct.
 */
export function sanitizeSnippet(raw: string): string {
	// Split with the delimiters CAPTURED, so the tags survive in the odd-indexed
	// slots and can be re-emitted verbatim.
	const parts = raw.split(/(<\/?mark>)/g)
	return parts
		.map((part, index) =>
			// An odd index is a captured `</mark>`/`<mark>` — emit as-is.
			index % 2 === 1
				? part
				: part
						.replace(
							/&(?!(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g,
							"&amp;",
						)
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;"),
		)
		.join("")
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
		snippet: sanitizeSnippet(hit.snippet),
	}
}

/**
 * Normalise a raw search response.
 *
 * ## WHY THE MODE BRANCH IS GONE
 *
 * There used to be two upstream shapes: a document hit (keyword/hybrid) and a
 * chunk hit (semantic), where a chunk carried no document record and its title
 * had to be guessed from the slug. hindsight returns facts, and this adapter maps
 * every fact back to its document, so all three modes now yield document hits
 * with a real title and section.
 *
 * That means `fromChunkHit` — and with it the "derive the title from the slug"
 * fallback — is deleted rather than left behind as dead code. Keeping a branch
 * for a shape the backend no longer produces would invite someone to keep
 * maintaining a guess that is now wrong for every caller.
 *
 * `fromDocumentHit` sanitises the snippet, and hindsight's snippet is a whole
 * fact rather than a `ts_headline` passage. The `<mark>` highlighting the old
 * stack produced is therefore gone; the shape and the sanitisation are not.
 */
export function normalizeSearchHits(_hits: unknown): SearchResult[] {
	if (!Array.isArray(_hits)) return []
	return _hits.map(fromDocumentHit)
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
const SLUG_PUNCTUATION =
	/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g

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
		// Both groups are mandatory in the pattern (`#{2,3}` and `.+?` are neither
		// optional nor starred), so neither default is reachable. They exist only
		// to satisfy `noUncheckedIndexedAccess`, which types every capture group as
		// `string | undefined` regardless of the pattern that produced it.
		const [, hashes = "", raw = ""] = m
		const text = raw.trim()
		entries.push({ id: headingSlug(text, taken), text, level: hashes.length })
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
