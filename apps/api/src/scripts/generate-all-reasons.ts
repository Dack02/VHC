/**
 * Script to generate reasons for all items in a template
 * Run with: npx tsx src/scripts/generate-all-reasons.ts
 */
import 'dotenv/config'
import { generateAllReasonsForTemplate } from '../services/ai-reasons.js'

const TEMPLATE_ID = process.argv[2] || 'f0aabfc8-756b-42ef-99cf-8f278077a28b'
const ORG_ID = process.argv[3] || '11111111-1111-1111-1111-111111111111'

async function main() {
  console.log('🚀 Starting reason generation')
  console.log('   Template ID:', TEMPLATE_ID)
  console.log('   Organization:', ORG_ID)
  console.log('')
  
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set in environment')
    process.exit(1)
  }
  
  try {
    const result = await generateAllReasonsForTemplate(TEMPLATE_ID, ORG_ID)
    console.log('\n✅ Generation complete!')
    console.log('   Items processed:', result.itemsProcessed)
    console.log('   Types processed:', result.typesProcessed)
    console.log('   Reasons created:', result.reasonsCreated)
    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors:')
      result.errors.forEach(e => console.log('   -', e))
    }
  } catch (error) {
    console.error('❌ Generation failed:', error)
    process.exit(1)
  }
}

main()
