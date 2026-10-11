"use client"

/**
 * Copied verbatim from app/components/Markdown.tsx.
 *
 * The "use client" directive is a no-op in a Vite SPA — everything is already
 * the client — and is kept only so this file stays a drop-in match for the Next
 * original, which has not been deleted yet. It is removed in the cutover stage
 * along with the whole app/ tree.
 */

import React, { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSlug from "rehype-slug"
import rehypeHighlight from "rehype-highlight"
import {
	Copy,
	Check,
	Info,
	Lightbulb,
	AlertTriangle,
	Flame,
	ShieldAlert,
} from "lucide-react"

function extractText(node: React.ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean") {
		return ""
	}
	if (typeof node === "string" || typeof node === "number") {
		return String(node)
	}
	if (Array.isArray(node)) {
		return node.map(extractText).join("")
	}
	if (React.isValidElement(node)) {
		return extractText((node.props as { children?: React.ReactNode })?.children)
	}
	return ""
}

function PreBlock({
	children,
	...props
}: React.HTMLAttributes<HTMLPreElement>) {
	const [copied, setCopied] = useState(false)
	const textContent = extractText(children).replace(/\n$/, "")

	let language = "text"
	if (React.isValidElement(children)) {
		const className =
			(children.props as { className?: string })?.className || ""
		const match = /language-(\w+)/.exec(className)
		if (match) {
			language = match[1]
		}
	}

	function handleCopy() {
		navigator.clipboard.writeText(textContent)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className="code-block-wrapper relative group my-6 print:my-2 rounded-xl print:rounded border border-[var(--border-code)] print:border-slate-300 bg-[var(--code-block-bg)] print:bg-slate-50 shadow-sm print:shadow-none">
			{/* Code block header bar */}
			<div className="code-block-header flex items-center justify-between px-4 py-2.5 print:px-2.5 print:py-0.5 bg-[var(--code-header-bg)] print:bg-slate-100 border-b border-[var(--border-code)] print:border-slate-300 text-xs font-mono select-none">
				<div className="flex items-center gap-2.5">
					<div className="no-print flex items-center gap-1.5 opacity-75 group-hover:opacity-100 transition-opacity">
						<span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
						<span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
						<span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
					</div>
					<span className="text-[11px] print:text-[7pt] font-semibold uppercase tracking-wider text-[var(--text-muted)] print:text-slate-700 group-hover:text-[var(--text-primary)] transition-colors">
						{language}
					</span>
				</div>

				<button
					onClick={handleCopy}
					type="button"
					aria-label="Copy code to clipboard"
					className="no-print flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--code-button-bg)] hover:bg-[var(--code-button-hover-bg)] px-2.5 py-1 rounded-md border border-[var(--border-code)] transition-all font-sans shadow-xs cursor-pointer"
				>
					{copied ? (
						<>
							<Check className="w-3.5 h-3.5 text-emerald-500" />
							<span className="text-emerald-500 font-medium">Copied!</span>
						</>
					) : (
						<>
							<Copy className="w-3.5 h-3.5" />
							<span>Copy</span>
						</>
					)}
				</button>
			</div>

			<pre
				className="!m-0 !bg-transparent p-4 sm:p-5 print:p-2 overflow-x-auto text-[13px] sm:text-[13.5px] print:text-[7.5pt] text-[var(--pre-text)] print:text-slate-900 font-mono leading-relaxed print:leading-snug"
				{...props}
			>
				{children}
			</pre>
		</div>
	)
}

export default function Markdown({ source }: { source: string }) {
	return (
		<div
			className="prose max-w-none
      prose-headings:text-[var(--text-primary)] prose-headings:font-bold prose-headings:tracking-tight
      prose-h1:text-2xl sm:prose-h1:text-3xl prose-h1:mb-6 prose-h1:mt-8 prose-h1:pb-3 prose-h1:border-b prose-h1:border-[var(--border-color)] print:prose-h1:text-[13pt] print:prose-h1:mt-2 print:prose-h1:mb-1 print:prose-h1:pb-0.5
      prose-h2:text-xl sm:prose-h2:text-2xl prose-h2:mb-4 prose-h2:mt-8 prose-h2:pb-2 prose-h2:border-b prose-h2:border-[var(--border-subtle)] print:prose-h2:text-[10.5pt] print:prose-h2:mt-2 print:prose-h2:mb-1 print:prose-h2:pb-0.5
      prose-h3:text-lg prose-h3:mb-3 prose-h3:mt-6 print:prose-h3:text-[9.5pt] print:prose-h3:mt-1.5 print:prose-h3:mb-0.5
      prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-p:mb-4 print:prose-p:text-[8.5pt] print:prose-p:leading-snug print:prose-p:mb-1.5
      prose-a:text-[var(--accent)] prose-a:font-medium prose-a:no-underline hover:prose-a:underline hover:prose-a:text-[var(--accent-hover)]
      prose-ul:text-[var(--text-secondary)] prose-ul:my-4 prose-li:my-1.5 print:prose-ul:my-1 print:prose-li:my-0.5
      prose-ol:text-[var(--text-secondary)] prose-ol:my-4 print:prose-ol:my-1
      prose-strong:text-[var(--text-primary)] prose-strong:font-semibold
      prose-hr:border-[var(--border-color)] prose-hr:my-8 print:prose-hr:my-2"
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeSlug, rehypeHighlight]}
				components={{
					pre: PreBlock as any,
					code: ({
						children,
						className,
						...props
					}: React.HTMLAttributes<HTMLElement>) => {
						if (
							className?.includes("hljs") ||
							className?.includes("language-")
						) {
							return (
								<code className={className} {...props}>
									{children}
								</code>
							)
						}
						return (
							<code
								className="px-1.5 py-0.5 rounded-md print:rounded-none bg-[var(--code-inline-bg)] print:bg-slate-100 text-[var(--code-inline-text)] print:text-slate-900 border border-[var(--code-inline-border)] print:border-slate-200 font-mono text-[0.875em] print:text-[7.5pt] font-medium"
								{...props}
							>
								{children}
							</code>
						)
					},
					table: ({ node, ...props }) => (
						<div className="overflow-x-auto my-6 print:my-1.5 border border-[var(--border-color)] print:border-slate-300 rounded-xl print:rounded-none shadow-xs print:shadow-none">
							<table className="w-full border-collapse" {...props} />
						</div>
					),
					blockquote: ({ children }) => {
						const rawText = extractText(children).trim()
						const alertMatch = rawText.match(
							/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i,
						)

						if (alertMatch) {
							const alertType = alertMatch[1].toUpperCase()
							let borderClass =
								"border-indigo-500 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200 print:bg-indigo-50 print:text-indigo-950"
							let Icon = Info
							let title = "Note"

							if (alertType === "TIP") {
								borderClass =
									"border-emerald-500 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 print:bg-emerald-50 print:text-emerald-950"
								Icon = Lightbulb
								title = "Tip"
							} else if (alertType === "IMPORTANT") {
								borderClass =
									"border-violet-500 bg-violet-500/10 text-violet-900 dark:text-violet-200 print:bg-violet-50 print:text-violet-950"
								Icon = Flame
								title = "Important"
							} else if (alertType === "WARNING") {
								borderClass =
									"border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200 print:bg-amber-50 print:text-amber-950"
								Icon = AlertTriangle
								title = "Warning"
							} else if (alertType === "CAUTION") {
								borderClass =
									"border-rose-500 bg-rose-500/10 text-rose-900 dark:text-rose-200 print:bg-rose-50 print:text-rose-950"
								Icon = ShieldAlert
								title = "Caution"
							}

							return (
								<div
									className={`my-5 print:my-1.5 p-4 print:p-2 rounded-xl print:rounded border-l-4 ${borderClass} shadow-xs print:shadow-none`}
								>
									<div className="flex items-center gap-2 font-bold text-xs print:text-[7.5pt] uppercase tracking-wider mb-1.5 print:mb-0.5">
										<Icon className="w-4 h-4 print:w-3 print:h-3" />
										<span>{title}</span>
									</div>
									<div className="text-xs sm:text-sm print:text-[8pt] text-[var(--text-secondary)] print:text-slate-900 [&>p]:mb-1 [&>p:last-child]:mb-0 print:[&>p]:mb-0.5">
										{children}
									</div>
								</div>
							)
						}

						return (
							<blockquote className="border-l-4 border-[var(--brand)] print:border-slate-500 bg-[var(--brand)]/5 dark:bg-[var(--brand)]/10 print:bg-slate-50 pl-4 print:pl-2.5 py-2.5 print:py-1 my-5 print:my-1.5 rounded-r-xl print:rounded-none text-[var(--text-secondary)] print:text-slate-900 not-italic print:text-[8pt]">
								{children}
							</blockquote>
						)
					},
				}}
			>
				{source}
			</ReactMarkdown>
		</div>
	)
}
