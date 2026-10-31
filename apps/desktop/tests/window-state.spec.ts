import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { persistWindowSize, readWindowSize } from '../src/window-state.ts'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-window-state-'))
  roots.push(root)
  const path = join(root, 'window-state.json')
  const application = new EventEmitter()
  const window = Object.assign(new EventEmitter(), {
    getNormalBounds: () => ({ x: 100, y: 50, width: 1280, height: 820 }),
  })
  return { root, path, application, window }
}

it('restores resized normal dimensions after exit and a fresh launch', () => {
  const f = setup()
  expect(readWindowSize(f.path)).toEqual({ width: 1280, height: 820 })
  persistWindowSize(f.window, f.application, f.path)
  f.window.getNormalBounds = () => ({ x: 123, y: 456, width: 1500, height: 950 })
  f.window.emit('resize')
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toEqual({ width: 1500, height: 950 })
  f.application.emit('before-quit')
  f.window.emit('close')
  f.window.emit('closed')
  expect(f.application.listenerCount('before-quit')).toBe(0)
  expect(readWindowSize(f.path)).toEqual({ width: 1500, height: 950 })
})

it.each(['close', 'before-quit'])('captures the final normal size on %s without waiting for resize', (event) => {
  const f = setup()
  persistWindowSize(f.window, f.application, f.path)
  f.window.getNormalBounds = () => ({ x: 0, y: 0, width: 1100, height: 700 })
  if (event === 'close') f.window.emit(event)
  else f.application.emit(event)
  expect(readWindowSize(f.path)).toEqual({ width: 1100, height: 700 })
})

it.each(['null', '{}', '{', '{"width":519,"height":820}', '{"width":1280,"height":599}',
  '{"width":1280.5,"height":820}', '{"width":"1280","height":820}', '{"width":-1,"height":820}'])
('uses the initial size for invalid file state %s', (state) => {
  const f = setup()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  writeFileSync(f.path, state)
  expect(readWindowSize(f.path)).toEqual({ width: 1280, height: 820 })
  expect(console.warn).toHaveBeenCalledOnce()
})

it('reports write failures without interrupting close or quit', () => {
  const f = setup()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  persistWindowSize(f.window, f.application, f.root)
  expect(() => f.window.emit('close')).not.toThrow()
  expect(console.error).toHaveBeenCalledWith('desktop window: could not save dimensions', expect.anything())
})
