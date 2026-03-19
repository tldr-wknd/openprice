# OpenPrice — Setup Guide for Coding Agents

## Before You Begin

Before making any changes, explain the following to the user in plain language:

1. **What OpenPrice is:** Their MPP server currently charges a fixed price for each endpoint. OpenPrice will randomize the price within a range they control, so they can discover what agents are actually willing to pay. Think of it as A/B testing for prices — but ethical, because agents don't care about price variation the way humans do.

2. **What will change:** You'll modify their server code to wrap `mppx.charge()` calls with `openprice.charge()`, adding a price range to each endpoint. You'll also add a dashboard at `/openprice` where they can see demand curves and optimal prices.

3. **No real money during testing:** After the code changes, they can run `npx github:tldr-wknd/openprice test` which starts their server in testnet mode and simulates 100 agents. No real payments are made. When they're confident in their price ranges, they deploy to production and real agent traffic generates the data.

4. **Ask for confirmation** before making any changes. Show them which endpoints you found and the price ranges you plan to set.

---

## What OpenPrice Does

OpenPrice is a middleware wrapper for MPP (`mppx`). Instead of serving a fixed price in every 402 Challenge, it randomizes the price within a configured range. It tracks which prices lead to payments and which get skipped, building a demand curve over time. After ~1,000 requests, the service provider knows their optimal price.

The insertion point is clean: OpenPrice only modifies the price at Challenge creation time. The rest of the MPP protocol (credential, verification, receipt) works unchanged.

---

## How to Install OpenPrice

### Step 1: Copy the library

Download the OpenPrice library files into an `openprice/` directory in the project root:

```bash
# From the project root
mkdir -p openprice
curl -sL https://raw.githubusercontent.com/tldr-wknd/openprice/main/openprice/index.js -o openprice/index.js
curl -sL https://raw.githubusercontent.com/tldr-wknd/openprice/main/openprice/dashboard.html -o openprice/dashboard.html
npm install better-sqlite3
```

### Step 2: Find the paid endpoints

Search the codebase for `mppx.charge(` calls. Each one is a paid endpoint with a fixed price:

```ts
// Look for patterns like this:
app.get('/api/resource', mppx.charge({ amount: '0.10' }), handler)
```

Note each endpoint's path and current price.

### Step 3: Update the server code

Make these changes to the server file:

**Add the import:**
```ts
import { withOpenPrice } from './openprice/index.js'
```

**Wrap the mppx instance:**
```ts
const openprice = withOpenPrice(mppx)
```

**Add testnet override to the Tempo config** (enables `openprice test` to run on testnet):
```ts
// In the Mppx.create() call, update the tempo() config:
tempo({
  testnet: !!process.env.OPENPRICE_TESTNET,  // add this line
  currency: '0x...',
  recipient: '0x...',
})
```

**Replace each `mppx.charge()` with `openprice.charge()`**, adding a `range` parameter:
```ts
// Before:
mppx.charge({ amount: '0.10', description: 'Resource' })

// After:
openprice.charge({ amount: '0.10', description: 'Resource', range: [0.02, 0.50] })
```

**Mount the dashboard:**
```ts
app.route('/openprice', openprice.routes())
```

### Step 4: Choose ranges

The `range` parameter defines the price window for experimentation:

- **Default: 20% floor, 5x ceiling.** If you charge $0.10, use `range: [0.02, 0.50]`
- **Go wider if the price was a guess.** Try `range: [0.01, 1.00]` — let the data tell you
- **Go narrower to refine.** After initial discovery, tighten around the optimal price

### Step 5: Choose a strategy (optional)

The `strategy` parameter controls how prices are sampled:

- `'uniform'` (default) — even distribution across the range. Best for initial discovery.
- `'skew-low'` — more samples at lower prices. Use for commodity endpoints where you expect price sensitivity.
- `'skew-high'` — more samples at higher prices. Use for premium endpoints where you want to find the ceiling.

```ts
openprice.charge({
  amount: '0.50',
  description: 'Market data',
  range: [0.10, 2.50],
  strategy: 'skew-low',
})
```

---

## Testing

After making the code changes, the service provider can run:

```bash
npx github:tldr-wknd/openprice test
```

This starts their server in testnet mode (no real money), runs 100 simulated agents, and opens the dashboard so they can see the demand curves build in real-time.

## After Testing

When the user confirms the test results look good, guide them to production:

1. **No code changes needed.** The OpenPrice middleware works identically on mainnet. The only difference is the `OPENPRICE_TESTNET` env var — in production, it's not set, so Tempo runs on mainnet with real payments.
2. **Deploy as normal.** However they usually deploy their server, they deploy it. OpenPrice is just middleware — it ships with the server.
3. **Real agent traffic builds real curves.** The demand curves from testing were simulated. In production, actual agents with real willingness-to-pay generate the data. After ~1,000 real requests, the ★ optimal price reflects true market demand.
4. **They can narrow ranges later.** Once the initial curves show a clear peak, suggest tightening the price range around the ★ for more precise optimization.

---

## Endpoint Examples

```ts
// Simple API — uniform, narrow range
openprice.charge({
  amount: '0.01',
  description: 'Weather lookup',
  range: [0.005, 0.02],
})

// Data product — skew-low, medium range
openprice.charge({
  amount: '0.50',
  description: 'Market data feed',
  range: [0.10, 1.00],
  strategy: 'skew-low',
})

// Premium service — skew-high, wide range
openprice.charge({
  amount: '5.00',
  description: 'AI model inference',
  range: [1.00, 15.00],
  strategy: 'skew-high',
})

// No price discovery — fixed price, no randomization
openprice.charge({
  amount: '0.001',
  description: 'Health check',
  // No range = passes through to mppx unchanged
})
```
