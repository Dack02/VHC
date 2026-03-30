import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth.js'
import board from './board.js'
import columns from './columns.js'
import cards from './cards.js'
import notes from './notes.js'
import statuses from './statuses.js'
import config from './config.js'

const tcard = new Hono()

// Apply auth middleware to all tcard routes
tcard.use('*', authMiddleware)

// Mount sub-routers
tcard.route('/board', board)
tcard.route('/columns', columns)
tcard.route('/cards', cards)
tcard.route('/notes', notes)
tcard.route('/statuses', statuses)
tcard.route('/config', config)

export default tcard
