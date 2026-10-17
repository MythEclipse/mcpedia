/**
 * Section-list shaping for the create route.
 *
 * A LEAF MODULE ON PURPOSE. It holds no component and imports nothing — not
 * even the `#/…` alias — because the root vitest config runs without that alias
 * (it is declared in apps/web/vite.config.ts, and vitest.config.mts is shared
 * with the rest of the monorepo and outside this task's write scope). A pure
 * function that a test can import without dragging in the whole React tree is
 * worth this much structure: `sectionIdsFrom` is the only real logic in the
 * loader, and it has to be testable.
 */
import type { SectionInfo } from "./api-client"

/** The section whose folder tree is fetched first, on entry to /create. */
export const DEFAULT_SECTION = "docs"

/**
 * Pull the section ids out of documents.sections.
 *
 * Tolerates malformed entries rather than throwing: this runs inside a route
 * loader, and one bad record must not take the whole page down. Duplicates are
 * collapsed (the API's sections and the form's built-in defaults overlap
 * heavily) and API order is preserved, since the datalist is built in that
 * order and a stable list avoids the dropdown reshuffling between renders.
 *
 * Returns ONLY what the API reported. The form merges its own built-in id list
 * on top (see doc-form.tsx), which is the right place for it: this function's
 * job is describing the payload, and appending guesses here would make
 * "the section list" mean two different things depending on the caller. Section
 * LABELS are no longer part of this at all — they come from the `sections`
 * table via documents.sections.
 */
export function sectionIdsFrom(
	sections: ReadonlyArray<SectionInfo | null | undefined>,
): string[] {
	const ids = (sections ?? [])
		.map((s) => s?.id)
		.filter((id): id is string => typeof id === "string" && id.length > 0)
	return Array.from(new Set(ids))
}

/**
 * A section shortcut as the command palette renders it.
 *
 * Structurally what CommandMenu's QuickAction looks like minus the lucide
 * component, which is deliberately NOT part of this type: a section's badge is
 * an emoji GLYPH from the database, so nothing about a section row depends on
 * what this bundle imports. That is what makes it reasonable to build here, in a
 * module with no React in it.
 */
export interface PaletteSection {
	id: string
	title: string
	subtitle: string
	href: string
	glyph: string
}

/**
 * Turn the live section list into palette shortcuts.
 *
 * CommandMenu used to hold three of these as literals — "Documentation Hub" ->
 * /docs, "CTF & Writeups Directory" -> /writeups, "Research & Benchmarks" ->
 * /research, each with a hand-written blurb. Section names are content now, so
 * those literals were a second source of truth: registering a section did not
 * add a row, renaming one changed the header nav and not the palette, and
 * deleting one left a shortcut pointing at a URL with no registry row behind it.
 *
 * Hidden sections need no filtering here. documents.sections already omits them
 * server-side, and SectionInfo carries no flag to re-check — filtering again
 * would be a claim about the payload this function cannot verify.
 *
 * An empty list is returned for an undefined payload rather than a built-in
 * default set: a palette advertising sections that do not exist is worse than
 * one showing only the application's own routes.
 */
export function paletteSectionsFrom(
	sections: ReadonlyArray<SectionInfo | null | undefined> | undefined,
): PaletteSection[] {
	return (sections ?? [])
		.filter((s): s is SectionInfo => Boolean(s?.id))
		.map((s) => ({
			id: `section-${s.id}`,
			title: s.label,
			// A section registered through MCP may carry no description at all.
			// An empty subtitle line reads as a rendering bug, so the live doc
			// count stands in — it is real data, not a placeholder.
			subtitle:
				s.desc || `${s.docCount} document${s.docCount === 1 ? "" : "s"}`,
			href: `/${s.id}`,
			glyph: s.icon,
		}))
}
