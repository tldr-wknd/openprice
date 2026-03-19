# Open★Price

**Price discovery for the agent economy.**

With human customers, you can't A/B test prices — it's unethical, often illegal, and destroys trust. But agents don't care. They see a price, make a rational buy/don't-buy decision, and move on. No outrage, no churn risk, no brand damage.

OpenPrice is middleware for [MPP](https://mpp.dev) (Machine Payments Protocol) that turns every agent request into a data point on your demand curve. Instead of guessing your price, you *discover* it.

## How it works

1. You wrap your existing `mppx.charge()` calls with OpenPrice
2. Each request gets a randomized price within your configured range
3. OpenPrice tracks which prices lead to payments vs. skips
4. A dashboard shows your demand curve and optimal price point (the ★)

~1,000 requests → you know your optimal price.

## Quick start

```bash
git clone https://github.com/tldr-wknd/openprice.git
cd openprice
npm install
node server.js
```

Open **http://localhost:3000/openprice/testnet** to see the demo dashboard with pre-loaded data from 100 simulated agents.

### Run your own experiment

```bash
# Create and fund a testnet wallet (pick any name)
npx mppx account create --account my-agent
npx mppx account fund --account my-agent

# Start the server
node server.js

# Run 1,000 requests from 100 agents with different price preferences
node agent-100.js

# Watch the dashboard update in real-time
open http://localhost:3000/openprice
```

## Add OpenPrice to your MPP server

```diff
  import { Mppx, tempo } from 'mppx/hono'
+ import { withOpenPrice } from './openprice/index.js'

  const mppx = Mppx.create({ ... })
+ const openprice = withOpenPrice(mppx)

- app.get('/api/resource', mppx.charge({ amount: '0.10' }), handler)
+ app.get('/api/resource', openprice.charge({ amount: '0.10', range: [0.05, 0.15] }), handler)
+ app.route('/openprice', openprice.routes())
```

Or run the CLI:

```bash
npx openprice init
```

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
