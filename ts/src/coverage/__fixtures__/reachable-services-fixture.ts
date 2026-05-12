import { cat, catModule, registerCatPipeline } from '../../index.js'

const pricing = catModule('PricingService', {
	applyTax(amount: number): number {
		return amount * 1.15
	},
	quoteTotal(subtotal: number): number {
		return subtotal + 1
	},
})

const run = cat('DemoController.run', function run(x: number) {
	const taxed = pricing.applyTax(x)
	return pricing.quoteTotal(taxed)
})

// Minimal pipeline just to make the handler a \"root\" candidate.
registerCatPipeline({} as any, 'post', '/run', [run])

