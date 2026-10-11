import Link from "next/link"
import {
	listDocuments,
	extractFoldersForSection,
	listSections,
} from "@mcpedia/core"
import { WEBHOOK_SECRET } from "@mcpedia/config"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import DocForm from "@/components/DocForm"
import { Edit3, ArrowLeft, Plus } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function CreatePage() {
	const cookieStore = await cookies()
	const isAdmin = cookieStore.get("mcpedia_admin")?.value != null
	if (!isAdmin) redirect("/login")

	const [all, sections] = await Promise.all([listDocuments(), listSections()])

	const docSlugs = all.map((d) => d.slug)
	const sectionIds = Array.from(
		new Set([...sections.map((s) => s.id), ...all.map((d) => d.section)]),
	)

	return (
		<div className="space-y-6">
			{/* Breadcrumb */}
			<nav className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
				<Link
					href="/"
					className="hover:text-[var(--text-primary)] transition-colors"
				>
					MCPedia
				</Link>
				<span>/</span>
				<span className="text-[var(--text-muted)] font-medium">
					Create Document
				</span>
			</nav>

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
				secret={WEBHOOK_SECRET}
				existingSections={sectionIds}
				existingFolders={Object.fromEntries(
					sectionIds.map((sid) => [
						sid,
						extractFoldersForSection(docSlugs, sid),
					]),
				)}
			/>
		</div>
	)
}
