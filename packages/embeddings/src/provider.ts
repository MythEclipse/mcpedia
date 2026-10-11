import { EMBED_API_KEY, EMBED_BASE_URL, EMBED_MODEL } from "@mcpedia/config"

export interface EmbeddingProvider {
	/** Embed a batch of texts into vectors of fixed dimension. */
	embed(texts: string[]): Promise<number[][]>
	readonly model: string
	readonly dimensions: number
}

/** Pinned embedding dimension for the configured OpenRouter model. */
export const EMBED_DIM = 2048

/**
 * OpenRouter embeddings provider (we route through 9router's OpenAI-compatible
 * /v1 endpoint). `encoding_format: "float"` is REQUIRED — the Nvidia-backed
 * model rejects base64.
 */
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
	readonly model: string
	private readonly baseUrl: string
	private readonly apiKey: string

	constructor(opts?: {
		baseUrl?: string
		apiKey?: string
		model?: string
	}) {
		this.baseUrl = (opts?.baseUrl ?? EMBED_BASE_URL).replace(/\/$/, "")
		this.apiKey = opts?.apiKey ?? EMBED_API_KEY
		this.model = opts?.model ?? EMBED_MODEL
		// NOTE: we do NOT validate baseUrl/apiKey/model here. Throwing in the
		// constructor breaks `next build` (SSG data collection imports the search
		// package before any .env is present) and any runtime-injected env. The
		// provider is constructed lazily at first query, so an unset config
		// surfaces as a clear error from embed() at request time, not a build crash.
	}

	get dimensions(): number {
		return EMBED_DIM
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return []
		if (!this.baseUrl || !this.apiKey || !this.model) {
			throw new Error(
				"OpenRouterEmbeddingProvider: missing EMBED_BASE_URL / EMBED_API_KEY / EMBED_MODEL at request time",
			)
		}
		const res = await fetch(`${this.baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				input: texts,
				encoding_format: "float",
			}),
		})
		if (!res.ok) {
			const body = await res.text().catch(() => "")
			throw new Error(
				`embedding request failed (${res.status}): ${body.slice(0, 300)}`,
			)
		}
		const json = (await res.json()) as {
			data?: { embedding: number[] }[]
		}
		const data = json.data
		if (!data || data.length !== texts.length) {
			throw new Error(
				`embedding response mismatch: expected ${texts.length}, got ${data?.length ?? 0}`,
			)
		}
		return data.map((d) => d.embedding)
	}
}

/** Default singleton provider. */
export function createEmbeddingProvider(): EmbeddingProvider {
	return new OpenRouterEmbeddingProvider()
}
