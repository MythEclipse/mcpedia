import { test, expect, describe } from "vitest";
import {
  extractDocCategory,
  extractDocPoints,
  extractDocDifficulty,
  sortExportDocuments,
  buildExportSummary,
  compileExportMarkdown,
  formatScopeTitle,
} from "./export.service";
import type { Document } from "@mcpedia/types";

describe("Export Service", () => {
  const sampleDocs: Document[] = [
    {
      id: "ctf/gemastik-2026-warmup/pwn-baby-heap",
      slug: "ctf/gemastik-2026-warmup/pwn-baby-heap",
      title: "Baby Heap",
      type: "writeup",
      section: "ctf",
      status: "published",
      author: "asepharyana",
      tags: ["pwn", "heap", "rop"],
      path: "ctf/gemastik-2026-warmup/pwn-baby-heap.md",
      createdAt: "2026-08-20T10:00:00Z",
      updatedAt: "2026-08-21T12:00:00Z",
      extraFields: {
        category: "Pwn",
        points: 500,
        difficulty: "Hard",
        event: "GEMASTIK 2026 Warmup",
      },
      body: "Heap exploitation walkthrough...",
    },
    {
      id: "ctf/gemastik-2026-warmup/web-login-bypass",
      slug: "ctf/gemastik-2026-warmup/web-login-bypass",
      title: "Login Bypass 101",
      type: "writeup",
      section: "ctf",
      status: "published",
      author: "asepharyana",
      tags: ["web", "sqli"],
      path: "ctf/gemastik-2026-warmup/web-login-bypass.md",
      createdAt: "2026-08-20T10:00:00Z",
      updatedAt: "2026-08-21T12:00:00Z",
      extraFields: {
        category: "Web",
        points: 100,
        difficulty: "Easy",
        event: "GEMASTIK 2026 Warmup",
      },
      body: "SQL injection in authentication handler...",
    },
    {
      id: "ctf/gemastik-2026-warmup/web-ssrf-vault",
      slug: "ctf/gemastik-2026-warmup/web-ssrf-vault",
      title: "SSRF Vault",
      type: "writeup",
      section: "ctf",
      status: "published",
      author: "team-member",
      tags: ["web", "ssrf"],
      path: "ctf/gemastik-2026-warmup/web-ssrf-vault.md",
      createdAt: "2026-08-20T10:00:00Z",
      updatedAt: "2026-08-21T12:00:00Z",
      extraFields: {
        category: "Web",
        points: 300,
        difficulty: "Medium",
        event: "GEMASTIK 2026 Warmup",
      },
      body: "Blind SSRF to AWS metadata...",
    },
    {
      id: "ctf/gemastik-2026-warmup/crypto-quantum-rsa",
      slug: "ctf/gemastik-2026-warmup/crypto-quantum-rsa",
      title: "Quantum RSA",
      type: "writeup",
      section: "ctf",
      status: "published",
      author: "asepharyana",
      tags: ["crypto", "rsa"],
      path: "ctf/gemastik-2026-warmup/crypto-quantum-rsa.md",
      createdAt: "2026-08-20T10:00:00Z",
      updatedAt: "2026-08-21T12:00:00Z",
      extraFields: {
        category: "Crypto",
        points: 250,
        difficulty: "Easy",
        event: "GEMASTIK 2026 Warmup",
      },
      body: "Coppersmith theorem applied to small roots...",
    },
    {
      id: "ctf/gemastik-2026-warmup/rev-rusty-keygen",
      slug: "ctf/gemastik-2026-warmup/rev-rusty-keygen",
      title: "Rusty Keygen",
      type: "writeup",
      section: "ctf",
      status: "published",
      author: "team-member",
      tags: ["reverse", "rust"],
      path: "ctf/gemastik-2026-warmup/rev-rusty-keygen.md",
      createdAt: "2026-08-20T10:00:00Z",
      updatedAt: "2026-08-21T12:00:00Z",
      extraFields: {
        category: "Reverse",
        points: 400,
        difficulty: "Medium",
        event: "GEMASTIK 2026 Warmup",
      },
      body: "Decompiling Rust binary using Ghidra...",
    },
  ];

  test("extractDocCategory: identifies category from extraFields, tags, or slug", () => {
    expect(extractDocCategory(sampleDocs[0]!)).toBe("Pwn");
    expect(extractDocCategory(sampleDocs[1]!)).toBe("Web");

    // Tag fallback
    const tagDoc: Document = {
      ...sampleDocs[0]!,
      extraFields: {},
      tags: ["forensics", "wireshark"],
    };
    expect(extractDocCategory(tagDoc)).toBe("Forensics");

    // Slug fallback
    const slugDoc: Document = {
      ...sampleDocs[0]!,
      slug: "ctf/event/crypto/chall1",
      extraFields: {},
      tags: [],
    };
    expect(extractDocCategory(slugDoc)).toBe("Crypto");
  });

  test("extractDocPoints: extracts numeric points correctly", () => {
    expect(extractDocPoints(sampleDocs[0]!)).toBe(500);
    expect(extractDocPoints(sampleDocs[1]!)).toBe(100);

    const stringPtsDoc: Document = {
      ...sampleDocs[0]!,
      extraFields: { points: "250 pts" },
    };
    expect(extractDocPoints(stringPtsDoc)).toBe(250);
  });

  test("sortExportDocuments: category_points sorts Web -> Crypto -> Rev -> Pwn and ascending points", () => {
    const sorted = sortExportDocuments(sampleDocs, "category_points");
    const titles = sorted.map((d) => d.title);

    // Expected order:
    // 1. Web: Login Bypass 101 (100 pts)
    // 2. Web: SSRF Vault (300 pts)
    // 3. Crypto: Quantum RSA (250 pts)
    // 4. Reverse: Rusty Keygen (400 pts)
    // 5. Pwn: Baby Heap (500 pts)
    expect(titles).toEqual([
      "Login Bypass 101",
      "SSRF Vault",
      "Quantum RSA",
      "Rusty Keygen",
      "Baby Heap",
    ]);
  });

  test("sortExportDocuments: points_desc sorts highest points first", () => {
    const sorted = sortExportDocuments(sampleDocs, "points_desc");
    const points = sorted.map((d) => extractDocPoints(d));
    expect(points).toEqual([500, 400, 300, 250, 100]);
  });

  test("sortExportDocuments: title sorts alphabetically", () => {
    const sorted = sortExportDocuments(sampleDocs, "title");
    const titles = sorted.map((d) => d.title);
    expect(titles).toEqual([
      "Baby Heap",
      "Login Bypass 101",
      "Quantum RSA",
      "Rusty Keygen",
      "SSRF Vault",
    ]);
  });

  test("formatScopeTitle: formats event paths into clean report titles", () => {
    expect(formatScopeTitle("ctf/gemastik-2026-warmup")).toBe(
      "GEMASTIK 2026 Warmup — CTF Writeups Report",
    );
    expect(formatScopeTitle("docs/getting-started")).toBe("Getting Started");
  });

  test("buildExportSummary: aggregates total points, categories, and authors", () => {
    const summary = buildExportSummary(
      sampleDocs,
      "ctf/gemastik-2026-warmup",
      "ctf",
    );
    expect(summary.totalDocuments).toBe(5);
    expect(summary.totalPoints).toBe(1550); // 500+100+300+250+400
    expect(summary.authors).toContain("asepharyana");
    expect(summary.authors).toContain("team-member");
    expect(summary.categories.map((c) => c.name)).toEqual([
      "Web",
      "Crypto",
      "Reverse",
      "Pwn",
    ]);
  });

  test("compileExportMarkdown: creates complete single markdown report", () => {
    const exportData = {
      summary: buildExportSummary(
        sampleDocs,
        "ctf/gemastik-2026-warmup",
        "ctf",
      ),
      documents: sortExportDocuments(sampleDocs, "category_points"),
    };
    const md = compileExportMarkdown(exportData);

    expect(md).toContain("# GEMASTIK 2026 Warmup — CTF Writeups Report");
    expect(md).toContain("## Challenge Overview");
    expect(md).toContain("## Chapter 1: Login Bypass 101");
    expect(md).toContain("**Category:** `Web`");
    expect(md).toContain("**Points:** `100 pts`");
    expect(md).toContain("## Chapter 5: Baby Heap");
  });
});
