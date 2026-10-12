import { McpediaClient } from "./client"

// One-shot MCP client — runs a single tool call and prints the result.
//
// Usage:
//   bun run ask search "websocket"
//   bun run ask doc docs/websocket/contract
//   bun run ask tools
//   bun run ask resources
//   bun run ask hybrid "what is MCP"
//   bun run ask create --slug=docs/my-doc --title="My Doc" --body="Hello"
//       (note: create requires WEBHOOK_SECRET env)
//   bun run ask delete docs/my-doc

const MCP_URL = process.env.MCP_URL ?? "https://mcp.asepharyana.my.id/mcp"

/** The sections `createDocument` accepts. */
const DOC_SECTIONS = ["docs", "writeups", "research", "notes"] as const
type DocSection = (typeof DOC_SECTIONS)[number]

/**
 * Narrow a free-text `--section=` argument to a valid section.
 *
 * The CLI takes an arbitrary string, so this validates rather than asserting:
 * an unrecognised value is rejected loudly instead of being forwarded to the
 * server as a section that does not exist. Defaults to "docs", matching the
 * previous `opts.section || "docs"`.
 */
function toDocSection(raw: string | undefined): DocSection {
	if (raw === undefined || raw === "") return "docs"
	const match = DOC_SECTIONS.find((s) => s === raw)
	if (!match) {
		throw new Error(
			`Unknown section "${raw}". Expected one of: ${DOC_SECTIONS.join(", ")}`,
		)
	}
	return match
}

async function main() {
	const [, , command, ...args] = process.argv
	if (!command) {
		console.error("Usage: ask <command> [args...]")
		console.error(
			"Commands: tools, resources, search <q>, ss <q>, hybrid <q>, doc <slug>, related <slug>, create, delete <slug>, index <slug>, status",
		)
		process.exit(1)
	}

	const headers: Record<string, string> = {}
	const secret = process.env.WEBHOOK_SECRET
	if (secret) headers["x-webhook-secret"] = secret

	const client = await McpediaClient.connect(MCP_URL, { headers })

	try {
		switch (command) {
			case "tools": {
				const tools = await client.listTools()
				console.log(
					JSON.stringify(
						tools.map((t) => ({
							name: t.name,
							description: t.description,
						})),
						null,
						2,
					),
				)
				break
			}
			case "resources": {
				const res = await client.listResources()
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "search": {
				const q = args.join(" ")
				if (!q) throw new Error("search requires a query")
				const hits = await client.search(q)
				console.log(JSON.stringify(hits, null, 2))
				break
			}
			case "ss": {
				const q = args.join(" ")
				if (!q) throw new Error("ss requires a query")
				const hits = await client.semanticSearch(q)
				console.log(JSON.stringify(hits, null, 2))
				break
			}
			case "hybrid": {
				const q = args.join(" ")
				if (!q) throw new Error("hybrid requires a query")
				const hits = await client.hybridSearch(q)
				console.log(JSON.stringify(hits, null, 2))
				break
			}
			case "doc": {
				const slug = args[0]
				if (!slug) throw new Error("doc requires a slug")
				const body = await client.getDocument(slug)
				console.log(body)
				break
			}
			case "related": {
				const slug = args[0]
				if (!slug) throw new Error("related requires a slug")
				const rel = await client.getRelated(slug)
				console.log(JSON.stringify(rel, null, 2))
				break
			}
			case "create": {
				const opts: Record<string, string> = {}
				for (const arg of args) {
					const [k, v] = arg.split("=") as [string, string]
					if (k && v) opts[k.replace("--", "")] = v
				}
				const res = await client.createDocument({
					slug: opts.slug || "",
					title: opts.title || "Untitled",
					section: toDocSection(opts.section),
					body: opts.body || "",
					tags: opts.tags ? opts.tags.split(",") : [],
					author: opts.author,
				})
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "delete": {
				const slug = args[0]
				if (!slug) throw new Error("delete requires a slug")
				const res = await client.deleteDocument(slug)
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "index": {
				const slug = args[0]
				if (!slug) throw new Error("index requires a slug")
				const res = await client.indexDocument(slug)
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "status": {
				const res = await client.queueStatus()
				console.log(JSON.stringify(res, null, 2))
				break
			}
			default:
				console.error(`Unknown command: ${command}`)
				process.exit(1)
		}
	} finally {
		await client.disconnect()
	}
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err)
	if (msg.includes("unauthorized")) {
		console.error(
			"⚠️  Write tools require x-webhook-secret. Set WEBHOOK_SECRET env var.",
		)
	} else {
		console.error(`Error: ${msg}`)
	}
	process.exit(1)
})
