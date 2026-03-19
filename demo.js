#!/usr/bin/env node
//
// OpenPrice Demo — one command, full experience
//
// Usage: node demo.js
//
// Starts the server, opens the dashboard, and fires 1,000 requests
// from 100 simulated agents with different price preferences.
//

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { Mppx, tempo as tempoServer } from 'mppx/hono'
import { Mppx as MppxClient, tempo as tempoClient } from 'mppx/client'
import { resolveAccount } from 'mppx/cli'
import { execSync } from 'child_process'
import { withOpenPrice } from './openprice/index.js'
import { existsSync, unlinkSync } from 'fs'

const PORT = 3000

// ── Clean slate ──────────────────────────────────────────────
// Delete old live DB so the demo starts fresh
if (existsSync('./openprice.db')) unlinkSync('./openprice.db')

// ── Server ───────────────────────────────────────────────────

const WIDGETS = [
  { id: 1, name: 'Quantum Flux Capacitor', color: 'iridescent' },
  { id: 2, name: 'Nano Sprocket', color: 'chrome' },
  { id: 3, name: 'Hyper Gasket', color: 'obsidian' },
  { id: 4, name: 'Plasma Cog', color: 'cerulean' },
  { id: 5, name: 'Titanium Widget Classic', color: 'gunmetal' },
]

const REPORTS = [
  { id: 1, title: 'Q1 Widget Market Analysis', pages: 24 },
  { id: 2, title: 'Supply Chain Optimization Brief', pages: 12 },
]

const ANALYSES = [
  { id: 1, title: 'Full Portfolio Risk Assessment', depth: 'comprehensive' },
  { id: 2, title: 'Demand Forecasting Model Output', depth: 'detailed' },
]

const app = new Hono()

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY || 'b1cb9563b4a9f45ecdc9f204b2888d6f9371727a65198b7ca168697be1122da2',
  methods: [tempoServer({
    testnet: true,
    currency: '0x20c0000000000000000000000000000000000000',
    recipient: '0xFA491891D70C4c67C532EEe937f8EB23748f1545',
  })],
})

const openprice = withOpenPrice(mppx, { token: process.env.OPENPRICE_TOKEN })

app.get('/', (c) => c.json({ service: 'Test Widgets, Inc.', dashboard: '/openprice' }))

app.get('/api/widget', openprice.charge({
  amount: '0.10', description: 'Random Widget',
  range: [0.01, 0.50], strategy: 'uniform',
}), (c) => {
  const w = WIDGETS[Math.floor(Math.random() * WIDGETS.length)]
  return c.json({ widget: { ...w, price_paid: c.get('openprice.amount') } })
})

app.get('/api/report', openprice.charge({
  amount: '0.50', description: 'Market Report',
  range: [0.05, 2.00], strategy: 'skew-low',
}), (c) => {
  const r = REPORTS[Math.floor(Math.random() * REPORTS.length)]
  return c.json({ report: { ...r, price_paid: c.get('openprice.amount') } })
})

app.get('/api/analysis', openprice.charge({
  amount: '1.00', description: 'Premium Analysis',
  range: [0.25, 5.00], strategy: 'skew-high',
}), (c) => {
  const a = ANALYSES[Math.floor(Math.random() * ANALYSES.length)]
  return c.json({ analysis: { ...a, price_paid: c.get('openprice.amount') } })
})

app.route('/openprice', openprice.routes())

// Mount testnet demo if DB exists
if (existsSync('./openprice-testnet.db')) {
  const testnet = withOpenPrice(mppx, { dbPath: './openprice-testnet.db', agentsFile: 'testnet-agents.json' })
  app.route('/openprice/testnet', testnet.routes())
}

// ── Start server, open browser, run agents ───────────────────

serve({ fetch: app.fetch, port: PORT }, async (info) => {
  const url = `http://localhost:${PORT}/openprice`
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║  Open★Price Demo                                             ║
  ╚═══════════════════════════════════════════════════════════════╝

  What is OpenPrice?
  OpenPrice helps MPP service providers discover their optimal price.
  Instead of guessing what to charge, you test a range of prices and
  let agent behavior reveal the demand curve. ~1,000 requests and
  you know exactly what to charge.

  What's happening now:
  We're simulating 100 agents hitting 3 paid endpoints, each agent
  with a different willingness to pay. Watch the dashboard build
  the demand curve in real-time.

  Endpoints & price ranges:
    Random Widget      $0.01 – $0.50  (uniform)
    Market Report      $0.05 – $2.00  (skew-low)
    Premium Analysis   $0.25 – $5.00  (skew-high)

  Dashboard: ${url}

  ─────────────────────────────────────────────────────────────────
  To add OpenPrice to your own MPP server, give your agent:
  https://github.com/tldr-wknd/openprice/blob/main/openprice/skill.md
  ─────────────────────────────────────────────────────────────────
`)

  // Open browser
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    execSync(`${cmd} ${url}`, { stdio: 'ignore' })
  } catch {}

  // ── Setup wallet ─────────────────────────────────────────
  const DEMO_ACCOUNT = '_openprice_demo_'
  let account
  try {
    account = await resolveAccount(DEMO_ACCOUNT)
  } catch {
    console.log('  Setting up testnet wallet (one-time)...')
    execSync(`npx mppx account create --account ${DEMO_ACCOUNT}`, { stdio: 'pipe' })
    execSync(`npx mppx account fund --account ${DEMO_ACCOUNT}`, { stdio: 'pipe' })
    account = await resolveAccount(DEMO_ACCOUNT)
    console.log('  Wallet funded ✓')
  }

  // ── Agent config ─────────────────────────────────────────
  const PRODUCTS = [
    { path: '/api/widget',   key: 'widget',   min: 0.01, max: 0.50 },
    { path: '/api/report',   key: 'report',   min: 0.05, max: 2.00 },
    { path: '/api/analysis', key: 'analysis', min: 0.25, max: 5.00 },
  ]

  const AGENT_COUNT = 100
  const REQUESTS_PER_AGENT = 10

  const AGENTS = Array.from({ length: AGENT_COUNT }, (_, i) => {
    const t = i / (AGENT_COUNT - 1)
    return {
      id: `agent-${String(i + 1).padStart(3, '0')}`,
      maxPrice: {
        widget:   PRODUCTS[0].min + t * (PRODUCTS[0].max - PRODUCTS[0].min),
        report:   PRODUCTS[1].min + t * (PRODUCTS[1].max - PRODUCTS[1].min),
        analysis: PRODUCTS[2].min + t * (PRODUCTS[2].max - PRODUCTS[2].min),
      },
    }
  })

  let currentMaxPrice = 0
  let lastChallengePrice = 0

  const client = MppxClient.create({
    methods: [tempoClient({ account })],
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

  // ── Run batch ────────────────────────────────────────────
  const total = AGENT_COUNT * REQUESTS_PER_AGENT
  let paid = 0, skipped = 0

  console.log(`  Sending ${total} requests from ${AGENT_COUNT} agents...\n`)

  const startTime = Date.now()

  for (let i = 0; i < total; i++) {
    const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)]
    const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)]

    currentMaxPrice = agent.maxPrice[product.key]
    lastChallengePrice = 0

    try {
      const res = await fetch(`http://localhost:${PORT}${product.path}`, {
        headers: { 'User-Agent': agent.id },
      })
      if (res.ok) paid++
    } catch (err) {
      if (err.message?.startsWith('PRICE_TOO_HIGH:')) skipped++
    }

    if ((i + 1) % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`  [${i + 1}/${total}] ${elapsed}s — ${paid} paid, ${skipped} skipped`)
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n  ✓ Done — ${paid} paid, ${skipped} skipped in ${elapsed}s`)
  console.log(`  Dashboard is live at ${url}`)
  console.log(`  Press Ctrl+C to stop\n`)
})
