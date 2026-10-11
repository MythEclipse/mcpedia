import {
	Document as DocxDocument,
	Paragraph,
	TextRun,
	Table,
	TableRow,
	TableCell,
	HeadingLevel,
	AlignmentType,
	BorderStyle,
	WidthType,
	ShadingType,
	PageBreak,
	Header,
	Footer,
	PageNumber,
	Packer,
	ExternalHyperlink,
} from "docx"
import type {
	Document as CoreDocument,
	ExportData,
	ExportSummary,
} from "@mcpedia/types"
import {
	extractDocCategory,
	extractDocPoints,
	extractDocDifficulty,
} from "./export.helpers"

// ---------------------------------------------------------------------------
// Markdown to DOCX Inlines & Blocks Parser
// ---------------------------------------------------------------------------

type InlineElement = TextRun | ExternalHyperlink

/**
 * Parse inline markdown formatting (bold, italic, code, links) into docx TextRuns / Hyperlinks.
 */
export function parseInlineMarkdown(text: string): InlineElement[] {
	if (!text) return []

	const elements: InlineElement[] = []

	// Regex pattern matching:
	// 1. Links: [text](url)
	// 2. Inline code: `code`
	// 3. Bold + Italic: ***text*** or ___text___
	// 4. Bold: **text** or __text__
	// 5. Italic: *text* or _text_
	const inlineRegex =
		/(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*\*([^*]+)\*\*\*|___([^_]+)___|\*\*([^*]+)\*\*|__([^_]+)__|(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_))/g

	let lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = inlineRegex.exec(text)) !== null) {
		// Add any preceding plain text
		if (match.index > lastIndex) {
			elements.push(
				new TextRun({
					text: text.slice(lastIndex, match.index),
					font: "Inter, Calibri, Arial",
					size: 20, // 10pt
					color: "1E293B",
				}),
			)
		}

		if (match[2] && match[3]) {
			// Hyperlink [text](url)
			elements.push(
				new ExternalHyperlink({
					children: [
						new TextRun({
							text: match[2],
							font: "Inter, Calibri, Arial",
							size: 20,
							color: "2563EB",
							underline: {},
						}),
					],
					link: match[3],
				}),
			)
		} else if (match[4]) {
			// Inline code `code`
			elements.push(
				new TextRun({
					text: match[4],
					font: "Consolas, Courier New",
					size: 18, // 9pt
					color: "0F172A",
					shading: {
						type: ShadingType.CLEAR,
						fill: "F1F5F9",
						color: "auto",
					},
				}),
			)
		} else if (match[5] || match[6]) {
			// Bold + Italic ***text***
			elements.push(
				new TextRun({
					text: match[5] || match[6],
					font: "Inter, Calibri, Arial",
					size: 20,
					bold: true,
					italics: true,
					color: "0F172A",
				}),
			)
		} else if (match[7] || match[8]) {
			// Bold **text**
			elements.push(
				new TextRun({
					text: match[7] || match[8],
					font: "Inter, Calibri, Arial",
					size: 20,
					bold: true,
					color: "0F172A",
				}),
			)
		} else if (match[9] || match[10]) {
			// Italic *text*
			elements.push(
				new TextRun({
					text: match[9] || match[10],
					font: "Inter, Calibri, Arial",
					size: 20,
					italics: true,
					color: "334155",
				}),
			)
		}

		lastIndex = inlineRegex.lastIndex
	}

	// Trailing plain text
	if (lastIndex < text.length) {
		elements.push(
			new TextRun({
				text: text.slice(lastIndex),
				font: "Inter, Calibri, Arial",
				size: 20,
				color: "1E293B",
			}),
		)
	}

	return elements.length > 0
		? elements
		: [
				new TextRun({
					text,
					font: "Inter, Calibri, Arial",
					size: 20,
					color: "1E293B",
				}),
			]
}

/**
 * Parse markdown table lines into a Docx Table.
 */
function parseMarkdownTable(tableLines: string[]): Table | null {
	if (tableLines.length < 2) return null

	const rows: string[][] = []
	for (const line of tableLines) {
		const trimmed = line.trim()
		if (!trimmed.startsWith("|") && !trimmed.endsWith("|")) continue
		// Skip separator line (|---|---|)
		if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue

		const cells = trimmed
			.split("|")
			.slice(1, -1)
			.map((c) => c.trim())
		rows.push(cells)
	}

	if (rows.length === 0) return null

	const colCount = Math.max(...rows.map((r) => r.length))

	return new Table({
		width: { size: 100, type: WidthType.PERCENTAGE },
		margins: {
			top: 100,
			bottom: 100,
			left: 140,
			right: 140,
		},
		rows: rows.map((rowCells, rowIdx) => {
			const isHeader = rowIdx === 0
			return new TableRow({
				tableHeader: isHeader,
				children: Array.from({ length: colCount }).map((_, colIdx) => {
					const cellText = rowCells[colIdx] || ""
					return new TableCell({
						shading: isHeader
							? { type: ShadingType.CLEAR, fill: "F1F5F9", color: "auto" }
							: rowIdx % 2 === 1
								? { type: ShadingType.CLEAR, fill: "FFFFFF", color: "auto" }
								: { type: ShadingType.CLEAR, fill: "F8FAFC", color: "auto" },
						borders: {
							top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
							bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
							left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
							right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
						},
						children: [
							new Paragraph({
								spacing: { before: 40, after: 40 },
								children: isHeader
									? [
											new TextRun({
												text: cellText,
												font: "Inter, Calibri, Arial",
												size: 18,
												bold: true,
												color: "0F172A",
											}),
										]
									: parseInlineMarkdown(cellText),
							}),
						],
					})
				}),
			})
		}),
	})
}

/**
 * Convert a markdown body string into an array of docx Paragraphs and Tables.
 */
export function convertMarkdownToDocx(markdown: string): (Paragraph | Table)[] {
	const elements: (Paragraph | Table)[] = []
	const lines = markdown.split(/\r?\n/)

	let i = 0
	while (i < lines.length) {
		const line = lines[i]
		const trimmed = line.trim()

		// 1. Blank lines
		if (trimmed === "") {
			i++
			continue
		}

		// 2. Fenced Code Blocks (```lang ... ```)
		if (trimmed.startsWith("```")) {
			const lang = trimmed.slice(3).trim()
			const codeLines: string[] = []
			i++
			while (i < lines.length && !lines[i].trim().startsWith("```")) {
				codeLines.push(lines[i])
				i++
			}
			i++ // skip closing ```

			const codeParagraphs = codeLines.map(
				(codeLine) =>
					new Paragraph({
						spacing: { before: 0, after: 0, line: 240 },
						children: [
							new TextRun({
								text: codeLine.replace(/\t/g, "    ") || " ",
								font: "Consolas, Courier New",
								size: 17, // 8.5pt
								color: "0F172A",
							}),
						],
					}),
			)

			// Wrap in a shaded callout table for code box look
			const codeBox = new Table({
				width: { size: 100, type: WidthType.PERCENTAGE },
				margins: { top: 120, bottom: 120, left: 160, right: 160 },
				rows: [
					new TableRow({
						children: [
							new TableCell({
								shading: {
									type: ShadingType.CLEAR,
									fill: "F8FAFC",
									color: "auto",
								},
								borders: {
									top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
									bottom: {
										style: BorderStyle.SINGLE,
										size: 6,
										color: "CBD5E1",
									},
									left: {
										style: BorderStyle.SINGLE,
										size: 18,
										color: "64748B",
									}, // darker left accent
									right: {
										style: BorderStyle.SINGLE,
										size: 6,
										color: "CBD5E1",
									},
								},
								children: [
									...(lang
										? [
												new Paragraph({
													spacing: { before: 0, after: 60 },
													children: [
														new TextRun({
															text: lang.toUpperCase(),
															font: "Consolas, Courier New",
															size: 15,
															bold: true,
															color: "64748B",
														}),
													],
												}),
											]
										: []),
									...codeParagraphs,
								],
							}),
						],
					}),
				],
			})

			elements.push(codeBox)
			elements.push(new Paragraph({ spacing: { before: 80, after: 0 } }))
			continue
		}

		// 3. Markdown Tables (| col1 | col2 |)
		if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
			const tableLines: string[] = []
			while (i < lines.length && lines[i].trim().startsWith("|")) {
				tableLines.push(lines[i])
				i++
			}
			const table = parseMarkdownTable(tableLines)
			if (table) {
				elements.push(table)
				elements.push(new Paragraph({ spacing: { before: 80, after: 0 } }))
			}
			continue
		}

		// 4. Blockquotes & GitHub Alert Callouts (> [!NOTE], > [!TIP], etc.)
		if (trimmed.startsWith(">")) {
			const quoteLines: string[] = []
			while (i < lines.length && lines[i].trim().startsWith(">")) {
				quoteLines.push(lines[i].trim().replace(/^>\s?/, ""))
				i++
			}

			const fullQuote = quoteLines.join("\n")
			const alertMatch = fullQuote.match(
				/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i,
			)

			let borderColor = "3B82F6" // Blue
			let fillColor = "EFF6FF"
			let title = "NOTE"

			if (alertMatch) {
				const alertType = alertMatch[1].toUpperCase()
				if (alertType === "TIP") {
					borderColor = "10B981"
					fillColor = "ECFDF5"
					title = "TIP"
				} else if (alertType === "IMPORTANT") {
					borderColor = "8B5CF6"
					fillColor = "F5F3FF"
					title = "IMPORTANT"
				} else if (alertType === "WARNING") {
					borderColor = "F59E0B"
					fillColor = "FFFBEB"
					title = "WARNING"
				} else if (alertType === "CAUTION") {
					borderColor = "EF4444"
					fillColor = "FEF2F2"
					title = "CAUTION"
				}
			}

			const contentLines = alertMatch
				? fullQuote
						.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i, "")
						.split("\n")
				: quoteLines

			const calloutTable = new Table({
				width: { size: 100, type: WidthType.PERCENTAGE },
				margins: { top: 100, bottom: 100, left: 160, right: 160 },
				rows: [
					new TableRow({
						children: [
							new TableCell({
								shading: {
									type: ShadingType.CLEAR,
									fill: fillColor,
									color: "auto",
								},
								borders: {
									top: { style: BorderStyle.NONE, size: 0, color: "auto" },
									bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
									left: {
										style: BorderStyle.SINGLE,
										size: 24,
										color: borderColor,
									},
									right: { style: BorderStyle.NONE, size: 0, color: "auto" },
								},
								children: [
									...(alertMatch
										? [
												new Paragraph({
													spacing: { before: 0, after: 40 },
													children: [
														new TextRun({
															text: `[ ${title} ]`,
															font: "Inter, Calibri, Arial",
															size: 18,
															bold: true,
															color: borderColor,
														}),
													],
												}),
											]
										: []),
									...contentLines.map(
										(qLine) =>
											new Paragraph({
												spacing: { before: 20, after: 40 },
												children: parseInlineMarkdown(qLine),
											}),
									),
								],
							}),
						],
					}),
				],
			})

			elements.push(calloutTable)
			elements.push(new Paragraph({ spacing: { before: 80, after: 0 } }))
			continue
		}

		// 5. Headings
		if (trimmed.startsWith("#### ")) {
			elements.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_4,
					spacing: { before: 180, after: 60 },
					children: [
						new TextRun({
							text: trimmed.slice(5),
							font: "Inter, Calibri, Arial",
							size: 22, // 11pt
							bold: true,
							color: "1E293B",
						}),
					],
				}),
			)
			i++
			continue
		}

		if (trimmed.startsWith("### ")) {
			elements.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_3,
					spacing: { before: 220, after: 80 },
					children: [
						new TextRun({
							text: trimmed.slice(4),
							font: "Inter, Calibri, Arial",
							size: 24, // 12pt
							bold: true,
							color: "0F172A",
						}),
					],
				}),
			)
			i++
			continue
		}

		if (trimmed.startsWith("## ")) {
			elements.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_2,
					spacing: { before: 280, after: 100 },
					border: {
						bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
					},
					children: [
						new TextRun({
							text: trimmed.slice(3),
							font: "Inter, Calibri, Arial",
							size: 28, // 14pt
							bold: true,
							color: "020617",
						}),
					],
				}),
			)
			i++
			continue
		}

		if (trimmed.startsWith("# ")) {
			elements.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_1,
					spacing: { before: 320, after: 120 },
					border: {
						bottom: { style: BorderStyle.SINGLE, size: 8, color: "CBD5E1" },
					},
					children: [
						new TextRun({
							text: trimmed.slice(2),
							font: "Inter, Calibri, Arial",
							size: 34, // 17pt
							bold: true,
							color: "020617",
						}),
					],
				}),
			)
			i++
			continue
		}

		// 6. Horizontal Rule (--- or ***)
		if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
			elements.push(
				new Paragraph({
					spacing: { before: 120, after: 120 },
					border: {
						bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
					},
				}),
			)
			i++
			continue
		}

		// 7. Bullet Lists (- item or * item)
		if (/^[-*+]\s+/.test(trimmed)) {
			const itemText = trimmed.replace(/^[-*+]\s+/, "")
			elements.push(
				new Paragraph({
					bullet: { level: 0 },
					spacing: { before: 20, after: 40 },
					children: parseInlineMarkdown(itemText),
				}),
			)
			i++
			continue
		}

		// 8. Numbered Lists (1. item)
		if (/^\d+\.\s+/.test(trimmed)) {
			const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
			const num = numMatch ? numMatch[1] : "1"
			const itemText = numMatch ? numMatch[2] : trimmed
			elements.push(
				new Paragraph({
					spacing: { before: 20, after: 40 },
					indent: { left: 360 },
					children: [
						new TextRun({
							text: `${num}.  `,
							font: "Inter, Calibri, Arial",
							size: 20,
							bold: true,
							color: "475569",
						}),
						...parseInlineMarkdown(itemText),
					],
				}),
			)
			i++
			continue
		}

		// 9. Standard Paragraph
		elements.push(
			new Paragraph({
				spacing: { before: 40, after: 100, line: 276 }, // 1.15 line spacing
				children: parseInlineMarkdown(line),
			}),
		)
		i++
	}

	return elements
}

// ---------------------------------------------------------------------------
// DOCX Document Builder
// ---------------------------------------------------------------------------

export interface DocxExportOptions {
	pageBreaks?: boolean
}

/**
 * Generate a complete, publication-grade Microsoft Word (.docx) document
 * from MCPedia ExportData.
 */
export async function generateExportDocx(
	exportData: ExportData,
	options: DocxExportOptions = {},
): Promise<Buffer> {
	const { summary, documents: docs } = exportData
	const pageBreaks = options.pageBreaks ?? true

	const docChildren: (Paragraph | Table)[] = []

	// ==========================================
	// 1. Document Cover & Header
	// ==========================================
	docChildren.push(
		new Paragraph({
			heading: HeadingLevel.TITLE,
			spacing: { before: 0, after: 120 },
			children: [
				new TextRun({
					text: summary.title,
					font: "Inter, Calibri, Arial",
					size: 44, // 22pt
					bold: true,
					color: "020617",
				}),
			],
		}),
	)

	// Metadata subtitle
	const metaParts: string[] = [
		`${summary.totalDocuments} Challenge${summary.totalDocuments !== 1 ? "s" : ""}`,
	]
	if (summary.totalPoints > 0) {
		metaParts.push(`${summary.totalPoints.toLocaleString()} Total Points`)
	}
	metaParts.push(
		new Date(summary.generatedAt).toLocaleDateString(undefined, {
			dateStyle: "long",
		}),
	)
	if (summary.authors && summary.authors.length > 0) {
		metaParts.push(`Authors: ${summary.authors.join(", ")}`)
	}

	docChildren.push(
		new Paragraph({
			spacing: { before: 0, after: 240 },
			border: {
				bottom: { style: BorderStyle.SINGLE, size: 8, color: "CBD5E1" },
			},
			children: [
				new TextRun({
					text: metaParts.join("   ·   "),
					font: "Consolas, Courier New",
					size: 18, // 9pt
					color: "64748B",
				}),
			],
		}),
	)

	// ==========================================
	// 2. Table of Contents / Matrix (if > 1 doc)
	// ==========================================
	if (docs.length > 1) {
		docChildren.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_2,
				spacing: { before: 200, after: 120 },
				children: [
					new TextRun({
						text: "Table of Contents & Overview",
						font: "Inter, Calibri, Arial",
						size: 26, // 13pt
						bold: true,
						color: "0F172A",
					}),
				],
			}),
		)

		const tocRows: string[][] = [
			["#", "Challenge Title", "Category", "Points", "Difficulty"],
		]

		docs.forEach((doc, idx) => {
			const chNum = String(idx + 1)
			const cat = extractDocCategory(doc)
			const pts = extractDocPoints(doc)
			const diff = extractDocDifficulty(doc) || "-"
			tocRows.push([chNum, doc.title, cat, pts > 0 ? `${pts} pts` : "-", diff])
		})

		const tocTable = parseMarkdownTable(
			tocRows.map((r) => `| ${r.join(" | ")} |`),
		)
		if (tocTable) {
			docChildren.push(tocTable)
		}

		docChildren.push(
			new Paragraph({
				spacing: { before: 200, after: 200 },
				border: {
					bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
				},
			}),
		)
	}

	// ==========================================
	// 3. Challenge Writeup Chapters
	// ==========================================
	docs.forEach((doc, idx) => {
		const chNum = idx + 1
		const cat = extractDocCategory(doc)
		const pts = extractDocPoints(doc)
		const diff = extractDocDifficulty(doc)

		// Page break between challenges
		if (pageBreaks && idx > 0) {
			docChildren.push(
				new Paragraph({
					children: [new PageBreak()],
				}),
			)
		}

		// Chapter Title
		docChildren.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				spacing: { before: pageBreaks ? 0 : 280, after: 80 },
				children: [
					new TextRun({
						text: `${chNum}. ${doc.title}`,
						font: "Inter, Calibri, Arial",
						size: 32, // 16pt
						bold: true,
						color: "020617",
					}),
				],
			}),
		)

		// Metadata Badge Ribbon
		const badgeTextParts: string[] = [`CATEGORY: ${cat.toUpperCase()}`]
		if (pts > 0) badgeTextParts.push(`POINTS: ${pts} PTS`)
		if (diff) badgeTextParts.push(`DIFFICULTY: ${diff.toUpperCase()}`)
		if (doc.author) badgeTextParts.push(`AUTHOR: ${doc.author}`)

		docChildren.push(
			new Paragraph({
				spacing: { before: 0, after: 180 },
				border: {
					bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
				},
				children: [
					new TextRun({
						text: badgeTextParts.join("   |   "),
						font: "Consolas, Courier New",
						size: 16, // 8pt
						bold: true,
						color: "475569",
					}),
				],
			}),
		)

		// Markdown Writeup Content
		const contentElements = convertMarkdownToDocx(doc.body)
		docChildren.push(...contentElements)

		// Subtle divider after challenge (when not page breaking)
		if (!pageBreaks && idx < docs.length - 1) {
			docChildren.push(
				new Paragraph({
					spacing: { before: 180, after: 180 },
					border: {
						bottom: { style: BorderStyle.DASHED, size: 6, color: "CBD5E1" },
					},
				}),
			)
		}
	})

	// ==========================================
	// 4. Construct Final DOCX Package
	// ==========================================
	const docx = new DocxDocument({
		creator: "MCPedia Knowledge Base",
		title: summary.title,
		description: `Export of ${summary.title} generated by MCPedia`,
		sections: [
			{
				properties: {
					page: {
						margin: {
							top: 1440, // 1 inch (1440 dxa)
							bottom: 1440,
							left: 1440,
							right: 1440,
						},
					},
				},
				headers: {
					default: new Header({
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								spacing: { after: 120 },
								children: [
									new TextRun({
										text: `MCPedia  ·  ${summary.title}`,
										font: "Consolas, Courier New",
										size: 16,
										color: "94A3B8",
									}),
								],
							}),
						],
					}),
				},
				footers: {
					default: new Footer({
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								spacing: { before: 120 },
								children: [
									new TextRun({
										text: "Page ",
										font: "Inter, Calibri, Arial",
										size: 16,
										color: "94A3B8",
									}),
									new TextRun({
										children: [PageNumber.CURRENT],
										font: "Inter, Calibri, Arial",
										size: 16,
										color: "94A3B8",
									}),
									new TextRun({
										text: " of ",
										font: "Inter, Calibri, Arial",
										size: 16,
										color: "94A3B8",
									}),
									new TextRun({
										children: [PageNumber.TOTAL_PAGES],
										font: "Inter, Calibri, Arial",
										size: 16,
										color: "94A3B8",
									}),
								],
							}),
						],
					}),
				},
				children: docChildren,
			},
		],
	})

	return await Packer.toBuffer(docx)
}
