import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computePlanId, planAutoRequests, type AutoRequestPlan } from './autoRequestPlan.js'
import { DEFAULT_AUTO_REQUEST_RULES, parseAutoRequestRules } from './autoRequestRules.js'
import type { RankedCandidate, SelectionDeps } from './autoRequestSelection.js'
import type { TopPicksConfig } from './config.js'

const cand = (rank: number, over: Partial<RankedCandidate> = {}): RankedCandidate => ({
  tmdbId: 2000 + rank, title: `T${rank}`, year: 2024, rank, inLibrary: false, ...over,
})
const config = (over: Partial<TopPicksConfig> = {}): TopPicksConfig =>
  ({
    moviesAutoRequestEnabled: true, seriesAutoRequestEnabled: true,
    moviesAutoRequestLimit: 3, seriesAutoRequestLimit: 3,
    moviesAutoRequestRules: DEFAULT_AUTO_REQUEST_RULES, seriesAutoRequestRules: DEFAULT_AUTO_REQUEST_RULES,
    updatedAt: new Date('2026-10-22T10:00:00Z'),
    ...over,
  }) as unknown as TopPicksConfig
const gatherOf = (list: RankedCandidate[]) => async () => ({
  candidates: list, popularitySource: 'tmdb_trending_week', externalSource: 'tmdb_trending_week', rankBasis: 'external' as const, warnings: [],
})
const sel = (requested: number[] = []): SelectionDeps => ({
  isRequested: async (c) => requested.includes(c.tmdbId),
  getMetadata: async () => ({ status: 'ok', countries: ['US'], genreIds: [], keywords: [] }),
})

test('preview and execution get the identical plan when they run on the same inputs', async () => {
  const list = Array.from({ length: 12 }, (_, i) => cand(i + 1, { inLibrary: i % 4 === 0 }))
  const run = () => planAutoRequests('movie', config(), { gather: gatherOf(list), selection: sel([2002]) })
  const a = await run()
  const b = await run()
  const strip = (p: AutoRequestPlan) => ({ ...p, generatedAt: '' })
  assert.deepEqual(strip(a), strip(b))
  assert.equal(a.planId, b.planId)
})

test('plan reports original ranks, source, rank basis and the cap/target in force', async () => {
  const list = Array.from({ length: 8 }, (_, i) => cand(i + 1))
  const p = await planAutoRequests('tv', config({ seriesAutoRequestLimit: 4, seriesAutoRequestRules: parseAutoRequestRules({ strategy: 'strict', targetCount: 6 }) }), { gather: gatherOf(list), selection: sel() })
  assert.equal(p.mediaType, 'tv')
  assert.equal(p.targetCount, 6)
  assert.equal(p.perRunCap, 4)
  assert.deepEqual(p.result.selected.map((e) => e.rank), [1, 2, 3, 4])
  assert.equal(p.result.summary.overCap, 2)
  assert.equal(p.rankBasis, 'external')
  assert.equal(p.configVersion, '2026-10-22T10:00:00.000Z')
})

test('planId changes when the selection or the settings version changes (stale-preview detection)', () => {
  const base = computePlanId('movie', '2026-10-22T10:00:00.000Z', [1, 2, 3])
  assert.equal(base, computePlanId('movie', '2026-10-22T10:00:00.000Z', [1, 2, 3]))
  assert.notEqual(base, computePlanId('movie', '2026-10-22T10:00:00.000Z', [1, 2, 4]))
  assert.notEqual(base, computePlanId('movie', '2026-10-22T10:00:01.000Z', [1, 2, 3]))
  assert.notEqual(base, computePlanId('tv', '2026-10-22T10:00:00.000Z', [1, 2, 3]))
})

test('with no metadata lookup available, active filters fail safe: nothing is selected', async () => {
  // default selection deps use the placeholder lookup, which reports an error
  const rules = parseAutoRequestRules({ strategy: 'strict', targetCount: 3, countries: { codes: ['JP'] } })
  const list = [cand(1), cand(2), cand(3)]
  const p = await planAutoRequests('movie', config({ moviesAutoRequestRules: rules }), {
    gather: gatherOf(list),
    selection: { isRequested: async () => false, getMetadata: async () => ({ status: 'error', message: 'down' }) },
  })
  assert.equal(p.result.selected.length, 0)
  assert.equal(p.result.summary.uncertain, 3)
})
