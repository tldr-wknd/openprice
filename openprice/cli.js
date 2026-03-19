#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cwd = process.cwd()

// --- Helpers ---

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function log(msg = '') { console.log(msg) }
function bold(s) { return `\x1b[1m${s}\x1b[0m` }
function dim(s) { return `\x1b[2m${s}\x1b[0m` }
function green(s) { return `\x1b[32m${s}\x1b[0m` }
function yellow(s) { return `\x1b[33m${s}\x1b[0m` }
function cyan(s) { return `\x1b[36m${s}\x1b[0m` }

// --- Detect server file ---

function findServerFile() {
  // Check package.json for entry points
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const candidates = [
      pkg.main,
      pkg.scripts?.start?.replace(/^node\s+/, ''),
      pkg.scripts?.dev?.replace(/^.*?node\s+/, '').replace(/\s.*$/, ''),
    ].filter(Boolean)

    for (const c of candidates) {
      const full = join(cwd, c)
      if (existsSync(full)) {
        const content = readFileSync(full, 'utf-8')
        if (content.includes('mppx')) return { path: full, relative: c, content }
      }
    }
  }

  // Fallback: scan common patterns
  const patterns = ['server.js', 'server.ts', 'src/server.js', 'src/server.ts', 'src/index.js', 'src/index.ts', 'app.js', 'app.ts', 'index.js', 'index.ts']
  for (const p of patterns) {
    const full = join(cwd, p)
    if (existsSync(full)) {
      const content = readFileSync(full, 'utf-8')
      if (content.includes('mppx')) return { path: full, relative: p, content }
    }
  }

  return null
}

// --- Detect framework ---

function detectFramework(content) {
  if (content.includes('mppx/hono')) return 'Hono'
  if (content.includes('mppx/express')) return 'Express'
  if (content.includes('mppx/nextjs')) return 'Next.js'
  if (content.includes('mppx/elysia')) return 'Elysia'
  if (content.includes('mppx/server')) return 'Generic'
  return 'Unknown'
}

// --- Find paid endpoints ---

function findEndpoints(content) {
  const endpoints = []

  // Match route + charge patterns (mppx.charge or openprice.charge)
  const chargeRegex = /\.(?:get|post|put|delete|all)\s*\(\s*\n?\s*['"`]([^'"`]+)['"`][\s\S]*?(?:mppx|openprice)\.charge\s*\(\s*\{([\s\S]*?)\}\s*\)/g
  let match

  while ((match = chargeRegex.exec(content)) !== null) {
    const path = match[1]
    const opts = match[2]

    const amountMatch = opts.match(/amount\s*:\s*['"`]([^'"`]+)['"`]/)
    const descMatch = opts.match(/description\s*:\s*['"`]([^'"`]+)['"`]/)

    if (amountMatch) {
      endpoints.push({
        path,
        amount: parseFloat(amountMatch[1]),
        description: descMatch ? descMatch[1] : path,
      })
    }
  }

  return endpoints
}

// --- Generate token ---

async function generateToken() {
  // Simple random token for v0.1
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// --- Commands ---

async function init() {
  const autoYes = process.argv.includes('--yes') || process.argv.includes('-y')

  log()
  log(`  ${bold('Open')}${dim('★')}${bold('Price')} ${dim('— Price Discovery for MPP')}`)
  log()

  // Find server file
  const server = findServerFile()
  if (!server) {
    log(`  ${yellow('Could not find an MPP server file.')}`)
    log(`  Make sure you're in a project that uses mppx.`)
    log()
    process.exit(1)
  }

  const framework = detectFramework(server.content)
  log(`  Scanning project...`)
  log(`  Found: ${cyan(server.relative)} ${dim(`(${framework})`)}`)
  log()

  // Find endpoints
  const endpoints = findEndpoints(server.content)
  if (endpoints.length === 0) {
    log(`  ${yellow('No mppx.charge() calls found in')} ${server.relative}`)
    log(`  Add some paid endpoints first, then run this again.`)
    log()
    process.exit(1)
  }

  log(`  Paid endpoints detected:`)
  for (const ep of endpoints) {
    const min = (ep.amount * 0.5).toFixed(2)
    const max = (ep.amount * 1.5).toFixed(2)
    log(`    ${dim('GET')} ${ep.path.padEnd(20)} $${ep.amount.toFixed(2)}  ${dim('→')} range $${min}–$${max}`)
  }
  log()
  log(`  Dashboard: ${cyan('/openprice')} ${dim('(token-protected)')}`)
  log()

  if (!autoYes) {
    log(`  Please choose:`)
    log(`    ${bold('1')} — Apply defaults and start discovering prices now`)
    log(`    ${bold('2')} — Give your agent ${cyan('openprice.skill.md')} for guided setup`)
    log()
    const choice = await ask(`  [1/2]: `)

    if (choice === '2') {
      // Copy skill file
      const skillSrc = join(__dirname, 'skill.md')
      const skillDst = join(cwd, 'openprice.skill.md')
      copyFileSync(skillSrc, skillDst)
      log()
      log(`  ${green('✓')} Created ${cyan('openprice.skill.md')}`)
      log()
      log(`  Give it to your agent:`)
      log(`  ${dim('"Follow openprice.skill.md to set up price discovery for my server"')}`)
      log()
      process.exit(0)
    }

    if (choice !== '1') {
      log(`  Cancelled.`)
      process.exit(0)
    }
  }

  // Option 1: Apply defaults
  log()
  log(`  Applying changes...`)

  // Generate token
  const token = await generateToken()

  // Update .env
  const envPath = join(cwd, '.env')
  let envContent = ''
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8')
    if (envContent.includes('OPENPRICE_TOKEN')) {
      envContent = envContent.replace(/OPENPRICE_TOKEN=.*/, `OPENPRICE_TOKEN=${token}`)
    } else {
      envContent += `\nOPENPRICE_TOKEN=${token}\n`
    }
  } else {
    envContent = `OPENPRICE_TOKEN=${token}\n`
  }
  writeFileSync(envPath, envContent)
  log(`  ${green('✓')} Dashboard token saved to ${cyan('.env')}`)

  // Modify server file
  let modified = server.content

  // Add import if not present
  if (!modified.includes('@bracket/openprice') && !modified.includes('./openprice')) {
    // Find the mppx import and add after it
    const mppxImportMatch = modified.match(/import\s+.*from\s+['"]mppx\/[^'"]+['"].*\n/)
    if (mppxImportMatch) {
      const insertPoint = mppxImportMatch.index + mppxImportMatch[0].length
      modified = modified.slice(0, insertPoint) +
        `import { withOpenPrice } from '@bracket/openprice'\n` +
        modified.slice(insertPoint)
    }
  }

  // Add withOpenPrice initialization if not present
  if (!modified.includes('withOpenPrice(')) {
    // Find the Mppx.create variable declaration and insert after its full statement
    // Strategy: find "const mppx = Mppx.create(" then track parens to find the closing
    const createStart = modified.indexOf('Mppx.create(')
    if (createStart >= 0) {
      let depth = 0
      let i = modified.indexOf('(', createStart)
      for (; i < modified.length; i++) {
        if (modified[i] === '(') depth++
        if (modified[i] === ')') { depth--; if (depth === 0) break }
      }
      // Find end of statement (next newline after closing)
      const nextNewline = modified.indexOf('\n', i)
      const point = nextNewline >= 0 ? nextNewline + 1 : i + 1
      modified = modified.slice(0, point) +
        `\nconst openprice = withOpenPrice(mppx, {\n  token: process.env.OPENPRICE_TOKEN,\n})\n` +
        modified.slice(point)
    }
  }

  // Replace mppx.charge() calls with openprice.charge() + range
  for (const ep of endpoints) {
    const min = (ep.amount * 0.5).toFixed(2)
    const max = (ep.amount * 1.5).toFixed(2)

    // Find and replace the charge call — match any representation of the amount
    // amount could be '0.05', '1.00', '5.00', '1', etc.
    const amountPatterns = [
      ep.amount.toString(),           // '1' or '0.05'
      ep.amount.toFixed(1),           // '1.0' or '0.1'
      ep.amount.toFixed(2),           // '1.00' or '0.05'
    ]
    const escaped = [...new Set(amountPatterns)].map(s => s.replace('.', '\\.')).join('|')
    const chargePattern = new RegExp(
      `mppx\\.charge\\(\\s*\\{\\s*amount:\\s*['"\`](${escaped})['"\`]`,
    )
    modified = modified.replace(chargePattern, (match) => {
      return match
        .replace('mppx.charge', 'openprice.charge')
        + `, range: [${min}, ${max}]`
    })
  }

  // Add dashboard route if not present
  if (!modified.includes('openprice.routes()')) {
    // Add before the last closing bracket or serve() call
    const serveMatch = modified.match(/serve\s*\(/)
    if (serveMatch) {
      modified = modified.slice(0, serveMatch.index) +
        `// OpenPrice dashboard\napp.route('/openprice', openprice.routes())\n\n` +
        modified.slice(serveMatch.index)
    }
  }

  writeFileSync(server.path, modified)
  log(`  ${green('✓')} Updated ${cyan(server.relative)}`)

  // Note: skip npm install in demo — package is local
  log()
  log(`  ${green('Done!')} Restart your server to start discovering prices.`)
  log()
  log(`  Dashboard: ${cyan('http://localhost:3000/openprice')}`)
  log(`  Token:     ${dim(token.slice(0, 16) + '...')}`)
  log(`             ${dim('(full token in .env)')}`)
  log()
}

async function tokenCmd() {
  const token = await generateToken()

  const envPath = join(cwd, '.env')
  let envContent = ''
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8')
    if (envContent.includes('OPENPRICE_TOKEN')) {
      envContent = envContent.replace(/OPENPRICE_TOKEN=.*/, `OPENPRICE_TOKEN=${token}`)
    } else {
      envContent += `\nOPENPRICE_TOKEN=${token}\n`
    }
  } else {
    envContent = `OPENPRICE_TOKEN=${token}\n`
  }
  writeFileSync(envPath, envContent)

  log()
  log(`  ${green('✓')} New dashboard token generated and saved to .env`)
  log(`  Token: ${dim(token.slice(0, 16) + '...')}`)
  log()
}

async function status() {
  log()
  log(`  ${bold('Open')}${dim('★')}${bold('Price')} ${dim('— Status')}`)
  log()

  const server = findServerFile()
  if (!server) {
    log(`  ${yellow('No MPP server found in this directory.')}`)
    log()
    process.exit(1)
  }

  const framework = detectFramework(server.content)
  const hasOpenPrice = server.content.includes('withOpenPrice') || server.content.includes('openprice.charge')
  const endpoints = findEndpoints(server.content)

  log(`  Server: ${cyan(server.relative)} ${dim(`(${framework})`)}`)
  log(`  OpenPrice: ${hasOpenPrice ? green('installed') : yellow('not installed')}`)
  log(`  Endpoints: ${endpoints.length}`)

  for (const ep of endpoints) {
    log(`    ${dim('GET')} ${ep.path.padEnd(20)} $${ep.amount.toFixed(2)}`)
  }

  const envPath = join(cwd, '.env')
  const hasToken = existsSync(envPath) && readFileSync(envPath, 'utf-8').includes('OPENPRICE_TOKEN')
  log(`  Token: ${hasToken ? green('configured') : yellow('not set')}`)
  log()
}

// --- Main ---

const command = process.argv[2]

switch (command) {
  case 'init':
    await init()
    break
  case 'token':
    await tokenCmd()
    break
  case 'status':
    await status()
    break
  default:
    log()
    log(`  ${bold('Open')}${dim('★')}${bold('Price')} ${dim('— Price Discovery for MPP')}`)
    log()
    log(`  Commands:`)
    log(`    ${cyan('init')}     Detect endpoints and set up price discovery`)
    log(`    ${cyan('token')}    Generate a new dashboard token`)
    log(`    ${cyan('status')}   Show current configuration`)
    log()
    log(`  Usage: ${dim('npx openprice <command>')}`)
    log()
}
