# OpenPrice — Setup Guide for Coding Agents

## Before You Begin

Before making any changes, explain the following to the user in plain language:

1. **What OpenPrice is:** Their MPP server currently charges a fixed price for each endpoint. OpenPrice will randomize the price within a range they control, so they can discover what agents are actually willing to pay. Think of it as A/B testing for prices — but ethical, because agents don't care about price variation the way humans do.

2. **What will change:** You'll modify their server code to wrap `mppx.charge()` calls with `openprice.charge()`, adding a price range to each endpoint. You'll also add a dashboard at `/openprice` where they can see demand curves and optimal prices.

3. **No real money during testing:** After the code changes, they can run `npx github:tldr-wknd/openprice test` which starts their server in testnet mode and simulates 100 agents. No real payments are made. When they're confident in their price ranges, they deploy to production and real agent traffic generates the data.

4. **Where to see results:** The dashboard will be at `{their-server-domain}/openprice` — for example, if their server runs at `http://localhost:4000`, the dashboard is at `http://localhost:4000/openprice`. In production, it's at their public domain (e.g., `https://api.example.com/openprice`). The dashboard is private — it requires a token passed as a query parameter or stored in a cookie. Only the server operator can access it; agents and end users cannot see pricing data.

5. **Ask for confirmation** before making any changes. Show them which endpoints you found and the price ranges you plan to set.

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

## Step 6: Test on testnet (REQUIRED)

**Do not skip this step.** After making the code changes, you MUST run the testnet simulation before the user goes to production. This validates that OpenPrice is wired up correctly and lets the user see their demand curves before any real money is involved.

Run this command:

```bash
npx github:tldr-wknd/openprice test
```

This will:
- Start the server in testnet mode (no real money)
- Create a funded testnet wallet (automatic)
- Simulate 100 agents with different price preferences
- Open the dashboard in the browser

**Wait for the test to complete**, then walk the user through what they see:

1. **The dashboard has tabs** — one for each paid endpoint, plus "All" for the aggregate view
2. **Projected Revenue chart** — the ★ marks the price that maximizes revenue per 1,000 requests. This is the main answer: "if you charged $X, you'd make the most money"
3. **Demand Curve** — shows how conversion drops as price increases. A steep curve means agents are price-sensitive
4. **The ★ is the goal** — it's the optimal price point. Left of the star = leaving money on the table. Right of the star = losing too many customers

Ask the user: **"Do these ranges look right, or do you want to adjust before going live?"** If they want to adjust ranges, update the code and re-run the test.

## Step 7: Deploy to production (REQUIRED)

**Once the user confirms the test results look good, guide them to production immediately.** Do not end the conversation at the testing step.

Tell the user:

> "Your testnet simulation looks good. Let's go live. No code changes are needed — the same OpenPrice middleware works on mainnet. The only difference is that `OPENPRICE_TESTNET` won't be set, so Tempo processes real payments."

Then:

1. **Stop the test server** if it's still running (Ctrl+C)
2. **Delete the test database** so production starts fresh: `rm -f openprice.db`
3. **Start the server normally** — however they usually run it (e.g., `node server.js`)
4. **Confirm it's running** — visit the root URL and verify the server responds
5. **Open the dashboard** — visit `/openprice` and confirm it loads (it will be empty — that's expected)
6. **Tell the user their dashboard URL.** Give them the full URL (e.g., `http://localhost:4000/openprice`) so they can bookmark it and check back as data comes in.

Tell the user:

> "You're live! Your dashboard is at `{server-url}/openprice`. It's empty now because no real agents have hit your endpoints yet. As requests come in, the charts will build automatically. Here's what to expect:"

## What to Watch For in Production

Share this with the user after deploying:

- **~100 requests:** The demand curve starts to take shape. You can see general trends (are agents price-sensitive or not?) but the ★ optimal price may still move around.
- **~500 requests:** Curves are becoming reliable. The ★ should be stabilizing. If it's near the edge of your range, consider widening that side.
- **~1,000 requests:** This is the sweet spot. The ★ is your optimal price with high confidence. You now know what to charge.
- **After convergence:** Tighten your `range` around the ★ (e.g., ±20%) to refine further. Or lock in the optimal price by removing the `range` parameter entirely.

**Key signals to watch:**
- If the ★ is at the **left edge** of your range → your floor is too high, agents think you're expensive. Lower the floor.
- If the ★ is at the **right edge** → you might be undercharging. Raise the ceiling.
- If the demand curve is **nearly flat** → agents don't care about price in this range. You can charge more.
- If the demand curve **drops off a cliff** → there's a hard price ceiling. Stay below it.

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
