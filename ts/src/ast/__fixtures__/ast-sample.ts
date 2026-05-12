import 'reflect-metadata'

import { Cat } from '../../decorators/cat.js'
import { Return } from '../../return.js'

export class AstSample {
	@Cat
	evaluate(flag: boolean): string {
		if (flag) 
			{				
				return Return('WHEN_TRUE', 'yes')
			}else{
				return Return('WHEN_FALSE', 'no')
			}
		
	}

	
}
