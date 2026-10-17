import type { ExportData } from "@mcpedia/types"
import { describe, expect, it } from "vitest"
import {
	convertMarkdownToDocx,
	generateExportDocx,
	parseInlineMarkdown,
} from "./export.docx"

/**
 * A realistic two-document export, shared by the generator tests.
 *
 * A factory rather than a module constant because the generator MUTATES nothing
 * but the tests read it more than once, and a shared object across tests is the
 * kind of aliasing that makes a later test's failure depend on run order.
 */
function makeMockExportData(): ExportData {
	const now = new Date().toISOString()
	return {
		summary: {
			title: "CTF 2026 Writeups",
			scope: "ctf/2026",
			section: "ctf",
			sectionLabel: "CTF",
			totalDocuments: 2,
			totalPoints: 600,
			categories: [
				{ name: "Web", count: 1, points: 200 },
				{ name: "Pwn", count: 1, points: 400 },
			],
			authors: ["asepharyana"],
			generatedAt: now,
		},
		documents: [
			{
				id: "ctf/2026/web/baby-web",
				slug: "ctf/2026/web/baby-web",
				title: "Baby Web",
				section: "ctf",
				type: "writeup",
				status: "published",
				author: "asepharyana",
				tags: ["web", "sqli"],
				path: "ctf/2026/web/baby-web.md",
				createdAt: now,
				updatedAt: now,
				extraFields: { category: "Web", points: 200, difficulty: "Easy" },
				body: "# Baby Web\n\nSolution explanation here.\n\n```sql\nSELECT * FROM users;\n```",
			},
			{
				id: "ctf/2026/pwn/ret2win",
				slug: "ctf/2026/pwn/ret2win",
				title: "Ret2Win Challenge",
				section: "ctf",
				type: "writeup",
				status: "published",
				author: "asepharyana",
				tags: ["pwn", "rop"],
				path: "ctf/2026/pwn/ret2win.md",
				createdAt: now,
				updatedAt: now,
				extraFields: { category: "Pwn", points: 400, difficulty: "Medium" },
				body: "## Challenge Overview\n\nStack buffer overflow vulnerability.",
			},
		],
	}
}

describe("DOCX Export Generator", () => {
	it("parseInlineMarkdown: formats plain, bold, italic, inline code, and links", () => {
		const text =
			"Hello **world** and *italic* with `const x = 1;` and [Link](https://example.com)"
		const runs = parseInlineMarkdown(text)
		expect(runs.length).toBeGreaterThan(1)
	})

	it("convertMarkdownToDocx: handles headings, tables, callouts, and code blocks", () => {
		const markdown = `
# Title
Some paragraph text with **bold** words.

## Subsection
> [!NOTE]
> This is a crucial note for testing.

\`\`\`python
def solve():
    return "flag{test}"
\`\`\`

| Challenge | Points |
| --- | --- |
| Chall 1 | 100 |
| Chall 2 | 200 |

- Item 1
- Item 2

1. First
2. Second
`
		const elements = convertMarkdownToDocx(markdown)
		expect(elements.length).toBeGreaterThan(5)
	})

	it("generateExportDocx: builds a valid Word document with OpenXML signature", async () => {
		const bytes = await generateExportDocx(makeMockExportData(), {
			pageBreaks: true,
		})
		expect(bytes).toBeDefined()
		expect(bytes.length).toBeGreaterThan(1000)
		// Standard ZIP/DOCX magic bytes: 0x50, 0x4B, 0x03, 0x04 ('PK\x03\x04')
		expect(bytes[0]).toBe(0x50)
		expect(bytes[1]).toBe(0x4b)
		expect(bytes[2]).toBe(0x03)
		expect(bytes[3]).toBe(0x04)
	})

	/**
	 * REGRESSION GUARD for the browser-host bug.
	 *
	 * The export used to end with `Packer.toBuffer`, whose JSZip output type
	 * `"nodebuffer"` is gated on a bare `Buffer` GLOBAL. That threw
	 * `nodebuffer is not supported by this platform` in the browser — every
	 * export click left the button reading "Failed".
	 *
	 * WHY THIS IS A SOURCE CHECK AND NOT A RUNTIME CHECK. A runtime test cannot
	 * see this bug here: Node HAS a global `Buffer`, so `toBuffer` works in this
	 * process no matter what the browser does. (Deleting the global is not a
	 * faithful simulation either — it trips `docx`'s inlined `buffer` polyfill
	 * at `Object.isBuffer` with a plain `ReferenceError`, a path the browser
	 * bundle never reaches because esbuild inlines the shim there.) The
	 * faithful reproduction is an esbuild `platform: "browser"` bundle executed
	 * with no global `Buffer`, which was run by hand to confirm the diagnosis
	 * and the fix.
	 *
	 * What CAN be asserted here is the invariant that actually broke: the
	 * generator must not ask JSZip for a Node-only output type. `toArrayBuffer`
	 * needs no global at all, which is why it is the one that works in both
	 * hosts.
	 */
	it("generateExportDocx: does not ask JSZip for the Node-only nodebuffer type", async () => {
		const { readFile } = await import("node:fs/promises")
		const { fileURLToPath } = await import("node:url")
		const raw = await readFile(
			fileURLToPath(new URL("./export.docx.ts", import.meta.url)),
			"utf8",
		)

		// Comments are stripped before the check, because the file's own doc
		// comments quote `Packer.toBuffer` to explain this very bug. Without the
		// strip, the explanation would trip its own guard.
		const code = raw
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:])\/\/.*$/gm, "$1")

		expect(code).not.toMatch(/Packer\s*\.\s*toBuffer\s*\(/)
		expect(code).toMatch(/Packer\s*\.\s*toArrayBuffer\s*\(/)
	})
})
