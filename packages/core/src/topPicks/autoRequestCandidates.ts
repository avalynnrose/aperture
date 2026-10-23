/**
 * Builds the ranked candidate list for auto-request from the configured Top Picks source.
 * Read-only: queries the library database and the external list providers (TMDB / MDBList).
 * The resulting list feeds the shared selection engine (autoRequestSelection.ts).
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import type { TopPicksConfig } from './config.js'
import type { AutoRequestRules, RankBasis } from './autoRequestRules.js'
import type { RankedCandidate } from './autoRequestSelection.js'
import {
  rankByExternalOrder,
  rankByHybridBlend,
  type DisplayScoredTitle,
  type ExternalListItem,
} from './autoRequestRanking.js'
import { getHybridDisplayScoresMovies, getHybridDisplayScoresSeries } from './popularity.js'

const logger = createChildLogger('top-picks-auto-request-candidates')

export type AutoRequestMediaType = 'movie' | 'tv'

export interface GatheredCandidates {
  candidates: RankedCandidate[]
  popularitySource: string
  externalSource: string | null
  /** the basis actually used (blended is only possible for hybrid sources) */
  rankBasis: RankBasis
  warnings: string[]
}

interface SourceSettings {
  popularity: string
  external: string | null
  languages: string[]
  includeUnknownLanguage: boolean
  mdblistListId: number | null
  mdblistSort: string
}

function sourceSettings(mediaType: AutoRequestMediaType, c: TopPicksConfig): SourceSettings {
  const movie = mediaType === 'movie'
  const popularity = movie ? c.moviesPopularitySource : c.seriesPopularitySource
  const hybridExternal = movie ? c.moviesHybridExternalSource : c.seriesHybridExternalSource
  return {
    popularity,
    external: popularity === 'hybrid' ? hybridExternal : popularity,
    languages: (movie ? c.moviesLanguages : c.seriesLanguages) ?? [],
    includeUnknownLanguage: (movie ? c.moviesIncludeUnknownLanguage : c.seriesIncludeUnknownLanguage) ?? true,
    mdblistListId: movie ? c.mdblistMoviesListId : c.mdblistSeriesListId,
    mdblistSort: movie ? c.mdblistMoviesSort : c.mdblistSeriesSort,
  }
}

/** The external list in provider order (before the language filter), up to `depth` items. */
async function fetchExternalList(
  mediaType: AutoRequestMediaType,
  s: SourceSettings,
  depth: number
): Promise<ExternalListItem[]> {
  const movie = mediaType === 'movie'
  const external = s.external
  if (external === 'mdblist') {
    if (!s.mdblistListId) return []
    const { getListItems } = await import('../mdblist/index.js')
    const items = await getListItems(s.mdblistListId, { limit: depth, sort: s.mdblistSort })
    return items
      .filter((item) => item.tmdbid)
      .map((item) => ({
        tmdbId: item.tmdbid as number,
        title: item.title || 'Unknown',
        year: item.year || null,
        originalLanguage: null, // MDBList does not provide language
      }))
  }
  if (!external?.startsWith('tmdb_')) return []

  const tmdb = await import('../tmdb/index.js')
  const maxPages = Math.max(1, Math.ceil(depth / 20))
  if (movie) {
    const list =
      external === 'tmdb_popular' ? await tmdb.getPopularMoviesBatch(maxPages)
      : external === 'tmdb_trending_day' ? await tmdb.getTrendingMoviesBatch('day', maxPages)
      : external === 'tmdb_trending_week' ? await tmdb.getTrendingMoviesBatch('week', maxPages)
      : external === 'tmdb_top_rated' ? await tmdb.getTopRatedMoviesBatch(maxPages)
      : []
    return list.map((m) => ({
      tmdbId: m.id,
      title: m.title,
      year: m.release_date ? parseInt(m.release_date.split('-')[0]) : null,
      originalLanguage: m.original_language || null,
      genreIds: m.genre_ids,
      releaseDate: m.release_date || null,
    }))
  }
  const list =
    external === 'tmdb_popular' ? await tmdb.getPopularTVBatch(maxPages)
    : external === 'tmdb_trending_day' ? await tmdb.getTrendingTVBatch('day', maxPages)
    : external === 'tmdb_trending_week' ? await tmdb.getTrendingTVBatch('week', maxPages)
    : external === 'tmdb_top_rated' ? await tmdb.getTopRatedTVBatch(maxPages)
    : []
  return list.map((t) => ({
    tmdbId: t.id,
    title: t.name,
    year: t.first_air_date ? parseInt(t.first_air_date.split('-')[0]) : null,
    originalLanguage: t.original_language || null,
    genreIds: t.genre_ids,
    releaseDate: t.first_air_date || null,
    countries: Array.isArray(t.origin_country) ? t.origin_country : undefined,
  }))
}

/** The existing language filter, unchanged: it shapes the list the same way the display does. */
export function applyLanguageFilter(
  items: ExternalListItem[],
  languages: string[],
  includeUnknown: boolean
): ExternalListItem[] {
  if (languages.length === 0) return items
  return items.filter((item) => (item.originalLanguage ? languages.includes(item.originalLanguage) : includeUnknown))
}

async function libraryTmdbIds(mediaType: AutoRequestMediaType, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set()
  const table = mediaType === 'movie' ? 'movies' : 'series'
  const res = await query<{ tmdb_id: string }>(`SELECT tmdb_id FROM ${table} WHERE tmdb_id = ANY($1)`, [ids.map(String)])
  return new Set(res.rows.map((r) => Number(r.tmdb_id)))
}

async function displayScoredTitles(mediaType: AutoRequestMediaType): Promise<{
  titles: DisplayScoredTitle[]
  localWeight: number
  externalWeight: number
}> {
  if (mediaType === 'movie') {
    const d = await getHybridDisplayScoresMovies()
    const rows = await query<{ id: string; tmdb_id: string | null }>(
      `SELECT id, tmdb_id FROM movies WHERE id = ANY($1)`,
      [d.entries.map((e) => e.item.movieId)]
    )
    const tmdbById = new Map(rows.rows.map((r) => [r.id, r.tmdb_id]))
    const titles: DisplayScoredTitle[] = []
    d.entries.forEach((e, displayOrder) => {
      const tmdb = tmdbById.get(e.item.movieId)
      if (tmdb) titles.push({ tmdbId: Number(tmdb), title: e.item.title, year: e.item.year, localScore: e.localScore, externalScore: e.externalScore, displayOrder })
    })
    return { titles, localWeight: d.localWeight, externalWeight: d.externalWeight }
  }
  const d = await getHybridDisplayScoresSeries()
  const rows = await query<{ id: string; tmdb_id: string | null }>(
    `SELECT id, tmdb_id FROM series WHERE id = ANY($1)`,
    [d.entries.map((e) => e.item.seriesId)]
  )
  const tmdbById = new Map(rows.rows.map((r) => [r.id, r.tmdb_id]))
  const titles: DisplayScoredTitle[] = []
  d.entries.forEach((e, displayOrder) => {
    const tmdb = tmdbById.get(e.item.seriesId)
    if (tmdb) titles.push({ tmdbId: Number(tmdb), title: e.item.title, year: e.item.year, localScore: e.localScore, externalScore: e.externalScore, displayOrder })
  })
  return { titles, localWeight: d.localWeight, externalWeight: d.externalWeight }
}

export async function gatherRankedCandidates(
  mediaType: AutoRequestMediaType,
  config: TopPicksConfig,
  rules: AutoRequestRules
): Promise<GatheredCandidates> {
  const s = sourceSettings(mediaType, config)
  const warnings: string[] = []
  const base = { popularitySource: s.popularity, externalSource: s.external }

  if (s.popularity === 'emby_history') {
    warnings.push('The Top Picks source is local watch history only, so there are no missing titles to request.')
    return { ...base, candidates: [], rankBasis: 'external', warnings }
  }

  const fetched = await fetchExternalList(mediaType, s, rules.maxCandidates)
  const items = applyLanguageFilter(fetched, s.languages, s.includeUnknownLanguage)
  if (fetched.length === 0) warnings.push('The external list returned no titles (not configured, empty, or the provider failed).')
  logger.debug({ mediaType, fetched: fetched.length, afterLanguage: items.length }, 'External list fetched')

  const library = await libraryTmdbIds(mediaType, items.map((i) => i.tmdbId))

  const wantsBlend = rules.rankBasis === 'blended'
  if (wantsBlend && s.popularity !== 'hybrid') {
    warnings.push('Hybrid blend ranking only applies to hybrid sources; using the external list order.')
  }
  if (wantsBlend && s.popularity === 'hybrid') {
    const display = await displayScoredTitles(mediaType)
    const candidates = rankByHybridBlend({
      items,
      libraryTmdbIds: library,
      displayScored: display.titles,
      localWeight: display.localWeight,
      externalWeight: display.externalWeight,
      maxCandidates: rules.maxCandidates,
    })
    return { ...base, candidates, rankBasis: 'blended', warnings }
  }
  return { ...base, candidates: rankByExternalOrder(items, library, rules.maxCandidates), rankBasis: 'external', warnings }
}
