import { NextRequest, NextResponse } from "next/server"
import { listRevisions } from "@mcpedia/core"

export const dynamic = "force-dynamic"

// GET /api/revisions?slug=...&limit=10
export async function GET(req: NextRequest) {
	const { searchParams } = new URL(req.url)
	const slug = searchParams.get("slug") ?? ""
	const limit = Math.min(
		Math.max(Number(searchParams.get("limit") ?? 10), 1),
		50,
	)
	if (!slug.trim()) {
		return NextResponse.json({ revisions: [] })
	}
	try {
		const revisions = await listRevisions(slug, limit)
		return NextResponse.json({ revisions })
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return NextResponse.json({ revisions: [], error: msg }, { status: 500 })
	}
}
