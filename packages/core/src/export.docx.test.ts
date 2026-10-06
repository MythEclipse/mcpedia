import { describe, expect, it } from "vitest";
import {
  parseInlineMarkdown,
  convertMarkdownToDocx,
  generateExportDocx,
} from "./export.docx";
import type { ExportData } from "@mcpedia/types";

describe("DOCX Export Generator", () => {
  it("parseInlineMarkdown: formats plain, bold, italic, inline code, and links", () => {
    const text = "Hello **world** and *italic* with `const x = 1;` and [Link](https://example.com)";
    const runs = parseInlineMarkdown(text);
    expect(runs.length).toBeGreaterThan(1);
  });

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
`;
    const elements = convertMarkdownToDocx(markdown);
    expect(elements.length).toBeGreaterThan(5);
  });

  it("generateExportDocx: builds a valid Word document buffer with OpenXML signature", async () => {
    const mockExportData: ExportData = {
      summary: {
        title: "CTF 2026 Writeups",
        scope: "ctf/2026",
        section: "ctf",
        totalDocuments: 2,
        totalPoints: 600,
        categories: [
          { name: "Web", count: 1, points: 200 },
          { name: "Pwn", count: 1, points: 400 },
        ],
        authors: ["asepharyana"],
        generatedAt: new Date().toISOString(),
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          extraFields: { category: "Pwn", points: 400, difficulty: "Medium" },
          body: "## Challenge Overview\n\nStack buffer overflow vulnerability.",
        },
      ],
    };

    const buffer = await generateExportDocx(mockExportData, { pageBreaks: true });
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(1000);
    // Standard ZIP/DOCX magic bytes: 0x50, 0x4B, 0x03, 0x04 ('PK\x03\x04')
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
  });
});
