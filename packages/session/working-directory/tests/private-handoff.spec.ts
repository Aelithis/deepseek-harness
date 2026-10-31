import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { expect, it } from 'vitest'
import { logPath } from '../../session-persistence-jsonl/src/format.ts'

// CI transfers only this synthetic log and project file between actual OS jobs.
const phase = process.env.DSH_PRIVATE_HANDOFF_PHASE
const transfer = process.env.DSH_PRIVATE_HANDOFF_DIR
const id = SessionId('session-11111111-1111-4111-8111-111111111111')

it.runIf(phase !== undefined && transfer !== undefined)('continues one persisted session across native device directories', async () => {
  if (!transfer || !['mac-write', 'win-continue', 'mac-return', 'mac-preflight'].includes(phase ?? '')) throw new Error('Invalid handoff phase')
  expect(process.platform).toBe(phase === 'win-continue' ? 'win32' : 'darwin')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-private-handoff-')))
  const home = join(root, '.dsh-private-fixture')
  const project = join(root, '项目', phase!)
  await mkdir(join(project, 'src', phase!), { recursive: true })
  await mkdir(join(home, 'storages'), { recursive: true })
  await mkdir(transfer, { recursive: true })
  const metadata = join(transfer, 'origin.json')
  let origin = project
  let incoming = ''
  if (phase !== 'mac-write') {
    const parsed: { origin?: unknown } = JSON.parse(await readFile(metadata, 'utf8'))
    if (typeof parsed.origin !== 'string') throw new Error('Missing synthetic origin')
    origin = parsed.origin
    incoming = await readFile(join(transfer, 'session.jsonl'), 'utf8')
    await writeFile(join(project, 'src', 'marker.txt'), await readFile(join(transfer, 'marker.txt')))
  } else await writeFile(join(project, 'src', 'marker.txt'), 'mac-write\n')

  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeRuntimeContext: false } })
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(WorkingDirectory)
    await ctx.plugin(JsonlPersistence, { root: join(home, 'sessions'), compression: 'none' })
    const plugin = process.env.DSH_PRIVATE_CHATSYNC_DIR
    if (!plugin) throw new Error('Private ChatSync checkout is required')
    const { SyncEngine } = await import(/* @vite-ignore */ pathToFileURL(join(plugin, 'lib/sync.js')).href)
    const { bindProjectMappings } = await import(/* @vite-ignore */ pathToFileURL(join(plugin, 'lib/project-mappings.js')).href)
    const engine = new SyncEngine(home, { autoRepo: false, enabled: false })
    engine.setHostContext(ctx)
    engine.loadTransferCatalog = async () => sessionFormatCatalog
    await writeFile(join(home, 'storages', 'workspace.json'), JSON.stringify({
      tables: { workspaces: { 'project-fixture': { path: origin, sessionIds: [id] } } },
    }))
    engine.setLocalWorkspacePath('project-fixture', project)
    const mappings = bindProjectMappings(ctx, engine)
    await mappings.refresh()
    if (incoming) {
      const { applySessionTransfer } = await import(/* @vite-ignore */ pathToFileURL(join(plugin, 'lib/session-transfer.js')).href)
      const file = 'sessions/' + logPath('root', origin, id, 'none').slice('root'.length + 1).replaceAll('\\', '/')
      const result = await applySessionTransfer(engine, file, Buffer.from(incoming), null)
      expect(result, JSON.stringify(result)).toHaveProperty('applied', true)
    }
    await mountAgentLoopTestHarness(ctx)
    const handle = phase === 'mac-write'
      ? await ctx.agents.create({ sessionId: id, meta: { cwd: origin } })
      : await ctx.agents.resume({ resumeSessionId: id })
    try {
      const agent = handle.agent
      expect(agent.session.id).toBe(id)
      expect(agent.session.header.cwd).toBe(origin)
      await ctx.workingDirectory.ensure(agent)
      await ctx.workingDirectory.set(agent, join(project, 'src', phase!))
      const cwd = await ctx.workingDirectory.ensure(agent)
      expect(cwd).toBe(join(project, 'src', phase!))
      expect(ctx.workingDirectory.projectRoot(agent.session)).toBe(project)
      const output = execFileSync(process.execPath, ['-e',
        'const fs=require("node:fs");process.stdout.write(fs.readFileSync("../marker.txt","utf8"))'], { cwd, encoding: 'utf8' })
      expect(output).toContain('mac-write')
      if (phase === 'mac-return') expect(output).toContain('win-continue')
      await writeFile(join(cwd, '..', 'marker.txt'), output + phase + '\n')
      await writeFile(join(transfer, 'marker.txt'), await readFile(join(cwd, '..', 'marker.txt')))
    } finally {
      await handle.dispose()
    }
    const stored = await ctx.sessionPersistence.open(id, 'read')
    try {
      expect(stored.header.id).toBe(id)
      expect(stored.header.cwd).toBe(origin)
      const rows = (await stored.read()).events
      expect(rows.every((event, index) => event.seq === index)).toBe(true)
    } finally {
      await stored.close()
    }
    const outgoing = await readFile(logPath(join(home, 'sessions'), origin, id, 'none'), 'utf8')
    expect(outgoing.startsWith(incoming)).toBe(true)
    expect(outgoing.length).toBeGreaterThan(incoming.length)
    for (const line of outgoing.trim().split('\n')) {
      const event: { type?: string; data?: { cwd?: string } } = JSON.parse(line)
      if (event.type === 'working-directory/change') expect(event.data?.cwd?.startsWith(origin)).toBe(true)
    }
    await writeFile(metadata, JSON.stringify({ origin }))
    await writeFile(join(transfer, 'session.jsonl'), outgoing)
    await writeFile(join(transfer, phase + '.json'), JSON.stringify({
      phase, platform: process.platform, arch: process.arch, id, origin, effectiveProject: project,
      historyPrefixPreserved: true, originalHeaderPreserved: true, fileOperation: true,
      chatSyncProductionImport: phase !== 'mac-write',
    }, null, 2))
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
