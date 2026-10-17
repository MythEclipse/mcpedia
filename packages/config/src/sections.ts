/**
 * Dynamic Section Registry & Metadata Generator.
 * Safe for client and server components.
 *
 * ## THIS FILE IS NO LONGER THE SOURCE OF TRUTH
 *
 * It used to BE the registry: `SECTION_PRESETS` was consulted at runtime by the
 * API (to decorate section counts), by the export (to title a PDF), and by the
 * web app (which could not import this module and so re-declared the whole table
 * in apps/web/src/lib/shape.ts). Three consumers, two copies of the same nine
 * labels, and a test whose only job was to keep the copies equal.
 *
 * Section metadata is CONTENT and now lives in the `sections` table
 * (packages/db/src/schema.ts), read through the API. What remains here is the
 * two things that are still genuinely code:
 *
 *   1. {@link SectionConfig} and {@link titleCaseSection} — a pure derivation any
 *      layer may use to render an id that has no registry row.
 *   2. {@link DEFAULT_SECTION_IDS} — the ids a fresh install starts with, used by
 *      the create form to offer sensible choices. The LABELS for those ids are
 *      seeded into the table (packages/db/src/seed-sections.ts); they are not
 *      here, because a name that lives in two places drifts in one of them.
 *
 * An empty corpus is no longer answered from this file. It is answered from the
 * table, which is why registering a section makes it appear on a database with
 * zero documents.
 */
export interface SectionConfig {
	id: string
	label: string
	icon: string
	desc: string
}

/**
 * Title-case a section id for display: "ctf-writeups" -> "Ctf Writeups".
 *
 * The single derivation used wherever a section has no registry row: the API's
 * reader, the export summary and the web bundle all need it. It takes only the
 * id, so it stays pure and importable anywhere — including the browser, which is
 * what the old hardcoded table could not be.
 */
export function titleCaseSection(id: string): string {
	const label = (id || "docs")
		.toLowerCase()
		.trim()
		.split(/[-_]/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")
	return label || "Custom Section"
}

/**
 * A section's display metadata, derived from its id alone.
 *
 * The generic glyph and blurb are deliberate: a curated icon or description only
 * comes from the registry, and inventing something section-specific here would
 * make an unregistered section indistinguishable from one someone curated.
 */
export function getSectionMeta(id: string, _count?: number): SectionConfig {
	const cleanId = (id || "docs").toLowerCase().trim()
	return {
		id: cleanId,
		label: titleCaseSection(cleanId),
		icon: "📁",
		desc: `Documents in the ${titleCaseSection(cleanId)} section.`,
	}
}

/**
 * The section ids a fresh install offers in the create form.
 *
 * IDS ONLY. The labels and icons for these live in the seed
 * (packages/db/src/seed-sections.ts) and are read from the database — that is
 * what stops this list and the table disagreeing about what "docs" is called.
 *
 * Kept in step with SECTION_SEED by a test in packages/db, because these two
 * lists answer the same question from opposite sides: this one is what a NEW
 * document may be filed under, and the seed is what the nav shows.
 */
export const DEFAULT_SECTION_IDS: readonly string[] = ["docs", "ctf", "notes"]

/**
 * Every seeded section id. A document may legitimately live in any of them.
 *
 * Same three as the default list: the extra six presets (`writeups`, `research`,
 * `guides`, `tutorials`, `api`, `projects`) were removed when the base was
 * consolidated — `writeups` folded into `ctf`, and the other five never held a
 * document. A document can still be created in ANY section id; this list only
 * names the ones the app knows to offer.
 */
export const SECTION_IDS: readonly string[] = ["docs", "ctf", "notes"]
