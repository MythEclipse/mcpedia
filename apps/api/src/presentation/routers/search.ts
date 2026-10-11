import { os } from "@orpc/server"
import { hybridSearch, keywordSearch, semanticSearch } from "@mcpedia/core"
import { HybridSearchInput, SearchInput, SemanticSearchInput } from "../schemas"

/**
 * The three search modes. Public — reading is not a privileged operation.
 *
 * Each handler is a thin pass-through to @mcpedia/core; the search logic (FTS
 * tsvector, chunked embeddings, RRF fusion) stays where it is.
 */
export const searchRouter = os.router({
	keyword: os
		.input(SearchInput)
		.handler(({ input }) => keywordSearch(input.q, input.limit)),

	semantic: os
		.input(SemanticSearchInput)
		.handler(({ input }) => semanticSearch(input.q, input.limit)),

	hybrid: os
		.input(HybridSearchInput)
		.handler(({ input }) => hybridSearch(input.q, input.limit)),
})
