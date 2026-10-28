/** Model discovery requires the API-key route's own credential. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import * as ApiKey from '../src/index.ts'

it.each([undefined, ''])('hides models without an API key: %j', async (key) => {
  vi.stubEnv('DEEPSEEK_API_KEY', key)
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, { enabled: true })
    expect(await ctx.llm.listModels('deepseek-official')).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('advertises configured models with an API key', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-api-key')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, { enabled: true, models: [{ id: 'configured-model' }] })
    expect(await ctx.llm.listModels('deepseek-official')).toEqual([
      expect.objectContaining({ provider: 'deepseek-official', id: 'configured-model' }),
    ])
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('reports malformed credentials during discovery', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'invalid\nheader')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, { enabled: true })
    await expect(ctx.llm.listModels('deepseek-official')).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('keeps the official provider dormant until added and permits removal and re-addition', async () => {
  const { liveConfig } = await import('../../../settings/settings/tests/live-config.ts')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    const live = await liveConfig(ctx, ApiKey, {})
    expect(ctx.llm.listProviders()).toEqual([])
    await live.update({ enabled: true })
    expect(ctx.llm.listProviders()).toContainEqual(expect.objectContaining({ id: 'deepseek-official' }))
    await live.replace({ enabled: false })
    expect(ctx.llm.listProviders()).toEqual([])
    await live.update({ enabled: true })
    expect(ctx.llm.listProviders()).toContainEqual(expect.objectContaining({ id: 'deepseek-official' }))
  } finally {
    await ctx.fiber.dispose()
  }
})
