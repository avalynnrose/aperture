import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_AUTO_REQUEST_RULES, parseAutoRequestRules, type AutoRequestRules } from './autoRequestRules.js'
import {
  selectAutoRequests,
  type RankedCandidate,
  type SelectionDeps,
  type TitleMetadata,
} from './autoRequestSelection.js'

const rules = (over: Partial<AutoRequestRules> = {}): AutoRequestRules => ({ ...DEFAULT_AUTO_REQUEST_RULES, strategy: 'legacy', ...over })
const cand = (rank: number, over: Partial<RankedCandidate> = {}): RankedCandidate => ({
  tmdbId: 1000 + rank, title: `Title ${rank}`, year: 2020, rank, inLibrary: false, ...over,
})
const ranked = (n: number, over: (rank: number) => Partial<RankedCandidate> = () => ({})) =>
  Array.from({ length: n }, (_, i) => cand(i + 1, over(i + 1)))

interface Fakes {
  requested?: Set<number>
  unknownRequested?: Set<number>
  meta?: Map<number, TitleMetadata>
}
function deps(f: Fakes = {}) {
  const calls = { requested: 0, metadata: 0 }
  const d: SelectionDeps = {
    async isRequested(c) {
      calls.requested++
      if (f.unknownRequested?.has(c.tmdbId)) return 'unknown'
      return f.requested?.has(c.tmdbId) ?? false
    },
    async getMetadata(c) {
      calls.metadata++
      return f.meta?.get(c.tmdbId) ?? { status: 'ok', genreIds: [], countries: ['US'], keywords: [] }
    },
  }
  return { d, calls }
}
const ids = (r: { selected: { rank: number }[] }) => r.selected.map((e) => e.rank)

test('strict: only the first N ranked titles are evaluated; fewer than N (even zero) is fine', async () => {
  // N=10, only ranks 3, 5, 9 are missing; ranks 11+ are all missing but must not be used to fill
  const list = ranked(30, (r) => ({ inLibrary: ![3, 5, 9].includes(r) && r <= 10 }))
  const { d } = deps()
  const r = await selectAutoRequests(list, rules({ strategy: 'strict', targetCount: 10 }), { perRunCap: 25 }, d)
  assert.deepEqual(ids(r), [3, 5, 9])
  assert.equal(r.summary.windowSize, 10)
  assert.equal(r.summary.evaluated, 10)
  const none = await selectAutoRequests(ranked(30, () => ({ inLibrary: true })), rules({ strategy: 'strict', targetCount: 10 }), { perRunCap: 25 }, d)
  assert.equal(none.selected.length, 0)
})

test('fill: continues down the ranking until N eligible titles are found, preserving order', async () => {
  // first ten: eight are owned; N=10 -> keep going
  const list = ranked(40, (r) => ({ inLibrary: r <= 10 && ![4, 7].includes(r) }))
  const { d } = deps()
  const r = await selectAutoRequests(list, rules({ strategy: 'fill', targetCount: 10 }), { perRunCap: 25 }, d)
  assert.deepEqual(ids(r), [4, 7, 11, 12, 13, 14, 15, 16, 17, 18])
  assert.equal(r.summary.notEvaluated, r.summary.windowSize - r.summary.evaluated)
  assert.ok(r.entries.every((e, i, a) => i === 0 || a[i - 1].rank < e.rank), 'ranks stay in order')
})

test('fill: a title ranked #23 can be selected when higher ones are excluded or present', async () => {
  const list = ranked(40, (r) => ({ inLibrary: r < 23 }))
  const r = await selectAutoRequests(list, rules({ strategy: 'fill', targetCount: 1 }), { perRunCap: 5 }, deps().d)
  assert.deepEqual(ids(r), [23])
})

test('fill: exhausted list returns what it found and says so', async () => {
  const list = ranked(12, (r) => ({ inLibrary: r > 3 }))
  const r = await selectAutoRequests(list, rules({ strategy: 'fill', targetCount: 10 }), { perRunCap: 25 }, deps().d)
  assert.deepEqual(ids(r), [1, 2, 3])
  assert.equal(r.summary.exhausted, true)
  assert.equal(r.summary.depthCapped, false)
})

test('fill: depth cap is reported when the target is not reached within maxCandidates', async () => {
  const list = ranked(100, () => ({ inLibrary: true }))
  const r = await selectAutoRequests(list, rules({ strategy: 'fill', targetCount: 5, maxCandidates: 40 }), { perRunCap: 25 }, deps().d)
  assert.equal(r.summary.evaluated, 40)
  assert.equal(r.summary.depthCapped, true)
})

test('per-run cap is independent of N (strict marks extra eligible titles over-cap, in rank order)', async () => {
  const r = await selectAutoRequests(ranked(20), rules({ strategy: 'strict', targetCount: 10 }), { perRunCap: 4 }, deps().d)
  assert.deepEqual(ids(r), [1, 2, 3, 4])
  assert.equal(r.summary.overCap, 6)
  assert.ok(r.entries.filter((e) => e.decision === 'over-cap').every((e) => e.reasons[0].code === 'cap-reached'))
  const f = await selectAutoRequests(ranked(20), rules({ strategy: 'fill', targetCount: 10 }), { perRunCap: 4 }, deps().d)
  assert.deepEqual(ids(f), [1, 2, 3, 4])
})

test('targetCount null falls back to the existing per-run limit (legacy behavior)', async () => {
  const r = await selectAutoRequests(ranked(30), rules({ strategy: 'fill', targetCount: null }), { perRunCap: 7 }, deps().d)
  assert.equal(r.selected.length, 7)
  assert.equal(r.summary.targetCount, 7)
})

test('duplicates are requested once; already-requested and requested-unknown are never selected', async () => {
  const list = [cand(1), { ...cand(2), tmdbId: 1001 }, cand(3), cand(4), cand(5)]
  const f: Fakes = { requested: new Set([1003]), unknownRequested: new Set([1004]) }
  const r = await selectAutoRequests(list, rules({ strategy: 'strict', targetCount: 5 }), { perRunCap: 10 }, deps(f).d)
  assert.deepEqual(ids(r), [1, 5])
  const byRank = (n: number) => r.entries.find((e) => e.rank === n)!
  assert.equal(byRank(2).reasons[0].code, 'duplicate')
  assert.equal(byRank(3).reasons[0].code, 'already-requested')
  assert.equal(byRank(4).decision, 'uncertain')
  assert.equal(byRank(4).reasons[0].code, 'requested-unknown')
})

test('mixed exclusions: country, genre and keyword all apply with every reason reported', async () => {
  const meta = new Map<number, TitleMetadata>([
    [1001, { status: 'ok', genreIds: [16, 35], countries: ['JP'], keywords: [{ id: 210024, name: 'anime' }] }],
    [1002, { status: 'ok', genreIds: [18], countries: ['US', 'JP'], keywords: [] }],
    [1003, { status: 'ok', genreIds: [10764], countries: ['GB'], keywords: [] }],
    [1004, { status: 'ok', genreIds: [18], countries: ['GB'], keywords: [{ id: 210024, name: 'anime' }] }],
    [1005, { status: 'ok', genreIds: [18], countries: ['GB'], keywords: [{ id: 5, name: 'other' }] }],
  ])
  const rl = parseAutoRequestRules({
    strategy: 'strict', targetCount: 5,
    countries: { mode: 'exclude', codes: ['jp'] }, excludedGenreIds: [16, 10764],
    excludedKeywords: [{ id: 210024, name: 'anime' }],
  })
  const r = await selectAutoRequests(ranked(5), rl, { perRunCap: 10 }, deps({ meta }).d)
  assert.deepEqual(ids(r), [5])
  const codes = (n: number) => r.entries.find((e) => e.rank === n)!.reasons.map((x) => `${x.code}:${x.detail}`).sort()
  assert.deepEqual(codes(1), ['country-excluded:JP', 'genre-excluded:16', 'keyword-excluded:anime'])
  assert.deepEqual(codes(2), ['country-excluded:JP'])          // any origin country matching excludes
  assert.deepEqual(codes(3), ['genre-excluded:10764'])
  assert.deepEqual(codes(4), ['keyword-excluded:anime'])
})

test('country match=all excludes only titles made solely in the listed countries', async () => {
  const meta = new Map<number, TitleMetadata>([
    [1001, { status: 'ok', countries: ['JP'] }],
    [1002, { status: 'ok', countries: ['JP', 'US'] }],
  ])
  const rl = parseAutoRequestRules({ strategy: 'strict', targetCount: 2, countries: { mode: 'exclude', codes: ['JP'], match: 'all' } })
  const r = await selectAutoRequests(ranked(2), rl, { perRunCap: 5 }, deps({ meta }).d)
  assert.deepEqual(ids(r), [2])
})

test('country include mode: only titles with a (any) / only (all) listed origin are allowed', async () => {
  const meta = new Map<number, TitleMetadata>([
    [1001, { status: 'ok', countries: ['US'] }],
    [1002, { status: 'ok', countries: ['US', 'FR'] }],
    [1003, { status: 'ok', countries: ['FR'] }],
  ])
  const any = parseAutoRequestRules({ strategy: 'strict', targetCount: 3, countries: { mode: 'include', codes: ['US'], match: 'any' } })
  assert.deepEqual(ids(await selectAutoRequests(ranked(3), any, { perRunCap: 5 }, deps({ meta }).d)), [1, 2])
  const all = parseAutoRequestRules({ strategy: 'strict', targetCount: 3, countries: { mode: 'include', codes: ['US'], match: 'all' } })
  assert.deepEqual(ids(await selectAutoRequests(ranked(3), all, { perRunCap: 5 }, deps({ meta }).d)), [1])
})

test('original language is never used as country of origin', async () => {
  const list = [cand(1, { originalLanguage: 'ja' })]
  const meta = new Map<number, TitleMetadata>([[1001, { status: 'ok', countries: ['US'] }]])
  const rl = parseAutoRequestRules({ strategy: 'strict', targetCount: 1, countries: { mode: 'exclude', codes: ['JP'] } })
  assert.deepEqual(ids(await selectAutoRequests(list, rl, { perRunCap: 5 }, deps({ meta }).d)), [1])
})

test('failed metadata lookups are uncertain, never selected, even when missing metadata is allowed', async () => {
  const meta = new Map<number, TitleMetadata>([
    [1001, { status: 'error', message: 'HTTP 500' }],
    [1002, { status: 'not-found' }],
  ])
  for (const policy of ['skip', 'allow'] as const) {
    const rl = parseAutoRequestRules({ strategy: 'strict', targetCount: 2, excludedKeywords: [{ id: 1, name: 'x' }], missingMetadata: policy })
    const r = await selectAutoRequests(ranked(2), rl, { perRunCap: 5 }, deps({ meta }).d)
    assert.equal(r.selected.length, 0, policy)
    assert.deepEqual(r.entries.map((e) => e.decision), ['uncertain', 'uncertain'])
    assert.equal(r.entries[0].reasons[0].code, 'metadata-unavailable')
  }
})

test('empty metadata follows the policy: skip -> uncertain, allow -> passes; empty keywords are valid', async () => {
  const meta = new Map<number, TitleMetadata>([[1001, { status: 'ok', countries: [], keywords: [] }]])
  const skip = parseAutoRequestRules({ strategy: 'strict', targetCount: 1, countries: { codes: ['JP'] }, missingMetadata: 'skip' })
  const allow = parseAutoRequestRules({ strategy: 'strict', targetCount: 1, countries: { codes: ['JP'] }, missingMetadata: 'allow' })
  assert.equal((await selectAutoRequests(ranked(1), skip, { perRunCap: 5 }, deps({ meta }).d)).entries[0].decision, 'uncertain')
  assert.equal((await selectAutoRequests(ranked(1), allow, { perRunCap: 5 }, deps({ meta }).d)).entries[0].decision, 'selected')
  const kw = parseAutoRequestRules({ strategy: 'strict', targetCount: 1, excludedKeywords: [{ id: 1, name: 'x' }], missingMetadata: 'skip' })
  assert.equal((await selectAutoRequests(ranked(1), kw, { perRunCap: 5 }, deps({ meta }).d)).entries[0].decision, 'selected')
})

test('no filters configured means no metadata lookups at all; owned titles skip lookups too', async () => {
  const a = deps()
  await selectAutoRequests(ranked(10), rules({ strategy: 'strict', targetCount: 10 }), { perRunCap: 10 }, a.d)
  assert.equal(a.calls.metadata, 0)
  const rl = parseAutoRequestRules({ strategy: 'strict', targetCount: 10, countries: { codes: ['JP'] } })
  const b = deps()
  await selectAutoRequests(ranked(10, (r) => ({ inLibrary: r <= 6 })), rl, { perRunCap: 10 }, b.d)
  assert.equal(b.calls.metadata, 4)
  assert.equal(b.calls.requested, 4)
})

test('list-provided genres and countries avoid extra lookups', async () => {
  const rl = parseAutoRequestRules({ strategy: 'strict', targetCount: 2, excludedGenreIds: [16], countries: { codes: ['JP'] } })
  const { d, calls } = deps()
  const list = [cand(1, { genreIds: [16], countries: ['US'] }), cand(2, { genreIds: [18], countries: ['US'] })]
  const r = await selectAutoRequests(list, rl, { perRunCap: 5 }, d)
  assert.equal(calls.metadata, 0)
  assert.deepEqual(ids(r), [2])
})

test('selection is deterministic: identical input gives identical output (preview == job)', async () => {
  const list = ranked(25, (r) => ({ inLibrary: r % 3 === 0 }))
  const rl = rules({ strategy: 'fill', targetCount: 6 })
  const a = await selectAutoRequests(list, rl, { perRunCap: 10 }, deps().d)
  const b = await selectAutoRequests(list, rl, { perRunCap: 10 }, deps().d)
  assert.deepEqual(a, b)
})

test('legacy (default): first N missing titles; requested ones use a slot and are not replaced; owned are skipped free', async () => {
  // ranks 1-2 owned (free), 3-5 missing but already requested (use 3 slots), 6.. missing
  const list = ranked(30, (r) => ({ inLibrary: r <= 2 }))
  const f: Fakes = { requested: new Set([1003, 1004, 1005]) }
  const r = await selectAutoRequests(list, rules({ strategy: 'legacy', targetCount: null }), { perRunCap: 5 }, deps(f).d)
  assert.deepEqual(ids(r), [6, 7])
  // the same list under fill replaces the requested ones and reaches N
  const fill = await selectAutoRequests(list, rules({ strategy: 'fill', targetCount: 5 }), { perRunCap: 5 }, deps(f).d)
  assert.deepEqual(ids(fill), [6, 7, 8, 9, 10])
})

test('legacy: filters never use slots; excluded titles are skipped and the walk continues', async () => {
  const meta = new Map<number, TitleMetadata>([[1001, { status: 'ok', countries: ['JP'] }]])
  const rl = parseAutoRequestRules({ strategy: 'legacy', countries: { codes: ['JP'] } })
  const r = await selectAutoRequests(ranked(10), rl, { perRunCap: 3 }, deps({ meta }).d)
  assert.deepEqual(ids(r), [2, 3, 4])
})

test('rules default to the Top N Eligible chart with release filtering off; legacy stays selectable', () => {
  assert.equal(parseAutoRequestRules({}).strategy, 'chart')
  assert.equal(DEFAULT_AUTO_REQUEST_RULES.strategy, 'chart')
  assert.equal(DEFAULT_AUTO_REQUEST_RULES.skipUnreleased, false)
  assert.equal(parseAutoRequestRules({ strategy: 'legacy' }).strategy, 'legacy')
})

test('rules parsing: defaults, normalization and rejection of bad input', () => {
  const p = parseAutoRequestRules({})
  assert.deepEqual(p, DEFAULT_AUTO_REQUEST_RULES)
  const n = parseAutoRequestRules({ countries: { codes: ['jp', 'JP', ' us '] }, excludedGenreIds: [16, 16, 10764], excludedKeywords: [{ id: 2, name: 'a' }, { id: 2, name: 'b' }] })
  assert.deepEqual(n.countries.codes, ['JP', 'US'])
  assert.deepEqual(n.excludedGenreIds, [16, 10764])
  assert.equal(n.excludedKeywords.length, 1)
  assert.throws(() => parseAutoRequestRules({ strategy: 'nope' }), /autoRequestRules invalid: strategy/)
  assert.throws(() => parseAutoRequestRules({ countries: { codes: ['JPN'] } }), /countries/)
  assert.throws(() => parseAutoRequestRules({ targetCount: 0 }), /targetCount/)
  assert.throws(() => parseAutoRequestRules({ unknownField: 1 }), /autoRequestRules invalid/)
})

// ---- Top N Eligible (chart) ----------------------------------------------------------------

const chartRules = (over: Partial<AutoRequestRules> = {}) => rules({ strategy: 'chart', targetCount: 10, ...over })
const NOW = new Date('2026-10-23T12:00:00Z')

test('chart: owner example - owned and requested titles hold places, excluded/unreleased take none, search continues to the Nth eligible', async () => {
  // ranks 1-10: 1,2,3 owned | 4,5 unreleased | 6,7 excluded (genre 16) | 8,9,10 eligible and missing
  // ranks 11-14: eligible and missing (the 4 extra needed); 15+ must not be touched
  const list = ranked(30, (r) => ({
    inLibrary: r <= 3,
    releaseDate: r === 4 || r === 5 ? '2027-01-01' : '2026-01-01',
    genreIds: r === 6 || r === 7 ? [16] : [18],
    countries: ['US'],
  }))
  const { d, calls } = deps()
  const r = await selectAutoRequests(list, chartRules({ skipUnreleased: true, excludedGenreIds: [16] }), { perRunCap: 25, now: NOW }, d)
  assert.deepEqual(ids(r), [8, 9, 10, 11, 12, 13, 14])
  const chart = r.entries.filter((e) => e.chartPosition !== undefined)
  assert.deepEqual(chart.map((e) => e.rank), [1, 2, 3, 8, 9, 10, 11, 12, 13, 14])
  assert.deepEqual(chart.map((e) => e.chartPosition), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(r.summary.chart, { size: 10, inLibrary: 3, alreadyRequested: 0, willRequest: 7, overCap: 0, short: false })
  assert.equal(r.summary.evaluated, 14)
  assert.deepEqual(r.entries.filter((e) => e.decision === 'excluded').map((e) => e.rank), [4, 5, 6, 7])
  assert.ok(r.entries.find((e) => e.rank === 4)!.reasons.some((x) => x.code === 'not-released'))
  assert.equal(calls.requested, 7, 'Seerr is only asked about titles that passed the filters and are not owned')
})

test('chart: already requested titles hold a place without a duplicate request; source order is preserved', async () => {
  const list = ranked(20, (r) => ({ inLibrary: r === 2 }))
  const f: Fakes = { requested: new Set([1001, 1003]) }
  const r = await selectAutoRequests(list, chartRules({ targetCount: 5 }), { perRunCap: 25 }, deps(f).d)
  assert.deepEqual(ids(r), [4, 5])
  assert.deepEqual(r.entries.map((e) => e.availability), ['requested', 'in-library', 'requested', 'will-request', 'will-request'])
  assert.deepEqual(r.summary.chart, { size: 5, inLibrary: 1, alreadyRequested: 2, willRequest: 2, overCap: 0, short: false })
  assert.equal(r.summary.evaluated, 5, 'stops at the 5th eligible title; nothing is requested just to reach more')
})

test('chart: filters apply to owned titles too, so an owned excluded title takes no place', async () => {
  const list = ranked(10, (r) => ({ inLibrary: r === 1, genreIds: r === 1 ? [16] : [18], countries: ['US'] }))
  const r = await selectAutoRequests(list, chartRules({ targetCount: 3, excludedGenreIds: [16] }), { perRunCap: 25 }, deps().d)
  assert.equal(r.entries[0].decision, 'excluded')
  assert.deepEqual(ids(r), [2, 3, 4])
})

test('chart: per-run cap limits requests but not chart places; over-cap titles are listed', async () => {
  const r = await selectAutoRequests(ranked(30), chartRules({ targetCount: 10 }), { perRunCap: 4 }, deps().d)
  assert.deepEqual(ids(r), [1, 2, 3, 4])
  assert.equal(r.summary.chart!.size, 10)
  assert.equal(r.summary.chart!.overCap, 6)
  assert.equal(r.summary.overCap, 6)
})

test('chart: unverifiable titles (failed lookup, unknown Seerr status) take no place and are never requested', async () => {
  const list = ranked(10, () => ({ genreIds: [18], countries: ['US'] }))
  const f: Fakes = { unknownRequested: new Set([1002]), meta: new Map([[1001, { status: 'error', message: 'down' }]]) }
  const r = await selectAutoRequests(list, chartRules({ targetCount: 3, excludedKeywords: [{ id: 5, name: 'x' }] }), { perRunCap: 25 }, deps(f).d)
  assert.deepEqual(r.entries.filter((e) => e.decision === 'uncertain').map((e) => e.rank), [1, 2])
  assert.deepEqual(ids(r), [3, 4, 5])
})

test('chart: stops at the depth cap and reports a short chart', async () => {
  const list = ranked(40, (r) => ({ inLibrary: false, genreIds: r % 2 ? [16] : [18], countries: ['US'] }))
  const r = await selectAutoRequests(list, chartRules({ targetCount: 10, maxCandidates: 12, excludedGenreIds: [16] }), { perRunCap: 25 }, deps().d)
  assert.equal(r.summary.chart!.size, 6)
  assert.equal(r.summary.chart!.short, true)
  assert.equal(r.summary.depthCapped, true)
  assert.equal(r.summary.evaluated, 12)
})

test('chart: targetCount null uses the per-run limit as the chart size', async () => {
  const r = await selectAutoRequests(ranked(30), chartRules({ targetCount: null }), { perRunCap: 7 }, deps().d)
  assert.equal(r.summary.targetCount, 7)
  assert.equal(r.summary.chart!.size, 7)
})

// ---- skip unreleased -------------------------------------------------------------------------

test('skipUnreleased: future dates are excluded with the date as the reason; today and past dates pass', async () => {
  const dates = ['2026-10-24', '2026-10-23', '2020-05-05', '2026-12-31T00:00:00Z']
  const list = ranked(4, (r) => ({ releaseDate: dates[r - 1] }))
  for (const strategy of ['legacy', 'strict', 'fill', 'chart'] as const) {
    const r = await selectAutoRequests(list, rules({ strategy, targetCount: 4, skipUnreleased: true }), { perRunCap: 25, now: NOW }, deps().d)
    assert.deepEqual(ids(r), [2, 3], strategy)
    const e = r.entries.filter((x) => x.decision === 'excluded')
    assert.deepEqual(e.map((x) => x.reasons[0].detail), ['2026-10-24', '2026-12-31'], strategy)
  }
})

test('skipUnreleased off: release dates are ignored and no lookup is made for them', async () => {
  const { d, calls } = deps()
  const r = await selectAutoRequests(ranked(3, () => ({ releaseDate: '2099-01-01' })), chartRules({ targetCount: 3 }), { perRunCap: 25, now: NOW }, d)
  assert.deepEqual(ids(r), [1, 2, 3])
  assert.equal(calls.metadata, 0)
})

test('skipUnreleased: date unknown from the list is looked up from TMDB details', async () => {
  const f: Fakes = { meta: new Map<number, TitleMetadata>([[1001, { status: 'ok', releaseDate: '2027-02-02' }], [1002, { status: 'ok', releaseDate: '2025-02-02' }]]) }
  const { d, calls } = deps(f)
  const r = await selectAutoRequests(ranked(2), chartRules({ targetCount: 2, skipUnreleased: true }), { perRunCap: 25, now: NOW }, d)
  assert.deepEqual(ids(r), [2])
  assert.equal(calls.metadata, 2)
})

test('skipUnreleased: a missing date follows the missing-metadata policy; a failed lookup is never allowed through', async () => {
  const list = ranked(3, (r) => ({ releaseDate: r === 3 ? undefined : null }))
  const f: Fakes = { meta: new Map<number, TitleMetadata>([[1003, { status: 'error', message: 'x' }]]) }
  const skip = await selectAutoRequests(list, chartRules({ targetCount: 3, skipUnreleased: true, missingMetadata: 'skip' }), { perRunCap: 25, now: NOW }, deps(f).d)
  assert.equal(skip.selected.length, 0)
  assert.deepEqual(skip.entries.map((e) => e.decision), ['uncertain', 'uncertain', 'uncertain'])
  const allow = await selectAutoRequests(list, chartRules({ targetCount: 3, skipUnreleased: true, missingMetadata: 'allow' }), { perRunCap: 25, now: NOW }, deps(f).d)
  assert.deepEqual(ids(allow), [1, 2])
  assert.equal(allow.entries[2].decision, 'uncertain')
})

test('rules: skipUnreleased and the chart strategy parse; bad values are rejected', () => {
  const p = parseAutoRequestRules({ strategy: 'chart', skipUnreleased: true })
  assert.equal(p.skipUnreleased, true)
  assert.throws(() => parseAutoRequestRules({ skipUnreleased: 'yes' }), /skipUnreleased/)
})

// ---- skipped titles (the X in the preview) -------------------------------------------------

const skip = (...ids: number[]) => ids.map((tmdbId) => ({ tmdbId, title: `Title ${tmdbId - 1000}` }))

test('skipped title: never requested, takes no chart place, the next eligible title fills it', async () => {
  const { d, calls } = deps()
  const r = await selectAutoRequests(ranked(30), chartRules({ targetCount: 5, skippedTitles: skip(1002, 1004) }), { perRunCap: 25 }, d)
  assert.deepEqual(ids(r), [1, 3, 5, 6, 7])
  assert.deepEqual(r.entries.filter((e) => e.chartPosition !== undefined).map((e) => e.rank), [1, 3, 5, 6, 7])
  const e2 = r.entries.find((e) => e.rank === 2)!
  assert.equal(e2.decision, 'excluded')
  assert.deepEqual(e2.reasons.map((x) => x.code), ['manually-skipped'])
  assert.equal(calls.requested, 5, 'no Seerr or TMDB call is made for a skipped title')
})

test('skipped title that is already in the library or already requested also leaves the chart', async () => {
  const list = ranked(10, (r) => ({ inLibrary: r === 1 }))
  const f: Fakes = { requested: new Set([1002]) }
  const r = await selectAutoRequests(list, chartRules({ targetCount: 3, skippedTitles: skip(1001, 1002) }), { perRunCap: 25 }, deps(f).d)
  assert.deepEqual(r.entries.filter((e) => e.chartPosition !== undefined).map((e) => e.rank), [3, 4, 5])
})

test('skipped title is honoured by legacy, strict and fill as well; fill walks past it, strict does not refill', async () => {
  for (const strategy of ['legacy', 'fill'] as const) {
    const r = await selectAutoRequests(ranked(20), rules({ strategy, targetCount: 3, skippedTitles: skip(1001) }), { perRunCap: 25 }, deps().d)
    assert.deepEqual(ids(r), [2, 3, 4], strategy)
  }
  const s = await selectAutoRequests(ranked(20), rules({ strategy: 'strict', targetCount: 3, skippedTitles: skip(1001) }), { perRunCap: 25 }, deps().d)
  assert.deepEqual(ids(s), [2, 3])
})

test('skippedTitles: parsed, de-duplicated by TMDB id, validated; default is empty', () => {
  assert.deepEqual(DEFAULT_AUTO_REQUEST_RULES.skippedTitles, [])
  const p = parseAutoRequestRules({ skippedTitles: [{ tmdbId: 5, title: 'A' }, { tmdbId: 5, title: 'B' }, { tmdbId: 6, title: 'C' }] })
  assert.deepEqual(p.skippedTitles, [{ tmdbId: 5, title: 'A' }, { tmdbId: 6, title: 'C' }])
  assert.throws(() => parseAutoRequestRules({ skippedTitles: [{ tmdbId: 0, title: 'x' }] }), /skippedTitles/)
  assert.throws(() => parseAutoRequestRules({ skippedTitles: [{ tmdbId: 1, title: '' }] }), /skippedTitles/)
})
