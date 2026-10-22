import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_AUTO_REQUEST_RULES, parseAutoRequestRules, type AutoRequestRules } from './autoRequestRules.js'
import {
  selectAutoRequests,
  type RankedCandidate,
  type SelectionDeps,
  type TitleMetadata,
} from './autoRequestSelection.js'

const rules = (over: Partial<AutoRequestRules> = {}): AutoRequestRules => ({ ...DEFAULT_AUTO_REQUEST_RULES, ...over })
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
