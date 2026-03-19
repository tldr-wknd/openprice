#!/usr/bin/env node

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { fork } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const command = process.argv[2]

if (command === 'demo') {
  fork(join(root, 'demo.js'), { cwd: root })
} else {
  console.log(`
  Open★Price

  Commands:
    openprice demo    Run the interactive demo

  Usage:
    npx github:tldr-wknd/openprice demo
`)
}
