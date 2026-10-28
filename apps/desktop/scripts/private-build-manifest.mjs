/** Keep the installer, exact source identity and resolved dependency inventory together. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const build = join(root, 'apps/desktop/.desktop-build')
const target = join(build, 'targets/mac-arm64')
const output = join(build, 'private-distribution')
mkdirSync(output, { recursive: true })
const files = readdirSync(join(target, 'unsigned-artifacts')).filter(name => name.endsWith('.dmg'))
if (files.length !== 1) throw new Error(`Expected one DMG, found ${files.length}`)
const installer = files[0]
copyFileSync(join(target, 'unsigned-artifacts', installer), join(output, installer))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
writeFileSync(join(output, 'SHA256SUMS'), `${sha256(readFileSync(join(output, installer)))}  ${installer}\n`)
for (const [file, name] of [
  ['pnpm-lock.yaml', 'source-pnpm-lock.yaml'],
  ['pnpm-workspace.yaml', 'source-pnpm-workspace.yaml'],
  ['scripts/primary-runtime/lock.json', 'primary-runtime-lock.json'],
  ['apps/desktop/.desktop-build/targets/mac-arm64/runtime-pnpm-lock.yaml', 'runtime-pnpm-lock.yaml'],
  ['apps/desktop/.desktop-build/targets/mac-arm64/package-set/desktop-packages.json', 'desktop-packages.json'],
]) {
  copyFileSync(join(root, file), join(output, name))
}
const packages = []
for (const file of readdirSync(join(target, 'dsh/node_modules'), { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || file.name !== 'package.json') continue
  const manifest = JSON.parse(readFileSync(join(file.parentPath, file.name), 'utf8'))
  if (typeof manifest.name === 'string' && typeof manifest.version === 'string') packages.push({ name: manifest.name, version: manifest.version })
}
packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
writeFileSync(join(output, 'dependencies.json'), `${JSON.stringify(packages, null, 2)}\n`)
const command = (name, args) => execFileSync(name, args, { cwd: root, encoding: 'utf8' }).trim()
if (command('git', ['status', '--porcelain']) !== '') {
  throw new Error('The build changed tracked source files; commit the generated changes before rebuilding')
}
writeFileSync(join(output, 'build.json'), `${JSON.stringify({
  repository: process.env.GITHUB_REPOSITORY,
  commit: command('git', ['rev-parse', 'HEAD']),
  sourceDirty: false,
  workflowRun: process.env.GITHUB_RUN_ID,
  node: process.version,
  pnpm: command('pnpm', ['--version']),
  platform: process.platform,
  architecture: process.arch,
  installer: basename(installer),
}, null, 2)}\n`)
