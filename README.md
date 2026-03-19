# Open★Price

**Discover perfect pricing in the agent economy.**

With human customers, you can't A/B test prices — it's unethical, often illegal, and destroys trust. But agents don't care. They see a price, make a rational buy/don't-buy decision, and move on. No outrage, no churn risk, no brand damage.

OpenPrice is middleware for [MPP](https://mpp.dev) (Machine Payments Protocol) that turns every agent request into a data point on your demand curve. Instead of guessing your price, you *discover* it.

## How it works

1. You wrap your existing `mppx.charge()` calls with OpenPrice
2. Each request gets a randomized price within your configured range
3. OpenPrice tracks which prices lead to payments vs. skips
4. A dashboard shows your demand curve and optimal price point (the ★)

~1,000 requests → you know your optimal price.

## Quick demo

See OpenPrice in action with a pre-built example server and 100 simulated agents:

```bash
git clone https://github.com/tldr-wknd/openprice.git
cd openprice
npm install
node demo.js
```

This starts a demo server, opens the dashboard in your browser, and fires 1,000 requests from 100 agents with different price preferences. Watch the demand curve build in real-time.

> A pre-loaded version with completed data is at `http://localhost:3000/openprice/testnet`

## Add OpenPrice to your MPP server

> **Prerequisite:** You need an existing MPP server with `mppx.charge()` endpoints. Run the command below from your server's root directory (where `package.json` lives). Don't have one yet? Run the [quick demo](#quick-demo) first to see how OpenPrice works.

### Step 1 — Install

From your MPP server's root directory:

```bash
cd your-mpp-server/
npx github:tldr-wknd/openprice init
```

This scans your codebase for `mppx.charge()` calls, copies the OpenPrice library, installs dependencies, and shows you exactly what code to change. Two options:

1. **Agent-guided** — gives you a prompt to paste into your coding agent (Claude Code, Cursor, etc.)
2. **Manual** — shows the exact code changes to make yourself

### Step 2 — Update your code

```diff
  import { Mppx, tempo } from 'mppx/hono'
+ import { withOpenPrice } from './openprice/index.js'

  const mppx = Mppx.create({ ... })
+ const openprice = withOpenPrice(mppx)

- app.get('/api/resource', mppx.charge({ amount: '0.10' }), handler)
+ app.get('/api/resource', openprice.charge({ amount: '0.10', range: [0.05, 0.15] }), handler)
+ app.route('/openprice', openprice.routes())
```

### Step 3 — Test in dev

Before going to production, validate your price ranges with simulated agents on testnet:

```bash
npx github:tldr-wknd/openprice test
```

This starts your server, creates a funded testnet wallet, and runs 100 agents against your endpoints — each with a different willingness to pay. The dashboard opens automatically so you can watch the demand curves build.

Review the ★ optimal prices. Adjust your ranges if needed. When you're confident, deploy to production.

> **Testnet vs production:** The OpenPrice middleware is identical in both environments. The only difference is the `testnet: true` flag in your Tempo config, which you already control. No code changes needed to go live.

## Dashboard

Three charts, one decision:

- **Projected Revenue** — expected revenue per 1,000 requests at each price. The ★ marks the peak.
- **Demand Curve** — how conversion drops as price increases
- **Adoption vs Revenue** — the tradeoff between volume and margin

## Architecture

OpenPrice inserts at Challenge creation time in the MPP flow. When a server issues a 402 Payment Required, OpenPrice randomizes the price in the Challenge. The rest of the protocol (credential, verification, receipt) works unchanged.

```
Agent request → OpenPrice picks random price → 402 Challenge → Agent decides → Pay or skip
                    ↓                                              ↓
              Log to SQLite                                  Log payment
                    ↓
            Build demand curve → Dashboard → ★ Optimal price
```

## Built with

- [MPP](https://mpp.dev) — Machine Payments Protocol
- [mppx](https://www.npmjs.com/package/mppx) — MPP TypeScript SDK
- [Tempo](https://tempo.xyz) — Stablecoin settlement layer
- [Hono](https://hono.dev) — Web framework
- [Chart.js](https://www.chartjs.org) — Charts
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Embedded database
