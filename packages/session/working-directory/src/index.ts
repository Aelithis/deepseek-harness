/**
 * Session working directories, durable changes, and model context.
 * @module @deepseek-ai/dsh-working-directory
 */

import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { isSessionAbsolutePath, type Session, type ProjectDirectoryMapping } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workingDirectory: WorkingDirectoryService
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Committed working-directory transition notices.
     * @persistenceAttribution
     */
    'working-directory': { kind: 'working-directory' }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Recorded working directory; local project mappings select its execution directory. */
    'working-directory/change': {
      /** Absolute recorded directory, projected to the local project before execution. */
      cwd: string
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Recorded current directory for Session observations, or null when none is recorded. */
    workingDirectory: string | null
  }

  interface SessionProjectionStateMap {
    /** Last committed working directory, or null before an explicit value exists. */
    workingDirectory: string | null
  }
}

/** Deployment default for Sessions without an original project directory. */
export interface Config {
  /** Absolute execution-world fallback directory; omitted values use the launch directory. */
  defaultDirectory?: string
}

/** One owner for each Session's effective directory and its model-visible changes. */
export class WorkingDirectoryService extends Service {
  static inject = ['sessions', 'fs', 'sessionProjections', 'systemPrompt']

  static Config: z<Config> = z.object({
    defaultDirectory: z.string(),
  })

  /** Absolute deployment fallback for Sessions with no recorded original directory. */
  readonly defaultDirectory: string
  private readonly pending = new WeakMap<Session, Promise<void>>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly lifecycle = new AbortController()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'workingDirectory')
    const directory = config.defaultDirectory ?? process.cwd()
    if (!isAbsolute(directory)) throw new Error('working-directory: defaultDirectory must be absolute')
    this.defaultDirectory = directory

    const directorySchema = zod.string().min(1).refine(isSessionAbsolutePath).nullable()
    ctx.sessionProjections.register({
      key: 'workingDirectory',
      stateVersion: 1,
      stateSchema: directorySchema,
      init: header => header.cwd ?? null,
      apply: (state, event) => event.type === 'working-directory/change' ? event.data.cwd : state,
      wire: { viewSchema: directorySchema, view: state => state === null ? null : this.ctx.sessions.resolveProjectPath(state) },
    })
    ctx.systemPrompt.context({
      name: 'working-directory:current',
      order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
      required: true,
      interpolate: false,
      text: context => context.agent === undefined ? '' : this.contextText(context.agent.session),
    })
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      if (context.agent === undefined) return next()
      await this.ensure(context.agent, context.signal)
      const assembly = await next()
      this.lifecycle.signal.throwIfAborted()
      const text = this.contextText(context.agent.session)
      const contribution = assembly.contexts.find(entry => entry.name === 'working-directory:current')
      if (contribution === undefined) assembly.contexts.unshift({ name: 'working-directory:current', text, interpolate: false })
      else {
        contribution.text = text
        contribution.interpolate = false
      }
      return assembly
    }, { prepend: true })
    ctx.effect(() => async () => {
      this.lifecycle.abort(new Error('working-directory service disposed'))
      await Promise.allSettled(this.operations)
    })
  }

  /**
   * Register the local directory for a synchronized project's known device roots.
   * @param mapping - Original project roots and the selected local directory.
   * @returns the registering fiber's disposer; mappings are never persisted to the Session.
   */
  registerProjectMapping(mapping: ProjectDirectoryMapping): () => Promise<void> {
    return this.ctx.sessions.registerProjectMapping(mapping)
  }

  /**
   * Read the local project root used for permissions and workspace membership.
   * @param session - Session whose immutable project root is requested.
   * @returns the mapped project root or deployment fallback.
   */
  projectRoot(session: Session): string {
    return this.ctx.sessions.resolveProjectPath(session.header.cwd ?? this.defaultDirectory)
  }

  /**
   * Read the committed directory without filesystem I/O.
   * @param session - Session whose directory is requested.
   * @returns its effective absolute directory.
   */
  get(session: Session): string {
    return this.ctx.sessions.resolveProjectPath(this.ctx.sessionProjections.stateOf(session, 'workingDirectory') ?? this.defaultDirectory)
  }

  /**
   * Validate the current directory and restore the original project when it disappeared.
   * @param agent - live or unpublished Agent owning the Session.
   * @param signal - cancellation for filesystem inspection.
   * @returns the existing directory; recovery is committed before fulfillment.
   * A notice failure is warned without reverting the committed state.
   * @throws when the original project is also unavailable.
   */
  ensure(agent: Agent, signal?: AbortSignal): Promise<string> {
    return this.serialize(agent, signal, async (control) => {
      const current = this.get(agent.session)
      if (!isAbsolute(current) || (process.platform === 'win32' && !/^[A-Za-z]:[\\/]|^\\\\/.test(current))) throw new Error(`working-directory: project directory requires a local mapping: ${JSON.stringify(current)}`)
      const target = await this.ctx.fs.resolve(current, { signal: control })
      const info = await this.ctx.fs.stat(target, control)
      control.throwIfAborted()
      agent.ctx.fiber.assertActive()
      if (info?.type === 'directory') {
        if (this.ctx.sessionProjections.stateOf(agent.session, 'workingDirectory') === null) {
          agent.session.append('working-directory/change', { cwd: this.ctx.sessions.resolveRecordedProjectPath(current, agent.session.header.cwd) })
        }
        return current
      }
      const original = this.projectRoot(agent.session)
      const restored = await this.directory(original, original, control)
      this.commit(agent, restored, true, control)
      return restored
    })
  }

  /**
   * Change one Session's directory without changing existing processes or permissions.
   * @param agent - live or unpublished Agent owning the Session.
   * @param path - absolute path or a path relative to its current directory.
   * @param signal - cancellation before the durable change.
   * @returns the canonical absolute directory, committed before fulfillment.
   * A notice failure is warned; the next request still receives the committed directory.
   * @throws when the requested path is not an existing directory.
   */
  set(agent: Agent, path: string, signal?: AbortSignal): Promise<string> {
    return this.serialize(agent, signal, async (control) => {
      if (path.length === 0) throw new Error('working-directory: cd must not be empty')
      const directory = await this.directory(this.ctx.sessions.resolveProjectPath(path), this.get(agent.session), control)
      this.commit(agent, directory, false, control)
      return directory
    })
  }

  private contextText(session: Session): string {
    return `Current working directory: ${JSON.stringify(this.get(session))}.`
  }

  private async directory(path: string, cwd: string, signal: AbortSignal): Promise<string> {
    if (isSessionAbsolutePath(path) && (!isAbsolute(path) || (process.platform === 'win32' && !/^[A-Za-z]:[\\/]|^\\\\/.test(path)))) {
      throw new Error(`working-directory: project directory requires a local mapping: ${JSON.stringify(path)}`)
    }
    const target = await this.ctx.fs.resolve(path, { cwd, signal })
    const info = await this.ctx.fs.stat(target, signal)
    signal.throwIfAborted()
    if (info?.type !== 'directory') {
      throw new Error(`working-directory: directory does not exist: ${JSON.stringify(path)}`)
    }
    return this.ctx.fs.processPath(target)
  }

  private commit(agent: Agent, directory: string, recovered: boolean, signal: AbortSignal): void {
    signal.throwIfAborted()
    agent.ctx.fiber.assertActive()
    const previous = this.get(agent.session)
    if (previous === directory) return
    agent.session.append('working-directory/change', { cwd: this.ctx.sessions.resolveRecordedProjectPath(directory, agent.session.header.cwd) })
    const notice = createUserMessage({
      content: [{
        type: 'text',
        text: recovered
          ? `The working directory ${JSON.stringify(previous)} is unavailable. The working directory is now ${JSON.stringify(directory)}.`
          : `The working directory changed from ${JSON.stringify(previous)} to ${JSON.stringify(directory)}.`,
      }],
      source: { kind: 'working-directory' },
    })
    try {
      agent.inject(notice)
    } catch (error) {
      this.ctx.logger.warn(`working-directory: committed ${JSON.stringify(directory)}, but could not queue its notice: ${String(error)}`)
    }
  }

  private serialize<T>(agent: Agent, signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const session = agent.session
    const control = signal === undefined
      ? this.lifecycle.signal
      : AbortSignal.any([this.lifecycle.signal, signal])
    const operation = (this.pending.get(session) ?? Promise.resolve()).then(() => {
      control.throwIfAborted()
      agent.ctx.fiber.assertActive()
      return action(control)
    })
    const settled = operation.finally(() => this.operations.delete(settled))
    this.operations.add(settled)
    this.pending.set(session, settled.then(() => {}, () => {}))
    return settled
  }
}

export default WorkingDirectoryService
