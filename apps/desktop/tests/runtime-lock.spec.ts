import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { constrainRuntimeDependencies, verifyRuntimeDependencyLock } from '../scripts/runtime-lock.ts'

const temporary: string[] = []
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(): { source: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  temporary.push(root)
  const source = join(root, 'source')
  const project = join(root, 'project')
  mkdirSync(join(source, 'packages/provider'), { recursive: true })
  mkdirSync(project)
  writeFileSync(join(source, 'packages/provider/package.json'), JSON.stringify({ name: '@test/provider', version: '1.0.0' }))
  writeFileSync(join(source, 'pnpm-lock.yaml'), yaml.dump({
    importers: { 'packages/provider': { dependencies: { parser: { specifier: '^2', version: '2.4.0' } } } },
    packages: {
      'parser@2.4.0': { resolution: { integrity: 'sha512-parser' } },
      'parser@1.9.0': { resolution: { integrity: 'sha512-old-parser' } },
      'consumer@1.0.0': { resolution: { integrity: 'sha512-consumer' } },
    },
    snapshots: {
      'consumer@1.0.0': { dependencies: { parser: '1.9.0' } },
      'consumer@2.0.0(peer@1.0.0)': { dependencies: { peer: '1.0.0' } },
      'consumer@2.0.0(peer@2.0.0)': { dependencies: { peer: '2.0.0' } },
    },
  }))
  writeFileSync(join(project, 'pnpm-workspace.yaml'), yaml.dump({ overrides: { '@test/provider': 'file:./local.tgz' } }))
  return { source, project }
}

it('pins each parent edge independently without collapsing peer contexts', () => {
  const { source, project } = fixture()
  constrainRuntimeDependencies(project, source)
  const result = yaml.load(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8')) as { overrides: Record<string, string> }
  expect(result.overrides).toEqual({
    '@test/provider': 'file:./local.tgz',
    '@test/provider@1.0.0>parser': '2.4.0',
    'consumer@1.0.0>parser': '1.9.0',
  })
})

it('accepts reviewed external bytes and separately verified local package archives', () => {
  const { source, project } = fixture()
  writeFileSync(join(project, 'pnpm-lock.yaml'), yaml.dump({ packages: {
    'parser@2.4.0': { resolution: { integrity: 'sha512-parser' } },
    '@test/provider@file:local.tgz': { resolution: { integrity: 'sha512-local', tarball: 'file:local.tgz' } },
  } }))
  expect(() => verifyRuntimeDependencyLock(project, source)).not.toThrow()
})

it.each([
  ['parser@2.4.0', 'sha512-changed'],
  ['parser@2.5.0', 'sha512-new-version'],
  ['unreviewed@1.0.0', 'sha512-new-package'],
])('rejects unreviewed dependency %s before runtime installation', (key, integrity) => {
  const { source, project } = fixture()
  writeFileSync(join(project, 'pnpm-lock.yaml'), yaml.dump({ packages: { [key]: { resolution: { integrity } } } }))
  expect(() => verifyRuntimeDependencyLock(project, source)).toThrow('outside the repository lockfile')
})
