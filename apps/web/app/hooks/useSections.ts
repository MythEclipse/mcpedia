"use client"

import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { SectionInfo } from "@mcpedia/types"

export function useSections() {
	return useSWR<SectionInfo[]>("/api/sections", fetcher, {
		revalidateOnFocus: false,
	})
}
