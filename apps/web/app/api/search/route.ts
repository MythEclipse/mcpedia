import { NextRequest, NextResponse } from "next/server"
import { keywordSearch, hybridSearch, semanticSearch } from "@mcpedia/core"

// GET /api/search?q=...&mode=hybrid|keyword|semantic
export async function GET(req: NextRequest) {
	const { searchParams } = new URL(req.url)
	const q = searchParams.get("q") ?? ""
	const mode = searchParams.get("mode") ?? "hybrid"
	const limit = Math.min(
		Math.max(Number(searchParams.get("limit") ?? 20), 1),
		50,
	)

	if (!q.trim()) {
		return NextResponse.json({ results: [] })
	}

	try {
		if (mode === "keyword") {
			const hits = await keywordSearch(q, limit)
			return NextResponse.json({
				results: hits.map((h) => ({
					slug: h.doc.slug,
					title: h.doc.title,
					section: h.doc.section,
					score: h.rank,
					snippet: h.snippet,
				})),
			})
		}

		if (mode === "semantic") {
			const hits = await semanticSearch(q, limit)
			return NextResponse.json({
				results: hits.map((h) => ({
					slug: h.slug,
					title: h.slug.split("/").pop() ?? h.slug,
					section: h.slug.split("/")[0] ?? "docs",
					score: h.score,
					snippet: h.content.slice(0, 160),
				})),
			})
		}

		// Default: hybrid search
		const hits = await hybridSearch(q, limit)
		return NextResponse.json({
			results: hits.map((h) => ({
				slug: h.doc.slug,
				title: h.doc.title,
				section: h.doc.section,
				score: h.rank,
				snippet: h.snippet,
			})),
		})
	} catch (err) {
		console.error("Search API error:", err)
		// Fall back to keyword search if embedding provider fails
		try {
			const hits = await keywordSearch(q, limit)
			return NextResponse.json({
				results: hits.map((h) => ({
					slug: h.doc.slug,
					title: h.doc.title,
					section: h.doc.section,
					score: h.rank,
					snippet: h.snippet,
				})),
			})
		} catch {
			return NextResponse.json(
				{ results: [], error: "Search failed" },
				{ status: 500 },
			)
		}
	}
}
