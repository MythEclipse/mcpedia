/**
 * Section registry use cases: register, rename, unregister.
 *
 * ## WHY THIS IS SEPARATE FROM read.use-cases.ts
 *
 * Reads and writes have different callers and different failure modes. The read
 * (`makeListSections`) runs on every page load and must never fail on missing
 * data; a write is an operator action that MUST fail loudly on bad input —
 * a silently-ignored rename is worse than an error, because the operator sees
 * their edit "succeed" and the old label keeps rendering.
 *
 * ## WHY UNREGISTER DOES NOT TOUCH DOCUMENTS
 *
 * `documents.section` is a plain text column, not a foreign key to `sections`.
 * That is deliberate and this use case is where it pays off: deleting a registry
 * row removes a NAME, not content. The section's documents stay readable at
 * their URLs and render with a derived label (`deriveSectionMeta`). Deleting
 * documents would have to be its own explicit, per-document operation.
 *
 * This asymmetry is the whole reason the table exists rather than the labels
 * being a NOT NULL column on documents: a section needs metadata BEFORE it has
 * documents (so a fresh install is navigable), and can outlive its documents.
 */

import type { DocumentRepository, SectionRecord } from "../domain"
import { badRequest } from "../domain"

export interface SectionDeps {
	documents: Pick<
		DocumentRepository,
		"listRegistry" | "upsertSection" | "removeSection"
	>
}

/**
 * Section ids are URL path segments (a document slug is `<section>/<rest>`), so
 * the id is constrained to what can appear in a slug unescaped.
 *
 * Enforced here rather than only in the zod schema at the API boundary: the MCP
 * server is a second entry point to this same use case, and a validation rule
 * that lives only in one of two callers is a rule the other one does not have.
 * A section id of "a/b" would make every document in it unreachable, which is
 * the kind of thing that should fail at the write rather than at the read.
 */
const SECTION_ID = /^[a-z0-9][a-z0-9-_]*$/

function normalize(input: {
	id: string
	label?: string
	icon?: string
	desc?: string
	sortOrder?: number
	hidden?: boolean
}): SectionRecord {
	const id = (input.id || "").toLowerCase().trim()
	if (!SECTION_ID.test(id)) {
		throw badRequest(
			`Invalid section id "${input.id}": use lowercase letters, digits, "-" and "_" only (it becomes a URL path segment).`,
		)
	}
	// A label is required to be non-empty when provided, and defaults to the
	// title-cased id when omitted — so registering a section is one argument and
	// renaming it cannot accidentally blank the name.
	const providedLabel = input.label?.trim()
	return {
		id,
		label: providedLabel || titleCase(id),
		icon: input.icon?.trim() || "📁",
		desc: input.desc?.trim() ?? "",
		sortOrder: input.sortOrder ?? 1000,
		hidden: input.hidden ?? false,
	}
}

/** "ctf-writeups" -> "Ctf Writeups". Mirrors the reader's fallback. */
function titleCase(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")
}

/** Register a section, or update one that exists. */
export function makeUpsertSection(deps: SectionDeps) {
	const { documents } = deps
	return async function upsertSection(input: {
		id: string
		label?: string
		icon?: string
		desc?: string
		sortOrder?: number
		hidden?: boolean
	}): Promise<SectionRecord> {
		return documents.upsertSection(normalize(input))
	}
}

/**
 * Unregister a section — its metadata row only.
 *
 * Returns `{ deleted }` rather than throwing when the id is unknown: a delete
 * that is already done is not an error, and making the caller distinguish
 * "removed" from "was never there" would force a read before every delete to
 * avoid a spurious failure. The boolean is there for the caller that cares.
 */
export function makeRemoveSection(deps: SectionDeps) {
	const { documents } = deps
	return async function removeSection(
		id: string,
	): Promise<{ deleted: boolean }> {
		const clean = (id || "").toLowerCase().trim()
		if (!clean) {
			throw badRequest("A section id is required.")
		}
		return documents.removeSection(clean)
	}
}

/** Every registry row, in nav order, hidden ones included. */
export function makeListRegistry(deps: SectionDeps) {
	const { documents } = deps
	return async function listRegistry(): Promise<SectionRecord[]> {
		return documents.listRegistry()
	}
}
