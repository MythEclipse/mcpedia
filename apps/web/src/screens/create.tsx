import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { fetchFolderInfo } from "../lib/api-client"
import { DEFAULT_SECTION } from "../lib/sections"
import DocForm from "./doc-form"

/**
 * /create — the SPA port of app/create/page.tsx.
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
 * anyone can skip. documents.create stays gated by requireWriteAuth in the
 * procedure and the form surfaces whatever the API says. The weaker check is
 * never treated as sufficient on its own.
 *
 * ## WHY FOLDERS ARE FETCHED HERE, NOT IN THE LOADER
 *
 * The folder tree is per-SECTION and the section is a form field the user
 * changes. Preloading one arbitrary section would make the dropdown correct
 * only for that one; fetching on section change keeps it correct for whichever
 * section is selected. The default section is fetched on mount so the common
 * case shows folders immediately.
 */

/** The section whose folder tree is fetched first. */
export { DEFAULT_SECTION, sectionIdsFrom } from "../lib/sections"

export interface CreatePageProps {
	/** Loader data: the sections that already exist. */
	sectionIds: string[]
}

export default function CreatePage({ sectionIds }: CreatePageProps) {
	const [activeSection, setActiveSection] = useState(DEFAULT_SECTION)
	const folders = useFoldersFor(activeSection)

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
							Create Knowledge Document
						</h1>
						<p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
							Persists directly into PostgreSQL, tracks revision history, and
							generates vector embeddings.
						</p>
					</div>
				</div>
			</div>

			<DocForm
				mode="create"
				existingSections={sectionIds}
				existingFolders={{ [activeSection]: folders }}
				onSectionChange={setActiveSection}
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
