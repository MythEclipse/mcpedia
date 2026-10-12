import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type {
	DocSection,
	DocStatus,
	DocType,
	DocumentMeta,
} from "@mcpedia/types"
import matter from "gray-matter"

// Standard frontmatter keys that are rendered explicitly in the UI template.
// Any other key in frontmatter becomes a dynamic "extra field" badge.
// This makes the system fully content-driven — creators add whatever
// metadata they need (event, challenge, category, difficulty, points, etc.)
// without code changes.
const STANDARD_FRONTMATTER_KEYS = new Set([
	"id",
	"slug",
	"title",
	"type",
	"section",
	"status",
	"author",
	"tags",
	"path",
	"created_at",
	"updated_at",
])

export interface ParsedFile {
	meta: DocumentMeta
	body: string
}

/**
 * Parse a content markdown file into metadata + body.
 * @param absPath absolute path on disk
 * @param relPath path relative to content root (e.g. "docs/websocket/contract.md")
 */
export function parseFile(absPath: string, relPath: string): ParsedFile {
	const raw = readFileSync(absPath, "utf8")
	const { data, content } = matter(raw)

	const parts = relPath.split("/")
	const derivedSection = parts.length > 1 ? (parts[0] ?? "docs") : "docs"
	const section: DocSection =
		typeof data.section === "string" && data.section.trim() !== ""
			? data.section.trim()
			: derivedSection

	const slug = relPath.replace(/\.mdx?$/, "")

	const type = (
		typeof data.type === "string" && data.type.trim() !== ""
			? data.type.trim()
			: "documentation"
	) as DocType
	const status = (data.status === "draft" ? "draft" : "published") as DocStatus

	const tags: string[] = Array.isArray(data.tags)
		? data.tags.map((t: unknown) => String(t))
		: []

	const nowIso = new Date().toISOString()
	const createdAt = data.created_at ?? nowIso
	const updatedAt = data.updated_at ?? data.created_at ?? nowIso

	// Extract any non-standard frontmatter keys as dynamic extra fields.
	// These are stored in DB as JSONB + rendered as dynamic badges in the UI.
	const extraFields: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(data)) {
		if (!STANDARD_FRONTMATTER_KEYS.has(k) && v !== undefined && v !== null) {
			extraFields[k] = v
		}
	}

	const meta: DocumentMeta = {
		id: slug,
		slug,
		title: typeof data.title === "string" ? data.title : slug,
		type,
		section,
		status,
		author: typeof data.author === "string" ? data.author : "",
		tags,
		path: relPath,
		createdAt: String(createdAt),
		updatedAt: String(updatedAt),
		extraFields,
	}

	return { meta, body: content }
}

/**
 * Serialize document metadata + body back to a markdown file with YAML
 * frontmatter. The file is written to `absPath`, creating parent dirs as needed.
 * The `relPath` is stored in frontmatter as `path` so the file is round-trip
 * stable (parseFile → stringifyFile → parseFile yields the same meta+body).
 *
 * @param absPath absolute path on disk
 * @param relPath path relative to content root (e.g. "docs/my/doc.md")
 * @param meta    document metadata
 * @param body    markdown body (frontmatter stripped — same as parseFile.body)
 */
export function stringifyFile(
	absPath: string,
	relPath: string,
	meta: DocumentMeta,
	body: string,
): void {
	const data: Record<string, unknown> = {
		title: meta.title,
		type: meta.type,
		section: meta.section,
		status: meta.status,
		author: meta.author,
		tags: meta.tags,
		path: relPath,
		created_at: meta.createdAt,
		updated_at: meta.updatedAt,
		// Dynamic custom fields — any key the content creator added.
		// These are written as-is to YAML frontmatter, and read back via parseFile
		// into meta.extraFields. Fully content-driven: no code changes needed
		// to support new metadata fields (e.g. CTF: event, challenge, category,
		// difficulty, points, or anything else).
		...(meta.extraFields ?? {}),
	}
	const yaml =
		"---\n" +
		Object.entries(data)
			.map(([k, v]) => {
				if (Array.isArray(v)) {
					return `${k}: [${v.map((x) => `"${x}"`).join(", ")}]`
				}
				if (typeof v === "string") {
					return `${k}: ${JSON.stringify(v)}`
				}
				return `${k}: ${v}`
			})
			.join("\n") +
		"\n---\n"
	const content = yaml + body
	mkdirSync(dirname(absPath), { recursive: true })
	writeFileSync(absPath, content, "utf8")
}
