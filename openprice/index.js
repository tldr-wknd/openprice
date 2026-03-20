import Database from 'better-sqlite3'
import { Hono } from 'hono'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- Price Strategies ---

function uniformRandom(min, max) {
  return min + Math.random() * (max - min)
}

function skewLowRandom(min, max) {
  const logMin = Math.log(min)
  const logMax = Math.log(max)
  return Math.exp(logMin + Math.random() * (logMax - logMin))
}

function skewHighRandom(min, max) {
  const low = skewLowRandom(min, max)
  return min + max - low
}

const strategies = {
  'uniform': uniformRandom,
  'skew-low': skewLowRandom,
  'skew-high': skewHighRandom,
}

// --- Smoothing: moving average with monotonic enforcement ---

function smoothDemand(bins) {
  if (bins.length === 0) return []

  const smoothed = bins.map((b, i) => {
    const window = []
    for (let j = Math.max(0, i - 1); j <= Math.min(bins.length - 1, i + 1); j++) {
      if (bins[j].requests >= 2) window.push(bins[j].conversionRate)
    }
    const avg = window.length > 0 ? window.reduce((s, v) => s + v, 0) / window.length : b.conversionRate
    return { ...b, smoothedConversion: avg }
  })

  // Enforce monotonic decreasing (pool adjacent violators)
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i].smoothedConversion > smoothed[i - 1].smoothedConversion) {
      const avg = (smoothed[i].smoothedConversion + smoothed[i - 1].smoothedConversion) / 2
      smoothed[i].smoothedConversion = avg
      smoothed[i - 1].smoothedConversion = avg
      let j = i - 1
      while (j > 0 && smoothed[j].smoothedConversion > smoothed[j - 1].smoothedConversion) {
        const a = (smoothed[j].smoothedConversion + smoothed[j - 1].smoothedConversion) / 2
        smoothed[j].smoothedConversion = a
        smoothed[j - 1].smoothedConversion = a
        j--
      }
    }
  }

  return smoothed
}

function buildOutcomeSeries(smoothedBins) {
  const outcomes = smoothedBins.map(b => ({
    price: b.mid,
    expectedConversion: b.smoothedConversion,
    rawConversion: b.conversionRate,
    projectedRevenuePer1000: b.mid * b.smoothedConversion * 1000,
    requests: b.requests,
  }))

  const maxRevenue = Math.max(...outcomes.map(o => o.projectedRevenuePer1000), 0)

  return outcomes.map(o => ({
    ...o,
    relativeRevenue: maxRevenue > 0 ? o.projectedRevenuePer1000 / maxRevenue : 0,
  }))
}

// --- Main API ---

export function withOpenPrice(mppx, opts = {}) {
  const {
    dbPath = './openprice.db',
    token = null,
    agentsFile = process.env.OPENPRICE_AGENTS_FILE || null,
  } = opts

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      amount TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      requester_ip TEXT,
      user_agent TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER REFERENCES challenges(id),
      endpoint TEXT NOT NULL,
      amount TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_endpoint ON challenges(endpoint);
    CREATE INDEX IF NOT EXISTS idx_payments_endpoint ON payments(endpoint);
  `)

  const insertChallenge = db.prepare(
    'INSERT INTO challenges (endpoint, amount, timestamp, requester_ip, user_agent) VALUES (?, ?, ?, ?, ?)'
  )
  const insertPayment = db.prepare(
    'INSERT INTO payments (challenge_id, endpoint, amount, timestamp) VALUES (?, ?, ?, ?)'
  )

  // Base prices per endpoint (set when charge() is called)
  const baseAmounts = {}

  // SSE clients
  const sseClients = new Set()

  function notifyClients() {
    try {
      for (const send of sseClients) {
        try { send() } catch { sseClients.delete(send) }
      }
    } catch {}
  }

  // Price pinning cache
  const priceCache = new Map()
  const PRICE_TTL = 5 * 60 * 1000

  function getPinnedPrice(key, endpoint, randomFn, min, max, ip, ua) {
    const now = Date.now()
    for (const [k, v] of priceCache) {
      if (now - v.timestamp > PRICE_TTL) priceCache.delete(k)
    }

    const cached = priceCache.get(key)
    if (cached) return cached

    const price = randomFn(min, max).toFixed(6)
    const result = insertChallenge.run(endpoint, price, now, ip, ua)
    const entry = { price, timestamp: now, challengeRowId: result.lastInsertRowid }
    priceCache.set(key, entry)
    notifyClients()
    return entry
  }

  // --- charge() middleware ---

  function charge(options) {
    const { range, strategy = 'uniform', ...chargeOptions } = options
    const endpoint = chargeOptions.description || 'unknown'
    baseAmounts[endpoint] = parseFloat(chargeOptions.amount)

    // No range = pass through to mppx.charge() unchanged
    if (!range) {
      return mppx.charge(chargeOptions)
    }

    const [min, max] = range
    const randomFn = strategies[strategy] || uniformRandom

    return async (c, next) => {
      const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
      const ua = c.req.header('user-agent') || 'unknown'
      const hasCredential = !!c.req.header('authorization')

      const pinKey = `${endpoint}:${ip}:${ua}`

      if (!hasCredential) {
        const existing = priceCache.get(pinKey)
        if (existing && (Date.now() - existing.timestamp > 1000)) {
          priceCache.delete(pinKey)
        }
      }

      const { price: randomPrice, challengeRowId } = getPinnedPrice(pinKey, endpoint, randomFn, min, max, ip, ua)

      const innerMiddleware = mppx.charge({ ...chargeOptions, amount: randomPrice })

      let paid = false
      const wrappedNext = async () => {
        paid = true
        await next()
      }

      const response = await innerMiddleware(c, wrappedNext)

      if (paid) {
        insertPayment.run(challengeRowId, endpoint, randomPrice, Date.now())
        c.set('openprice.amount', randomPrice)
        priceCache.delete(pinKey)
        notifyClients()
      }

      if (response) return response
    }
  }

  // --- Token auth middleware ---

  function tokenAuth() {
    return async (c, next) => {
      // No token configured = open access
      if (!token) return next()

      // Check cookie first
      const cookie = c.req.header('cookie')
      if (cookie) {
        const match = cookie.match(/openprice-token=([^;]+)/)
        if (match && match[1] === token) return next()
      }

      // Check query param
      const queryToken = c.req.query('token')
      if (queryToken === token) {
        // Set cookie and redirect to clean URL
        const url = new URL(c.req.url)
        url.searchParams.delete('token')
        const cleanPath = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '')
        c.header('Set-Cookie', `openprice-token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`)
        return c.redirect(cleanPath)
      }

      // Not authenticated — show gate page
      return c.html(tokenGatePage())
    }
  }

  function tokenGatePage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenPrice</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    background: #fafafa; color: #1d1d1f;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; -webkit-font-smoothing: antialiased;
  }
  .gate {
    text-align: center; max-width: 400px; padding: 40px;
  }
  .logo {
    font-size: 48px; font-weight: 800; letter-spacing: -2px;
    background: linear-gradient(135deg, #1d1d1f 0%, #1d1d1f 40%, #86868b 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
  }
  .logo span { font-weight: 300; letter-spacing: -0.5px; }
  .subtitle { font-size: 14px; color: #86868b; margin-bottom: 32px; }
  form { display: flex; gap: 8px; }
  input {
    flex: 1; padding: 12px 16px; border: 1px solid rgba(0,0,0,0.1);
    border-radius: 10px; font-size: 14px; font-family: inherit;
    outline: none; transition: border-color 0.2s;
  }
  input:focus { border-color: #6A82FB; }
  button {
    padding: 12px 20px; border: none; border-radius: 10px;
    background: #1d1d1f; color: #fff; font-size: 14px; font-weight: 600;
    font-family: inherit; cursor: pointer; transition: opacity 0.2s;
  }
  button:hover { opacity: 0.8; }
  .hint { font-size: 12px; color: #aeaeb2; margin-top: 16px; }
</style>
</head>
<body>
<div class="gate">
  <div class="logo">Open<span>Price</span></div>
  <p class="subtitle">Enter your dashboard token to continue.</p>
  <form onsubmit="window.location.href='?token='+encodeURIComponent(document.getElementById('t').value);return false">
    <input type="password" id="t" placeholder="Dashboard token" autofocus>
    <button type="submit">Go</button>
  </form>
  <p class="hint">Find your token in .env (OPENPRICE_TOKEN)</p>
</div>
</body>
</html>`
  }

  // --- Dashboard routes ---

  function routes() {
    const app = new Hono()

    // Token auth on all dashboard routes
    app.use('/*', tokenAuth())

    app.get('/', (c) => {
      const html = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8')
      c.header('Cache-Control', 'no-store')
      return c.html(html)
    })

    app.get('/api/events', (c) => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          const send = () => {
            try { controller.enqueue(encoder.encode('data: update\n\n')) } catch {}
          }
          send()
          sseClients.add(send)
          c.req.raw.signal?.addEventListener('abort', () => {
            sseClients.delete(send)
          })
        },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    })

    app.get('/api/agents', (c) => {
      if (!agentsFile) return c.json(null, 404)
      try {
        const data = JSON.parse(readFileSync(join(process.cwd(), agentsFile), 'utf-8'))
        return c.json(data)
      } catch {
        return c.json(null, 404)
      }
    })

    app.get('/api/data', (c) => {
      const endpoint = c.req.query('endpoint')

      const endpoints = db.prepare(
        'SELECT DISTINCT endpoint FROM challenges ORDER BY endpoint'
      ).all().map(r => r.endpoint)

      const whereClause = endpoint ? 'WHERE endpoint = ?' : ''
      const params = endpoint ? [endpoint] : []

      const challenges = db.prepare(
        `SELECT endpoint, amount, timestamp FROM challenges ${whereClause} ORDER BY timestamp`
      ).all(...params)

      const payments = db.prepare(
        `SELECT endpoint, amount, timestamp FROM payments ${whereClause} ORDER BY timestamp`
      ).all(...params)

      const curves = {}
      for (const ep of (endpoint ? [endpoint] : endpoints)) {
        const epChallenges = challenges.filter(c => c.endpoint === ep)
        const epPayments = payments.filter(p => p.endpoint === ep)

        if (epChallenges.length === 0) continue

        const amounts = epChallenges.map(c => parseFloat(c.amount))
        const minPrice = Math.min(...amounts)
        const maxPrice = Math.max(...amounts)

        const idealBins = Math.max(5, Math.min(25, Math.floor(epChallenges.length / 15)))
        const bucketCount = idealBins
        const bucketWidth = (maxPrice - minPrice) / bucketCount || 0.01

        const bins = []
        for (let i = 0; i < bucketCount; i++) {
          const lo = minPrice + i * bucketWidth
          const hi = lo + bucketWidth
          const mid = (lo + hi) / 2
          const requestCount = epChallenges.filter(c => {
            const a = parseFloat(c.amount)
            return a >= lo && (i === bucketCount - 1 ? a <= hi : a < hi)
          }).length
          const paymentCount = epPayments.filter(p => {
            const a = parseFloat(p.amount)
            return a >= lo && (i === bucketCount - 1 ? a <= hi : a < hi)
          }).length

          const conversionRate = requestCount > 0 ? paymentCount / requestCount : 0

          bins.push({
            lo: parseFloat(lo.toFixed(6)),
            hi: parseFloat(hi.toFixed(6)),
            mid: parseFloat(mid.toFixed(6)),
            requests: requestCount,
            payments: paymentCount,
            conversionRate: parseFloat(conversionRate.toFixed(4)),
          })
        }

        const smoothedBins = smoothDemand(bins)
        const outcomes = buildOutcomeSeries(smoothedBins)

        const validOutcomes = outcomes.filter(o => o.requests >= 2)
        const optimalRevenue = validOutcomes.reduce((best, o) =>
          o.projectedRevenuePer1000 > (best?.projectedRevenuePer1000 || 0) ? o : best, null)
        const optimalVolume = validOutcomes.reduce((best, o) =>
          o.expectedConversion > (best?.expectedConversion || 0) ? o : best, null)

        curves[ep] = {
          bins: bins.map((b, i) => ({
            ...b,
            smoothedConversion: smoothedBins[i]?.smoothedConversion || 0,
          })),
          outcomes,
          summary: {
            totalRequests: epChallenges.length,
            totalPayments: epPayments.length,
            overallConversion: parseFloat((epPayments.length / epChallenges.length).toFixed(4)),
            totalRevenue: parseFloat(epPayments.reduce((s, p) => s + parseFloat(p.amount), 0).toFixed(6)),
          },
          optimal: {
            revenue: optimalRevenue ? {
              price: optimalRevenue.price,
              conversion: optimalRevenue.expectedConversion,
              revenuePer1000: optimalRevenue.projectedRevenuePer1000,
            } : null,
            volume: optimalVolume ? {
              price: optimalVolume.price,
              conversion: optimalVolume.expectedConversion,
              revenuePer1000: optimalVolume.projectedRevenuePer1000,
            } : null,
          },
        }
      }

      return c.json({ endpoints, curves, baseAmounts })
    })

    app.get('/api/log', (c) => {
      const endpoint = c.req.query('endpoint')
      const limit = parseInt(c.req.query('limit') || '500')
      const offset = parseInt(c.req.query('offset') || '0')

      const whereClause = endpoint ? 'WHERE c.endpoint = ?' : ''
      const params = endpoint ? [endpoint] : []

      const rows = db.prepare(`
        SELECT
          c.id as challenge_id,
          c.endpoint,
          c.amount,
          c.timestamp as challenged_at,
          c.requester_ip,
          c.user_agent,
          p.id as payment_id,
          p.timestamp as paid_at
        FROM challenges c
        LEFT JOIN payments p ON p.challenge_id = c.id
        ${whereClause}
        ORDER BY c.timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset)

      const total = db.prepare(
        `SELECT COUNT(*) as count FROM challenges ${endpoint ? 'WHERE endpoint = ?' : ''}`
      ).get(...params).count

      return c.json({
        rows: rows.map(r => ({
          challengeId: r.challenge_id,
          endpoint: r.endpoint,
          amount: r.amount,
          requestedAt: new Date(r.challenged_at).toISOString(),
          paid: !!r.payment_id,
          paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
          requesterIp: r.requester_ip,
          userAgent: r.user_agent,
        })),
        total,
        limit,
        offset,
      })
    })

    return app
  }

  return { charge, routes }
}
