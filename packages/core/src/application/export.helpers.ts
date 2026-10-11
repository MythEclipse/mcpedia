import { getSectionMeta } from "@mcpedia/config/sections"
import type {
	Document,
	DocumentMeta,
	ExportCategorySummary,
	ExportData,
	ExportSortOption,
	ExportSummary,
} from "@mcpedia/types"

export type {
	Document,
	DocumentMeta,
	ExportCategorySummary,
	ExportData,
	ExportSortOption,
	ExportSummary,
}

/**
 * Standard category order priority for CTF challenges & writeups.
 */
export const CTF_CATEGORY_PRIORITY: Record<string, number> = {
	web: 10,
	"web exploitation": 10,
	"web security": 10,
	crypto: 20,
	cryptography: 20,
	rev: 30,
	reverse: 30,
	"reverse engineering": 30,
	reversing: 30,
	pwn: 40,
	"binary exploitation": 40,
	binary: 40,
	pwnable: 40,
	forensics: 50,
	forensic: 50,
	dfir: 50,
	osint: 60,
	recon: 60,
	mobile: 70,
	android: 70,
	ios: 70,
	hardware: 80,
	iot: 80,
	blockchain: 90,
	web3: 90,
	smartcontract: 90,
	ai: 100,
	ml: 100,
	misc: 110,
	miscellaneous: 110,
	general: 120,
}

/**
 * Extract the category name from a document (checking extraFields, tags, and slug).
 */
export function extractDocCategory(doc: DocumentMeta): string {
	const extra = doc.extraFields || {}
	if (typeof extra.category === "string" && extra.category.trim()) {
		return extra.category.trim()
	}
	if (typeof extra.Category === "string" && extra.Category.trim()) {
		return extra.Category.trim()
	}

	// Check tags against known CTF categories
	const categoryKeywords = [
		"web",
		"crypto",
		"cryptography",
		"pwn",
		"binary",
		"reverse",
		"reversing",
		"forensics",
		"forensic",
		"misc",
		"miscellaneous",
		"osint",
		"hardware",
		"mobile",
		"blockchain",
		"ai",
	]
	for (const tag of doc.tags || []) {
		const lower = tag.toLowerCase().trim()
		if (categoryKeywords.includes(lower)) {
			return lower.charAt(0).toUpperCase() + lower.slice(1)
		}
	}

	// Check slug parts (e.g. ctf/gemastik-2026-warmup/web/chall-1)
	const parts = doc.slug.split("/")
	if (parts.length >= 3) {
		const candidate = parts[parts.length - 2].toLowerCase()
		if (categoryKeywords.includes(candidate)) {
			return candidate.charAt(0).toUpperCase() + candidate.slice(1)
		}
	}

	return "General"
}

/**
 * Extract integer points from a document (e.g., 500 pts).
 */
export function extractDocPoints(doc: DocumentMeta): number {
	const extra = doc.extraFields || {}
	const val = extra.points ?? extra.Points ?? extra.pts ?? extra.score
	if (typeof val === "number") return val
	if (typeof val === "string") {
		const parsed = parseInt(val.replace(/[^0-9]/g, ""), 10)
		if (!isNaN(parsed)) return parsed
	}
	return 0
}

/**
 * Extract difficulty string from a document.
 */
export function extractDocDifficulty(doc: DocumentMeta): string {
	const extra = doc.extraFields || {}
	const val = extra.difficulty ?? extra.Difficulty ?? extra.level
	if (typeof val === "string" && val.trim()) {
		return val.trim()
	}
	return ""
}

/**
 * Difficulty priority map for sorting (Easy -> Medium -> Hard -> Insane).
 */
const DIFFICULTY_ORDER: Record<string, number> = {
	beginner: 1,
	easy: 2,
	simple: 2,
	medium: 3,
	intermediate: 3,
	hard: 4,
	expert: 4,
	advanced: 4,
	insane: 5,
}

/**
 * Extract solved / challenge completion status.
 */
export function extractDocSolved(doc: DocumentMeta): boolean {
	const extra = doc.extraFields || {}
	if (typeof extra.solved === "boolean") return extra.solved
	if (typeof extra.Solved === "boolean") return extra.Solved
	if (typeof extra.flag === "string" && extra.flag.trim().length > 0)
		return true
	return true // Default to true for writeups
}

/**
 * Get category priority number (lower = earlier in order).
 */
export function getCategoryPriority(category: string): number {
	const clean = category.toLowerCase().trim()
	return CTF_CATEGORY_PRIORITY[clean] ?? 150
}

/**
 * Sort documents for PDF export neatly per challenge / chapter.
 */
export function sortExportDocuments(
	docs: Document[],
	sortBy: ExportSortOption = "category_points",
): Document[] {
	const copy = [...docs]

	switch (sortBy) {
		case "category_points":
			return copy.sort((a, b) => {
				const catA = extractDocCategory(a)
				const catB = extractDocCategory(b)
				const prioA = getCategoryPriority(catA)
				const prioB = getCategoryPriority(catB)

				// 1. Sort by category priority
				if (prioA !== prioB) return prioA - prioB

				// 2. If same priority, alphabetical category name
				if (catA.toLowerCase() !== catB.toLowerCase()) {
					return catA.localeCompare(catB)
				}

				// 3. Within category, sort by points ascending
				const ptsA = extractDocPoints(a)
				const ptsB = extractDocPoints(b)
				if (ptsA !== ptsB) return ptsA - ptsB

				// 4. Then by difficulty
				const diffA =
					DIFFICULTY_ORDER[extractDocDifficulty(a).toLowerCase()] ?? 99
				const diffB =
					DIFFICULTY_ORDER[extractDocDifficulty(b).toLowerCase()] ?? 99
				if (diffA !== diffB) return diffA - diffB

				// 5. Fallback to title
				return a.title.localeCompare(b.title)
			})

		case "points_desc":
			return copy.sort((a, b) => {
				const ptsA = extractDocPoints(a)
				const ptsB = extractDocPoints(b)
				if (ptsA !== ptsB) return ptsB - ptsA
				return a.title.localeCompare(b.title)
			})

		case "difficulty":
			return copy.sort((a, b) => {
				const diffA =
					DIFFICULTY_ORDER[extractDocDifficulty(a).toLowerCase()] ?? 99
				const diffB =
					DIFFICULTY_ORDER[extractDocDifficulty(b).toLowerCase()] ?? 99
				if (diffA !== diffB) return diffA - diffB
				return a.title.localeCompare(b.title)
			})

		case "title":
			return copy.sort((a, b) => a.title.localeCompare(b.title))

		case "updated_at":
			return copy.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			)

		case "path":
		default:
			return copy.sort((a, b) => a.slug.localeCompare(b.slug))
	}
}

/**
 * Known acronyms to preserve in uppercase when formatting titles.
 */
const ACRONYMS = new Set([
	"CTF",
	"GEMASTIK",
	"DEFCON",
	"HTB",
	"THM",
	"PICOCTF",
	"TCP",
	"UDP",
	"HTTP",
	"HTTPS",
	"API",
	"REST",
	"SSH",
	"SQL",
	"XSS",
	"CSRF",
	"SSRF",
	"RCE",
	"LFI",
	"RFI",
	"PWN",
	"RSA",
	"AES",
	"ECC",
	"DES",
	"TLS",
	"SSL",
	"OSINT",
	"DFIR",
	"AI",
	"ML",
])

/**
 * Format a human-readable title from a path or section name.
 * e.g., "ctf/gemastik-2026-warmup" -> "GEMASTIK 2026 Warmup — CTF Writeups Report"
 */
export function formatScopeTitle(pathOrSection: string): string {
	if (!pathOrSection) return "MCPedia Document Report"

	const clean = pathOrSection.replace(/^\/+|\/+$/g, "")
	const parts = clean.split("/")
	const last = parts[parts.length - 1]

	// Capitalize words nicely
	const words = last.split(/[-_]/).map((w) => {
		const upper = w.toUpperCase()
		if (ACRONYMS.has(upper)) return upper
		if (/^[0-9]+$/.test(w)) return w
		return w.charAt(0).toUpperCase() + w.slice(1)
	})

	const formatted = words.join(" ")

	if (
		parts.length > 1 &&
		(parts[0].toLowerCase() === "ctf" || parts[0].toLowerCase() === "writeups")
	) {
		if (!/ctf|writeup/i.test(formatted)) {
			return `${formatted} — CTF Writeups Report`
		}
	}

	return formatted
}

/**
 * Compile export summary statistics.
 */
export function buildExportSummary(
	docs: Document[],
	scopePath?: string,
	section?: string,
): ExportSummary {
	const effectiveSection = section || (docs[0]?.section ?? "docs")
	const sectionMeta = getSectionMeta(effectiveSection)
	const scopeTitle = scopePath
		? formatScopeTitle(scopePath)
		: `${sectionMeta.label} Export`

	let totalPoints = 0
	const categoryMap = new Map<string, { count: number; points: number }>()
	const authorsSet = new Set<string>()

	for (const doc of docs) {
		const pts = extractDocPoints(doc)
		totalPoints += pts

		const cat = extractDocCategory(doc)
		const existing = categoryMap.get(cat) || { count: 0, points: 0 }
		existing.count += 1
		existing.points += pts
		categoryMap.set(cat, existing)

		if (doc.author && doc.author.trim()) {
			authorsSet.add(doc.author.trim())
		}
	}

	const categories: ExportCategorySummary[] = Array.from(categoryMap.entries())
		.map(([name, stat]) => ({
			name,
			count: stat.count,
			points: stat.points,
		}))
		.sort((a, b) => getCategoryPriority(a.name) - getCategoryPriority(b.name))

	return {
		title: scopeTitle,
		scope: scopePath || effectiveSection,
		section: effectiveSection,
		totalDocuments: docs.length,
		totalPoints,
		categories,
		authors: Array.from(authorsSet),
		generatedAt: new Date().toISOString(),
	}
}

/**
 * Compile all documents into a single standalone Markdown document.
 */
export function compileExportMarkdown(exportData: ExportData): string {
	const { summary, documents: docs } = exportData
	const lines: string[] = []

	// Frontmatter
	lines.push("---")
	lines.push(`title: "${summary.title}"`)
	lines.push(`section: "${summary.section}"`)
	lines.push(`total_challenges: ${summary.totalDocuments}`)
	if (summary.totalPoints > 0) {
		lines.push(`total_points: ${summary.totalPoints}`)
	}
	lines.push(`generated_at: "${summary.generatedAt}"`)
	if (summary.authors.length > 0) {
		lines.push(`authors: [${summary.authors.map((a) => `"${a}"`).join(", ")}]`)
	}
	lines.push("---")
	lines.push("")

	// Cover / Header
	lines.push(`# ${summary.title}`)
	lines.push("")
	lines.push(
		`*Date: ${new Date(summary.generatedAt).toLocaleDateString(undefined, { dateStyle: "long" })}*`,
	)
	lines.push("")

	if (summary.totalDocuments > 1) {
		// Scoreboard / Challenge Matrix
		lines.push("## Challenge Overview")
		lines.push("")
		lines.push("| # | Challenge | Category | Points | Difficulty | Author |")
		lines.push("|---|-----------|----------|--------|------------|--------|")

		docs.forEach((doc, idx) => {
			const chNum = idx + 1
			const cat = extractDocCategory(doc)
			const pts = extractDocPoints(doc)
			const diff = extractDocDifficulty(doc) || "-"
			const author = doc.author || "-"
			lines.push(
				`| ${chNum} | [${doc.title}](#ch-${chNum}) | ${cat} | ${pts > 0 ? `${pts} pts` : "-"} | ${diff} | ${author} |`,
			)
		})
		lines.push("")
		lines.push("---")
		lines.push("")
	}

	// Chapters per Challenge
	docs.forEach((doc, idx) => {
		const chNum = idx + 1
		const cat = extractDocCategory(doc)
		const pts = extractDocPoints(doc)
		const diff = extractDocDifficulty(doc)

		lines.push(`<a id="ch-${chNum}"></a>`)
		lines.push(`## Chapter ${chNum}: ${doc.title}`)
		lines.push("")

		const badges: string[] = []
		if (cat) badges.push(`**Category:** \`${cat}\``)
		if (pts > 0) badges.push(`**Points:** \`${pts} pts\``)
		if (diff) badges.push(`**Difficulty:** \`${diff}\``)

		if (badges.length > 0) {
			lines.push(badges.join(" · "))
			lines.push("")
		}

		lines.push(doc.body.trim())
		lines.push("")
		lines.push("---")
		lines.push("")
	})

	return lines.join("\n")
}
