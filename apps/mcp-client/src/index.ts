import type { SearchHitSummary } from "./client"
import { McpediaClient } from "./client"

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? ""

// Interactive MCP client — connects to the MCPedia MCP server over
// Streamable HTTP and provides a chat-like REPL.
//
// Usage:
//   MCP_URL=https://mcp.asepharyana.my.id/mcp bun run chat
//   bun run chat  (defaults to https://mcp.asepharyana.my.id/mcp)
//
// Commands in the REPL:
//   /tools — list available tools
//   /resources — list available resources
//   /search <q> — keyword search
//   /ss <q> — semantic search
//   /hybrid <q> — hybrid search
//   /doc <slug> — get document body
//   /related <slug> — related documents
//   /create — create a document (prompts for fields)
//   /delete <slug> — delete a document
//   /index <slug> — enqueue reindex for a doc
//   /status — queue status
//   /help — show help
//   /quit — exit

const HELP = `Commands:
  /tools                    — list available MCP tools
  /resources                — list available resources
  /search <query>           — keyword (full-text) search
  /ss <query>               — semantic (embedding) search
  /hybrid <query>           — hybrid search (FTS + semantic)
  /doc <slug>               — get document body (e.g. docs/websocket/contract)
  /related <slug>           — get related documents
  /create                   — create a document (interactive prompts)
  /update <slug>            — update a document (interactive prompts)
  /delete <slug>            — delete a document
  /index <slug>             — enqueue reindex for a document
  /status                   — queue status
  /help                     — show this help
  /quit                     — exit`

async function main() {
	const url = process.env.MCP_URL ?? "https://mcp.asepharyana.my.id/mcp"
	const headers: Record<string, string> = {}
	if (WEBHOOK_SECRET) {
		headers["x-webhook-secret"] = WEBHOOK_SECRET
	}

	console.log(`Connecting to MCP server: ${url}`)
	const client = await McpediaClient.connect(url, { headers })
	console.log("Connected! Type /help for commands.\n")

	// Show available tools on startup
	const tools = await client.listTools()
	console.log(
		`Available tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`,
	)
	console.log("")

	const rl = await import("node:readline")
	const readline = rl.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: "mcp> ",
	})

	readline.prompt()

	for await (const line of readline) {
		const cmd = line.trim()
		if (!cmd) {
			readline.prompt()
			continue
		}

		const [name, ...args] = cmd.split(/\s+/)
		const arg = args.join(" ")

		try {
			switch (name) {
				case "/tools": {
					const t = await client.listTools()
					console.log(
						t.map((x) => `  ${x.name}: ${x.description || ""}`).join("\n"),
					)
					break
				}
				case "/resources": {
					const r = await client.listResources()
					console.log(r.map((x) => `  ${x.uri}`).join("\n"))
					break
				}
				case "/search": {
					if (!arg) throw new Error("Usage: /search <query>")
					const hits = await client.search(arg)
					printHits(hits)
					break
				}
				case "/ss": {
					if (!arg) throw new Error("Usage: /ss <query>")
					const hits = await client.semanticSearch(arg)
					printHits(hits)
					break
				}
				case "/hybrid": {
					if (!arg) throw new Error("Usage: /hybrid <query>")
					const hits = await client.hybridSearch(arg)
					printHits(hits)
					break
				}
				case "/doc": {
					if (!arg) throw new Error("Usage: /doc <slug>")
					const text = await client.getDocument(arg)
					console.log(text)
					break
				}
				case "/related": {
					if (!arg) throw new Error("Usage: /related <slug>")
					const rel = await client.getRelated(arg)
					console.log(
						rel.map((x) => `  ${x.title ?? x.slug} (${x.slug})`).join("\n"),
					)
					break
				}
				case "/create": {
					await interactiveCreate(client)
					break
				}
				case "/update": {
					if (!arg) throw new Error("Usage: /update <slug>")
					await interactiveUpdate(client, arg)
					break
				}
				case "/delete": {
					if (!arg) throw new Error("Usage: /delete <slug>")
					const res = await client.deleteDocument(arg)
					console.log(JSON.stringify(res, null, 2))
					break
				}
				case "/index": {
					if (!arg) throw new Error("Usage: /index <slug>")
					const res = await client.indexDocument(arg)
					console.log(JSON.stringify(res, null, 2))
					break
				}
				case "/status": {
					const res = await client.queueStatus()
					console.log(JSON.stringify(res, null, 2))
					break
				}
				case "/help":
					console.log(HELP)
					break
				case "/quit":
					await client.disconnect()
					process.exit(0)
					break
				default:
					console.log(`Unknown command: ${name}. Type /help for commands.`)
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			if (msg.includes("unauthorized")) {
				console.log(
					"⚠️  Write tools require x-webhook-secret. Set WEBHOOK_SECRET in your .env.",
				)
			} else {
				console.log(`Error: ${msg}`)
			}
		}

		readline.prompt()
	}
}

function printHits(hits: SearchHitSummary[]) {
	if (!hits.length) {
		console.log("No results.")
		return
	}
	for (const h of hits) {
		const slug = h.doc?.slug || h.slug || "?"
		const title = h.doc?.title || h.title || slug
		const score =
			h.rank !== undefined
				? `★ ${h.rank.toFixed(3)}`
				: h.score
					? `★ ${h.score.toFixed(3)}`
					: ""
		const section = h.doc?.section || h.section || ""
		console.log(`  ${title} ${score}`)
		console.log(`    /${slug}  ·  ${section}`)
		if (h.snippet || h.doc?.excerpt) {
			const snip = (h.snippet ?? h.doc?.excerpt ?? "").slice(0, 120)
			console.log(`    ${snip}...`)
		}
	}
}

async function ask(question: string): Promise<string> {
	const rl = await import("node:readline")
	return new Promise((resolve) => {
		const iface = rl.createInterface({
			input: process.stdin,
			output: process.stdout,
		})
		iface.question(question, (ans) => {
			iface.close()
			resolve(ans.trim())
		})
	})
}

async function interactiveCreate(client: McpediaClient) {
	console.log("\n--- Create Document ---")
	// The prompt lists what the registry actually holds rather than the four
	// names this CLI was written against. Sections are content now, so a prompt
	// naming a fixed set would both hide the sections an operator registered and
	// advertise ones that may have been unregistered. A registry read failure is
	// not fatal: the field accepts free text and the server validates it.
	const known = await client.listSections().catch(() => [])
	const offered = known.map((s) => s.id)
	const hint = offered.length > 0 ? offered.join("/") : "free text"
	const section =
		(await ask(`Section (${hint}) [${offered[0] ?? "docs"}]: `)) ||
		offered[0] ||
		"docs"
	const title = await ask("Title: ")
	if (!title) throw new Error("Title is required.")
	const slug =
		(await ask(`Slug (will become ${section}/<slug>): `)) ||
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
	const body = (await ask("Body (single line, or /edit for editor): ")) || ""
	const tagsStr = await ask("Tags (comma-separated): ")
	const tags = tagsStr
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean)
	const author = await ask("Author: ")

	const res = await client.createDocument({
		slug: `${section}/${slug}`,
		title,
		// Not narrowed to a union: createDocument takes the section as a plain
		// string, because the set of valid sections lives in the database.
		section,
		body,
		tags,
		author: author || undefined,
	})
	console.log(JSON.stringify(res, null, 2))
}

async function interactiveUpdate(client: McpediaClient, slug: string) {
	console.log(`\n--- Update: ${slug} ---`)
	const doc = await client.getDocument(slug)
	const body = (await ask(`Body (current: ${doc.slice(0, 50)}...): `)) || doc
	const title = (await ask("New title (or leave blank to keep): ")) || undefined
	const tagsStr =
		(await ask("New tags (comma-separated, or blank to keep): ")) || ""
	const tags = tagsStr
		? tagsStr
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: undefined

	const res = await client.updateDocument(slug, {
		...(title && { title }),
		body,
		...(tags && { tags }),
	})
	console.log(JSON.stringify(res, null, 2))
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
