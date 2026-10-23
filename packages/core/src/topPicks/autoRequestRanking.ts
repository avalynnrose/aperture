/**
 * Ranking of auto-request candidates. Pure functions, no I/O.
 *
 * Two bases:
 *  - external: the position in the external list (TMDB / MDBList) after the language filter.
 *    This is what auto-request has always used and what the admin "library match" preview shows.
 *  - blended (hybrid sources only): the SAME hybrid score the Top Picks display uses, but also
 *    ranking titles that are not in the library, so "Top N" means the top N of the whole ranking.
 *
 * How a title that is not in the library is scored in the blend:
 *   local relevance  = 0   (local score comes from watch history; a title nobody in the library
 *                           could have watched has none, exactly like an owned title with no plays)
 *   external score   = (1000 - position) / 999 * 100   (the display scores a matched title as
 *                           1000 - rank and normalizes by the best, 999; same scale here)
 *   blended          = local * localWeight + external * externalWeight
 * Titles that ARE in the display's scored set keep exactly the score the display gives them.
 *
 * Consequence worth knowing: the external score only varies by 0.1 points per position, so with
 * typical weights the ordering is dominated by local watch scores; unwatched and missing titles
 * mostly follow the external list order behind watched owned titles.
 */
import type { RankedCandidate } from './autoRequestSelection.js'

export interface ExternalListItem {
  tmdbId: number
  title: string
  year: number | null
  originalLanguage: string | null
  /** known from TMDB list results; undefined for MDBList items */
  genreIds?: number[]
  /** TV origin countries from TMDB list results */
  countries?: string[]
  /** movie release date / TV first air date (YYYY-MM-DD) from TMDB list results; null = list has none */
  releaseDate?: string | null
}

/** A title that the Top Picks display scores (it is in the library and in the local or external list). */
export interface DisplayScoredTitle {
  tmdbId: number
  title: string
  year: number | null
  /** normalized 0-100 scores exactly as the display computes them */
  localScore: number
  externalScore: number
  /** position in the display's un-truncated sorted order (tie-breaker, keeps display order) */
  displayOrder: number
}

export const MAX_EXTERNAL_RAW_SCORE = 999

/** External score of a title at 1-based `position` in the external list, on the display's scale. */
export function externalScoreAtPosition(position: number): number {
  return Math.max(0, ((1000 - position) / MAX_EXTERNAL_RAW_SCORE) * 100)
}

/** rank = position in the external list (after language filtering). */
export function rankByExternalOrder(
  items: readonly ExternalListItem[],
  libraryTmdbIds: ReadonlySet<number>,
  maxCandidates: number
): RankedCandidate[] {
  return items.slice(0, maxCandidates).map((item, index) => ({
    tmdbId: item.tmdbId,
    title: item.title,
    year: item.year,
    rank: index + 1,
    inLibrary: libraryTmdbIds.has(item.tmdbId),
    genreIds: item.genreIds,
    countries: item.countries,
    releaseDate: item.releaseDate,
    originalLanguage: item.originalLanguage,
  }))
}

export function rankByHybridBlend(args: {
  items: readonly ExternalListItem[]
  libraryTmdbIds: ReadonlySet<number>
  displayScored: readonly DisplayScoredTitle[]
  localWeight: number
  externalWeight: number
  maxCandidates: number
}): RankedCandidate[] {
  const { items, libraryTmdbIds, displayScored, localWeight, externalWeight, maxCandidates } = args
  interface Row {
    candidate: Omit<RankedCandidate, 'rank'>
    blended: number
    displayOrder: number
    externalPosition: number
  }
  const rows = new Map<number, Row>()
  const externalPosition = new Map(items.map((it, i) => [it.tmdbId, i + 1]))
  const byTmdb = new Map(items.map((it) => [it.tmdbId, it]))

  for (const d of displayScored) {
    const ext = byTmdb.get(d.tmdbId)
    const blended = d.localScore * localWeight + d.externalScore * externalWeight
    rows.set(d.tmdbId, {
      candidate: {
        tmdbId: d.tmdbId,
        title: d.title,
        year: d.year,
        inLibrary: true,
        genreIds: ext?.genreIds,
        countries: ext?.countries,
        releaseDate: ext?.releaseDate,
        originalLanguage: ext?.originalLanguage ?? null,
        scores: { local: d.localScore, external: d.externalScore, blended },
      },
      blended,
      displayOrder: d.displayOrder,
      externalPosition: externalPosition.get(d.tmdbId) ?? Number.POSITIVE_INFINITY,
    })
  }

  items.forEach((it, index) => {
    if (rows.has(it.tmdbId)) return
    const position = index + 1
    const external = externalScoreAtPosition(position)
    const blended = 0 * localWeight + external * externalWeight
    rows.set(it.tmdbId, {
      candidate: {
        tmdbId: it.tmdbId,
        title: it.title,
        year: it.year,
        inLibrary: libraryTmdbIds.has(it.tmdbId),
        genreIds: it.genreIds,
        countries: it.countries,
        releaseDate: it.releaseDate,
        originalLanguage: it.originalLanguage,
        scores: { local: 0, external, blended },
      },
      blended,
      displayOrder: Number.POSITIVE_INFINITY,
      externalPosition: position,
    })
  })

  return [...rows.values()]
    .sort(
      (a, b) =>
        b.blended - a.blended ||
        a.displayOrder - b.displayOrder ||
        a.externalPosition - b.externalPosition ||
        a.candidate.tmdbId - b.candidate.tmdbId
    )
    .slice(0, maxCandidates)
    .map((r, i) => ({ ...r.candidate, rank: i + 1 }))
}
