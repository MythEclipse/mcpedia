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
 * ## WHY AN OMITTED FIELD IS PRESERVED, NOT RESET TO ITS DEFAULT
 *
 * `upsertSection({ id: "writeups", hidden: true })` must hide writeups WITHOUT
 * blanking its curated label, icon and description — the same reason the seed is
 * ON CONFLICT DO NOTHING. An upsert that treated "omitted" as "set to default"
 * would make every single-field edit a full overwrite, and the damage is silent:
 * the response echoes the row, the caller sees a success, and a curated
 * description is quietly gone. That is not hypothetical — it happened here, to
 * writeups, the first time a partial upsert ran against the live database.
 *
 * The resolution is in `merge` below: the use case reads the stored row and lays
 * the provided fields over it, defaulting only for a section that does not exist
 * yet. The repository stays a plain INSERT ... ON CONFLICT writer with no
 * knowledge of which fields were meant to change.
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

/**
 * Resolve an upsert against the row that is already stored.
 *
 * ## WHY THIS READS BEFORE IT WRITES
 *
 * An omitted field means "leave it alone", not "reset it to the default". Every
 * edit the API and the MCP server expose is partial — `upsert({id, hidden:true})`
 * is how a section is hidden — so treating a missing field as its default makes
 * each single-field edit a full overwrite. The failure is silent: the caller gets
 * a 200 with the row echoed back, and a curated label, icon or description is
 * gone. Observed on the live database, by a partial upsert that only meant to
 * unhide a section and instead stripped its icon and description.
 *
 * Defaults still apply to a section that does NOT exist yet, because there is
 * nothing to preserve — registering a section stays a one-argument operation,
 * `upsert({id:"threat-intel"})`.
 *
 * `explicit` distinguishes a field the caller sent as `undefined` from one they
 * sent as `""` or `false`: `hidden: false` must unhide, while an absent `hidden`
 * must keep the current value. Reading it off the raw input rather than off the
 * normalized record is what makes that distinction survive.
 */
function merge(
	existing: SectionRecord | undefined,
	input: {
		id: string
		label?: string
		icon?: string
		desc?: string
		sortOrder?: number
		hidden?: boolean
	},
): SectionRecord {
	// normalize() applies the id validation and the fallbacks for a NEW row; its
	// defaults are then overridden below by whatever the stored row holds.
	const base = normalize(input)
	if (!existing) return base
	return {
		id: base.id,
		label: existing.label,
		icon: existing.icon,
		desc: existing.desc,
		sortOrder: existing.sortOrder,
		hidden: existing.hidden,
		// Applied last so a provided value always wins.
		...pickProvided(input),
	}
}

/**
 * The fields the caller actually sent, with blanks resolved.
 *
 * A blank string is treated as absent rather than as an instruction to erase:
 * `label: ""` would otherwise blank a curated name, and the id is the only field
 * where the empty string has a meaning (an invalid one).
 */
function pickProvided(input: {
	label?: string
	icon?: string
	desc?: string
	sortOrder?: number
	hidden?: boolean
}): Partial<SectionRecord> {
	const provided: Partial<SectionRecord> = {}
	if (input.label?.trim()) provided.label = input.label.trim()
	if (input.icon?.trim()) provided.icon = input.icon.trim()
	if (input.desc !== undefined) provided.desc = input.desc.trim()
	if (input.sortOrder !== undefined) provided.sortOrder = input.sortOrder
	if (input.hidden !== undefined) provided.hidden = input.hidden
	return provided
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
		// The existing row is read here rather than merged inside the repository's
		// INSERT ... ON CONFLICT, because the merge has to distinguish `hidden:
		// false` from an absent `hidden` — and by the time the statement is built,
		// normalize() has already replaced both with a value. See `merge`.
		//
		// One extra SELECT per write. These are operator actions, not page loads,
		// so the round trip is not on any hot path.
		const id = (input.id || "").toLowerCase().trim()
		const existing = (await documents.listRegistry()).find((r) => r.id === id)
		return documents.upsertSection(merge(existing, input))
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
