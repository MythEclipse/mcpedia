/**
 * Dynamic Section Registry & Metadata Generator.
 * Safe for client and server components.
 */
export interface SectionConfig {
	id: string
	label: string
	icon: string
	desc: string
}

export const SECTION_PRESETS: Record<
	string,
	{ label: string; icon: string; desc: string }
> = {
	docs: {
		label: "Documentation",
		icon: "📄",
		desc: "Setup guides, API references, and protocol specs.",
	},
	writeups: {
		label: "Writeups",
		icon: "📝",
		desc: "Post-mortems, CTF writeups, debugging stories, and case studies.",
	},
	research: {
		label: "Research",
		icon: "🔬",
		desc: "Deep-dive analysis, architecture notes, and experiments.",
	},
	notes: {
		label: "Notes",
		icon: "📌",
		desc: "Quick references, patterns, and cheat-sheets.",
	},
	guides: {
		label: "Guides",
		icon: "🧭",
		desc: "Step-by-step guides and implementation walkthroughs.",
	},
	tutorials: {
		label: "Tutorials",
		icon: "🎓",
		desc: "Educational lessons and practical tutorials.",
	},
	ctf: {
		label: "CTF",
		icon: "🚩",
		desc: "Capture The Flag challenge writeups and exploit solutions.",
	},
	api: {
		label: "API",
		icon: "⚡",
		desc: "API documentation and endpoint definitions.",
	},
	projects: {
		label: "Projects",
		icon: "🚀",
		desc: "Project overviews and technical architecture roadmaps.",
	},
}

export function getSectionMeta(id: string, _count?: number): SectionConfig {
	const cleanId = (id || "docs").toLowerCase().trim()
	if (SECTION_PRESETS[cleanId]) {
		return { id: cleanId, ...SECTION_PRESETS[cleanId] }
	}
	const formattedLabel = cleanId
		.split(/[-_]/)
		.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
		.join(" ")
	return {
		id: cleanId,
		label: formattedLabel || "Custom Section",
		icon: "📁",
		desc: `Documents in the ${formattedLabel || cleanId} section.`,
	}
}

export const DEFAULT_SECTIONS: SectionConfig[] = [
	getSectionMeta("docs"),
	getSectionMeta("writeups"),
	getSectionMeta("research"),
	getSectionMeta("notes"),
]

// Backwards-compatible constants:
export const SECTIONS: SectionConfig[] = DEFAULT_SECTIONS
export const SECTIONS_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]))
export const SECTION_IDS = SECTIONS.map((s) => s.id)
