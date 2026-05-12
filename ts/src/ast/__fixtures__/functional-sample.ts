import { cat, catModule } from '../../functional.js'

export const greet = cat('Greeter.hello', function hello(name: string): string {
	return `hi:${name}`
})

export const pricing = catModule('PricingService', {
	applyTax(amount: number): number {
		return amount * 1.15
	},
})

