"use client"

import { SWRConfig } from "swr"

export default function SWRProvider({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<SWRConfig
			value={{
				dedupingInterval: 4_000,
				focusThrottleInterval: 10_000,
				revalidateOnFocus: true,
				shouldRetryOnError: false,
				errorRetryCount: 0,
			}}
		>
			{children}
		</SWRConfig>
	)
}
