# OpenPrice — Setup Guide for Coding Agents

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
