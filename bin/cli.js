#!/usr/bin/env node

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { fork, execSync } from 'child_process'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'fs'
import { createInterface } from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const command = process.argv[2]

if (command === 'demo') {
  fork(join(root, 'demo.js'), { cwd: root })
} else if (command === 'init') {
  await runInit()
} else if (command === 'test') {
  await runTest()
} else {
  console.log(`
  Open★Price

  Commands:
    openprice demo    Run the interactive demo
    openprice init    Add OpenPrice to your MPP server
    openprice test    Run 100 simulated agents against your server

  Usage:
    npx github:tldr-wknd/openprice demo
    npx github:tldr-wknd/openprice init
    npx github:tldr-wknd/openprice test
`)
}

// ── Init command ────────────────────────────────────────────────

async function runInit() {
  const cwd = process.cwd()

  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║  Open★Price — Setup                                          ║
  ╚═══════════════════════════════════════════════════════════════╝

  What is OpenPrice?
  OpenPrice helps MPP service providers discover their optimal price.
  Instead of guessing what to charge, you test a range of prices and
  let agent behavior reveal the demand curve. ~1,000 requests and
  you know exactly what to charge.

  Scanning for MPP endpoints...
`)

  // Find all .js and .ts files (skip node_modules, .git, dist)
  const files = findFiles(cwd, ['.js', '.ts', '.mjs', '.mts'])
  if (files.length === 0) {
    console.log(`  No JavaScript/TypeScript files found in this directory.

  OpenPrice needs to run inside an MPP server directory — the one
  with your mppx.charge() endpoints.

  ${bold('→ Have an MPP server?')}
    cd your-mpp-server/
    npx github:tldr-wknd/openprice init

  ${bold('→ New to MPP?')} Run the demo to see OpenPrice in action:
    npx github:tldr-wknd/openprice demo
`)
    process.exit(1)
  }

  // Scan for mppx.charge() calls
  const endpoints = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const found = extractChargeEndpoints(content, file, cwd)
    endpoints.push(...found)
  }

  if (endpoints.length === 0) {
    console.log(`  No mppx.charge() calls found.

  OpenPrice needs to run inside an MPP server directory — the one
  with your mppx.charge() endpoints.

  ${bold('→ Have an MPP server?')}
    cd your-mpp-server/
    npx github:tldr-wknd/openprice init

  ${bold('→ New to MPP?')} Run the demo to see OpenPrice in action:
    npx github:tldr-wknd/openprice demo
`)
    process.exit(1)
  }

  // Display found endpoints
  console.log(`  Found ${endpoints.length} paid endpoint${endpoints.length > 1 ? 's' : ''}:\n`)
  console.log('  ┌─────────────────────────────────────────────────────────────┐')
  for (const ep of endpoints) {
    const price = `$${ep.amount}`
    const range = suggestRange(parseFloat(ep.amount))
    console.log(`  │  ${ep.method.padEnd(4)} ${ep.path.padEnd(25)} ${price.padEnd(8)} → test range $${range[0].toFixed(2)}–$${range[1].toFixed(2)}`)
    if (ep.description) {
      console.log(`  │       "${ep.description}"`)
    }
  }
  console.log('  └─────────────────────────────────────────────────────────────┘')
  console.log(`
  │  File: ${endpoints[0].relFile}
`)

  // Present options
  console.log(`  How would you like to test out OpenPrice?

  1 — Give your agent the skill file to guide you through setup
  2 — Get instructions to manually add OpenPrice ranges to your codebase
`)

  const answer = await ask('  Enter 1 or 2: ')

  if (answer === '1') {
    await showSkillFileInstructions()
  } else if (answer === '2') {
    await autoInstall(cwd, endpoints)
  } else {
    console.log('\n  Invalid option. Run `npx openprice init` to try again.')
  }
}

// ── Auto-install ────────────────────────────────────────────────

async function autoInstall(cwd, endpoints) {
  console.log('\n  Installing OpenPrice...\n')

  // Copy openprice library files
  const opDir = join(cwd, 'openprice')
  if (!existsSync(opDir)) {
    const { mkdirSync } = await import('fs')
    mkdirSync(opDir, { recursive: true })
  }

  const filesToCopy = ['index.js', 'dashboard.html']
  for (const f of filesToCopy) {
    const src = join(root, 'openprice', f)
    const dest = join(opDir, f)
    if (existsSync(src)) {
      copyFileSync(src, dest)
      console.log(`  ✓ openprice/${f}`)
    }
  }

  // Install dependency
  console.log('  Installing better-sqlite3...')
  try {
    execSync('npm install better-sqlite3', { cwd, stdio: 'pipe' })
    console.log('  ✓ better-sqlite3')
  } catch (e) {
    console.log('  ⚠ Could not install better-sqlite3. Run: npm install better-sqlite3')
  }

  // Generate the wrapper code the user needs to add
  console.log(`
  ✓ OpenPrice installed to ./openprice/

  Now update your server code:
`)

  // Show the code changes needed
  console.log(`  Add this import:
    ${dim('import { withOpenPrice } from \'./openprice/index.js\'')}

  Wrap your mppx instance:
    ${dim('const openprice = withOpenPrice(mppx)')}

  Add testnet override to your Tempo config (for dev testing):
    ${dim('testnet: !!process.env.OPENPRICE_TESTNET,')}

  Replace each mppx.charge() with openprice.charge():`)

  for (const ep of endpoints) {
    const range = suggestRange(parseFloat(ep.amount))
    console.log(`
    ${red(`- mppx.charge({ amount: '${ep.amount}' })`)}
    ${green(`+ openprice.charge({ amount: '${ep.amount}', range: [${range[0]}, ${range[1]}] })`)}`)
  }

  console.log(`
  Mount the dashboard:
    ${dim(`app.route('/openprice', openprice.routes())`)}

  Then restart your server and visit /openprice to see your dashboard.
`)
}

// ── Skill file instructions ─────────────────────────────────────

async function showSkillFileInstructions() {
  const cwd = process.cwd()
  const skillUrl = 'https://github.com/tldr-wknd/openprice/blob/main/openprice/skill.md'

  console.log(`
  Give this to your coding agent (Claude Code, Cursor, etc.):

    "Follow the instructions at ${skillUrl}
     to add OpenPrice to the project in ${cwd}"
`)
}

// ── Helpers ──────────────────────────────────────────────────────

function findFiles(dir, extensions, results = [], depth = 0) {
  if (depth > 3) return results  // server files are near the root
  const skip = ['node_modules', '.git', 'dist', 'build', '.next', '.claude', 'openprice']
  try {
    for (const entry of readdirSync(dir)) {
      if (skip.includes(entry) || entry.startsWith('.')) continue
      const full = join(dir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) {
          findFiles(full, extensions, results, depth + 1)
        } else if (extensions.some(ext => entry.endsWith(ext))) {
          results.push(full)
        }
      } catch {}
    }
  } catch {}
  return results
}

function extractChargeEndpoints(content, filePath, cwd) {
  const endpoints = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match mppx.charge() or openprice.charge() patterns
    const chargeMatch = line.match(/(mppx|openprice)\.charge\(\s*\{/)
    if (!chargeMatch) continue

    // Gather the full charge block (may span multiple lines)
    let block = ''
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      block += lines[j] + '\n'
      if (lines[j].includes(')')) break
    }

    // Extract amount (must be a numeric value, not a template expression)
    const amountMatch = block.match(/amount:\s*['"](\d+\.?\d*)['"]/)
    if (!amountMatch) continue

    // Extract description
    const descMatch = block.match(/description:\s*['"]([^'"]+)['"]/)

    // Look backwards for route definition (app.get, app.post, etc.)
    let path = '/unknown'
    let method = 'GET'
    for (let j = i; j >= Math.max(0, i - 10); j--) {
      // Single-line: app.get('/path', ...)
      const routeMatch = lines[j].match(/app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/)
      if (routeMatch) {
        method = routeMatch[1].toUpperCase()
        path = routeMatch[2]
        break
      }
      // Multi-line: app.get(\n  '/path',
      const methodMatch = lines[j].match(/app\.(get|post|put|delete|patch)\(/)
      if (methodMatch) {
        method = methodMatch[1].toUpperCase()
        // Look forward from app.get( for the path string
        for (let k = j; k <= i; k++) {
          const pathMatch = lines[k].match(/['"]([/][^'"]+)['"]/)
          if (pathMatch) {
            path = pathMatch[1]
            break
          }
        }
        break
      }
    }

    endpoints.push({
      path,
      method,
      amount: amountMatch[1],
      description: descMatch ? descMatch[1] : null,
      file: filePath,
      relFile: filePath.replace(cwd + '/', ''),
      line: i + 1,
    })
  }

  return endpoints
}

function suggestRange(amount) {
  // Suggest a range: 20% of the base price as floor, 5x as ceiling
  const min = Math.max(0.01, Math.round(amount * 0.2 * 100) / 100)
  const max = Math.round(amount * 5 * 100) / 100
  return [min, max]
}

function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function dim(s) { return `\x1b[2m${s}\x1b[0m` }
function red(s) { return `\x1b[31m${s}\x1b[0m` }
function green(s) { return `\x1b[32m${s}\x1b[0m` }
function bold(s) { return `\x1b[1m${s}\x1b[0m` }

// ── Test command ────────────────────────────────────────────────

async function runTest() {
  const cwd = process.cwd()

  // Scan for endpoints (same as init)
  const files = findFiles(cwd, ['.js', '.ts', '.mjs', '.mts'])
  const endpoints = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    endpoints.push(...extractChargeEndpoints(content, file, cwd))
  }

  if (endpoints.length === 0) {
    console.log(`
  No paid endpoints found. Run this from your MPP server directory:
    cd your-mpp-server/
    npx github:tldr-wknd/openprice init
`)
    process.exit(1)
  }

  // Check for OpenPrice integration (look for openprice.charge or withOpenPrice)
  let hasOpenPrice = false
  let serverFile = null
  let serverPort = 3000
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    if (content.includes('withOpenPrice') || content.includes('openprice.charge')) {
      hasOpenPrice = true
    }
    // Detect server file and port
    const portMatch = content.match(/port:\s*(\d+)/)
    const serveMatch = content.match(/serve\s*\(/)
    if (serveMatch) {
      serverFile = file
      if (portMatch) serverPort = parseInt(portMatch[1])
    }
  }

  if (!hasOpenPrice) {
    console.log('\n  OpenPrice not integrated yet. Run `openprice init` first.\n')
    process.exit(1)
  }

  if (!serverFile) {
    console.log('\n  Could not find server entry point. Which file starts your server?\n')
    process.exit(1)
  }

  // Build endpoint config with ranges
  const products = []
  for (const ep of endpoints) {
    const content = readFileSync(ep.file, 'utf8')
    // Try to find the range from openprice.charge() call
    const lines = content.split('\n')
    let rangeMin, rangeMax
    for (let j = Math.max(0, ep.line - 3); j < Math.min(lines.length, ep.line + 5); j++) {
      const rangeMatch = lines[j].match(/range:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/)
      if (rangeMatch) {
        rangeMin = parseFloat(rangeMatch[1])
        rangeMax = parseFloat(rangeMatch[2])
        break
      }
    }
    if (!rangeMin) {
      const suggested = suggestRange(parseFloat(ep.amount))
      rangeMin = suggested[0]
      rangeMax = suggested[1]
    }
    products.push({
      path: ep.path,
      name: ep.description || ep.path,
      min: rangeMin,
      max: rangeMax,
    })
  }

  const relServer = serverFile.replace(cwd + '/', '')

  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║  Open★Price — Dev Test                                       ║
  ╚═══════════════════════════════════════════════════════════════╝

  Starting your server (${relServer} on port ${serverPort})...
`)

  // Start the user's server in testnet mode
  const serverProc = fork(serverFile, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, OPENPRICE_TESTNET: '1' },
  })

  // Wait for server to be ready
  let ready = false
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fetch(`http://localhost:${serverPort}`)
      ready = true
      break
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  if (!ready) {
    console.log('  Server failed to start. Check for errors.')
    serverProc.kill()
    process.exit(1)
  }

  console.log(`  ✓ Server running on port ${serverPort}`)

  // Show endpoints being tested
  console.log(`\n  Testing ${products.length} endpoint${products.length > 1 ? 's' : ''}:\n`)
  for (const p of products) {
    console.log(`    ${p.name.padEnd(30)} $${p.min.toFixed(2)} – $${p.max.toFixed(2)}`)
  }

  // Open dashboard
  const dashUrl = `http://localhost:${serverPort}/openprice`
  console.log(`\n  Dashboard: ${dashUrl}`)
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    execSync(`${cmd} ${dashUrl}`, { stdio: 'ignore' })
  } catch {}

  // Setup testnet wallet
  const { resolveAccount } = await import('mppx/cli')
  const DEMO_ACCOUNT = '_openprice_test_'
  let account
  try {
    account = await resolveAccount(DEMO_ACCOUNT)
  } catch {
    console.log('\n  Setting up testnet wallet (one-time)...')
    execSync(`npx mppx account create --account ${DEMO_ACCOUNT}`, { stdio: 'pipe' })
    execSync(`npx mppx account fund --account ${DEMO_ACCOUNT}`, { stdio: 'pipe' })
    account = await resolveAccount(DEMO_ACCOUNT)
    console.log('  Wallet funded ✓')
  }

  // Setup client
  const { Mppx: MppxClient, tempo: tempoClient } = await import('mppx/client')

  const AGENT_COUNT = 100
  const REQUESTS_PER_AGENT = 10
  const total = AGENT_COUNT * REQUESTS_PER_AGENT

  // Create agents with uniform willingness across each product's range
  const agents = Array.from({ length: AGENT_COUNT }, (_, i) => {
    const t = i / (AGENT_COUNT - 1)
    const maxPrice = {}
    for (const p of products) {
      maxPrice[p.path] = p.min + t * (p.max - p.min)
    }
    return { id: `agent-${String(i + 1).padStart(3, '0')}`, maxPrice }
  })

  let currentMaxPrice = 0

  const client = MppxClient.create({
    methods: [tempoClient({ account })],
    onChallenge: async (challenge, { createCredential }) => {
      const amount = parseInt(challenge.request.amount)
      const priceInDollars = amount / 1_000_000
      if (priceInDollars > currentMaxPrice) {
        throw new Error(`PRICE_TOO_HIGH`)
      }
      return createCredential()
    },
  })

  // Run the batch
  let paid = 0, skipped = 0
  console.log(`\n  Sending ${total} requests from ${AGENT_COUNT} agents...\n`)
  const startTime = Date.now()

  for (let i = 0; i < total; i++) {
    const agent = agents[Math.floor(Math.random() * agents.length)]
    const product = products[Math.floor(Math.random() * products.length)]

    currentMaxPrice = agent.maxPrice[product.path]

    try {
      const res = await fetch(`http://localhost:${serverPort}${product.path}`, {
        headers: { 'User-Agent': agent.id },
      })
      if (res.ok) paid++
    } catch {
      skipped++
    }

    if ((i + 1) % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`  [${i + 1}/${total}] ${elapsed}s — ${paid} paid, ${skipped} skipped`)
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`
  ✓ Done — ${paid} paid, ${skipped} skipped in ${elapsed}s

  Your demand curves are live at ${dashUrl}
  Review the ★ optimal prices, then deploy to production with confidence.

  Press Ctrl+C to stop the server.
`)
}
