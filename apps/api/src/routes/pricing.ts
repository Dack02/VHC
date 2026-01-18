import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'

const pricing = new Hono()

// Apply auth middleware to all routes
pricing.use('*', authMiddleware)

/**
 * POST /api/v1/pricing/calculate - Calculate sell price from cost and margin/markup
 *
 * Request body options:
 * 1. { cost_price, margin_percent } - Calculate based on desired margin
 * 2. { cost_price, markup_percent } - Calculate based on desired markup
 *
 * Formulas:
 * - Margin: sell_price = cost_price / (1 - margin_percent / 100)
 * - Markup: sell_price = cost_price * (1 + markup_percent / 100)
 * - Margin % = (sell_price - cost_price) / sell_price * 100
 * - Markup % = (sell_price - cost_price) / cost_price * 100
 */
pricing.post('/calculate', async (c) => {
  try {
    const body = await c.req.json()
    const { cost_price, margin_percent, markup_percent } = body

    // Validate cost_price
    if (cost_price === undefined || cost_price === null) {
      return c.json({ error: 'cost_price is required' }, 400)
    }

    const costPrice = parseFloat(cost_price)
    if (isNaN(costPrice) || costPrice < 0) {
      return c.json({ error: 'cost_price must be a positive number' }, 400)
    }

    let sellPrice: number
    let calculatedMarginPercent: number
    let calculatedMarkupPercent: number

    // Calculate based on margin or markup
    if (margin_percent !== undefined && margin_percent !== null) {
      const margin = parseFloat(margin_percent)
      if (isNaN(margin) || margin < 0 || margin >= 100) {
        return c.json({ error: 'margin_percent must be between 0 and 99.99' }, 400)
      }

      // sell_price = cost_price / (1 - margin_percent / 100)
      sellPrice = costPrice / (1 - margin / 100)
      calculatedMarginPercent = margin
      calculatedMarkupPercent = costPrice > 0 ? ((sellPrice - costPrice) / costPrice) * 100 : 0

    } else if (markup_percent !== undefined && markup_percent !== null) {
      const markup = parseFloat(markup_percent)
      if (isNaN(markup) || markup < 0) {
        return c.json({ error: 'markup_percent must be a positive number' }, 400)
      }

      // sell_price = cost_price * (1 + markup_percent / 100)
      sellPrice = costPrice * (1 + markup / 100)
      calculatedMarkupPercent = markup
      calculatedMarginPercent = sellPrice > 0 ? ((sellPrice - costPrice) / sellPrice) * 100 : 0

    } else {
      return c.json({ error: 'Either margin_percent or markup_percent is required' }, 400)
    }

    const profit = sellPrice - costPrice

    return c.json({
      costPrice: round(costPrice, 2),
      sellPrice: round(sellPrice, 2),
      marginPercent: round(calculatedMarginPercent, 2),
      markupPercent: round(calculatedMarkupPercent, 2),
      profit: round(profit, 2)
    })
  } catch (error) {
    console.error('Pricing calculate error:', error)
    return c.json({ error: 'Failed to calculate pricing' }, 500)
  }
})

/**
 * POST /api/v1/pricing/calculate-from-sell - Calculate margin/markup from cost and sell price
 *
 * Request body:
 * { cost_price, sell_price }
 */
pricing.post('/calculate-from-sell', async (c) => {
  try {
    const body = await c.req.json()
    const { cost_price, sell_price } = body

    // Validate inputs
    if (cost_price === undefined || cost_price === null) {
      return c.json({ error: 'cost_price is required' }, 400)
    }
    if (sell_price === undefined || sell_price === null) {
      return c.json({ error: 'sell_price is required' }, 400)
    }

    const costPrice = parseFloat(cost_price)
    const sellPrice = parseFloat(sell_price)

    if (isNaN(costPrice) || costPrice < 0) {
      return c.json({ error: 'cost_price must be a positive number' }, 400)
    }
    if (isNaN(sellPrice) || sellPrice < 0) {
      return c.json({ error: 'sell_price must be a positive number' }, 400)
    }

    const profit = sellPrice - costPrice
    const marginPercent = sellPrice > 0 ? ((sellPrice - costPrice) / sellPrice) * 100 : 0
    const markupPercent = costPrice > 0 ? ((sellPrice - costPrice) / costPrice) * 100 : 0

    return c.json({
      costPrice: round(costPrice, 2),
      sellPrice: round(sellPrice, 2),
      marginPercent: round(marginPercent, 2),
      markupPercent: round(markupPercent, 2),
      profit: round(profit, 2)
    })
  } catch (error) {
    console.error('Pricing calculate from sell error:', error)
    return c.json({ error: 'Failed to calculate pricing' }, 500)
  }
})

/**
 * Helper function to round to specified decimal places
 */
function round(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals)
  return Math.round(value * multiplier) / multiplier
}

export default pricing
