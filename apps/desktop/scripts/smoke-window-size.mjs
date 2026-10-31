/** Run actual Electron resize, exit and restoration in isolated processes on the build host. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'

const target = resolveDesktopBuildTarget()
const paths = desktopTargetBuildPaths(target)
const output = join(fileURLToPath(new URL('../.desktop-build/private-distribution/', import.meta.url)), 'window-size-smoke')
await mkdir(output, { recursive: true })
const root = await mkdtemp(join(output, 'profile-'))
const executable = join(paths.electron, process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron.exe')
const fixture = fileURLToPath(new URL('../tests/fixtures/window-size.mjs', import.meta.url))
const environment = { ...process.env, DSH_WINDOW_SIZE_TEST_ROOT: root }
delete environment.ELECTRON_RUN_AS_NODE
const phases = []
for (const phase of ['write', 'read']) {
  const result = await promisify(execFile)(executable, [fixture], {
    env: { ...environment, DSH_WINDOW_SIZE_TEST_PHASE: phase }, timeout: 30_000,
  })
  await writeFile(join(output, `${phase}.log`), result.stdout + result.stderr)
  phases.push(JSON.parse(await readFile(join(root, `${phase}.json`), 'utf8')))
}
await writeFile(join(output, 'acceptance.json'), JSON.stringify({ target, separateProcesses: true, phases }, null, 2) + '\n')
console.log(`Window size qualification passed: ${output}`)
