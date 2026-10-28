/** Constrain Desktop's independent installation to the reviewed repository dependency graph. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'

interface Dependency {
  specifier: string
  version: string
}

interface Importer {
  dependencies?: Record<string, Dependency>
  optionalDependencies?: Record<string, Dependency>
}

interface Lockfile {
  importers?: Record<string, Importer>
  packages?: Record<string, { resolution?: { integrity?: string; tarball?: string } }>
  snapshots?: Record<string, {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }>
}

function loadLock(root: string): Lockfile {
  return yaml.load(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')) as Lockfile
}

function identity(key: string): { name: string; version: string } | undefined {
  const plain = key.split('(')[0]!
  const separator = plain.lastIndexOf('@')
  if (separator <= 0) return undefined
  const version = plain.slice(separator + 1)
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(version)) return undefined
  return { name: plain.slice(0, separator), version }
}

/**
 * Pin dependency edges before pnpm resolves the separately packed runtime.
 * Multiple peer contexts remain distinct; conflicting peer edges are checked against the final lock.
 * @param projectRoot Temporary runtime project containing local core package overrides.
 * @param repositoryRoot Source checkout containing the reviewed root lockfile.
 * @param target Platform of the packaged runtime, used to omit incompatible workspace binaries.
 */
export function constrainRuntimeDependencies(
  projectRoot: string,
  repositoryRoot: string,
  target: { platform: string; arch: string } = { platform: process.platform, arch: process.arch },
): void {
  const root = loadLock(repositoryRoot)
  const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
  const workspace = yaml.load(readFileSync(workspacePath, 'utf8')) as {
    overrides?: Record<string, string>
  }
  const candidates = new Map<string, Set<string>>()
  const excluded: Record<string, string> = {}
  const add = (selector: string, raw: string): void => {
    const version = raw.split('(')[0]!
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(version)) return
    const versions = candidates.get(selector) ?? new Set<string>()
    versions.add(version)
    candidates.set(selector, versions)
  }
  for (const [key, snapshot] of Object.entries(root.snapshots ?? {})) {
    const parent = identity(key)
    if (parent === undefined) continue
    for (const [name, version] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })) {
      add(`${parent.name}@${parent.version}>${name}`, version)
    }
  }
  for (const [path, importer] of Object.entries(root.importers ?? {})) {
    if (path === '.') continue
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, path, 'package.json'), 'utf8')) as {
      name: string
      version: string
    }
    for (const [name, entry] of Object.entries({ ...importer.dependencies, ...importer.optionalDependencies })) {
      add(`${manifest.name}@${manifest.version}>${name}`, entry.version)
    }
    for (const [name, entry] of Object.entries(importer.optionalDependencies ?? {})) {
      if (!entry.version.startsWith('link:')) continue
      const dependency = JSON.parse(readFileSync(resolve(repositoryRoot, path, entry.version.slice(5), 'package.json'), 'utf8')) as {
        os?: string[]
        cpu?: string[]
      }
      if ((dependency.os !== undefined && !dependency.os.includes(target.platform))
        || (dependency.cpu !== undefined && !dependency.cpu.includes(target.arch))) {
        excluded[`${manifest.name}>${name}`] = '-'
      }
    }
  }
  const overrides = { ...workspace.overrides, ...excluded }
  for (const [selector, versions] of candidates) {
    if (versions.size === 1 && overrides[selector] === undefined) overrides[selector] = [...versions][0]!
  }
  writeFileSync(workspacePath, yaml.dump({ ...workspace, overrides }))
}

/**
 * Reject external runtime packages whose bytes are not recorded in the source lockfile.
 * @param projectRoot Runtime project after lockfile resolution and before lifecycle scripts run.
 * @param repositoryRoot Source checkout containing the reviewed root lockfile.
 */
export function verifyRuntimeDependencyLock(projectRoot: string, repositoryRoot: string): void {
  const approved = loadLock(repositoryRoot).packages ?? {}
  const runtime = loadLock(projectRoot).packages ?? {}
  for (const [key, record] of Object.entries(runtime)) {
    if (record.resolution?.tarball?.startsWith('file:') && key.includes('@file:')) continue
    const expected = approved[key]?.resolution?.integrity
    const actual = record.resolution?.integrity
    if (expected === undefined || actual !== expected) {
      throw new Error(`desktop runtime: dependency is outside the repository lockfile: ${key}`)
    }
  }
}
