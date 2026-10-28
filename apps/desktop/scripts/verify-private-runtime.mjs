/** Check the packaged production files for retired upload modules and request fields. */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const retiredPackages = new Set([
  'anonymous-user-id', 'session-log-deepseek', 'plugin-package-inventory-deepseek',
  'session-telemetry', 'session-telemetry-otel', 'otel', 'client-product-analytics',
  'host-product-telemetry-otel', 'deepseek-account', 'deepseek-account-platform', 'llm-deepseek-account',
  'api-account-controller', 'client-ui-settings-account', 'client-ui-settings-session-log',
].map(name => `@deepseek-ai/dsh-${name}`))
retiredPackages.add('electron-updater')
const retiredRequests = [
  'dsh-otel-collector.deepseeksvc.com', 'harness-telemetry.deepseeksvc.com',
  'x-deepseek-harness-user-id', 'x-deepseek-harness-session-id',
  'x-deepseek-harness-compact', 'dsh_session_log', 'dsh_plugin_packages', 'ori_question',
  'auth_exchange', '/api/v0/check_client_update',
]

/**
 * Reject retired production modules or upload request code in a prepared runtime tree.
 * Historical local session event names and ordinary model/search requests are retained.
 * @param {string} root Directory containing production files.
 * @returns {number} Number of checked manifests and JavaScript files.
 */
export function verifyPrivateRuntime(root) {
  let checked = 0
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (entry.name === 'package.json') {
      checked++
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      if (retiredPackages.has(manifest.name)) throw new Error(`Retired production package: ${manifest.name}`)
      for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const name of Object.keys(manifest[section] ?? {})) {
          if (retiredPackages.has(name)) throw new Error(`Retired dependency ${name}: ${path}`)
        }
      }
    } else if (/\.(?:c?js|mjs)$/u.test(entry.name)) {
      checked++
      const source = readFileSync(path, 'utf8')
      for (const request of retiredRequests) {
        if (source.includes(request)) throw new Error(`Retired upload request ${request}: ${path}`)
      }
    }
  }
  if (checked === 0) throw new Error(`No production files found: ${root}`)
  return checked
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const roots = process.argv.slice(2)
  if (roots.length === 0) throw new Error('Supply at least one production directory')
  for (const root of roots) console.log(`Checked ${verifyPrivateRuntime(root)} production files in ${root}`)
}
