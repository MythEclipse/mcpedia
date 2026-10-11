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
 */
export function sectionIdsFrom(
	sections: ReadonlyArray<SectionInfo | null | undefined>,
): string[] {
	const ids = (sections ?? [])
		.map((s) => s?.id)
		.filter((id): id is string => typeof id === "string" && id.length > 0)
	return Array.from(new Set(ids))
}
