/**
 * Path classification and slug validation — pure domain logic.
 *
 * ## WHY THIS IS A DOMAIN MODULE AND NOT INFRASTRUCTURE
 *
 * These three functions decide what a URL means. They read no database, no
 * filesystem and no configuration, they take every input as an argument, and
 * they return the same answer for the same inputs in any process. That is the
 * definition of domain logic, and it is why they are the FIRST thing moved into
 * the hexagonal layout: everything else in this package reaches for the network
 * or the disk, but this cannot, so it is safe to depend on from any layer.
 *
 * ## MOVED VERBATIM
 *
 * `validateSlug`, `slugToRelPath`, `extractFoldersForSection` and `classifyPath`
 * are byte-for-byte the implementations that lived in the former
 * `src/document.service.ts`, minus their module-private visibility. Not one
 * character of a branch, a regex, a default or a comment inside them changed.
 * They are load-bearing and already covered; a "cleaned up" rewrite here would
 * be a silent behaviour change dressed up as refactoring, and slug validation is
 * exactly the kind of code where a well-meaning edit is a path-traversal bug.
 *
 * The one thing that DID change is `slugToRelPath`, which previously took
 * `DocSection` and now takes `string`. Those are the same type — `DocSection` is
 * declared as an alias for `string` in @mcpedia/types — so this is a widening
 * with no runtime effect, made so the domain layer can stand alone without
 * importing a package that will later be re-exported through this layer.
 */
import { badRequest } from "./errors"

/**
 * Validate that a slug is safe (no path traversal, only [a-z0-9/_-]).
 *
 * This is the security boundary for anything that becomes a file path: it is
 * what stops `../../etc/passwd` from reaching `slugToRelPath`. Keep it strict,
 * and keep it in the domain layer where a reviewer can see it without following
 * a database import to find it.
 *
 * A rejection throws `badRequest` rather than a bare Error, so the transport
 * reports a caller mistake as 400 instead of as a server fault. The message text
 * is unchanged from the original bare throw, which is what keeps every existing
 * assertion on `invalid slug` valid.
 */
export function validateSlug(slug: string): string {
	if (!/^[a-z0-9][a-z0-9/_-]*$/.test(slug)) {
		throw badRequest(`invalid slug: ${slug}`)
	}
	if (slug.includes("//"))
		throw badRequest(`invalid slug (double slash): ${slug}`)
	return slug
}

/** Compute the relative file path for a slug. */
export function slugToRelPath(section: string, slug: string): string {
	const cleanSlug = validateSlug(slug)
	const pathPart = cleanSlug.startsWith(`${section}/`)
		? cleanSlug.slice(section.length + 1)
		: cleanSlug
	return `${section}/${pathPart}.md`
}

/**
 * Extract the folder structure for a given section from a list of document slugs/paths.
 */
export function extractFoldersForSection(
	docSlugs: string[],
	section: string,
): string[] {
	const folders = new Set<string>()
	const base = `${section}/`
	const cleanSlugs = docSlugs.map((s) => s.replace(/\.md$/, ""))

	for (const slug of cleanSlugs) {
		if (!slug.startsWith(base)) continue
		const rel = slug.slice(base.length)
		const parts = rel.split("/")

		let acc = ""
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i] ?? ""
			acc = acc ? `${acc}/${part}` : part
			folders.add(acc)
		}
	}

	return [...folders].sort()
}

/**
 * Determine if a path represents a folder or a leaf document.
 */
export function classifyPath(
	docSlugs: string[],
	path: string,
): "doc" | "folder" | "none" {
	const cleanPath = path.replace(/\.md$/, "")
	const cleanSlugs = docSlugs.map((s) => s.replace(/\.md$/, ""))

	// Check leaf doc match
	if (cleanSlugs.includes(cleanPath)) return "doc"

	// Check folder parent match
	const prefix = `${cleanPath}/`
	if (cleanSlugs.some((s) => s.startsWith(prefix))) return "folder"

	return "none"
}
