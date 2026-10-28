import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { writePrivateBuildManifest } from '../scripts/private-build-manifest.mjs'

for (const [target, extension] of [['mac-arm64', '.dmg'], ['win-x64', '.exe']]) {
  test(`records the ${target} installer, locks and production dependencies`, t => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-private-manifest-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const write = (path, content) => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    const build = `apps/desktop/.desktop-build/targets/${target}`
    const installer = `dsh-private-test${extension}`
    write(`${build}/unsigned-artifacts/${installer}`, 'installer fixture')
    write(`${build}/runtime-pnpm-lock.yaml`, 'runtime lock')
    write(`${build}/package-set/desktop-packages.json`, '{}')
    write(`${build}/dsh/node_modules/@fixture/runtime/package.json`, JSON.stringify({ name: '@fixture/runtime', version: '1.0.0' }))
    write('pnpm-lock.yaml', 'source lock')
    write('pnpm-workspace.yaml', 'packages: []')
    write('scripts/primary-runtime/lock.json', '{}')
    write('.gitignore', 'apps/desktop/.desktop-build/\n')
    const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git(['init'])
    git(['add', '.'])
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'])
    writePrivateBuildManifest(root, target)
    const output = join(root, 'apps/desktop/.desktop-build/private-distribution')
    const record = JSON.parse(readFileSync(join(output, 'build.json'), 'utf8'))
    assert.equal(record.target, target)
    assert.equal(record.installer, installer)
    assert.equal(record.sourceDirty, false)
    assert.equal(record.commit, git(['rev-parse', 'HEAD']).toString().trim())
    assert.equal(readFileSync(join(output, 'runtime-pnpm-lock.yaml'), 'utf8'), 'runtime lock')
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'dependencies.json'), 'utf8')), [{ name: '@fixture/runtime', version: '1.0.0' }])
    const digest = createHash('sha256').update('installer fixture').digest('hex')
    assert.equal(readFileSync(join(output, 'SHA256SUMS'), 'utf8'), `${digest}  ${installer}\n`)
    write('pnpm-lock.yaml', 'dirty source')
    assert.throws(() => writePrivateBuildManifest(root, target), /build changed tracked source files/u)
  })
}

test('rejects an unsupported private target before reading artifacts', () => {
  assert.throws(() => writePrivateBuildManifest('/unused', 'linux-x64'), /Unsupported private distribution target/u)
})
