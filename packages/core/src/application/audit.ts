/**
 * The audit policy: what gets recorded, and what happens when recording fails.
 *
 * ## WHY THIS IS ITS OWN FILE
 *
 * Three properties of an audit trail are decisions, not mechanics, and each one
 * is easy to get wrong at an individual call site:
 *
 *   1. WHICH writes are recorded. Every write, not the interesting ones.
 *   2. WHAT the metadata contains. Enough to answer "what changed", never the
 *      document body — an audit table that duplicates content doubles the
 *      storage cost of the corpus and puts a second copy of every document
 *      behind the same authorisation boundary.
 *   3. WHAT happens when the audit write fails. This is the one that matters.
 *
 * On (3): the failure is logged and swallowed. An audit row that fails to write
 * must not roll back a document the user successfully created — losing the work
 * to satisfy the record of the work is a strictly worse outcome than a gap in the
 * trail. The failure is logged rather than ignored because a silently dropped
 * audit row is indistinguishable from a write that never happened, which is the
 * exact confusion an audit trail exists to prevent.
 *
 * ## WHY THE METADATA IS COMPUTED, NOT PASSED
 *
 * `metadataFor` is a total function of the values already in hand. If each call
 * site assembled its own metadata object, the shapes would drift per action and
 * a reader of the trail would need to special-case every action. Deriving it in
 * one place is what makes the table queryable.
 */
import type { ActivityRepository, AuditAction, AuditActor } from "../domain"

/** The actor for a write with no authenticated principal behind it. */
export const SYSTEM_ACTOR: AuditActor = Object.freeze({ via: "system" })

/**
 * Build the metadata blob for one action.
 *
 * Only the fields that are cheap, already known, and useful later. Bodies and
 * full metadata snapshots are deliberately absent — `before`/`after` here mean
 * the identifiers and section that changed, not the document text.
 */
export function metadataFor(
	action: AuditAction,
	changed: Record<string, string[]>,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	// `changed` maps a field name to its previous and next value. Only include a
	// field that actually changed: an entry claiming `title` changed when it did
	// not is worse than no entry, because it teaches a reader to distrust the
	// trail.
	const changedFields = Object.entries(changed)
		.filter(([, pair]) => pair[0] !== pair[1])
		.map(([field, pair]) => ({ field, from: pair[0], to: pair[1] }))

	return {
		// `action` is echoed into the blob rather than left implicit. The action is
		// already a column, so this is not the only place it appears — but the
		// metadata blob is the part that gets exported and read outside this
		// database, and a `changes` array with no label attached is ambiguous the
		// moment it is separated from its row.
		...(changedFields.length > 0 ? { action, changes: changedFields } : {}),
		...extra,
	}
}

/**
 * Wrap an activity repository so every write is recorded, and a recording
 * failure never becomes a write failure.
 *
 * Returns the port rather than a concrete object so callers hold only the
 * interface — the no-op fallback below stays an implementation detail.
 */
export function makeAuditor(activity: ActivityRepository | null) {
	// A missing repository must not be an error at call time: tests and CLI tools
	// legitimately build use cases without a database, and forcing an audit
	// collaborator there would mean every one of them grew a fake for a feature
	// they do not exercise. Absence disables recording; it never throws.
	if (!activity) {
		return async (_entry: Parameters<ActivityRepository["record"]>[0]) => {}
	}

	return async function audit(
		entry: Parameters<ActivityRepository["record"]>[0],
	): Promise<void> {
		try {
			await activity.record(entry)
		} catch (err) {
			console.error(
				`audit: recording "${entry.action}" for ${entry.resourceId} FAILED: ${
					err instanceof Error ? err.message : err
				}`,
			)
		}
	}
}
