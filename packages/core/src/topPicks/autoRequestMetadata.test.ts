import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TitleMetadataCache,
  createMetadataGetter,
  fetchTitleMetadata,
  parseMovieMetadata,
  parseTvMetadata,
  type RawLookup,
} from './autoRequestMetadata.js'

test('movie response: genre ids, production countries and keywords (keywords.keywords)', () => {
  const m = parseMovieMetadata({
    genres: [{ id: 16 }, { id: 35 }],
    production_countries: [{ iso_3166_1: 'jp' }, { iso_3166_1: 'US' }],
    keywords: { keywords: [{ id: 210024, name: 'anime' }] },
  })
  assert.deepEqual(m, { status: 'ok', genreIds: [16, 35], countries: ['JP', 'US'], keywords: [{ id: 210024, name: 'anime' }] })
})

test('tv response: origin_country and keywords.results; falls back to production countries', () => {
  const t = parseTvMetadata({ genres: [{ id: 10764 }], origin_country: ['gb'], keywords: { results: [{ id: 5, name: 'x' }] } })
  assert.deepEqual(t, { status: 'ok', genreIds: [10764], countries: ['GB'], keywords: [{ id: 5, name: 'x' }] })
  const fb = parseTvMetadata({ production_countries: [{ iso_3166_1: 'FR' }] })
  assert.deepEqual(fb.countries, ['FR'])
})

test('absent sections stay undefined (missing), empty lists stay empty (valid)', () => {
  const absent = parseMovieMetadata({})
  assert.equal(absent.countries, undefined)
  assert.equal(absent.keywords, undefined)
  assert.equal(absent.genreIds, undefined)
  const empty = parseMovieMetadata({ genres: [], production_countries: [], keywords: { keywords: [] } })
  assert.deepEqual(empty.keywords, [])
  assert.deepEqual(empty.countries, [])
})

test('lookup outcomes map to ok / not-found / error and the endpoint is a single call', async () => {
  const seen: string[] = []
  const mk = (r: Awaited<ReturnType<RawLookup>>): RawLookup => async (e) => { seen.push(e); return r }
  assert.equal((await fetchTitleMetadata('movie', 7, mk({ outcome: 'ok', data: {} }))).status, 'ok')
  assert.deepEqual(await fetchTitleMetadata('tv', 8, mk({ outcome: 'not-found' })), { status: 'not-found' })
  assert.deepEqual(await fetchTitleMetadata('tv', 9, mk({ outcome: 'error', message: 'HTTP 500' })), { status: 'error', message: 'HTTP 500' })
  assert.deepEqual(seen, ['/movie/7?append_to_response=keywords', '/tv/8?append_to_response=keywords', '/tv/9?append_to_response=keywords'])
})

test('cache: successes and not-found are reused, errors are retried, entries expire', async () => {
  let t = 0
  const cache = new TitleMetadataCache({ ttlMs: 1000, now: () => t })
  let calls = 0
  let mode: 'ok' | 'error' = 'error'
  const lookup: RawLookup = async () => { calls++; return mode === 'ok' ? { outcome: 'ok', data: {} } : { outcome: 'error', message: 'boom' } }
  const get = createMetadataGetter('movie', { cache, lookup })
  const c = { tmdbId: 1, title: 'x', year: null, rank: 1, inLibrary: false }
  assert.equal((await get(c)).status, 'error')
  assert.equal((await get(c)).status, 'error')
  assert.equal(calls, 2, 'errors are not cached')
  mode = 'ok'
  assert.equal((await get(c)).status, 'ok')
  assert.equal((await get(c)).status, 'ok')
  assert.equal(calls, 3, 'success is cached')
  t = 5000
  await get(c)
  assert.equal(calls, 4, 'expired entry is reloaded')
})

test('concurrent lookups for the same title share one request', async () => {
  const cache = new TitleMetadataCache()
  let calls = 0
  const lookup: RawLookup = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return { outcome: 'ok', data: {} } }
  const get = createMetadataGetter('tv', { cache, lookup })
  const c = { tmdbId: 3, title: 'x', year: null, rank: 1, inLibrary: false }
  await Promise.all([get(c), get(c), get(c)])
  assert.equal(calls, 1)
})
