import type { EmbeddingProvider } from "./provider"

/**
 * Split text into overlapping chunks for embedding. Keeps paragraphs/words
 * intact where possible; never splits a chunk mid-word by more than `overlap`.
 */
export function chunkText(
	text: string,
	opts: { size?: number; overlap?: number } = {},
): string[] {
	const size = opts.size ?? 1000
	const overlap = opts.overlap ?? 150
	const clean = text.replace(/\r\n/g, "\n").trim()
	if (!clean) return []
	if (clean.length <= size) return [clean]

	const chunks: string[] = []
	let start = 0
	while (start < clean.length) {
		let end = Math.min(start + size, clean.length)
		// Prefer to break on a newline/space near the boundary.
		if (end < clean.length) {
			const nl = clean.lastIndexOf("\n", end)
			const sp = clean.lastIndexOf(" ", end)
			const breakAt =
				nl > start + size * 0.5 ? nl : sp > start + size * 0.5 ? sp : end
			if (breakAt > start) end = breakAt
		}
		chunks.push(clean.slice(start, end).trim())
		if (end >= clean.length) break
		start = Math.max(end - overlap, start + 1)
	}
	return chunks.filter(Boolean)
}

/** Embed a list of chunks in batches to avoid oversized requests. */
export async function embedChunks(
	provider: EmbeddingProvider,
	chunks: string[],
	batchSize = 16,
): Promise<number[][]> {
	const out: number[][] = []
	for (let i = 0; i < chunks.length; i += batchSize) {
		const batch = chunks.slice(i, i + batchSize)
		const vecs = await provider.embed(batch)
		out.push(...vecs)
	}
	return out
}
