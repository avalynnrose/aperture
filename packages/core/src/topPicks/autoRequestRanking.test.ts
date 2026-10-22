import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blendDetailed } from './popularity.js'
import {
  externalScoreAtPosition,
  rankByExternalOrder,
  rankByHybridBlend,
  type DisplayScoredTitle,
  type ExternalListItem,
} from './autoRequestRanking.js'

const ext = (n: number): ExternalListItem[] =>
  Array.from({ length: n }, (_, i) => ({ tmdbId: 100 + i + 1, title: `E${i + 1}`, year: 2024, originalLanguage: 'en' }))

test('external ordering ranks by list position and flags library titles', () => {
  const r = rankByExternalOrder(ext(5), new Set([102, 104]), 3)
  assert.deepEqual(r.map((c) => [c.rank, c.tmdbId, c.inLibrary]), [[1, 101, false], [2, 102, true], [3, 103, false]])
})

test('external score of a missing title uses the display scale: 100 at #1, 0.1 less per position', () => {
  assert.equal(externalScoreAtPosition(1), 100)
  assert.ok(Math.abs(externalScoreAtPosition(2) - 99.8998998) < 1e-6)
  assert.ok(externalScoreAtPosition(30) < externalScoreAtPosition(29))
})

test('a missing title has local score 0 and blended = external * externalWeight', () => {
  const r = rankByHybridBlend({ items: ext(2), libraryTmdbIds: new Set(), displayScored: [], localWeight: 0.25, externalWeight: 0.75, maxCandidates: 10 })
  assert.equal(r[0].scores?.local, 0)
  assert.ok(Math.abs((r[0].scores?.blended ?? 0) - 75) < 1e-9)
  assert.deepEqual(r.map((c) => c.tmdbId), [101, 102])
})

test('owned titles keep the display score; watched owned titles outrank missing ones, unwatched interleave by list order', () => {
  // E1 missing; E2 owned+watched (local 60); E3 owned, unwatched; E4 missing; local-only owned title L (not in external list)
  const displayScored: DisplayScoredTitle[] = [
    { tmdbId: 102, title: 'E2', year: 2024, localScore: 60, externalScore: externalScoreAtPosition(1), displayOrder: 0 },
    { tmdbId: 103, title: 'E3', year: 2024, localScore: 0, externalScore: externalScoreAtPosition(2), displayOrder: 2 },
    { tmdbId: 900, title: 'L', year: 2020, localScore: 100, externalScore: 0, displayOrder: 1 },
  ]
  const r = rankByHybridBlend({ items: ext(4), libraryTmdbIds: new Set([102, 103]), displayScored, localWeight: 0.25, externalWeight: 0.75, maxCandidates: 10 })
  // E2: .25*60 + .75*100 = 90 ; L: .25*100 = 25 ; E3: .75*99.9 = 74.92 ; E1 (missing, position 1): .75*100 = 75 ; E4: ~74.78
  assert.deepEqual(r.map((c) => c.title), ['E2', 'E1', 'E3', 'E4', 'L'])
  assert.deepEqual(r.map((c) => c.inLibrary), [true, false, true, false, true])
  assert.deepEqual(r.map((c) => c.rank), [1, 2, 3, 4, 5])
})

test('owned titles keep the relative order the display gives them', () => {
  const displayScored: DisplayScoredTitle[] = [
    { tmdbId: 103, title: 'A', year: 1, localScore: 80, externalScore: 99.7, displayOrder: 0 },
    { tmdbId: 101, title: 'B', year: 1, localScore: 70, externalScore: 100, displayOrder: 1 },
    { tmdbId: 102, title: 'C', year: 1, localScore: 70, externalScore: 100, displayOrder: 2 },
  ]
  const r = rankByHybridBlend({ items: ext(6), libraryTmdbIds: new Set([101, 102, 103]), displayScored, localWeight: 0.5, externalWeight: 0.5, maxCandidates: 10 })
  assert.deepEqual(r.filter((c) => c.inLibrary).map((c) => c.title), ['A', 'B', 'C'])
})

// ---- parity with the pre-refactor display algorithm --------------------------------------------
interface Item { id: string; popularityScore: number }
function oldBlend(local: Item[], external: Item[], lw: number, ew: number, limit: number) {
  const maxLocalScore = Math.max(...local.map((m) => m.popularityScore), 1)
  const maxExternalScore = Math.max(...external.map((m) => m.popularityScore), 1)
  const scoreMap = new Map<string, { movie: Item; localScore: number; externalScore: number }>()
  for (const movie of local) scoreMap.set(movie.id, { movie, localScore: (movie.popularityScore / maxLocalScore) * 100, externalScore: 0 })
  for (const movie of external) {
    const n = (movie.popularityScore / maxExternalScore) * 100
    const ex = scoreMap.get(movie.id)
    if (ex) ex.externalScore = n
    else scoreMap.set(movie.id, { movie, localScore: 0, externalScore: n })
  }
  return Array.from(scoreMap.values())
    .map(({ movie, localScore, externalScore }) => ({ ...movie, popularityScore: localScore * lw + externalScore * ew }))
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, limit)
    .map((m, i) => ({ ...m, rank: i + 1 }))
}

test('refactored display blend equals the original algorithm on randomized fixtures', () => {
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  for (let run = 0; run < 200; run++) {
    const local: Item[] = Array.from({ length: Math.floor(rnd() * 25) }, (_, i) => ({ id: `m${Math.floor(rnd() * 40)}-${i % 3}`, popularityScore: Math.round(rnd() * 500) }))
    const external: Item[] = Array.from({ length: Math.floor(rnd() * 25) }, (_, i) => ({ id: `m${Math.floor(rnd() * 40)}-${i % 3}`, popularityScore: 1000 - (i + 1) }))
    const lw = rnd(), ew = 1 - lw, limit = 1 + Math.floor(rnd() * 20)
    const expected = oldBlend(local, external, lw, ew, limit)
    const actual = blendDetailed(local, external, (m) => m.id, lw, ew).slice(0, limit).map((e, i) => ({ ...e.item, popularityScore: e.blended, rank: i + 1 }))
    assert.deepEqual(actual, expected, `run ${run}`)
  }
})
