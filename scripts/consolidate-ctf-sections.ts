/**
 * ONE-OFF DATA MIGRATION — consolidate every CTF writeup into `ctf`.
 *
 * Replaces two redundant sections: `writeups` (65 docs) and `learn` (7 docs).
 * All 72 documents are CTF material, so they all land in `ctf`.
 *
 * ## WHY THE RENAME IS INSERT -> MOVE CHILDREN -> DELETE
 *
 * `documents.id` IS the slug — it is the PRIMARY KEY — and the two tables that
 * reference it (`document_revisions`, `document_chunks`) are declared
 * `ON DELETE CASCADE ON UPDATE NO ACTION`. `NO ACTION` means Postgres REFUSES a
 * plain `UPDATE documents SET id = ...` while a child row points at the old
 * value, so the obvious one-statement rename cannot work at all. This is the
 * ordering that does:
 *
 *   1. INSERT the new parent rows (old and new coexist briefly),
 *   2. re-point the children at the new ids,
 *   3. DELETE the old parent rows.
 *
 * Revision history is PRESERVED by that order. Re-creating the documents
 * instead (delete + insert) would have cascaded every revision away silently —
 * 153 rows across the two sections.
 *
 * ## WHY `--apply` IS REQUIRED
 *
 * Without it the writes run inside a transaction that is then ROLLED BACK, so
 * the collision checks, the row counts and the orphan check are all real output
 * from the real database. That is the only way to verify a primary-key rewrite
 * against production without performing it.
 *
 * Idempotent: a second run finds no rows in the source sections and no-ops.
 *
 * Usage:
 *   bws-exec mcpedia tsx scripts/consolidate-ctf-sections.ts            # dry run
 *   bws-exec mcpedia tsx scripts/consolidate-ctf-sections.ts --apply    # commit
 */
import { forgetDocument, indexingUseCases } from "@mcpedia/core"
import { client, db } from "@mcpedia/db"
import { sql } from "drizzle-orm"

/** Every writeup lands here. */
const TARGET_SECTION = "ctf"

/** Sections being drained. `learn` has no registry row; `writeups` does. */
const SOURCE_SECTIONS = ["writeups", "learn"] as const

/**
 * Registry rows that are pure nav noise: seeded presets that never received a
 * single document. `docs` is deliberately NOT here — it is the code's default
 * section (`deriveSectionMeta` and the create form both fall back to it).
 * `notes` is kept because it holds a document.
 */
const EMPTY_PRESET_SECTIONS = [
	"research",
	"guides",
	"tutorials",
	"api",
	"projects",
] as const

const APPLY = process.argv.includes("--apply")

/** Thrown to force a rollback in dry-run mode, so `begin()` sees an exit. */
class DryRunRollback extends Error {}

/**
 * Section ids are inlined into SQL as literals rather than passed as array
 * parameters. They are compile-time constants in this file, and the assertion
 * below is what keeps that true if someone edits the lists above.
 */
function literalList(ids: readonly string[]): string {
	for (const id of ids) {
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
			throw new Error(
				`refusing to inline unsafe section id: ${JSON.stringify(id)}`,
			)
		}
	}
	return ids.map((id) => `'${id}'`).join(", ")
}

interface Row {
	id: string
	slug: string
	section: string
}

/** The new slug for a document: swap its first segment for the target. */
function renamedSlug(row: Row): string {
	return `${TARGET_SECTION}/${row.slug.slice(row.section.length + 1)}`
}

/**
 * Verify the invariants that make the rewrite safe.
 *
 * Throws rather than warns on every one of them: each failure would either lose
 * revision history or write a slug nobody can reach, and a warning would let
 * that happen anyway.
 */
function checkPlan(rows: Row[], takenSlugs: Set<string>): string[] {
	const planned = rows.map(renamedSlug)

	for (const [i, row] of rows.entries()) {
		if (!row.slug.startsWith(`${row.section}/`)) {
			throw new Error(
				`slug does not start with its own section: ${row.slug} (section=${row.section})`,
			)
		}
		if (!(planned[i] ?? "").trim()) {
			throw new Error(`plan produced an empty slug for ${row.slug}`)
		}
	}

	const dupes = [...new Set(planned.filter((s, i) => planned.indexOf(s) !== i))]
	if (dupes.length > 0) {
		throw new Error(`plan produces duplicate slugs: ${dupes.join(", ")}`)
	}

	// `documents.slug` is UNIQUE, so a collision would abort mid-transaction.
	// Checking first turns that into a readable message.
	const collisions = planned.filter((s) => takenSlugs.has(s))
	if (collisions.length > 0) {
		throw new Error(`target slugs already exist: ${collisions.join(", ")}`)
	}

	return planned
}

async function main() {
	const sources = literalList(SOURCE_SECTIONS)

	const rows = (await db.execute(
		sql.raw(
			`select id, slug, section from documents where section in (${sources}) order by slug`,
		),
	)) as unknown as Row[]

	console.log(`plan: ${SOURCE_SECTIONS.join(" + ")} -> ${TARGET_SECTION}`)
	console.log(`documents to move: ${rows.length}`)

	if (rows.length === 0) {
		console.log("nothing to move — already consolidated (idempotent no-op)")
	}

	const taken = (await db.execute(
		sql.raw(`select slug from documents where section = '${TARGET_SECTION}'`),
	)) as unknown as Array<{ slug: string }>
	const planned = checkPlan(rows, new Set(taken.map((r) => r.slug)))

	// Exactly one row has `id <> slug`; naming it makes the normalisation
	// visible rather than a silent side effect of the rewrite.
	const mismatched = (await db.execute(
		sql`select id, slug from documents where id <> slug`,
	)) as unknown as Array<{ id: string; slug: string }>
	for (const m of mismatched) {
		console.log(`note: id<>slug normalised — id=${m.id} slug=${m.slug}`)
	}

	const before = (await db.execute(
		sql`select count(*)::int as n from documents`,
	)) as unknown as Array<{
		n: number
	}>
	const beforeRev = (await db.execute(
		sql`select count(*)::int as n from document_revisions`,
	)) as unknown as Array<{ n: number }>

	console.log(`\nplan (first 5 of ${planned.length}):`)
	for (const p of planned.slice(0, 5)) console.log(`  -> ${p}`)

	try {
		await client.begin(async (tx) => {
			// 1. New parent rows. They coexist with the old ones for steps 2-3.
			await tx.unsafe(
				`insert into documents
				   (id, slug, title, type, section, status, author, tags, path, body,
				    created_at, updated_at, extra_fields)
				 select '${TARGET_SECTION}/' || substring(slug from length(section) + 2),
				        '${TARGET_SECTION}/' || substring(slug from length(section) + 2),
				        title, type, '${TARGET_SECTION}', status, author, tags,
				        '${TARGET_SECTION}/' || substring(slug from length(section) + 2) || '.md',
				        body, created_at, updated_at, extra_fields
				   from documents where section in (${sources})`,
			)

			// 2. Children first, so no row is ever left pointing at a missing
			//    parent. `d.section` still names the OLD section here because the
			//    new parent rows carry the target section and are not matched.
			for (const child of ["document_revisions", "document_chunks"]) {
				await tx.unsafe(
					`update ${child} c
					    set document_id = '${TARGET_SECTION}/' || substring(c.slug from length(d.section) + 2),
					        slug        = '${TARGET_SECTION}/' || substring(c.slug from length(d.section) + 2)
					   from documents d
					  where c.document_id = d.id and d.section in (${sources})`,
				)
			}

			// 3. Old parents. Matches on section, so the new rows are untouched.
			await tx.unsafe(`delete from documents where section in (${sources})`)

			// Verify INSIDE the transaction — before either commit or rollback.
			const after = (await tx.unsafe(
				`select section, count(*)::int as n from documents group by 1 order by 1`,
			)) as Array<{ section: string; n: number }>
			const integrity = (await tx.unsafe(
				`select
				   (select count(*) from document_revisions r
				      left join documents d on d.id = r.document_id where d.id is null)::int as orphan_rev,
				   (select count(*) from document_chunks c
				      left join documents d on d.id = c.document_id where d.id is null)::int as orphan_chunk,
				   (select count(*) from document_revisions)::int as rev_total,
				   (select count(*) from documents)::int as doc_total`,
			)) as Array<{
				orphan_rev: number
				orphan_chunk: number
				rev_total: number
				doc_total: number
			}>

			console.log(`\nafter: ${JSON.stringify(after)}`)
			console.log(`integrity: ${JSON.stringify(integrity[0])}`)

			const row = integrity[0]
			if (!row) throw new Error("integrity query returned nothing")

			// The document count must be UNCHANGED: a rename that also inserts or
			// drops a row is a bug, and this is where it would show.
			if (row.doc_total !== (before[0]?.n ?? -1)) {
				throw new Error(
					`document count changed: ${before[0]?.n} -> ${row.doc_total}`,
				)
			}
			if (row.rev_total !== (beforeRev[0]?.n ?? -1)) {
				throw new Error(
					`revision count changed: ${beforeRev[0]?.n} -> ${row.rev_total} (history lost)`,
				)
			}
			if (row.orphan_rev > 0 || row.orphan_chunk > 0) {
				throw new Error("refusing to commit: orphaned child rows")
			}

			if (!APPLY) throw new DryRunRollback()
		})
	} catch (err) {
		if (err instanceof DryRunRollback) {
			console.log("\nDRY RUN — rolled back. Re-run with --apply to commit.")
			return
		}
		throw err
	}

	console.log("\ncommitted.\n")

	// --- Post-commit side effects ------------------------------------------
	// hindsight keys its facts on `document_id`, which IS the slug, so every old
	// slug still holds its memories. A re-retain under the new slug would NOT
	// replace them — it would add a second document. The old ones are forgotten
	// explicitly.
	console.log("repointing the hindsight index...")
	for (const row of rows) {
		try {
			await forgetDocument(row.slug)
		} catch (err) {
			console.warn(
				`  forget ${row.slug}: ${err instanceof Error ? err.message : err}`,
			)
		}
	}
	const { retained, missing, failed } =
		await indexingUseCases().reindexFromStore({
			slugs: [...new Set(planned)],
		})
	console.log(`  retained ${retained}, missing ${missing}, failed ${failed}`)

	// --- Registry cleanup ---------------------------------------------------
	// Guarded on the live document count, so this can never unregister a section
	// that still holds content.
	console.log("\nunregistering drained and empty sections...")
	for (const id of [...SOURCE_SECTIONS, ...EMPTY_PRESET_SECTIONS]) {
		const counted = (await db.execute(
			sql`select count(*)::int as n from documents where section = ${id}`,
		)) as unknown as Array<{ n: number }>
		const n = counted[0]?.n ?? 0
		if (n > 0) {
			console.log(`  skip ${id}: still holds ${n} document(s)`)
			continue
		}
		const deleted = (await db.execute(
			sql`delete from sections where id = ${id} returning id`,
		)) as unknown as Array<{ id: string }>
		console.log(
			deleted.length > 0 ? `  removed ${id}` : `  ${id}: no registry row`,
		)
	}

	// Nav order: docs, then the one content section, then notes.
	console.log("\nnormalising nav order...")
	for (const [i, id] of ["docs", TARGET_SECTION, "notes"].entries()) {
		const updated = (await db.execute(
			sql`update sections set sort_order = ${i}, updated_at = now() where id = ${id} returning id`,
		)) as unknown as Array<{ id: string }>
		console.log(
			`  ${id} -> sort_order ${i}${updated.length ? "" : " (no registry row)"}`,
		)
	}

	await client.end()
}

await main()
