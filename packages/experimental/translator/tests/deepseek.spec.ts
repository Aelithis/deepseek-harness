/** Paid selection, independent native requests, audit-before-I/O and cancellation. */
import { ReasoningEffortId, type PreparedLlmCall } from '@deepseek-ai/dsh-llm'
import { Config as OfficialConfig } from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import { TimeoutReason } from '@deepseek-ai/dsh-timeout'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paidFixture, replyEvents, sse } from './paid-fixture.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('native Flash translation', () => {

  it('revalidates model configuration after asynchronous discovery and before preparing a native call', async () => {
    const b = await paidFixture(cleanups)
    const before = Promise.withResolvers<undefined>(), continueLookup = Promise.withResolvers<undefined>()
    const original = b.ctx.llm.listModels.bind(b.ctx.llm)
    const lookup = vi.spyOn(b.ctx.llm, 'listModels').mockImplementationOnce(async (provider) => {
      const models = await original(provider)
      before.resolve(undefined)
      await continueLookup.promise
      const owner = [...b.ctx.loader.entries()].find(entry => entry.options.id === 'official-custom-id')!
      const config = owner.fiber!.config as ReturnType<typeof OfficialConfig>
      config.models = OfficialConfig({ models: [{ id: 'deepseek-v4-flash', name: 'Flash' }] }).models
      return models
    })
    const pending = b.translate('deepseek-official')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' })
    await before.promise
    continueLookup.resolve(undefined)
    await rejected
    lookup.mockRestore()
    expect(b.requests).toEqual([])
    expect(b.session?.snapshotEvents()).toEqual([])
  })

  it('rechecks the owner across the eligibility return microtask before preparation', async () => {
    const b = await paidFixture(cleanups), directory = b.ctx.llm.listConfigurableProviders()
    const owner = [...b.ctx.loader.entries()].find(entry => entry.options.id === 'official-custom-id')!
    let reads = 0
    vi.spyOn(b.ctx.llm, 'listConfigurableProviders').mockImplementation(() => {
      reads += 1
      if (reads === 2) queueMicrotask(() => {
        const config = owner.fiber!.config as ReturnType<typeof OfficialConfig>
        config.models = OfficialConfig({ models: [{ id: 'deepseek-v4-flash' }] }).models
      })
      return directory
    })
    await expect(b.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' })
    expect(b.requests).toEqual([])
    expect(b.session?.snapshotEvents()).toEqual([])
  })

  it('rejects a prepared call that cannot guarantee thinking off before auditing or network I/O', async () => {
    const b = await paidFixture(cleanups)
    const prepared = await b.ctx.llm.prepareCall({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: ReasoningEffortId('off') })
    vi.spyOn(b.ctx.llm, 'prepareCall').mockResolvedValueOnce({ ...prepared,
      config: { ...prepared.config, reasoningEffort: ReasoningEffortId('high') } })
    await expect(b.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' })
    expect(b.requests).toEqual([])
    expect(b.session?.snapshotEvents()).toEqual([])
  })

  it.each(['max_tokens', 'tool_use'])('rejects non-stop native finish %s while preserving the audited request', async (stop) => {
    const b = await paidFixture(cleanups, { reply: (response) => { response.end(sse(replyEvents('partial private output', stop))) } })
    await expect(b.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' })
    expect(b.session?.snapshotEvents()).toHaveLength(1)
  })

  it('classifies native HTTP errors as request failures without forwarding response contents', async () => {
    const b = await paidFixture(cleanups, { responseStatus: 503,
      reply: (response) => { response.end(JSON.stringify({ error: { type: 'api_error', message: 'private backend diagnostic' } })) } })
    await expect(b.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_REQUEST_FAILED',
      message: 'Native Flash translation request failed' })
    expect(b.requests).toHaveLength(1)
    expect(b.session?.snapshotEvents()).toHaveLength(1)
  })

  it.each(['withdrawn', 'catalog', 'credential'])('rejects a native route %s during async preparation before audit or dispatch', async (change) => {
    const b = await paidFixture(cleanups), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const original = b.ctx.llm.prepareCall.bind(b.ctx.llm)
    vi.spyOn(b.ctx.llm, 'prepareCall').mockImplementationOnce(async (config, signal) => {
      const call = await original(config, signal)
      entered.resolve(undefined); await release.promise; return call
    })
    const pending = b.translate('deepseek-official')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' })
    await entered.promise
    const owner = [...b.ctx.loader.entries()].find(entry => entry.options.id === 'official-custom-id')!
    if (change === 'withdrawn') {
      await owner.fiber!.dispose()
      await rejected
    } else if (change === 'catalog') {
      const config = owner.fiber!.config as ReturnType<typeof OfficialConfig>
      config.models = OfficialConfig({ models: [{ id: 'deepseek-v4-flash' }] }).models
    } else b.setConfigured(false)
    release.resolve(undefined)
    await rejected
    expect(b.requests).toEqual([])
    expect(b.session?.snapshotEvents()).toEqual([])
  })

  it.each(['withdrawn', 'catalog', 'credential'])('rejects a native route %s by an audit observer before dispatch', async (change) => {
    const b = await paidFixture(cleanups)
    const owner = [...b.ctx.loader.entries()].find(entry => entry.options.id === 'official-custom-id')!
    let withdrawal: Promise<void> | undefined
    b.ctx.on('session/event', (_session, event) => {
      if (pluginRecordOf(event)?.type !== 'plugin:translator/request') return
      if (change === 'withdrawn') withdrawal = owner.fiber!.dispose()
      else if (change === 'catalog') {
        const config = owner.fiber!.config as ReturnType<typeof OfficialConfig>
        config.models = OfficialConfig({ models: [{ id: 'deepseek-v4-flash' }] }).models
      } else b.setConfigured(false)
    }, { global: true })
    await expect(b.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' })
    await withdrawal
    expect(b.requests).toEqual([])
    expect(b.session?.snapshotEvents()).toHaveLength(1)
  })

  it('rejects empty text and enforces the complete multibyte output limit', async () => {
    const empty = await paidFixture(cleanups, { reply: (response) => { response.end(sse(replyEvents('   '))) } })
    await expect(empty.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' })
    const exact = await paidFixture(cleanups, { translator: { maxResponseBytes: 3 },
      reply: (response) => { response.end(sse(replyEvents('中'))) } })
    expect(await exact.translate('deepseek-official')).toBe('中')
    const short = await paidFixture(cleanups, { translator: { maxResponseBytes: 2 },
      reply: (response) => { response.end(sse(replyEvents('中'))) } })
    await expect(short.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_RESPONSE_LIMIT' })
  })

  it.each(['block-start', 'block-end', 'reasoning-delta', 'tool-call-delta', 'missing-finish'])('rejects unwanted model output %s', async (kind) => {
    const b = await paidFixture(cleanups)
    const prepared = await b.ctx.llm.prepareCall({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: ReasoningEffortId('off') })
    const replacement: PreparedLlmCall = { ...prepared, async *stream() {
      if (kind === 'block-start') yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      else if (kind === 'block-end') yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private output' } }
      else if (kind === 'reasoning-delta') yield { type: 'reasoning-delta', index: 0, text: 'private output' }
      else if (kind === 'tool-call-delta') yield { type: 'tool-call-delta', index: 0, id: 'unused' as never, argumentsDelta: '{}' }
      else yield { type: 'text-delta', index: 0, text: 'unsettled' }
    } }
    vi.spyOn(b.ctx.llm, 'prepareCall').mockResolvedValueOnce(replacement)
    await expect(b.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' })
    expect(b.requests).toEqual([])
    expect(b.session?.snapshotEvents()).toHaveLength(1)
  })

  it('sanitizes native model errors and does not select another route', async () => {
    const b = await paidFixture(cleanups)
    vi.spyOn(b.ctx.llm, 'prepareCall').mockRejectedValueOnce(new Error('private credentials or original prompt'))
    await expect(b.translate('deepseek-official')).rejects.toMatchObject({ code: 'TRANSLATION_REQUEST_FAILED', message: 'Native Flash translation request failed' })
    expect(b.requests).toEqual([])
    const discovery = vi.spyOn(b.ctx.llm, 'listModels').mockRejectedValueOnce(new Error('private catalog error'))
    expect(await b.ctx.translator.availableProviders()).toEqual(['bing', 'google', 'deepseek-official'])
    discovery.mockRestore()
  })

  it('covers availability cancellation and quiescent disposal during a pending catalog lookup', async () => {
    const b = await paidFixture(cleanups)
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const original = b.ctx.llm.listModels.bind(b.ctx.llm)
    vi.spyOn(b.ctx.llm, 'listModels').mockImplementationOnce(async (provider) => {
      entered.resolve(undefined); await release.promise; return original(provider)
    })
    const pending = b.ctx.translator.availableProviders()
    const rejected = expect(pending).rejects.toThrow('Translator service disposed')
    await entered.promise
    const fiber = [...b.ctx.loader.entries()].find(entry => entry.options.id === 'translator')!.fiber!
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await rejected
    expect(disposed).toBe(false)
    release.resolve(undefined)
    await disposal
  })

  it.each(['owned', 'caller'] as const)('classifies %s discovery deadlines without leaking native details', async (kind) => {
    const b = await paidFixture(cleanups, { translator: { deepseekTimeoutMs: 40 } })
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    vi.spyOn(b.ctx.llm, 'listModels').mockImplementationOnce(async () => { entered.resolve(undefined); await release.promise; return [] })
    const caller = new AbortController(), reason = new TimeoutReason('TRANSLATION_TIMEOUT', 1)
    vi.useFakeTimers()
    try {
      const outcome = b.ctx.translator.availableProviders(caller.signal).catch((error: unknown) => error)
      await entered.promise
      if (kind === 'owned') await vi.advanceTimersByTimeAsync(40)
      else caller.abort(reason)
      const result = await outcome
      if (kind === 'owned') expect(result).toEqual(['bing', 'google'])
      else expect(result).toBe(reason)
    } finally { release.resolve(undefined); vi.useRealTimers() }
  })

  it('cancels during native-owner inspection before starting any metadata work', async () => {
    const b = await paidFixture(cleanups), caller = new AbortController(), reason = new Error('metadata cancelled')
    const directory = b.ctx.llm.listConfigurableProviders()
    vi.spyOn(b.ctx.llm, 'listConfigurableProviders').mockImplementationOnce(() => { caller.abort(reason); return directory })
    const lookup = vi.spyOn(b.ctx.llm, 'listModels')
    await expect(b.ctx.translator.availableProviders(caller.signal)).rejects.toBe(reason)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('cancels a held credential lookup promptly while service disposal still joins it', async () => {
    const b = await paidFixture(cleanups), caller = new AbortController(), reason = new Error('credentials observation cancelled')
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    vi.spyOn(b.ctx.get('credentials')!, 'describe').mockImplementationOnce(async () => {
      entered.resolve(undefined); await release.promise; return { configured: true, writable: true }
    })
    const pending = b.ctx.translator.availableProviders(caller.signal)
    const rejected = expect(pending).rejects.toBe(reason)
    await entered.promise
    caller.abort(reason)
    await rejected
    const fiber = [...b.ctx.loader.entries()].find(entry => entry.options.id === 'translator')!.fiber!
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release.resolve(undefined)
    await disposal
    expect(b.requests).toEqual([])
  })
})
