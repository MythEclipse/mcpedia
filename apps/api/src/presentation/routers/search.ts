import { os } from "@orpc/server"
import { hybridSearch, keywordSearch, semanticSearch } from "@mcpedia/core"
import { mapAppErrors } from "../middleware"
import { HybridSearchInput, SearchInput, SemanticSearchInput } from "../schemas"

/**
 * The three search modes. Public — reading is not a privileged operation.
 *
 * Each handler is a thin pass-through to @mcpedia/core; the search logic
 * (hindsight recall, grouping, ranking) stays where it is. The mapper is
 * attached anyway so a typed error thrown from that layer reports its real status
 * rather than a blanket 500.
 */
export const searchRouter = os.router({
	keyword: os
		.use(mapAppErrors)
		.input(SearchInput)
		.handler(({ input }) => keywordSearch(input.q, input.limit)),

	semantic: os
		.use(mapAppErrors)
		.input(SemanticSearchInput)
		.handler(({ input }) => semanticSearch(input.q, input.limit)),

	hybrid: os
		.use(mapAppErrors)
		.input(HybridSearchInput)
		.handler(({ input }) => hybridSearch(input.q, input.limit)),
})
