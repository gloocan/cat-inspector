import express from 'express'

import { importedService } from './unwrapped-service.js'

const router = express.Router()

export function unwrappedController(): void {
	importedService(123)
}

// Minimal route to make the handler a root candidate.
router.post('/run', unwrappedController)

