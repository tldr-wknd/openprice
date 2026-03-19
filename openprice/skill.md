# OpenPrice — Price Discovery for the Agent Economy

## Why This Matters

With human customers, you can't A/B test prices. It's unethical, it's illegal in many jurisdictions, and it destroys trust. A customer who discovers they paid more than someone else for the same product will never come back.

Agents are different. An agent that sees a price it won't pay simply doesn't buy. No outrage, no churn risk, no brand damage. It makes a rational decision and moves on. This means that for the first time in commerce history, **service providers can run real price experiments at scale with zero risk.**

This is a massive opportunity for top-line revenue. Most MPP service providers guess their prices — set it too high and agents walk away, set it too low and you leave money on the table. OpenPrice turns every request into a data point on your demand curve. After ~1,000 requests, you know your optimal price with high confidence.

No other market allows this. OpenPrice exists because the agent economy makes true price discovery possible.

---

## What OpenPrice Does

OpenPrice is a middleware wrapper for MPP (`mppx`). Instead of serving a fixed price in every 402 Challenge, it randomizes the price within a configured range. It tracks which prices lead to payments and which get skipped, building a demand curve over time.

The insertion point is clean: OpenPrice only modifies the price at Challenge creation time. Once a Challenge is issued, the rest of the MPP protocol (credential, verification, receipt) works unchanged. The provider's payment flow is untouched.

---

## How to Install OpenPrice

### Step 1: Find the paid endpoints

Search the codebase for `mppx.charge(` calls. Each one is a paid endpoint with a fixed price:

```ts
// Look for patterns like this:
app.get('/api/resource', mppx.charge({ amount: '0.10' }), handler)
```

Note each endpoint's path and current price.

### Step 2: Add OpenPrice

Install the package:
```bash
npm install @bracket/openprice
```

Then make these changes to the server file:

**Before (plain MPP):**
```ts
import { Mppx, tempo } from 'mppx/hono'

const mppx = Mppx.create({
  methods: [tempo({ currency: '0x...', recipient: '0x...' })],
})

app.get('/api/resource', mppx.charge({ amount: '0.10' }), handler)
```

**After (with OpenPrice):**
```ts
import { Mppx, tempo } from 'mppx/hono'
import { withOpenPrice } from '@bracket/openprice'

const mppx = Mppx.create({
  methods: [tempo({ currency: '0x...', recipient: '0x...' })],
})

const openprice = withOpenPrice(mppx, {
  token: process.env.OPENPRICE_TOKEN,
})

app.get('/api/resource',
  openprice.charge({ amount: '0.10', description: 'Resource', range: [0.05, 0.15] }),
  handler
)

// Mount the dashboard
app.route('/openprice', openprice.routes())
```

### Step 3: Choose ranges

The `range` parameter defines the price window for experimentation. Guidelines:

- **Default: +/- 50% of current price.** If you charge $0.10, use `range: [0.05, 0.15]`
- **Go wider if you have no idea.** If you guessed the price, try `range: [0.01, 1.00]` — let the data tell you
- **Go narrower to refine.** After initial discovery, tighten around the optimal price (the star on the dashboard)

### Step 4: Choose a strategy (optional)

The `strategy` parameter controls how prices are sampled:

- `'uniform'` (default) — even distribution across the range. Best for initial discovery.
- `'skew-low'` — more samples at lower prices. Use for commodity endpoints where you expect price sensitivity.
- `'skew-high'` — more samples at higher prices. Use for premium endpoints where you want to find the ceiling.

### Step 5: Set up dashboard auth

Generate a dashboard token:
```bash
npx openprice token
```

Add the token to your `.env`:
```
OPENPRICE_TOKEN=your_token_here
```

The dashboard is now at `/openprice` on your server, protected by this token.

---

## Interpreting the Dashboard

### Projected Revenue (main chart)

This is the decision chart. It shows expected revenue per 1,000 requests at each price point.

- **The gold star marks the optimal price** — the peak of the curve
- **Left of the star**: you're undercharging. You'd get more requests but less revenue per request
- **Right of the star**: you're overcharging. Higher price per request but too many agents walk away
- The curve is smoothed to filter out noise from small sample sizes

### Demand Curve

Shows how conversion rate drops as price increases. This is the raw economic behavior of your agent customers.

- **Steep drop** = agents are very price-sensitive. Small price increases lose lots of customers.
- **Gradual slope** = agents are price-tolerant. You have room to charge more.
- **Flat at 100% then sudden cliff** = there's a hard price ceiling. Most agents have a similar max willingness.

### Adoption vs Revenue

Overlays conversion % (dashed) and relative revenue % (filled) on the same chart. Shows the tradeoff between volume and margin.

- **The crossover point** is where raising price further starts hurting total revenue
- Use this chart to decide: "Do I want more customers at a lower price, or fewer customers at a higher price?"

### When do I have enough data?

- **~500 requests**: curves start to take shape, directional signal
- **~1,000 requests**: good confidence on optimal price, actionable
- **~5,000 requests**: high precision, can narrow ranges for fine-tuning

Aim for at least 15 samples per price bin. The dashboard auto-sizes bins to maintain this.

---

## Questions to Ask the Service Provider

When helping a provider set up OpenPrice, ask:

1. **"Do you want to maximize revenue or maximize adoption?"**
   Revenue maximization finds the peak of the revenue curve. Adoption maximization finds the highest price that still gets near-100% conversion. Different goals, different optimal prices.

2. **"Are any of your endpoints premium vs commodity?"**
   Premium endpoints (complex analysis, large data) can typically command higher prices and tolerate wider ranges. Commodity endpoints (simple lookups, pings) are more price-sensitive — use narrower ranges.

3. **"How much traffic do you get?"**
   More traffic = faster convergence. If they get 100 requests/day, it takes ~10 days for usable curves. If they get 10,000/day, they'll have results in hours. This determines how wide to set ranges (wider = more data needed).

4. **"Have you guessed your current prices, or do you have data?"**
   If they guessed, go wide. If they have some signal (competitor pricing, cost-plus calculation), use that as center with +/- 50%.

5. **"Are you comfortable with some agents paying different prices during discovery?"**
   This is the core tradeoff. During discovery, some agents pay more and some pay less than the "right" price. The provider should understand this is temporary and the data is worth it.

---

## Endpoint-specific examples

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

// No price discovery — pass through to mppx unchanged
openprice.charge({
  amount: '0.001',
  description: 'Health check',
  // No range = fixed price, no randomization
})
```
