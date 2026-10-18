import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { fetchFolderInfo } from "../lib/api-client"
import { useDocumentQuery } from "../lib/queries"
import { DEFAULT_SECTION } from "../lib/sections"
import DocForm from "./doc-form"

/**
 * /create — the SPA port of app/create/page.tsx, now also the EDIT page.
 *
 * ## WHAT CHANGED FROM THE SERVER COMPONENT
 *
 * The Next page ran `listDocuments()`, `listSections()` and
 * `extractFoldersForSection()` in the server, importing @mcpedia/core straight
 * into Postgres, and passed WEBHOOK_SECRET down as a prop. All three are gone:
 *
 *  - The database reads move to the route loader in routes.tsx, which calls
 *    documents.sections for the known ids. It deliberately does NOT call
 *    documents.list: the folder tree comes from documents.folderInfo, which the
 *    API computes server-side from that same list, so the browser never has to
 *    hold every slug just to derive folder names.
 *  - The secret prop is not reproduced (see doc-form.tsx).
 *
 * ## THE GATE IS IN BOTH PLACES
 *
 * The route's beforeLoad redirects to /login unless auth.me reports an admin
 * (see gate.ts). That is UX: it avoids rendering an editor that cannot save.
 * It is NOT the security boundary — a client-side redirect is a suggestion
 * anyone can skip. documents.create/update/remove stay gated in the procedure
 * and the form surfaces whatever the API says. The weaker check is never
 * treated as sufficient on its own.
 *
 * ## WHY FOLDERS ARE FETCHED HERE, NOT IN THE LOADER
 *
 * The folder tree is per-SECTION and the section is a form field the user
 * changes. Preloading one arbitrary section would make the dropdown correct
 * only for that one; fetching on section change keeps it correct for whichever
 * section is selected. The default section is fetched on mount so the common
 * case shows folders immediately.
 *
 * ## EDIT MODE IS THIS SAME ROUTE, KEYED BY ?slug=
 *
 * The document toolbar's Edit button used to link to `/<slug>?edit=1`, which the
 * document route explicitly did NOT handle — so it bounced to the login redirect
 * and editing was unreachable. Rather than teach the read-only document route to
 * be a write surface (and duplicate the admin gate there), Edit links here with
 * `?slug=`; this page already owns the gate, the section list and the folder
 * tree, so editing is a mode of it rather than a second editor.
 */

/** The section whose folder tree is fetched first. */
export { DEFAULT_SECTION, sectionIdsFrom } from "../lib/sections"

export interface CreatePageProps {
	/** Loader data: the sections that already exist. */
	sectionIds: string[]
	/**
	 * The slug being edited, from `?slug=`. Absent means create.
	 *
	 * Read from the search params rather than a path segment because a slug
	 * contains slashes and is not a single route segment; `?slug=writeups/x/y`
	 * is unambiguous where `/[section]/[...slug]/edit` would collide with the
	 * document route tree.
	 */
	editSlug?: string
}

export default function CreatePage({ sectionIds, editSlug }: CreatePageProps) {
	const isEdit = Boolean(editSlug)

	// The document being edited. Disabled when creating, so this costs nothing on
	// the create path.
	const { data: existing, isPending } = useDocumentQuery(editSlug ?? "")

	// The section drives the folder lookup below. It starts at the default and is
	// corrected to the loaded document's section once the edit payload arrives —
	// in an effect, because `useFoldersFor` must not be called with a value that
	// changes dependency identity on every render.
	const [activeSection, setActiveSection] = useState(
		existing?.section ?? DEFAULT_SECTION,
	)
	useEffect(() => {
		if (existing?.section) setActiveSection(existing.section)
	}, [existing?.section])

	const folders = useFoldersFor(activeSection)

	// Creating is immediately renderable; editing must wait for the body, or the
	// form would mount empty and then swap its contents under the user's cursor.
	if (isEdit && isPending) {
		return (
			<div
				className="flex items-center justify-center gap-3 py-16 text-[var(--text-muted)] text-xs font-mono"
				role="status"
				aria-live="polite"
			>
				<div className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
				<span>Loading document…</span>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)]">
				<div className="flex items-center gap-3.5">
					<div className="w-11 h-11 rounded-2xl bg-[var(--brand)]/15 border border-[var(--brand)]/30 flex items-center justify-center text-[var(--brand)] dark:text-[var(--accent)]">
						<Plus className="w-6 h-6" />
					</div>
					<div>
						<h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
							{isEdit ? "Edit page" : "New page"}
						</h1>
						<p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
							{isEdit ? (
								<>
									Editing <code>{editSlug}</code>. Saving appends a revision.
								</>
							) : (
								<>
									Saves the page and keeps every previous version in its
									history.
								</>
							)}
						</p>
					</div>
				</div>
			</div>

			<DocForm
				mode={isEdit ? "edit" : "create"}
				{...(editSlug ? { slug: editSlug } : {})}
				existingSections={sectionIds}
				existingFolders={{ [activeSection]: folders }}
				onSectionChange={setActiveSection}
				{...(isEdit && existing
					? {
							initial: {
								title: existing.title,
								body: existing.body,
								section: existing.section,
								type: existing.type,
								status: existing.status,
								tags: existing.tags,
								author: existing.author,
								extraFields: existing.extraFields,
							},
						}
					: {})}
			/>
		</div>
	)
}

/**
 * Folder names for one section, fetched on demand.
 *
 * A failed fetch leaves the list empty rather than raising: the parent-folder
 * select defaults to "(Root of section)" and the form works without it, so a
 * folderInfo hiccup must not block creating a document at the section root.
 */
function useFoldersFor(section: string): string[] {
	const [folders, setFolders] = useState<string[]>([])

	useEffect(() => {
		const controller = new AbortController()
		let cancelled = false
		void (async () => {
			try {
				const info = await fetchFolderInfo(section, section, controller.signal)
				if (!cancelled) setFolders(info.folders)
			} catch {
				if (!cancelled) setFolders([])
			}
		})()
		return () => {
			cancelled = true
			controller.abort()
		}
	}, [section])

	return folders
}
