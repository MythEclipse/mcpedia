"use client"

import { Check, Copy, Laptop, Server, Sparkles, Terminal } from "lucide-react"
import { useState } from "react"
import Markdown from "#/components/Markdown"

const CONFIGS = [
	{
		id: "claude",
		label: "Claude Desktop",
		icon: Sparkles,
		lang: "json",
		filename: "~/Library/Application Support/Claude/claude_desktop_config.json",
		content: `{
  "mcpServers": {
    "mcpedia": {
      "command": "bun",
      "args": ["run", "/path/to/mcpedia/apps/mcp/src/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:password@localhost:5432/mcpedia",
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}`,
	},
	{
		id: "cursor",
		label: "Cursor AI",
		icon: Laptop,
		lang: "json",
		filename: ".cursor/mcp.json",
		content: `{
  "mcpServers": {
    "mcpedia": {
      "command": "bun",
      "args": ["run", "/path/to/mcpedia/apps/mcp/src/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:password@localhost:5432/mcpedia"
      }
    }
  }
}`,
	},
	{
		id: "http",
		label: "Streamable HTTP (SSE)",
		icon: Server,
		lang: "json",
		filename: "Streamable HTTP Client Config",
		content: `{
  "mcpServers": {
    "mcpedia-remote": {
      "url": "https://mcp.asepharyana.my.id/mcp",
      "headers": {
        "x-webhook-secret": "your-secret-here"
      }
    }
  }
}`,
	},
	{
		id: "cli",
		label: "CLI & Scripts",
		icon: Terminal,
		lang: "bash",
		filename: "Terminal Subprocess / REPL",
		content: `# Semantic question answering via MCP client
bun run apps/mcp-client/src/ask.ts "How does ret2win stack alignment work in x86_64?"

# Interactive REPL with tool discovery
bun run apps/mcp-client/src/index.ts`,
	},
]

export default function McpConfigSnippet() {
	const [activeTab, setActiveTab] = useState("claude")
	const [copied, setCopied] = useState(false)

	// Same shape as InteractiveTopology: `CONFIGS[0]` is
	// `Config | undefined` under `noUncheckedIndexedAccess`, and every read
	// below (`current.lang`, `current.content`, `current.filename`) would throw
	// on an empty list. `activeTab` only ever holds an id rendered from
	// `CONFIGS` itself, so `find` always hits; the guard documents that.
	const current = CONFIGS.find((c) => c.id === activeTab) ?? CONFIGS.at(0)
	if (!current) return null

	// Read the two fields the handlers need into consts at the guard. A narrowing
	// established here does NOT survive into a `function` declaration body —
	// declarations hoist, so the call could textually precede the `if (!current)`
	// above, and TS re-widens the read. Function *expressions* would be fine;
	// binding the values keeps the existing declaration style.
	const content = current.content

	const markdownSnippet = `\`\`\`${current.lang}
${content}
\`\`\``

	function handleCopyAll() {
		navigator.clipboard.writeText(content)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-xs">
			{/* Header bar with tabs */}
			<div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-elevated)] border-b border-[var(--border-color)] flex-wrap gap-2">
				<div className="flex items-center gap-1.5 flex-wrap">
					{CONFIGS.map((c) => {
						const Icon = c.icon
						const isSelected = activeTab === c.id
						return (
							<button
								key={c.id}
								onClick={() => setActiveTab(c.id)}
								type="button"
								className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-all cursor-pointer ${
									isSelected
										? "bg-[var(--brand)] text-[var(--brand-fg)] font-semibold shadow-xs"
										: "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
								}`}
							>
								<Icon className="w-3.5 h-3.5" />
								<span>{c.label}</span>
							</button>
						)
					})}
				</div>

				<button
					onClick={handleCopyAll}
					type="button"
					className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md transition-colors shadow-xs cursor-pointer font-medium"
				>
					{copied ? (
						<>
							<Check className="w-3.5 h-3.5 text-emerald-500" />
							<span className="text-emerald-500">Copied</span>
						</>
					) : (
						<>
							<Copy className="w-3.5 h-3.5" />
							<span>Copy Config</span>
						</>
					)}
				</button>
			</div>

			{/* Code preview */}
			<div className="p-4 sm:p-5 [&>.prose>.group]:my-0 [&>.prose]:max-w-none">
				<Markdown source={markdownSnippet} />
			</div>

			{/* Footer Info */}
			<div className="px-4 py-2.5 bg-[var(--bg-elevated)] border-t border-[var(--border-color)] text-xs text-[var(--text-dim)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span className="font-mono uppercase text-[10px] text-[var(--text-muted)]">
						Target File:
					</span>
					<span className="font-mono text-[var(--text-secondary)] text-[11px]">
						{current.filename}
					</span>
				</div>

				<div className="flex items-center gap-3 text-[11px] font-mono">
					<span className="flex items-center gap-1 text-[var(--text-muted)]">
						<span>[ 13_TOOLS_ACTIVE ]</span>
					</span>
				</div>
			</div>
		</div>
	)
}
