#!/usr/bin/env node

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { fork } from 'child_process'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'fs'
import { createInterface } from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const command = process.argv[2]

if (command === 'demo') {
  fork(join(root, 'demo.js'), { cwd: root })
} else if (command === 'init') {
  await runInit()
} else {
  console.log(`
  Open★Price

  Commands:
    openprice demo    Run the interactive demo
    openprice init    Add OpenPrice to your MPP server

  Usage:
    npx github:tldr-wknd/openprice demo
    npx github:tldr-wknd/openprice init
`)
}

// ── Init command ────────────────────────────────────────────────

async function runInit() {
  const cwd = process.cwd()

  console.log(`
  Open★Price — Setup
  ──────────────────

  Scanning for MPP endpoints...
`)

  // Find all .js and .ts files (skip node_modules, .git, dist)
  const files = findFiles(cwd, ['.js', '.ts', '.mjs', '.mts'])
  if (files.length === 0) {
    console.log('  No JavaScript/TypeScript files found in this directory.')
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
    console.log('  No mppx.charge() calls found. Is this an MPP server?')
    console.log('  Make sure you\'re running this from your server\'s root directory.')
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
  console.log(`  What would you like to do?

  1 — Try OpenPrice's dynamic pricing with the above default ranges
  2 — Give your agent the skill file to guide you through setup
`)

  const answer = await ask('  Enter 1 or 2: ')

  if (answer === '1') {
    await autoInstall(cwd, endpoints)
  } else if (answer === '2') {
    showSkillFileInstructions()
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

function showSkillFileInstructions() {
  const skillSrc = join(root, 'openprice', 'skill.md')

  if (existsSync(skillSrc)) {
    const dest = join(process.cwd(), 'openprice.skill.md')
    copyFileSync(skillSrc, dest)
    console.log(`
  ✓ Copied openprice.skill.md to your project root.

  Give this file to your coding agent (Claude Code, Cursor, etc.):

    "Follow the instructions in openprice.skill.md to add OpenPrice
     to this project."

  The skill file will guide the agent through the full setup.
`)
  } else {
    console.log(`
  Give your agent this URL:

    https://github.com/tldr-wknd/openprice/blob/main/openprice/skill.md

  Tell it:

    "Follow the instructions in that skill file to add OpenPrice
     to this project."
`)
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function findFiles(dir, extensions, results = []) {
  const skip = ['node_modules', '.git', 'dist', 'build', '.next']
  try {
    for (const entry of readdirSync(dir)) {
      if (skip.includes(entry)) continue
      const full = join(dir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) {
          findFiles(full, extensions, results)
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
    // Match mppx.charge({ amount: '...' }) patterns
    const chargeMatch = line.match(/mppx\.charge\(\s*\{/)
    if (!chargeMatch) continue

    // Gather the full charge block (may span multiple lines)
    let block = ''
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      block += lines[j] + '\n'
      if (lines[j].includes(')')) break
    }

    // Extract amount
    const amountMatch = block.match(/amount:\s*['"]([^'"]+)['"]/)
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
