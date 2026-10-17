/**
 * Revision history for one document, with restore.
 *
 * ## WHY THIS COMPONENT HAD TO BE REBUILT
 *
 * The Next app rendered `RevisionList` below every document body. It was deleted
 * with the Next tree and never ported, and nothing in the SPA called the
 * `revisions.*` procedures at all — so the API surface was fully intact
 * (`revisions.list`, `.get`, `.restore`) while the UI had silently lost the
 * feature. A reader could not see that a document had been edited, and could not
 * roll one back.
 *
 * ## WHAT CHANGED FROM THE NEXT VERSION, AND WHY
 *
 * The original restored via a POST to `/api/revisions/restore`, a Next route that
 * did `revalidatePath` and redirected. None of that exists here, so the restore
 * goes straight to the `revisions.restore` procedure, which is the same use case
 * the route called (the route added revalidation and a redirect, both of which
 * are server-rendering concerns that a SPA replaces with a refetch).
 *
 * The three things that DO carry over unchanged:
 *
 *   1. Restore is write-gated. `revisions.restore` carries
 *      `requireWriteAuthOrSession`, so an anonymous caller gets a 401 no matter
 *      what this component renders. `canEdit` is therefore UX only and is not
 *      treated as the boundary — same posture as the create form.
 *
 *   2. The restore is DESTRUCTIVE and not undoable through this UI: it
 *      overwrites the live body and snapshots the overwritten state as a new
 *      revision. So it is behind an explicit confirm, and the button says what
 *      it will do rather than just "Restore".
 *
 *   3. A restore rewrites the document, so every cached read of it is stale
 *      afterwards — the body, the list it appears in, and the history itself
 *      (which gains a row). All three are invalidated below rather than only the
 *      one this component happens to read.
 */
import { useQueryClient } from "@tanstack/react-query"
import { History, Loader2, RotateCcw } from "lucide-react"
import { useState } from "react"
import { RPC_BASE, rpcCall } from "#/lib/api-client"
import { useRevisionsQuery, qk } from "#/lib/queries"

export default function RevisionList({
	slug,
	canEdit,
}: {
	slug: string
	canEdit: boolean
}) {
	const { data: revisions, isPending, error } = useRevisionsQuery(slug)
	const queryClient = useQueryClient()
	const [restoringId, setRestoringId] = useState<string | null>(null)
	const [failure, setFailure] = useState<string | null>(null)

	async function handleRestore(id: string, revisionNo: number) {
		// Confirmed because it overwrites the live document and the overwrite is
		// only recoverable by restoring the revision this creates. `window.confirm`
		// rather than a modal: the app has no dialog primitive, and adding one for
		// a single destructive action is a larger change than the action warrants.
		const ok = window.confirm(
			`Restore revision v${revisionNo}?\n\nThe current body will be replaced. ` +
				`This is saved as a new revision first, so it can be recovered from this list.`,
		)
		if (!ok) return

		setRestoringId(id)
		setFailure(null)
		try {
			await rpcCall(RPC_BASE, ["revisions", "restore"] as const, { id })
			// Everything derived from the document, in one place. The history is
			// included because the restore itself writes a row.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: qk.document(slug) }),
				queryClient.invalidateQueries({ queryKey: qk.revisions(slug) }),
				// Every list that could contain this document: the section-scoped
				// one and the unfiltered one are separate cache entries.
				queryClient.invalidateQueries({ queryKey: ["documents", "list"] }),
			])
		} catch (err) {
			setFailure(err instanceof Error ? err.message : String(err))
		} finally {
			setRestoringId(null)
		}
	}

	// A document that has never been edited has no history. Rendering an empty
	// header for it would suggest the feature is broken rather than unused, which
	// is exactly what the Next version avoided by returning null here.
	if (isPending || error || !revisions || revisions.length === 0) return null

	return (
		<aside className="no-print mt-10 pt-8 border-t border-[var(--border-color)]">
			<div className="flex items-center justify-between mb-3.5">
				<div className="flex items-center gap-2">
					<History className="w-4 h-4 text-[var(--text-muted)]" />
					<h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
						Revision History ({revisions.length})
					</h2>
				</div>
			</div>

			{failure && (
				<p className="mb-2 text-xs text-rose-500 font-medium" role="alert">
					Restore failed: {failure}
				</p>
			)}

			<div className="space-y-2">
				{revisions.map((rev) => (
					<div
						key={rev.id}
						className="flex items-center justify-between gap-3 p-3 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg text-xs shadow-xs"
					>
						<div className="flex items-center gap-2 min-w-0 font-mono">
							<span className="text-[var(--text-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--border-color)] font-bold text-[10px]">
								v{rev.revisionNo}
							</span>
							<span className="text-[var(--text-secondary)] font-sans truncate text-xs">
								{rev.reason || "Updated document in PostgreSQL"}
							</span>
							<span className="text-[var(--text-dim)] hidden sm:inline text-[11px]">
								· {new Date(rev.createdAt).toLocaleString()}
							</span>
						</div>

						{canEdit && (
							<button
								onClick={() => handleRestore(rev.id, rev.revisionNo)}
								type="button"
								disabled={restoringId !== null}
								className="inline-flex items-center gap-1.5 shrink-0 text-xs text-[var(--text-primary)] hover:text-black dark:hover:text-white bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] px-2.5 py-1 rounded border border-[var(--border-color)] transition-colors font-medium cursor-pointer disabled:opacity-60 disabled:cursor-wait"
							>
								{restoringId === rev.id ? (
									<>
										<Loader2 className="w-3 h-3 animate-spin" />
										<span>Restoring…</span>
									</>
								) : (
									<>
										<RotateCcw className="w-3 h-3" />
										<span>Restore</span>
									</>
								)}
							</button>
						)}
					</div>
				))}
			</div>
		</aside>
	)
}
