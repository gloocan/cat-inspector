export type ImportedOrderInput = {
	sku: string
	qty: number
	subtotal: number
}

export type RecursiveNode = {
	name: string
	child?: RecursiveNode
}

export type LargeUnion =
	| 'a'
	| 'b'
	| 'c'
	| 'd'
	| 'e'
	| 'f'
