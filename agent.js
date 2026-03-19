import { Mppx, tempo } from 'mppx/client'
import { resolveAccount } from 'mppx/cli'

const account = await resolveAccount('buyer')
console.log(`Agent fleet using account: ${account.address}`)

const SERVER = 'http://localhost:3000'
const BATCH_SIZE = 500

// Simulate 5 different agents with distinct willingness profiles
const AGENTS = [
  { id: 'agent-alpha',   bias: { widget: 0.15, report: 0.40, analysis: 1.00 } },
  { id: 'agent-beta',    bias: { widget: 0.25, report: 0.80, analysis: 2.00 } },
  { id: 'agent-gamma',   bias: { widget: 0.35, report: 1.20, analysis: 3.00 } },
  { id: 'agent-delta',   bias: { widget: 0.10, report: 0.60, analysis: 1.50 } },
  { id: 'agent-epsilon', bias: { widget: 0.45, report: 1.80, analysis: 4.00 } },
]

const ENDPOINTS = [
  { path: '/api/widget',   key: 'widget' },
  { path: '/api/report',   key: 'report' },
  { path: '/api/analysis', key: 'analysis' },
]

// Current request state — set before each fetch, read in onChallenge
let currentMaxPrice = 0
let lastChallengePrice = 0
let currentAgentId = ''

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

// Stats per agent per product
const stats = {}
for (const agent of AGENTS) {
  stats[agent.id] = {}
  for (const ep of ENDPOINTS) {
    stats[agent.id][ep.key] = { challenged: 0, paid: 0, skipped: 0, revenue: 0 }
  }
}

console.log(`\nStarting batch run: ${BATCH_SIZE} requests from ${AGENTS.length} agents`)
console.log(`Agents:`)
for (const a of AGENTS) {
  console.log(`  ${a.id}: widget=$${a.bias.widget}, report=$${a.bias.report}, analysis=$${a.bias.analysis}`)
}
console.log()

for (let i = 0; i < BATCH_SIZE; i++) {
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)]
  const ep = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)]
  const url = `${SERVER}${ep.path}`

  currentMaxPrice = agent.bias[ep.key]
  currentAgentId = agent.id
  lastChallengePrice = 0

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': agent.id }
    })

    if (res.ok) {
      stats[agent.id][ep.key].challenged++
      stats[agent.id][ep.key].paid++
      stats[agent.id][ep.key].revenue += lastChallengePrice
      if (i % 50 === 0 || i < 10) {
        console.log(`[${i + 1}/${BATCH_SIZE}] ${agent.id} → ${ep.key}: $${lastChallengePrice.toFixed(4)} — PAID`)
      }
    } else {
      stats[agent.id][ep.key].challenged++
      if (i < 10) console.log(`[${i + 1}/${BATCH_SIZE}] ${agent.id} → ${ep.key}: $${lastChallengePrice.toFixed(4)} — failed (${res.status})`)
    }
  } catch (err) {
    if (err.message?.startsWith('PRICE_TOO_HIGH:')) {
      const price = parseFloat(err.message.split(':')[1])
      stats[agent.id][ep.key].challenged++
      stats[agent.id][ep.key].skipped++
      if (i % 50 === 0 || i < 10) {
        console.log(`[${i + 1}/${BATCH_SIZE}] ${agent.id} → ${ep.key}: $${price.toFixed(4)} — SKIP (max $${currentMaxPrice})`)
      }
    } else {
      console.log(`[${i + 1}/${BATCH_SIZE}] ${agent.id} → ${ep.key}: error — ${err.message}`)
    }
  }
}

// Summary
console.log(`\n${'='.repeat(70)}`)
console.log(`BATCH COMPLETE: ${BATCH_SIZE} requests from ${AGENTS.length} agents\n`)

for (const ep of ENDPOINTS) {
  let totalC = 0, totalP = 0, totalR = 0
  for (const agent of AGENTS) {
    const s = stats[agent.id][ep.key]
    totalC += s.challenged
    totalP += s.paid
    totalR += s.revenue
  }
  const conv = totalC > 0 ? ((totalP / totalC) * 100).toFixed(1) : '0.0'
  console.log(`  ${ep.key} (${totalC} challenges, ${totalP} paid, ${conv}% conversion, $${totalR.toFixed(2)} revenue)`)
  for (const agent of AGENTS) {
    const s = stats[agent.id][ep.key]
    if (s.challenged > 0) {
      const c = s.challenged > 0 ? ((s.paid / s.challenged) * 100).toFixed(0) : '0'
      console.log(`    ${agent.id}: ${s.challenged} challenged, ${s.paid} paid (${c}%), $${s.revenue.toFixed(2)}`)
    }
  }
  console.log()
}
