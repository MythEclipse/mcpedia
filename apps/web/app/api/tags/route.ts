import { NextResponse } from "next/server"
import { listDocuments } from "@mcpedia/core"

export const dynamic = "force-dynamic"

// GET /api/tags?limit=30  — aggregated tag counts
export async function GET(req: Request) {
	const limit = Math.min(
		Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 30), 1),
		100,
	)
	try {
		const docs = await listDocuments()
		const counts = new Map<string, number>()
		for (const d of docs) {
			for (const t of d.tags ?? []) {
				const tag = String(t).trim()
				if (!tag) continue
				counts.set(tag, (counts.get(tag) ?? 0) + 1)
			}
		}
		const tags = [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
			.slice(0, limit)
		return NextResponse.json({ tags })
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return NextResponse.json({ tags: [], error: msg }, { status: 500 })
	}
}
