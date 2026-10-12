"use client"

import { Link } from "@tanstack/react-router"
import {
	ArrowRight,
	Database,
	Globe,
	Layers,
	Search,
	Server,
	Sparkles,
} from "lucide-react"
import { useState } from "react"

interface NodeDetail {
	id: string
	title: string
	badge: string
	type: "client" | "protocol" | "core" | "storage"
	/** A lucide-react icon component, rendered as `<Icon className=... />`. */
	icon: React.ComponentType<{ className?: string }>
	desc: string
	metrics: { label: string; value: string }[]
	features: string[]
	docLink?: string
}

const NODES: NodeDetail[] = [
	{
		id: "ai-agents",
		title: "AI Coding Agents",
		badge: "MCP::CLIENT",
		type: "client",
		icon: Sparkles,
		desc: "Claude Desktop, Cursor, Antigravity, and Zed connect via Model Context Protocol to read and write technical knowledge directly.",
		metrics: [
			{ label: "Transport", value: "Stdio / HTTP SSE" },
			{ label: "Tools Exposed", value: "13 Native Tools" },
			{ label: "Authentication", value: "x-webhook-secret" },
		],
		features: [
			"Semantic similarity search over chunks",
			"Direct document CRUD into Postgres",
			"Context retrieval for debugging & CTF writeups",
		],
		docLink: "/docs",
	},
	{
		id: "web-ui",
		title: "Human Web Interface",
		badge: "UI::NEXTJS",
		type: "client",
		icon: Globe,
		desc: "Fast, accessible developer web interface with dark/light themes, keyboard shortcuts, and instant search.",
		metrics: [
			{ label: "Framework", value: "Next.js 16.3" },
			{ label: "Styling", value: "Tailwind CSS v4" },
			{ label: "Command Menu", value: "⌘K Omnisearch" },
		],
		features: [
			"Hierarchical folder directory tree",
			"Publication-grade PDF export generator",
			"Live markdown editor with revision rollback",
		],
		docLink: "/docs",
	},
	{
		id: "mcp-server",
		title: "MCP Server Gateway",
		badge: "PORT::4021",
		type: "protocol",
		icon: Server,
		desc: "Streamable Model Context Protocol server exposing tool endpoints and resource URIs.",
		metrics: [
			{ label: "Port", value: ":4021" },
			{ label: "Protocol", value: "MCP 2024-11-05" },
			{ label: "Runtime", value: "Bun Engine" },
		],
		features: [
			"get_document / create_document tools",
			"search_hybrid / search_semantic tools",
			"list_sections & list_revisions resources",
		],
		docLink: "/api",
	},
	{
		id: "core-engine",
		title: "@mcpedia/core",
		badge: "CORE::PACKAGE",
		type: "core",
		icon: Layers,
		desc: "Unified business logic layer shared across Web, MCP Server, REST API, and Background Workers.",
		metrics: [
			{ label: "Architecture", value: "Monorepo Package" },
			{ label: "Validation", value: "Strict Type Safety" },
			{ label: "Ranking", value: "RRF Hybrid Fusion" },
		],
		features: [
			"Path classification & folder hierarchy",
			"Markdown document chunking & tokenization",
			"Drizzle ORM transactional schema mapping",
		],
		docLink: "/research",
	},
	{
		id: "search-engine",
		title: "Multi-Modal Search Engine",
		badge: "SEARCH::RRF",
		type: "core",
		icon: Search,
		desc: "Reciprocal Rank Fusion uniting Postgres Full-Text Search tsvectors with vector embeddings.",
		metrics: [
			{ label: "FTS Algorithm", value: "tsvector + GIN" },
			{ label: "Vector Search", value: "Cosine Similarity" },
			{ label: "Fusion Constant", value: "k = 60" },
		],
		features: [
			"Sub-millisecond keyword retrieval",
			"Conceptual similarity matching",
			"Instant snippet generation with highlight markers",
		],
		docLink: "/search",
	},
	{
		id: "postgres-db",
		title: "PostgreSQL 16 + pgvector",
		badge: "DB::POSTGRES",
		type: "storage",
		icon: Database,
		desc: "ACID-compliant relational database storing document bodies, revision trees, vector embeddings, and full-text indexes.",
		metrics: [
			{ label: "Extension", value: "vector (1536 dim)" },
			{ label: "Backups", value: "Auto .md to disk" },
			{ label: "Isolation", value: "Transactional" },
		],
		features: [
			"HNSW vector index for embeddings",
			"Complete revision history preservation",
			"Instant document schema migrations",
		],
		docLink: "/docs",
	},
]

export default function InteractiveTopology() {
	const [activeNodeId, setActiveNodeId] = useState<string>("core-engine")

	// `NODES.find(...) || NODES[0]` was the original guard, but `NODES[0]` is
	// `NodeDetail | undefined` under `noUncheckedIndexedAccess` — and worse, an
	// empty `NODES` would have rendered a component whose every
	// `activeNode.<field>` read threw. `NODES` is a module-level literal that
	// ships six entries, so this cannot fire today; the early return keeps that
	// a type-checked fact instead of a comment, and degrades to the shell chrome
	// rather than a white screen if the list is ever emptied.
	const activeNode = NODES.find((n) => n.id === activeNodeId) ?? NODES.at(0)
	if (!activeNode) return null
	const ActiveIcon = activeNode.icon

	return (
		<div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-xs">
			{/* Header Bar */}
			<div className="p-4 sm:p-5 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 mb-1">
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
						<span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
							Architecture Schematic
						</span>
					</div>
					<h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight">
						System Topology: Single Core Architecture
					</h3>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-[11px] font-mono text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-color)] px-2 py-1 rounded">
						Click nodes to inspect
					</span>
				</div>
			</div>

			{/* Grid Layout */}
			<div className="grid grid-cols-1 lg:grid-cols-12">
				{/* Visual Map Column (Left) */}
				<div className="lg:col-span-7 p-5 border-b lg:border-b-0 lg:border-r border-[var(--border-color)] bg-[var(--bg-app)] flex flex-col justify-between space-y-5">
					{/* Layer 1: Clients */}
					<div>
						<span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-2 block">
							1. Ingestion & Access Layer
						</span>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
							{NODES.filter((n) => n.type === "client").map((node) => {
								const Icon = node.icon
								const isSelected = activeNodeId === node.id
								return (
									<button
										key={node.id}
										onClick={() => setActiveNodeId(node.id)}
										type="button"
										className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
											isSelected
												? "bg-[var(--bg-surface)] border-[var(--text-primary)] shadow-xs ring-1 ring-[var(--text-primary)]"
												: "bg-[var(--bg-surface)] border-[var(--border-color)] hover:border-[var(--text-muted)]"
										}`}
									>
										<div className="flex items-center justify-between mb-2">
											<div
												className={`p-1.5 rounded ${isSelected ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}
											>
												<Icon className="w-3.5 h-3.5" />
											</div>
											<span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-color)]">
												{node.badge}
											</span>
										</div>
										<div className="font-semibold text-xs text-[var(--text-primary)]">
											{node.title}
										</div>
									</button>
								)
							})}
						</div>
					</div>

					{/* Flow Connector Arrow */}
					<div className="flex justify-center text-[var(--text-dim)]">
						<span className="text-[10px] font-mono px-2.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-color)]">
							↓ Protocol Gateway
						</span>
					</div>

					{/* Layer 2: Protocol & Core Services */}
					<div>
						<span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-2 block">
							2. Core Engine & Protocol Layer
						</span>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
							{NODES.filter(
								(n) => n.type === "protocol" || n.type === "core",
							).map((node) => {
								const Icon = node.icon
								const isSelected = activeNodeId === node.id
								return (
									<button
										key={node.id}
										onClick={() => setActiveNodeId(node.id)}
										type="button"
										className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
											isSelected
												? "bg-[var(--bg-surface)] border-[var(--text-primary)] shadow-xs ring-1 ring-[var(--text-primary)]"
												: "bg-[var(--bg-surface)] border-[var(--border-color)] hover:border-[var(--text-muted)]"
										}`}
									>
										<div className="flex items-center justify-between mb-2">
											<div
												className={`p-1.5 rounded ${isSelected ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}
											>
												<Icon className="w-3.5 h-3.5" />
											</div>
										</div>
										<div className="font-semibold text-xs text-[var(--text-primary)] leading-tight mb-0.5 truncate">
											{node.title}
										</div>
										<div className="text-[10px] text-[var(--text-muted)] font-mono truncate">
											{node.badge}
										</div>
									</button>
								)
							})}
						</div>
					</div>

					{/* Flow Connector Arrow */}
					<div className="flex justify-center text-[var(--text-dim)]">
						<span className="text-[10px] font-mono px-2.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-color)]">
							↓ Persistent Storage Layer
						</span>
					</div>

					{/* Layer 3: Storage */}
					<div>
						<span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-2 block">
							3. Database (Source of Truth)
						</span>
						{NODES.filter((n) => n.type === "storage").map((node) => {
							const Icon = node.icon
							const isSelected = activeNodeId === node.id
							return (
								<button
									key={node.id}
									onClick={() => setActiveNodeId(node.id)}
									type="button"
									className={`w-full p-3 rounded-lg border text-left transition-all cursor-pointer ${
										isSelected
											? "bg-[var(--bg-surface)] border-[var(--text-primary)] shadow-xs ring-1 ring-[var(--text-primary)]"
											: "bg-[var(--bg-surface)] border-[var(--border-color)] hover:border-[var(--text-muted)]"
									}`}
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-3">
											<div
												className={`p-1.5 rounded ${isSelected ? "bg-[var(--brand)] text-[var(--brand-fg)]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}
											>
												<Icon className="w-4 h-4" />
											</div>
											<div>
												<div className="font-semibold text-xs text-[var(--text-primary)]">
													{node.title}
												</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													Source of truth for all content & embeddings
												</div>
											</div>
										</div>
										<span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-color)]">
											{node.badge}
										</span>
									</div>
								</button>
							)
						})}
					</div>
				</div>

				{/* Node Inspector Details Column (Right) */}
				<div className="lg:col-span-5 p-5 bg-[var(--bg-surface)] flex flex-col justify-between space-y-5 animate-fade-in">
					<div>
						{/* Inspector Header */}
						<div className="flex items-start justify-between gap-3 mb-3">
							<div className="flex items-center gap-2.5">
								<div className="w-9 h-9 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] flex items-center justify-center">
									<ActiveIcon className="w-4 h-4" />
								</div>
								<div>
									<h4 className="text-sm font-bold text-[var(--text-primary)]">
										{activeNode.title}
									</h4>
									<span className="text-[10px] font-mono text-[var(--text-muted)]">
										{activeNode.badge}
									</span>
								</div>
							</div>
						</div>

						<p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-5">
							{activeNode.desc}
						</p>

						{/* Telemetry Metrics */}
						<div className="mb-5">
							<span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] font-mono mb-2 block">
								Specifications
							</span>
							<div className="space-y-1.5">
								{activeNode.metrics.map((m) => (
									<div
										key={m.label}
										className="flex items-center justify-between p-2 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded text-xs"
									>
										<span className="text-[var(--text-muted)] text-[11px]">
											{m.label}
										</span>
										<span className="font-mono font-medium text-[var(--text-primary)] text-[11px]">
											{m.value}
										</span>
									</div>
								))}
							</div>
						</div>

						{/* Key Capabilities */}
						<div>
							<span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] font-mono mb-2 block">
								Capabilities
							</span>
							<ul className="space-y-1.5">
								{activeNode.features.map((feat, idx) => (
									<li
										key={idx}
										className="flex items-start gap-2 text-xs text-[var(--text-secondary)]"
									>
										<span className="text-emerald-500 shrink-0 font-mono text-[11px]">
											✓
										</span>
										<span>{feat}</span>
									</li>
								))}
							</ul>
						</div>
					</div>

					{/* Link to Documentation */}
					{activeNode.docLink && (
						<div className="pt-3 border-t border-[var(--border-color)]">
							<Link
								to={activeNode.docLink}
								className="inline-flex items-center justify-center gap-1.5 w-full py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] border border-[var(--border-color)] text-xs font-semibold text-[var(--text-primary)] rounded-lg transition-colors group"
							>
								<span>Read documentation</span>
								<ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
							</Link>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
