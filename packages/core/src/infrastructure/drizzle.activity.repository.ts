/**
 * Drizzle-backed implementation of the audit trail.
 *
 * ## WHY A DEDICATED ADAPTER RATHER THAN A METHOD ON THE DOCUMENT REPOSITORY
 *
 * The audit trail has different read patterns (newest-first over the whole
 * table, or filtered to one document) and a different write pattern (append
 * only, never updated) from document storage. Sharing one adapter would mean
 * every document query sits next to an append-only log insert, and the two sets
 * of concerns would be edited by different people for different reasons.
 *
 * The row mapping is the only interesting part of this file: the domain's
 * `AuditActor` is a nested value, and Postgres has no nested type for it. It is
 * denormalised into `actor_id` / `actor_role` columns rather than stored as JSON,
 * because "everything one user did" is a query this table must answer with an
 * index rather than a scan-and-unpack.
 */
import { db } from "@mcpedia/db"
import { documentActivity } from "@mcpedia/db/schema"
import { and, desc, eq } from "drizzle-orm"
import type { ActivityRecord, ActivityRepository, AuditActor } from "../domain"

/** Flatten the domain actor into the columns the table stores. */
function toColumns(actor: AuditActor) {
	return {
		actorId: actor.userId ?? null,
		actorRole: actor.role ?? null,
		via: actor.via,
	}
}

/**
 * Rebuild the nested actor from a row.
 *
 * `via` is typed as the enum but arrives as whatever was in the column. An
 * unrecognised value falls back to "system" rather than throwing: a row written
 * by a newer build must not make the trail unreadable by an older one, and
 * "system" is the least-wrong answer for a value this version does not know.
 */
function toActor(row: {
	actorId: string | null
	actorRole: string | null
	via: string
}): AuditActor {
	const via =
		row.via === "webhook-secret" || row.via === "session" ? row.via : "system"
	return {
		...(row.actorId ? { userId: row.actorId } : {}),
		...(row.actorRole ? { role: row.actorRole } : {}),
		via,
	}
}

export function createActivityRepository(
	client: typeof db = db,
): ActivityRepository {
	return {
		async record(entry) {
			await client.insert(documentActivity).values({
				...toColumns(entry.actor),
				action: entry.action,
				resource: entry.resource,
				resourceId: entry.resourceId,
				metadata: entry.metadata,
			})
		},

		async list({ resourceId, limit, offset }) {
			// The filter is conditional rather than always-present so a full-table
			// feed does not carry a `WHERE id IS NOT NULL` that the planner has to
			// reason about on every page.
			const filter = resourceId
				? and(eq(documentActivity.resourceId, resourceId))
				: undefined

			const rows = await client
				.select()
				.from(documentActivity)
				.where(filter)
				.orderBy(desc(documentActivity.createdAt))
				.limit(limit)
				.offset(offset)

			return rows.map(
				(row): ActivityRecord => ({
					id: row.id,
					action: row.action as ActivityRecord["action"],
					resource: row.resource,
					resourceId: row.resourceId,
					actor: toActor(row),
					metadata: row.metadata,
					createdAt: row.createdAt.toISOString(),
				}),
			)
		},
	}
}
