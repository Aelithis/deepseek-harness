import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  DeepSeekSearchApiProvider,
  DEEPSEEK_WEB_API_BASE_URL,
  mapSearchResponse,
  type DeepSeekSearchApiOptions,
} from '@deepseek-ai/dsh-web-deepseek-api'
import * as webApiPlugin from '@deepseek-ai/dsh-web-deepseek-api'

/** Construct the provider over a fixed options value; production passes a live thunk. */
const searchProvider = (options: DeepSeekSearchApiOptions): DeepSeekSearchApiProvider =>
  new DeepSeekSearchApiProvider(() => options)

const options = {
  apiKey: 'ds-key',
  baseURL: 'https://api.deepseek.test/api/v1/tools',
  count: 10,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** Search API response with present and absent source metadata. */
function searchResponse() {
  return { results: [
    {
      rerank_score: 2.5, title: 'A', url: 'https://a.test', snippet: 'excerpt for A', summary: 'longer summary for A',
      content: '', site_name: 'A News', site_icon: 'https://a.test/favicon.ico', date: '2026-02-02T16:00:00+00:00', authority: 4,
    },
    {
      rerank_score: 1.2, title: 'B', url: 'https://b.test', snippet: '', summary: '',
      content: '', site_name: null, site_icon: null, date: null, authority: -1,
    },
  ] }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('mapSearchResponse', () => {
  it('maps source titles, snippets and nullable dates in provider order', () => {
    expect(mapSearchResponse(searchResponse())).toEqual({ sources: [
      { url: 'https://a.test', title: 'A', snippet: 'excerpt for A', publishedAt: '2026-02-02T16:00:00+00:00' },
      { url: 'https://b.test', title: 'B' },
    ], truncated: false })
  })
  it('accepts an empty search', () => {
    expect(mapSearchResponse({ results: [] })).toEqual({ sources: [], truncated: false })
  })
  it('omits empty optional source text', () => {
    expect(mapSearchResponse({ results: [{ url: 'https://a.test', title: '', snippet: '', date: '' }] }).sources)
      .toEqual([{ url: 'https://a.test' }])
  })
  it.each([null, {}, { results: {} }, { results: [null] }, { results: [{ url: '' }] },
    { results: [{ url: 'https://a.test', title: 1, snippet: '', date: null }] },
    { results: [{ url: 'https://a.test', title: '', snippet: 1, date: null }] },
    { results: [{ url: 'https://a.test', title: '', snippet: '', date: 1 }] },
  ])('rejects malformed remote JSON %j', (body) => {
    expect(() => mapSearchResponse(body)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('DeepSeekSearchApiProvider availability', () => {
  it('is unavailable without a key', async () => {
    expect(await searchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', async () => {
    expect(await searchProvider(options).available()).toBe(true)
  })

  it('is unavailable when a resolver returns no credential', async () => {
    expect(await searchProvider({ ...options, apiKey: '', resolveApiKey: async () => undefined }).available()).toBe(false)
  })

  it('is misconfigured when the base URL is unparseable', async () => {
    expect(await searchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it.each([0, 1.5])('is unavailable with invalid count %j', async (count) => {
    expect(await searchProvider({ ...options, count }).available()).toBe(false)
  })
})

describe('DeepSeekSearchApiProvider request mapping', () => {
  it.each([
    [undefined, { query: 'hello', count: 10, need_content: false }],
    [5, { query: 'hello', count: 5, need_content: false }],
    [80, { query: 'hello', count: 10, need_content: false }],
  ])('posts a direct search with result bound %j', async (maxResults, expected) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await searchProvider(options).search({ query: 'hello', ...maxResults === undefined ? {} : { maxResults } })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.test/api/v1/tools/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init?.headers).toMatchObject({ authorization: 'Bearer ds-key', 'content-type': 'application/json' })
    expect(Object.keys(init?.headers ?? {}).sort()).toEqual(['accept', 'authorization', 'content-type', 'user-agent'])
    if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
    expect(JSON.parse(init.body)).toEqual(expected)
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await searchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.signal).toBe(controller.signal)
  })
})

describe('Search API session privacy', () => {
  it('does not send the user prompt from the initiating session', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(WebRuntime, { searchProvider: 'deepseek-search-api' })
      await ctx.plugin(webApiPlugin, { apiKey: 'ds-key' })
      const session = ctx.sessions.create(SessionId('search-privacy'))
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Sensitive original prompt: private account number 12345' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      const agent = { session } as Agent
      await ctx.agents.withInitiator(agent, () => ctx.web.search({ query: 'DeepSeek V4' }))
      const body = fetchMock.mock.calls[0]?.[1]?.body
      if (typeof body !== 'string') throw new Error('expected JSON request body')
      expect(JSON.parse(body)).toEqual({ query: 'DeepSeek V4', count: 10, need_content: false })
      expect(body).not.toContain('Sensitive original prompt')
    } finally { await ctx.fiber.dispose() }
  })
})

describe('Search API configuration and failures', () => {
  it('uses the official Search API base by default', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: 'deepseek-search-api' })
      await ctx.plugin(webApiPlugin, { apiKey: 'ds-key' })
      await ctx.web.search({ query: 'q' })
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${DEEPSEEK_WEB_API_BASE_URL}/search`)
      expect(DEEPSEEK_WEB_API_BASE_URL).toBe('https://api.deepseek.com/v1/tools')
    } finally { await ctx.fiber.dispose() }
  })

  it('reports an unparseable API base as an unavailable provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: 'deepseek-search-api' })
      await ctx.plugin(webApiPlugin, { apiKey: 'ds-key', baseURL: '' })
      await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('retains the HTTP status when the error body is not an object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, { status: 502 })))
    await expect(searchProvider(options).search({ query: 'DeepSeek' })).rejects.toThrow('HTTP 502')
  })

  it('names the Search API base in endpoint guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'not found' } }, { status: 404 })))
    await expect(searchProvider(options).search({ query: 'DeepSeek' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'DeepSeek API error (HTTP 404): not found\n\n'
        + 'The web request used endpoint "https://api.deepseek.test/api/v1/tools/search". '
        + 'Search endpoint configuration is separate from chat. If that endpoint is not intended, '
        + 'guide the user to Plugins > Built-in plugin settings > Web search, where they can '
        + 'change and save Search / Fetch API base URL. If that settings page is unavailable, the user can set '
        + 'web-deepseek-api.baseURL to a trusted DeepSeek endpoint. Only the user should choose or change the endpoint.',
    })
  })
})
