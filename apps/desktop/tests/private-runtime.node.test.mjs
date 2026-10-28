import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyPrivateRuntime } from '../scripts/verify-private-runtime.mjs'

test('accepts model/search traffic and historical local receipt event names', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-private-runtime-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session' }))
  writeFileSync(join(root, 'index.js'), "const historical = 'session-log-deepseek/delivery-accepted'; fetch('https://api.deepseek.com/v1/tools/search');")
  assert.equal(verifyPrivateRuntime(root), 2)
})

test('fails if an upload module or hidden request is reintroduced', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-private-runtime-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session-telemetry-otel' }))
  assert.throws(() => verifyPrivateRuntime(root), /Retired production package/u)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@test/runtime' }))
  writeFileSync(join(root, 'index.js'), "fetch('https://dsh-otel-collector.deepseeksvc.com/v1/logs')")
  assert.throws(() => verifyPrivateRuntime(root), /Retired upload request/u)
  writeFileSync(join(root, 'index.js'), "request.headers['x-deepseek-harness-user-id'] = id")
  assert.throws(() => verifyPrivateRuntime(root), /Retired upload request/u)
})
