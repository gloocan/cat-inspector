import express from 'express'

import { registerCatPipeline, cat } from '../../index.js'

const router = express.Router()

const requireUser = cat('AuthMiddleware.requireUser', function requireUser(req: unknown, res: unknown, next: any) {
	void req
	void res
	next()
})

const validateBody = cat('ValidateMiddleware.validateBody', function validateBody(req: unknown, res: unknown, next: any) {
	void req
	void res
	next()
})

const run = cat('DemoController.run', function run(req: unknown, res: unknown) {
	void req
	void res
})

// Included on purpose; should be dropped as third-party.
router.use(express.json())

registerCatPipeline(router, 'post', '/run', [requireUser, validateBody, run])

