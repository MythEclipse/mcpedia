/**
 * The section registry SEED — the nine sections this wiki shipped with.
 *
 * ## WHY THIS IS NOT THE RUNTIME SOURCE ANY MORE
 *
 * This list used to live in packages/config/src/sections.ts and was the answer
 * to "what is the writeups section called" everywhere: the header nav, the
 * section page heading, breadcrumbs, the PDF cover. It had to be re-declared
 * in apps/web/src/lib/shape.ts (the browser bundle may not import the config
 * barrel), so a rename was a two-file edit and the only thing keeping the copies
 * equal was a test whose whole job was policing the duplication.
 *
 * Section metadata is content. It now lives in the `sections` table and is read
 * from there; this file exists so the table starts out populated with the names
 * the site already used, rather than every section rendering as a title-cased
 * fallback after the cutover.
 *
 * ## IDEMPOTENT BY CONSTRUCTION
 *
 * `INSERT ... ON CONFLICT (id) DO NOTHING` — a re-run, a second environment, or
 * a section someone already edited through the DB all leave the existing row
 * alone. The seed never overwrites an operator's edit; that is the property that
 * makes it safe to apply on every migrate rather than exactly once.
 *
 * Deliberately NOT applied on API startup. Startup is the wrong place for a
 * write: it would run per process (api, mcp and worker all boot), it would race
 * itself on a rolling restart, and a read-only or replica database would fail
 * to start. The migration path already runs before the new code serves traffic.
 */
import type { AnyDatabase } from "./migrate-guard"
import { sections } from "./schema"

/**
 * Order is the header nav order.
 *
 * ## WHY THIS IS THE SHORT LIST, NOT THE ORIGINAL NINE
 *
 * The seed used to declare nine sections because the old config held them as
 * presets, and the nav filtered by document count. In practice six of those nine
 * never received a single document, and the header carried the clutter: `docs`,
 * `writeups`, `research`, `notes`, `guides`, `tutorials`, `ctf`, `api`,
 * `projects` all existed as registry rows to serve three sections' worth of
 * content.
 *
 * It is three now, and each one is load-bearing:
 *
 *   - `docs`  — the code's own default section (see `deriveSectionMeta` and the
 *               create form, which both fall back to it, so it must exist).
 *   - `ctf`   — every challenge writeup, consolidated out of `writeups` and
 *               `learn` (see scripts/consolidate-ctf-sections.ts).
 *   - `notes` — quick references; holds documents.
 *
 * ## WHY REMOVING AN ENTRY HERE IS NOT ENOUGH ON ITS OWN
 *
 * This runs on every `db:migrate`, i.e. every deploy, and it only INSERTs. A
 * section deleted from the table but still listed here is therefore recreated by
 * the next deploy — the delete appears to work and then silently undoes itself.
 * Dropping a section is a two-part change: remove it from this list AND delete
 * its row. `ON CONFLICT DO NOTHING` means the reverse order is safe (a stale row
 * is left alone until it is explicitly removed).
 */
export const SECTION_SEED: Array<{
	id: string
	label: string
	icon: string
	desc: string
}> = [
	{
		id: "docs",
		label: "Documentation",
		icon: "📄",
		desc: "Setup guides, API references, and protocol specs.",
	},
	{
		id: "ctf",
		label: "CTF",
		icon: "🚩",
		desc: "Capture The Flag challenge writeups and exploit solutions.",
	},
	{
		id: "notes",
		label: "Notes",
		icon: "📌",
		desc: "Quick references, patterns, and cheat-sheets.",
	},
]

/**
 * Insert any seed section that is not already present.
 *
 * Returns the ids it actually inserted, which is what the migrate entrypoint
 * logs — "seeded 9 sections" on a fresh database, "seeded 0" on every run after.
 *
 * ## WHY THIS GOES THROUGH THE QUERY BUILDER RATHER THAN RAW SQL
 *
 * The first version of this function was a hand-written
 * `insert into sections (id, label, icon, desc, ...)` and it broke on the live
 * database: `desc` is a reserved word in SQL, so the column must be quoted. The
 * generated DDL quoted it; this string did not; nothing caught it until the
 * migration actually ran somewhere with a real Postgres. Drizzle's builder owns
 * identifier quoting and column naming, so the class of bug cannot recur here —
 * and it is why the column is now named `description` at the SQL level.
 */
export async function seedSections(db: AnyDatabase): Promise<string[]> {
	// Sequential rather than Promise.all: the pool is small (max 5) on the deploy
	// host and these are nine tiny inserts on a path that runs once per deploy.
	// Racing them would buy nothing measurable and would make the log order
	// nondeterministic.
	const inserted: string[] = []
	for (const [index, s] of SECTION_SEED.entries()) {
		const rows = await db
			.insert(sections)
			.values({
				id: s.id,
				label: s.label,
				icon: s.icon,
				desc: s.desc,
				sortOrder: index,
			})
			// ON CONFLICT DO NOTHING: a re-run, a second environment, or a
			// section someone already edited through the API all leave the
			// existing row alone. The seed never overwrites an operator's edit,
			// which is what makes it safe to apply on every migrate.
			.onConflictDoNothing({ target: sections.id })
			.returning({ id: sections.id })
		for (const row of rows) inserted.push(row.id)
	}
	return inserted
}
