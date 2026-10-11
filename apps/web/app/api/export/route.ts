import { NextRequest, NextResponse } from "next/server"
import {
	getExportDocuments,
	compileExportMarkdown,
	generateExportDocx,
	type ExportSortOption,
} from "@mcpedia/core"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
	const { searchParams } = new URL(req.url)
	const path = searchParams.get("path") || undefined
	const section = searchParams.get("section") || undefined
	const format = searchParams.get("format") || "json"
	const sortBy =
		(searchParams.get("sort") as ExportSortOption) || "category_points"
	const slugsParam = searchParams.get("slugs")
	const slugs = slugsParam
		? slugsParam.split(",").map((s) => s.trim())
		: undefined
	const pageBreaksParam = searchParams.get("pageBreaks")
	const pageBreaks = pageBreaksParam !== "false" && pageBreaksParam !== "0"

	try {
		const data = await getExportDocuments({
			path,
			section,
			slugs,
			sortBy,
		})

		const safeFilename =
			data.summary.title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "") || "mcpedia-export"

		if (format === "docx" || format === "word") {
			const buffer = await generateExportDocx(data, { pageBreaks })
			const uint8 = new Uint8Array(buffer)
			return new NextResponse(uint8, {
				headers: {
					"Content-Type":
						"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					"Content-Disposition": `attachment; filename="${safeFilename}.docx"`,
				},
			})
		}

		if (format === "markdown" || format === "md") {
			const md = compileExportMarkdown(data)
			return new NextResponse(md, {
				headers: {
					"Content-Type": "text/markdown; charset=utf-8",
					"Content-Disposition": `attachment; filename="${safeFilename}.md"`,
				},
			})
		}

		return NextResponse.json(data)
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Export failed" },
			{ status: 500 },
		)
	}
}
