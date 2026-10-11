import { NextRequest, NextResponse } from "next/server"
import { getRelated } from "@mcpedia/core"

export const dynamic = "force-dynamic"

// GET /api/related?slug=...&limit=5
export async function GET(req: NextRequest) {
	const slug = new URL(req.url).searchParams.get("slug") ?? ""
	const limit = Math.min(
		Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 5), 1),
		20,
	)
	if (!slug.trim()) {
		return NextResponse.json({ results: [] })
	}
	try {
		const results = await getRelated(slug, limit)
		return NextResponse.json({ results })
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return NextResponse.json({ results: [], error: msg }, { status: 500 })
	}
}
