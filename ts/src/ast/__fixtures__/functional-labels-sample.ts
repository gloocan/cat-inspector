import { ApiReturn, Return, Throw } from '../../return.js'
import { cat, catModule } from '../../functional.js'

export const greet = cat('Greeter.hello', function hello(name: string) {
	if (!name) Throw('NO_NAME', new Error('name required'))
	return Return('HELLO', `hi:${name}`)
})

export const pricing = catModule('PricingService', {
	applyTax(amount: number) {
		if (amount === 0) Throw('ZERO', new Error('amount cannot be 0'))
		return Return('TAXED', amount * 1.15)
	},
	apiExample() {
		return ApiReturn('OK', 200, { ok: true })
	},
})

