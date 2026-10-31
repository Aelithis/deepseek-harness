/** Restore normal dimensions in a second Electron process without a Host or user profile. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { MIN_WINDOW_SIZE, persistWindowSize, readWindowSize } from '../../lib/types/window-state.js'

const root = process.env.DSH_WINDOW_SIZE_TEST_ROOT
const phase = process.env.DSH_WINDOW_SIZE_TEST_PHASE
assert.ok(root)
assert.ok(phase === 'write' || phase === 'read')
app.setPath('userData', root)
const path = join(root, 'window-state.json')
const expected = { width: 1040, height: 720 }

async function main() {
  await app.whenReady()
  const window = new BrowserWindow({ show: false, ...MIN_WINDOW_SIZE, ...readWindowSize(path) })
  persistWindowSize(window, app, path)
  await window.loadURL('data:text/html,<title>Window size qualification</title>')
  if (phase === 'write') {
    const resized = once(window, 'resize')
    window.setSize(expected.width, expected.height)
    await resized
  }
  const { width, height } = window.getNormalBounds()
  assert.deepEqual({ width, height }, expected)
  app.on('will-quit', () => {
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), expected)
    writeFileSync(join(root, `${phase}.json`), JSON.stringify({ phase, width, height }) + '\n')
  })
  app.quit()
}
void main().catch(error => { console.error(error); app.exit(1) })
