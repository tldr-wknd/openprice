import { Mppx, tempo } from 'mppx/client'
import { resolveAccount } from 'mppx/cli'
import { execSync } from 'child_process'

// Auto-setup: create and fund a demo account if it doesn't exist
const DEMO_ACCOUNT = '_openprice_demo_'
let account
try {
  account = await resolveAccount(DEMO_ACCOUNT)
  console.log(`Using existing demo wallet: ${account.address}`)
} catch {
  console.log('Setting up demo wallet (one-time)...')
  execSync(`npx mppx account create --account ${DEMO_ACCOUNT}`, { stdio: 'pipe' })
  execSync(`npx mppx account fund --account ${DEMO_ACCOUNT}`, { stdio: 'inherit' })
  account = await resolveAccount(DEMO_ACCOUNT)
  console.log(`Demo wallet ready: ${account.address}`)
}
console.log()

const SERVER = 'http://localhost:3000'
const AGENT_COUNT = 100
const REQUESTS_PER_AGENT = 10  // 100 agents x 10 = 1,000 requests

// Product ranges (matching server config)
const PRODUCTS = [
  { path: '/api/widget',   key: 'widget',   min: 0.01, max: 0.50 },
  { path: '/api/report',   key: 'report',   min: 0.05, max: 2.00 },
  { path: '/api/analysis', key: 'analysis', min: 0.25, max: 5.00 },
]

// Generate 100 agents with uniformly distributed max willingness per product
const AGENTS = Array.from({ length: AGENT_COUNT }, (_, i) => {
  const t = i / (AGENT_COUNT - 1) // 0.0 to 1.0
  return {
    id: `agent-${String(i + 1).padStart(3, '0')}`,
    maxPrice: {
      widget:   PRODUCTS[0].min + t * (PRODUCTS[0].max - PRODUCTS[0].min),
      report:   PRODUCTS[1].min + t * (PRODUCTS[1].max - PRODUCTS[1].min),
      analysis: PRODUCTS[2].min + t * (PRODUCTS[2].max - PRODUCTS[2].min),
    },
  }
})

// Current request state
let currentMaxPrice = 0
let lastChallengePrice = 0

const mppx = Mppx.create({
  methods: [tempo({ account })],
  onChallenge: async (challenge, { createCredential }) => {
    const amount = parseInt(challenge.request.amount)
    const priceInDollars = amount / 1_000_000
    lastChallengePrice = priceInDollars

    if (priceInDollars > currentMaxPrice) {
      throw new Error(`PRICE_TOO_HIGH:${priceInDollars}`)
    }
    return createCredential()
  },
})

// Stats
let totalRequests = 0
let totalPaid = 0
let totalSkipped = 0
let totalRevenue = 0
const productStats = {}
for (const p of PRODUCTS) {
  productStats[p.key] = { requests: 0, paid: 0, skipped: 0, revenue: 0 }
}

console.log(`Starting batch: ${AGENT_COUNT} agents x ${REQUESTS_PER_AGENT} requests = ${AGENT_COUNT * REQUESTS_PER_AGENT} total`)
console.log(`Agent willingness range per product:`)
console.log(`  widget:   $${AGENTS[0].maxPrice.widget.toFixed(2)} – $${AGENTS[AGENT_COUNT-1].maxPrice.widget.toFixed(2)}`)
console.log(`  report:   $${AGENTS[0].maxPrice.report.toFixed(2)} – $${AGENTS[AGENT_COUNT-1].maxPrice.report.toFixed(2)}`)
console.log(`  analysis: $${AGENTS[0].maxPrice.analysis.toFixed(2)} – $${AGENTS[AGENT_COUNT-1].maxPrice.analysis.toFixed(2)}`)
console.log()

const startTime = Date.now()

for (let i = 0; i < AGENT_COUNT * REQUESTS_PER_AGENT; i++) {
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)]
  const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)]
  const url = `${SERVER}${product.path}`

  currentMaxPrice = agent.maxPrice[product.key]
  lastChallengePrice = 0

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': agent.id }
    })

    totalRequests++
    productStats[product.key].requests++

    if (res.ok) {
      totalPaid++
      totalRevenue += lastChallengePrice
      productStats[product.key].paid++
      productStats[product.key].revenue += lastChallengePrice
    }
  } catch (err) {
    if (err.message?.startsWith('PRICE_TOO_HIGH:')) {
      totalRequests++
      totalSkipped++
      productStats[product.key].requests++
      productStats[product.key].skipped++
    } else {
      console.error(`[${i + 1}] ${agent.id} → ${product.key}: ${err.message}`)
    }
  }

  // Progress every 100
  if ((i + 1) % 100 === 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const rate = ((i + 1) / parseFloat(elapsed)).toFixed(0)
    console.log(`  [${i + 1}/${AGENT_COUNT * REQUESTS_PER_AGENT}] ${elapsed}s (${rate} req/s) — ${totalPaid} paid, ${totalSkipped} skipped`)
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

console.log(`\n${'='.repeat(60)}`)
console.log(`BATCH COMPLETE — ${totalRequests} requests in ${elapsed}s`)
console.log(`  Paid: ${totalPaid} (${(totalPaid/totalRequests*100).toFixed(1)}%)`)
console.log(`  Skipped: ${totalSkipped} (${(totalSkipped/totalRequests*100).toFixed(1)}%)`)
console.log(`  Revenue: $${totalRevenue.toFixed(2)}`)
console.log()

for (const p of PRODUCTS) {
  const s = productStats[p.key]
  const conv = s.requests > 0 ? (s.paid / s.requests * 100).toFixed(1) : '0.0'
  console.log(`  ${p.key}: ${s.requests} requests, ${s.paid} paid (${conv}%), $${s.revenue.toFixed(2)} revenue`)
}
console.log()
