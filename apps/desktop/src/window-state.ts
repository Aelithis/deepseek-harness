/** Main-window dimensions, kept separately from profiles and application data. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { App, BrowserWindow } from 'electron'

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 820 }
export const MIN_WINDOW_SIZE = { minWidth: 520, minHeight: 600 }

/** Read dimensions at the file boundary; absent or invalid state uses the initial size. */
export function readWindowSize(path: string): { width: number; height: number } {
  try {
    const state: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof state === 'object' && state !== null && 'width' in state && 'height' in state
      && typeof state.width === 'number' && Number.isSafeInteger(state.width) && state.width >= MIN_WINDOW_SIZE.minWidth
      && typeof state.height === 'number' && Number.isSafeInteger(state.height) && state.height >= MIN_WINDOW_SIZE.minHeight) {
      return { width: state.width, height: state.height }
    }
    console.warn('desktop window: invalid saved dimensions', path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      console.warn('desktop window: could not read dimensions', error)
    }
  }
  return { ...DEFAULT_WINDOW_SIZE }
}

/** Save normal dimensions synchronously so close and quit cannot overtake the write. */
export function persistWindowSize(window: Pick<BrowserWindow, 'on' | 'getNormalBounds'>,
  application: Pick<App, 'on' | 'removeListener'>, path: string): void {
  const save = (): void => {
    const { width, height } = window.getNormalBounds()
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ width, height }) + '\n')
    } catch (error) {
      console.error('desktop window: could not save dimensions', error)
    }
  }
  window.on('resize', save)
  window.on('close', save)
  application.on('before-quit', save)
  window.on('closed', () => { application.removeListener('before-quit', save) })
}
