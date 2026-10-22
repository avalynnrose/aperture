/**
 * Integration tests for auto-request: real Postgres (migrated), an in-process mock Seerr, and fake
 * TMDB responses. Nothing here talks to a real service.
 *
 * Skipped unless AR_INTEGRATION=1 and DATABASE_URL points at a throwaway, fully migrated database
 * (the CI "checks" job provides one).
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'

const enabled = process.env.AR_INTEGRATION === '1' && !!process.env.DATABASE_URL
const opts = { skip: enabled ? false : 'set AR_INTEGRATION=1 and DATABASE_URL to run' }

// ---- fake TMDB -------------------------------------------------------------------------------
interface FakeTitle {
  id: number
  title: string
  lang: string
  genres: number[]
  countries: string[]
  keywords: { id: number; name: string }[]
  failDetails?: boolean
}
const movies: FakeTitle[] = [
  { id: 501, title: 'Owned One', lang: 'en', genres: [18], countries: ['US'], keywords: [] },
  { id: 502, title: 'Requested One', lang: 'en', genres: [18], countries: ['US'], keywords: [] },
  { id: 503, title: 'Anime Film', lang: 'ja', genres: [16], countries: ['JP'], keywords: [{ id: 210024, name: 'anime' }] },
  { id: 504, title: 'Good A', lang: 'en', genres: [28], countries: ['US'], keywords: [] },
  { id: 505, title: 'Doc B', lang: 'en', genres: [99], countries: ['GB'], keywords: [] },
  { id: 506, title: 'Japanese Live Action', lang: 'ja', genres: [18], countries: ['JP'], keywords: [] },
  { id: 507, title: 'Good C', lang: 'en', genres: [35], countries: ['US', 'FR'], keywords: [] },
  { id: 508, title: 'Good D', lang: 'fr', genres: [18], countries: ['FR'], keywords: [{ id: 5, name: 'other' }] },
]
const shows: FakeTitle[] = [
  { id: 601, title: 'Show One', lang: 'en', genres: [18], countries: ['US'], keywords: [] },
  { id: 602, title: 'Show Two', lang: 'en', genres: [10764], countries: ['GB'], keywords: [] },
  { id: 603, title: 'Show Three', lang: 'en', genres: [35], countries: ['CA'], keywords: [] },
]
const realFetch = globalThis.fetch.bind(globalThis)
function installFakeTmdb() {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('https://api.themoviedb.org/3/')) return realFetch(input, init)
    const u = new URL(url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const list = u.pathname.match(/^\/3\/trending\/(movie|tv)\//)
    if (list) {
      const page = Number(u.searchParams.get('page') ?? '1')
      const src = list[1] === 'movie' ? movies : shows
      const results = (page === 1 ? src : []).map((t) =>
        list[1] === 'movie'
          ? { id: t.id, title: t.title, release_date: '2024-01-01', original_language: t.lang, genre_ids: t.genres, popularity: 1, vote_average: 7, vote_count: 10 }
          : { id: t.id, name: t.title, first_air_date: '2024-01-01', original_language: t.lang, genre_ids: t.genres, origin_country: t.countries, popularity: 1, vote_average: 7, vote_count: 10 }
      )
      return json({ page, results, total_pages: 1, total_results: results.length })
    }
    const detail = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)$/)
    if (detail) {
      const t = (detail[1] === 'movie' ? movies : shows).find((x) => x.id === Number(detail[2]))
      if (!t) return json({ status_message: 'not found' }, 404)
      if (t.failDetails) return json({ status_message: 'boom' }, 500)
      return detail[1] === 'movie'
        ? json({ id: t.id, genres: t.genres.map((id) => ({ id })), production_countries: t.countries.map((c) => ({ iso_3166_1: c })), keywords: { keywords: t.keywords } })
        : json({ id: t.id, genres: t.genres.map((id) => ({ id })), origin_country: t.countries, keywords: { results: t.keywords } })
    }
    return json({}, 404)
  }) as typeof fetch
}

// ---- mock Seerr --------------------------------------------------------------------------------
const seerr = { posts: [] as Record<string, unknown>[], requested: new Set<number>(), users: [{ id: 1 }, { id: 2 }], server: null as http.Server | null, url: '' }
function startMockSeerr(): Promise<void> {
  seerr.server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const send = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (u.pathname === '/api/v1/user') return send(200, { pageInfo: { page: 1, pages: 1, results: seerr.users.length }, results: seerr.users })
    const m = u.pathname.match(/^\/api\/v1\/(movie|tv)\/(\d+)$/)
    if (m) {
      const id = Number(m[2])
      return send(200, { id, numberOfSeasons: 4, ...(seerr.requested.has(id) ? { mediaInfo: { status: 2, requests: [{ id: 1, status: 2 }] } } : {}) })
    }
    if (u.pathname === '/api/v1/request' && req.method === 'POST') {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => { const body = JSON.parse(b || '{}'); seerr.posts.push(body); send(201, { id: seerr.posts.length }) })
      return
    }
    return send(404, {})
  })
  return new Promise((resolve) => seerr.server!.listen(0, '127.0.0.1', () => { seerr.url = `http://127.0.0.1:${(seerr.server!.address() as AddressInfo).port}`; resolve() }))
}

// ---- helpers (core is imported lazily so a skipped run never needs a database) -----------------
type Core = typeof import('./index.js')
let core: Core
let pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
const ids = (plan: { result: { selected: { tmdbId: number }[] } }) => plan.result.selected.map((e) => e.tmdbId)
const postedIds = () => seerr.posts.map((p) => p.mediaId as number)

async function configure(movieRules: unknown, extra: Record<string, unknown> = {}) {
  await core.updateTopPicksConfig({
    isEnabled: true,
    moviesPopularitySource: 'tmdb_trending_week',
    seriesPopularitySource: 'tmdb_trending_week',
    moviesAutoRequestEnabled: true,
    seriesAutoRequestEnabled: true,
    moviesAutoRequestLimit: 3,
    seriesAutoRequestLimit: 3,
    moviesLanguages: [],
    seriesLanguages: [],
    moviesAutoRequestRules: movieRules as never,
    seriesAutoRequestRules: {} as never,
    autoRequestSeerrUserId: null,
    seriesAutoRequestSeasons: 'all',
    ...extra,
  } as never)
}
const FILTERS = { countries: { mode: 'exclude', codes: ['JP'] }, excludedGenreIds: [16], excludedKeywords: [{ id: 210024, name: 'anime' }] }

before(async () => {
  if (!enabled) return
  installFakeTmdb()
  await startMockSeerr()
  core = await import('./index.js')
  const { query } = await import('../lib/db.js')
  pool = { query: (sql, params) => query(sql, params) as never }
  await core.setSeerrConfig({ url: seerr.url, apiKey: 'mock', enabled: true })
  await core.setTMDbConfig({ apiKey: 'ci-fake', enabled: true })
  await pool.query(`DELETE FROM movies WHERE provider_item_id LIKE 'it-%'`)
  await pool.query(`INSERT INTO movies (provider_item_id, title, year, path, tmdb_id) VALUES ('it-501', 'Owned One', 2024, '/m/owned', '501')`)
})
after(async () => {
  if (!enabled) return
  globalThis.fetch = realFetch
  await pool.query(`DELETE FROM movies WHERE provider_item_id LIKE 'it-%'`)
  await new Promise((r) => seerr.server?.close(r))
  const { closePool } = await import('../lib/db.js')
  await closePool()
  setTimeout(() => process.exit(0), 200).unref()
})
beforeEach(() => {
  seerr.posts.length = 0
  seerr.requested.clear()
  seerr.requested.add(502)
  seerr.users = [{ id: 1 }, { id: 2 }]
  for (const t of movies) t.failDetails = false
})

test('default (legacy) rules reproduce the old behavior: first N missing titles, requested ones use a slot', opts, async () => {
  await configure({})
  const cfg = await core.getTopPicksConfig()
  const plan = await core.planAutoRequests('movie', cfg)
  assert.deepEqual(ids(plan), [503, 504]) // 501 owned (free), 502 requested (slot), 503, 504 -> 3 slots
  const result = await core.runAutoRequestJob(undefined, { plans: { movie: plan } })
  assert.deepEqual(postedIds().sort(), [503, 504])
  assert.equal(result.moviesRequested, 2)
})

test('strict top N applies country, genre and keyword filters and does not fill from below', opts, async () => {
  await configure({ strategy: 'strict', targetCount: 5, ...FILTERS })
  const plan = await core.planAutoRequests('movie', await core.getTopPicksConfig())
  assert.deepEqual(ids(plan), [504, 505]) // ranks 1-5: owned, requested, anime (excluded), A, B
  const anime = plan.result.entries.find((e) => e.tmdbId === 503)!
  assert.equal(anime.decision, 'excluded')
  assert.deepEqual(anime.reasons.map((r) => r.code).sort(), ['country-excluded', 'genre-excluded', 'keyword-excluded'])
  assert.equal(plan.result.summary.windowSize, 5)
})

test('fill to N keeps going past excluded titles in rank order', opts, async () => {
  await configure({ strategy: 'fill', targetCount: 3, ...FILTERS })
  const plan = await core.planAutoRequests('movie', await core.getTopPicksConfig())
  assert.deepEqual(ids(plan), [504, 505, 507]) // 506 (JP) is skipped over
  assert.deepEqual(plan.result.selected.map((e) => e.rank), [4, 5, 7])
})

test('a failed TMDB lookup makes the title uncertain and it is never requested; fill continues', opts, async () => {
  movies.find((m) => m.id === 505)!.failDetails = true
  for (const policy of ['skip', 'allow']) {
    await configure({ strategy: 'fill', targetCount: 3, missingMetadata: policy, ...FILTERS })
    const plan = await core.planAutoRequests('movie', await core.getTopPicksConfig())
    assert.equal(plan.result.entries.find((e) => e.tmdbId === 505)!.decision, 'uncertain', policy)
    assert.ok(!ids(plan).includes(505), policy)
    assert.deepEqual(ids(plan), [504, 507, 508])
  }
})

test('the per-run cap is independent of the target count', opts, async () => {
  await configure({ strategy: 'strict', targetCount: 8 }, { moviesAutoRequestLimit: 2 })
  const plan = await core.planAutoRequests('movie', await core.getTopPicksConfig())
  assert.equal(plan.result.selected.length, 2)
  assert.ok(plan.result.summary.overCap > 0)
})

async function writeCounters(): Promise<number> {
  await pool.query('SELECT pg_stat_force_next_flush()')
  const r = await pool.query('SELECT COALESCE(SUM(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint AS n FROM pg_stat_user_tables')
  return Number(r.rows[0].n)
}

test('preview is read-only: no Seerr POST and no database writes', opts, async () => {
  await configure({ strategy: 'fill', targetCount: 3, ...FILTERS })
  const cfg = await core.getTopPicksConfig()
  const before = await writeCounters()
  await core.planAutoRequests('movie', cfg)
  await core.planAutoRequests('tv', cfg)
  const after = await writeCounters()
  assert.equal(seerr.posts.length, 0)
  assert.equal(after, before, 'planning must not insert, update or delete any row')
})

test('executing a previewed plan requests exactly the previewed titles, in order', opts, async () => {
  await configure({ strategy: 'fill', targetCount: 3, ...FILTERS })
  const plan = await core.planAutoRequests('movie', await core.getTopPicksConfig())
  await core.runAutoRequestJob(undefined, { plans: { movie: plan } })
  assert.deepEqual(postedIds(), ids(plan))
})

test('planId changes when the selection changes (stale preview)', opts, async () => {
  await configure({ strategy: 'fill', targetCount: 3 })
  const a = await core.planAutoRequests('movie', await core.getTopPicksConfig())
  seerr.requested.add(503)
  const b = await core.planAutoRequests('movie', await core.getTopPicksConfig())
  assert.notEqual(a.planId, b.planId)
})

test('requester and TV seasons apply to both media types and stay independent', opts, async () => {
  await configure({}, { autoRequestSeerrUserId: 2, seriesAutoRequestSeasons: 'first', seriesAutoRequestRules: { strategy: 'strict', targetCount: 2 } })
  await core.runAutoRequestJob()
  const movie = seerr.posts.find((p) => p.mediaType === 'movie')!
  const tv = seerr.posts.find((p) => p.mediaType === 'tv')!
  assert.equal(movie.userId, 2)
  assert.equal(tv.userId, 2)
  assert.deepEqual(tv.seasons, [1])
  assert.equal(movie.seasons, undefined)
  seerr.posts.length = 0
  await configure({}, { autoRequestSeerrUserId: null, seriesAutoRequestSeasons: 'all', seriesAutoRequestRules: { strategy: 'strict', targetCount: 1 } })
  await core.runAutoRequestJob()
  const tv2 = seerr.posts.find((p) => p.mediaType === 'tv')!
  assert.equal(tv2.userId, undefined)
  assert.deepEqual(tv2.seasons, [1, 2, 3, 4])
})

test('a requester that no longer exists stops the job before any request is made', opts, async () => {
  await configure({}, { autoRequestSeerrUserId: 99 })
  const result = await core.runAutoRequestJob()
  assert.equal(seerr.posts.length, 0)
  assert.ok(result.errors[0].includes('no longer exists'))
})
