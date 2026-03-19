import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { Mppx, tempo } from 'mppx/hono'
import { withOpenPrice } from './openprice/index.js'

// --- Product catalogs ---

const WIDGETS = [
  { id: 1, name: 'Quantum Flux Capacitor', color: 'iridescent' },
  { id: 2, name: 'Nano Sprocket', color: 'chrome' },
  { id: 3, name: 'Hyper Gasket', color: 'obsidian' },
  { id: 4, name: 'Plasma Cog', color: 'cerulean' },
  { id: 5, name: 'Titanium Widget Classic', color: 'gunmetal' },
  { id: 6, name: 'Anti-Gravity Washer', color: 'pearl' },
  { id: 7, name: 'Photon Bearing', color: 'gold' },
  { id: 8, name: 'Dark Matter Shim', color: 'vantablack' },
]

const REPORTS = [
  { id: 1, title: 'Q1 Widget Market Analysis', pages: 24 },
  { id: 2, title: 'Supply Chain Optimization Brief', pages: 12 },
  { id: 3, title: 'Competitive Landscape Report', pages: 36 },
]

const ANALYSES = [
  { id: 1, title: 'Full Portfolio Risk Assessment', depth: 'comprehensive' },
  { id: 2, title: 'Demand Forecasting Model Output', depth: 'detailed' },
  { id: 3, title: 'Strategic Pricing Recommendation', depth: 'executive' },
]

// --- Server setup ---

const app = new Hono()

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY || 'b1cb9563b4a9f45ecdc9f204b2888d6f9371727a65198b7ca168697be1122da2',
  methods: [tempo({
    testnet: true,
    currency: '0x20c0000000000000000000000000000000000000',
    recipient: '0xFA491891D70C4c67C532EEe937f8EB23748f1545',
  })],
})

// --- OpenPrice: 2 lines to add price discovery ---

const openprice = withOpenPrice(mppx, {
  token: process.env.OPENPRICE_TOKEN,
})

// --- Routes ---

app.get('/', (c) => c.json({
  service: 'Test Widgets, Inc.',
  status: 'operational',
  products: [
    { endpoint: '/api/widget', description: 'Random widget', basePrice: '$0.10' },
    { endpoint: '/api/report', description: 'Market report', basePrice: '$0.50' },
    { endpoint: '/api/analysis', description: 'Premium analysis', basePrice: '$1.00' },
  ],
  dashboard: '/openprice'
}))

// Product 1: Widgets — uniform distribution, $0.01–$0.50
app.get(
  '/api/widget',
  openprice.charge({
    amount: '0.10',
    description: 'Random Widget',
    range: [0.01, 0.50],
    strategy: 'uniform',
  }),
  (c) => {
    const widget = WIDGETS[Math.floor(Math.random() * WIDGETS.length)]
    return c.json({ widget: { ...widget, price_paid: c.get('openprice.amount') } })
  },
)

// Product 2: Reports — skew-low distribution, $0.05–$2.00
app.get(
  '/api/report',
  openprice.charge({
    amount: '0.50',
    description: 'Market Report',
    range: [0.05, 2.00],
    strategy: 'skew-low',
  }),
  (c) => {
    const report = REPORTS[Math.floor(Math.random() * REPORTS.length)]
    return c.json({ report: { ...report, price_paid: c.get('openprice.amount') } })
  },
)

// Product 3: Premium Analysis — skew-high distribution, $0.25–$5.00
app.get(
  '/api/analysis',
  openprice.charge({
    amount: '1.00',
    description: 'Premium Analysis',
    range: [0.25, 5.00],
    strategy: 'skew-high',
  }),
  (c) => {
    const analysis = ANALYSES[Math.floor(Math.random() * ANALYSES.length)]
    return c.json({ analysis: { ...analysis, price_paid: c.get('openprice.amount') } })
  },
)

// Dashboard (live)
app.route('/openprice', openprice.routes())

// Testnet demo (frozen data + agent profiles)
const testnet = withOpenPrice(mppx, {
  dbPath: './openprice-testnet.db',
  agentsFile: 'testnet-agents.json',
})
app.route('/openprice/testnet', testnet.routes())

// --- Start ---

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`\nTest Widgets, Inc. server running on http://localhost:${info.port}`)
  console.log(`  GET /              — service info (free)`)
  console.log(`  GET /api/widget    — random widget ($0.01–$0.50, uniform)`)
  console.log(`  GET /api/report    — market report ($0.05–$2.00, skew-low)`)
  console.log(`  GET /api/analysis  — premium analysis ($0.25–$5.00, skew-high)`)
  console.log(`  GET /openprice     — OpenPrice dashboard`)
  console.log()
})
