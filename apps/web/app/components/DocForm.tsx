"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { mutate } from "swr"
import Markdown from "./Markdown"
import {
	Bold,
	Italic,
	Heading2,
	Heading3,
	Code,
	Link as LinkIcon,
	Plus,
	Trash2,
	Eye,
	Edit3,
	Sliders,
} from "lucide-react"

interface DocFormProps {
	mode: "create" | "edit"
	slug?: string
	secret: string
	existingFolders?: Record<string, string[]>
	existingSections?: string[]
	initial?: {
		title?: string
		body?: string
		section?: string
		type?: string
		status?: "published" | "draft" | string
		tags?: string[]
		author?: string
		extraFields?: Record<string, unknown>
	}
}

const DEFAULT_SECTION_LIST = [
	"docs",
	"writeups",
	"research",
	"notes",
	"guides",
	"tutorials",
	"ctf",
	"api",
	"projects",
]
const DEFAULT_TYPE_LIST = [
	"documentation",
	"writeup",
	"research",
	"note",
	"guide",
	"tutorial",
	"spec",
]

const PRESET_FIELDS = [
	{ key: "difficulty", value: "medium" },
	{ key: "points", value: "100" },
	{ key: "category", value: "pwn" },
	{ key: "event", value: "DEF CON Quals 2024" },
	{ key: "solved", value: "true" },
]

export default function DocForm({
	mode,
	slug,
	secret,
	existingFolders,
	existingSections,
	initial,
}: DocFormProps) {
	const router = useRouter()
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<"write" | "preview">("write")

	const [title, setTitle] = useState(initial?.title ?? "")
	const [slugInput, setSlugInput] = useState("")
	const [body, setBody] = useState(initial?.body ?? "")
	const [section, setSection] = useState(initial?.section ?? "docs")
	const [type, setType] = useState(initial?.type ?? "documentation")
	const [status, setStatus] = useState(initial?.status ?? "published")
	const [tags, setTags] = useState(initial?.tags?.join(", ") ?? "")
	const [author, setAuthor] = useState(initial?.author ?? "")
	const [parentFolder, setParentFolder] = useState("")

	const textareaRef = useRef<HTMLTextAreaElement>(null)

	const sectionOptions = Array.from(
		new Set(
			[...(existingSections ?? []), ...DEFAULT_SECTION_LIST, section].filter(
				Boolean,
			),
		),
	)

	// Extract existing custom fields
	const [customFields, setCustomFields] = useState<
		Array<{ key: string; value: string }>
	>(() => {
		if (initial?.extraFields) {
			return Object.entries(initial.extraFields)
				.filter(([k, v]) => k !== "slug" && v !== undefined && v !== null)
				.map(([k, v]) => ({
					key: k,
					value: typeof v === "string" ? v : JSON.stringify(v),
				}))
				.filter((f) => f.value)
		}
		return []
	})

	const tagList = tags
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean)

	const isEdit = mode === "edit"
	const effectiveSlug = isEdit
		? (slug ?? "")
		: parentFolder
			? `${parentFolder}/${slugInput}`.replace(/^\/+/, "").replace(/\/+/g, "/")
			: slugInput

	const availableFolders = existingFolders?.[section] ?? []

	const baseInputCls =
		"w-full px-3.5 py-2 bg-[var(--bg-surface)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"

	function addCustomField(key = "", value = "") {
		setCustomFields([...customFields, { key, value }])
	}

	function updateCustomField(
		index: number,
		field: "key" | "value",
		value: string,
	) {
		const updated = [...customFields]
		updated[index][field] = value
		setCustomFields(updated)
	}

	function removeCustomField(index: number) {
		setCustomFields(customFields.filter((_, i) => i !== index))
	}

	function insertMarkdown(prefix: string, suffix = "") {
		const textarea = textareaRef.current
		if (!textarea) return

		const start = textarea.selectionStart
		const end = textarea.selectionEnd
		const selection = body.substring(start, end)
		const replacement = `${prefix}${selection || "text"}${suffix}`

		const newBody = body.substring(0, start) + replacement + body.substring(end)
		setBody(newBody)

		setTimeout(() => {
			textarea.focus()
			textarea.setSelectionRange(
				start + prefix.length,
				start + replacement.length - suffix.length,
			)
		}, 10)
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setLoading(true)
		setError(null)

		if (!effectiveSlug || !title || !body) {
			setError("Slug, title, and markdown body are required.")
			setLoading(false)
			return
		}

		const payload: Record<string, unknown> = {
			title,
			body,
			slug: effectiveSlug,
			section,
			type,
			status,
			author,
			tags: tagList,
		}

		for (const field of customFields) {
			if (field.key.trim() && field.value.trim()) {
				payload[field.key.trim()] = field.value.trim()
			}
		}

		try {
			let res: Response
			if (mode === "create") {
				res = await fetch("/api/docs", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-webhook-secret": secret,
					},
					body: JSON.stringify(payload),
				})
			} else {
				const editSlug = slug ?? ""
				res = await fetch(`/api/docs/${editSlug}`, {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						"x-webhook-secret": secret,
					},
					body: JSON.stringify(payload),
				})
			}

			if (!res.ok) {
				const data = await res.json().catch(() => ({}))
				throw new Error(
					data.error ??
						"Failed to save document. Verify ADMIN_PASSWORD or secret.",
				)
			}

			const result = await res.json()
			// Invalidate SWR caches so Sidebar/Header/search reflect the change immediately
			mutate("/api/docs")
			mutate("/api/sections")
			mutate((key) => typeof key === "string" && key.startsWith("/api/tags"))
			router.push(result.doc?.slug ? `/${result.doc.slug}` : "/")
			router.refresh()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setLoading(false)
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
			{error && (
				<div className="p-3.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400 text-xs font-medium animate-fade-in">
					{error}
				</div>
			)}

			{/* Document Title */}
			<div>
				<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
					Document Title *
				</label>
				<input
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="e.g. Exploiting Stack Alignment Issues in x86_64"
					className={`${baseInputCls} text-base font-semibold`}
					required
				/>
			</div>

			{/* Section, Type, Status */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div>
					<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
						Section
					</label>
					<input
						type="text"
						list="section-list"
						value={section}
						onChange={(e) => setSection(e.target.value)}
						placeholder="e.g. docs, writeups, research"
						className={baseInputCls}
						required
					/>
					<datalist id="section-list">
						{sectionOptions.map((s) => (
							<option key={s} value={s}>
								{s.toUpperCase()}
							</option>
						))}
					</datalist>
				</div>

				<div>
					<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
						Document Type
					</label>
					<input
						type="text"
						list="type-list"
						value={type}
						onChange={(e) => setType(e.target.value)}
						placeholder="e.g. writeup, documentation, note"
						className={baseInputCls}
					/>
					<datalist id="type-list">
						{DEFAULT_TYPE_LIST.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</datalist>
				</div>

				<div>
					<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
						Status
					</label>
					<select
						value={status}
						onChange={(e) => setStatus(e.target.value as typeof status)}
						className={baseInputCls}
					>
						<option value="published">Published</option>
						<option value="draft">Draft (Unindexed)</option>
					</select>
				</div>
			</div>

			{/* Folder + Slug */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
						Parent Folder / Chapter
					</label>
					<select
						value={parentFolder}
						onChange={(e) => setParentFolder(e.target.value)}
						className={baseInputCls}
						disabled={isEdit}
					>
						<option value="">(Root of section)</option>
						{availableFolders.map((folder) => (
							<option key={folder} value={folder}>
								/{folder}
							</option>
						))}
					</select>
				</div>

				<div>
					<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
						{isEdit ? "Document Path" : "Slug (File name) *"}
					</label>
					{isEdit ? (
						<input
							type="text"
							value={slug ?? ""}
							readOnly
							className="w-full px-3.5 py-2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-muted)] font-mono"
						/>
					) : (
						<input
							type="text"
							value={slugInput}
							onChange={(e) => setSlugInput(e.target.value)}
							className={`${baseInputCls} font-mono`}
							placeholder="ret2win-guide"
							required
						/>
					)}
					<p className="text-[11px] text-[var(--text-dim)] mt-1.5 font-mono">
						Full Slug:{" "}
						<span className="text-[var(--text-primary)] font-semibold">
							{effectiveSlug || section}
						</span>
					</p>
				</div>
			</div>

			{/* Tags + Author */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
						Tags (comma separated)
					</label>
					<input
						type="text"
						value={tags}
						onChange={(e) => setTags(e.target.value)}
						className={baseInputCls}
						placeholder="pwn, x86_64, rop, ctf"
					/>
				</div>
				<div>
					<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
						Author
					</label>
					<input
						type="text"
						value={author}
						onChange={(e) => setAuthor(e.target.value)}
						className={baseInputCls}
						placeholder="e.g. asepharyana"
					/>
				</div>
			</div>

			{/* Custom Metadata Fields */}
			<div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl space-y-3.5 shadow-xs">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
					<div>
						<h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] font-mono flex items-center gap-1.5">
							<Sliders className="w-3.5 h-3.5 text-[var(--text-muted)]" />
							<span>Technical Metadata</span>
						</h3>
						<p className="text-[11px] text-[var(--text-dim)] mt-0.5">
							Custom fields (points, difficulty, event, solved) will render as
							styled badges in the document hero.
						</p>
					</div>

					<div className="flex items-center gap-1 flex-wrap">
						<span className="text-[10px] font-mono text-[var(--text-dim)] uppercase">
							Presets:
						</span>
						{PRESET_FIELDS.map((preset) => (
							<button
								key={preset.key}
								type="button"
								onClick={() => addCustomField(preset.key, preset.value)}
								className="px-2 py-0.5 text-[10px] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded transition-colors font-mono cursor-pointer"
							>
								+{preset.key}
							</button>
						))}
					</div>
				</div>

				{customFields.map((field, i) => (
					<div key={i} className="flex gap-2 items-center">
						<input
							type="text"
							placeholder="Field name (e.g. event)"
							value={field.key}
							onChange={(e) => updateCustomField(i, "key", e.target.value)}
							className={`${baseInputCls} text-xs font-mono`}
						/>
						<input
							type="text"
							placeholder="Value (e.g. DEF CON 2024)"
							value={field.value}
							onChange={(e) => updateCustomField(i, "value", e.target.value)}
							className={`${baseInputCls} text-xs font-mono`}
						/>
						<button
							type="button"
							onClick={() => removeCustomField(i)}
							className="p-2 text-rose-500 hover:text-rose-600 rounded hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
							title="Remove field"
						>
							<Trash2 className="w-4 h-4" />
						</button>
					</div>
				))}

				<button
					type="button"
					onClick={() => addCustomField()}
					className="inline-flex items-center gap-1.5 text-xs text-[var(--text-primary)] hover:underline px-3 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] transition-colors font-medium cursor-pointer"
				>
					<Plus className="w-3.5 h-3.5" />
					<span>Add Custom Field</span>
				</button>
			</div>

			{/* Markdown Body Editor */}
			<div className="border border-[var(--border-color)] rounded-xl overflow-hidden bg-[var(--bg-surface)] shadow-xs">
				{/* Editor Toolbar */}
				<div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-color)] flex-wrap gap-2">
					{/* Tabs */}
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setActiveTab("write")}
							className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded font-semibold transition-all cursor-pointer ${
								activeTab === "write"
									? "bg-[var(--brand)] text-[var(--brand-fg)] shadow-xs"
									: "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
							}`}
						>
							<Edit3 className="w-3.5 h-3.5" />
							<span>Write</span>
						</button>
						<button
							type="button"
							onClick={() => setActiveTab("preview")}
							className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded font-semibold transition-all cursor-pointer ${
								activeTab === "preview"
									? "bg-[var(--brand)] text-[var(--brand-fg)] shadow-xs"
									: "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
							}`}
						>
							<Eye className="w-3.5 h-3.5" />
							<span>Preview</span>
						</button>
					</div>

					{/* Quick Markdown Formatter Shortcuts */}
					{activeTab === "write" && (
						<div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
							<button
								type="button"
								onClick={() => insertMarkdown("**", "**")}
								className="p-1 hover:bg-[var(--bg-surface)] rounded hover:text-[var(--text-primary)]"
								title="Bold"
							>
								<Bold className="w-3.5 h-3.5" />
							</button>
							<button
								type="button"
								onClick={() => insertMarkdown("*", "*")}
								className="p-1 hover:bg-[var(--bg-surface)] rounded hover:text-[var(--text-primary)]"
								title="Italic"
							>
								<Italic className="w-3.5 h-3.5" />
							</button>
							<button
								type="button"
								onClick={() => insertMarkdown("## ")}
								className="p-1 hover:bg-[var(--bg-surface)] rounded hover:text-[var(--text-primary)]"
								title="Heading 2"
							>
								<Heading2 className="w-3.5 h-3.5" />
							</button>
							<button
								type="button"
								onClick={() => insertMarkdown("### ")}
								className="p-1 hover:bg-[var(--bg-surface)] rounded hover:text-[var(--text-primary)]"
								title="Heading 3"
							>
								<Heading3 className="w-3.5 h-3.5" />
							</button>
							<button
								type="button"
								onClick={() => insertMarkdown("```\n", "\n```")}
								className="p-1 hover:bg-[var(--bg-surface)] rounded hover:text-[var(--text-primary)]"
								title="Code Block"
							>
								<Code className="w-3.5 h-3.5" />
							</button>
							<button
								type="button"
								onClick={() => insertMarkdown("[", "](https://)")}
								className="p-1 hover:bg-[var(--bg-surface)] rounded hover:text-[var(--text-primary)]"
								title="Link"
							>
								<LinkIcon className="w-3.5 h-3.5" />
							</button>
						</div>
					)}
				</div>

				{/* Tab Content */}
				{activeTab === "write" ? (
					<textarea
						ref={textareaRef}
						value={body}
						onChange={(e) => setBody(e.target.value)}
						className="w-full h-96 p-4 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-dim)] font-mono text-sm focus:outline-none resize-y leading-relaxed"
						placeholder="# Write your technical documentation or writeup here in Markdown..."
						required
					/>
				) : (
					<div className="p-6 h-96 overflow-y-auto bg-[var(--bg-app)]">
						{body.trim() ? (
							<Markdown source={body} />
						) : (
							<p className="text-xs text-[var(--text-dim)] italic font-mono">
								No content to preview yet.
							</p>
						)}
					</div>
				)}
			</div>

			{/* Submit Action Buttons */}
			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={loading}
					className="px-6 py-2.5 bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] rounded-lg font-semibold text-xs transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer font-mono uppercase tracking-wider"
				>
					{loading && (
						<div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
					)}
					<span>
						{loading
							? "PERSISTING..."
							: mode === "create"
								? "PUBLISH_DOCUMENT"
								: "SAVE_CHANGES"}
					</span>
				</button>

				<button
					type="button"
					onClick={() => router.back()}
					className="px-4 py-2.5 border border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] rounded-lg text-xs transition-colors shadow-xs cursor-pointer font-mono"
				>
					Cancel
				</button>
			</div>
		</form>
	)
}
