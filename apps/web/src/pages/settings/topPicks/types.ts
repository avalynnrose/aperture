export type PopularitySource = 
  | 'emby_history'      // Local watch history (renamed from 'local')
  | 'tmdb_popular'      // TMDB most popular
  | 'tmdb_trending_day' // TMDB trending today
  | 'tmdb_trending_week'// TMDB trending this week
  | 'tmdb_top_rated'    // TMDB highest rated
  | 'mdblist'           // User-selected MDBList
  | 'hybrid'            // Local + one external source

// External sources that can be used in hybrid mode
export type HybridExternalSource = 
  | 'tmdb_popular'
  | 'tmdb_trending_day'
  | 'tmdb_trending_week'
  | 'tmdb_top_rated'
  | 'mdblist'

export interface AutoRequestRules {
  strategy: 'legacy' | 'strict' | 'fill' | 'chart'
  targetCount: number | null
  maxCandidates: number
  rankBasis: 'external' | 'blended'
  countries: { mode: 'exclude' | 'include'; codes: string[]; match: 'any' | 'all' }
  excludedGenreIds: number[]
  excludedKeywords: { id: number; name: string }[]
  missingMetadata: 'skip' | 'allow'
  skipUnreleased: boolean
  /** managed from the preview (X button); a normal save keeps the stored list */
  skippedTitles: { tmdbId: number; title: string }[]
}

export interface TopPicksConfig {
  isEnabled: boolean
  // Movies-specific settings
  moviesPopularitySource: PopularitySource
  moviesTimeWindowDays: number
  moviesMinUniqueViewers: number
  moviesUseAllMatches: boolean
  moviesCount: number
  moviesHybridExternalSource: HybridExternalSource
  // Series-specific settings
  seriesPopularitySource: PopularitySource
  seriesTimeWindowDays: number
  seriesMinUniqueViewers: number
  seriesUseAllMatches: boolean
  seriesCount: number
  seriesHybridExternalSource: HybridExternalSource
  // Shared weights
  uniqueViewersWeight: number
  playCountWeight: number
  completionWeight: number
  refreshCron: string
  lastRefreshedAt: string | null
  moviesLibraryName: string
  seriesLibraryName: string
  // Output format settings (separate for movies and series)
  moviesUseSymlinks: boolean
  seriesUseSymlinks: boolean
  // Movies output modes
  moviesLibraryEnabled: boolean
  moviesCollectionEnabled: boolean
  moviesPlaylistEnabled: boolean
  // Series output modes
  seriesLibraryEnabled: boolean
  seriesCollectionEnabled: boolean
  seriesPlaylistEnabled: boolean
  // Collection/Playlist names
  moviesCollectionName: string
  seriesCollectionName: string
  // MDBList list selections
  mdblistMoviesListId: number | null
  mdblistSeriesListId: number | null
  mdblistMoviesListName: string | null
  mdblistSeriesListName: string | null
  // MDBList sort order
  mdblistMoviesSort: string
  mdblistSeriesSort: string
  // Hybrid mode weights
  hybridLocalWeight: number
  hybridExternalWeight: number
  // Auto-request settings
  moviesAutoRequestEnabled: boolean
  moviesAutoRequestLimit: number
  seriesAutoRequestEnabled: boolean
  seriesAutoRequestLimit: number
  autoRequestCron: string
  // Top Picks Requester: Seerr user ID credited with automatic requests (null = Seerr default)
  autoRequestSeerrUserId: number | null
  // Seasons requested by automatic TV requests
  seriesAutoRequestSeasons: 'all' | 'first'
  // Auto-request rules (strategy, target count, content filters) per media type
  moviesAutoRequestRules: AutoRequestRules
  seriesAutoRequestRules: AutoRequestRules
  // Language filters
  moviesLanguages: string[]
  moviesIncludeUnknownLanguage: boolean
  seriesLanguages: string[]
  seriesIncludeUnknownLanguage: boolean
}

export type PreviewCountConfig = Pick<
  TopPicksConfig,
  | 'moviesPopularitySource'
  | 'moviesMinUniqueViewers'
  | 'moviesTimeWindowDays'
  | 'seriesPopularitySource'
  | 'seriesMinUniqueViewers'
  | 'seriesTimeWindowDays'
>

export interface PreviewCounts {
  movies: number
  series: number
  recommendedMoviesMinViewers: number
  recommendedSeriesMinViewers: number
}

export interface LibraryImageInfo {
  url?: string
  isDefault?: boolean
}

export interface SortOption {
  value: string
  label: string
}

export interface LibraryMatchResult {
  total: number
  matched: number
  missing: Array<{
    title: string
    year: number | null
    tmdbid?: number
    imdbid?: string
    mediatype: string
  }>
}

// Source options for dropdown
export interface SourceOption {
  value: PopularitySource
  label: string
  description: string
  icon: 'home' | 'tmdb' | 'mdblist' | 'hybrid'
  requiresMdblist?: boolean
}

// External sources for hybrid mode
export interface HybridSourceOption {
  value: HybridExternalSource
  label: string
  requiresMdblist?: boolean
}

export type TopPicksMediaType = 'movies' | 'series'

export interface MediaLibraryPreviewState {
  libraryMatch: LibraryMatchResult | null
  matchLoading: boolean
  matchExpanded: boolean
  setMatchExpanded: (expanded: boolean) => void
}

// ---- Auto-request preview (shape of POST /api/settings/top-picks/auto-request/preview) ----

export type AutoRequestDecision = 'selected' | 'skipped' | 'excluded' | 'uncertain' | 'over-cap'

export interface AutoRequestReason {
  code: string
  detail?: string
}

export interface AutoRequestPlanEntry {
  rank: number
  tmdbId: number
  title: string
  year: number | null
  inLibrary: boolean
  requested: boolean | 'unknown' | null
  decision: AutoRequestDecision
  reasons: AutoRequestReason[]
  countries: string[] | null
  genreIds: number[] | null
  matchedKeywords: { id: number; name: string }[]
  scores?: { local: number; external: number; blended: number }
  chartPosition?: number
  availability?: AutoRequestAvailability
}

export type AutoRequestAvailability = 'in-library' | 'requested' | 'will-request' | 'over-cap'

export interface AutoRequestChartSummary {
  size: number
  inLibrary: number
  alreadyRequested: number
  willRequest: number
  overCap: number
  short: boolean
}

export interface AutoRequestPlanSummary {
  strategy: AutoRequestRules['strategy'] | 'legacy'
  targetCount: number
  perRunCap: number
  windowSize: number
  evaluated: number
  notEvaluated: number
  exhausted: boolean
  depthCapped: boolean
  selected: number
  skipped: number
  excluded: number
  uncertain: number
  overCap: number
  chart?: AutoRequestChartSummary
}

export interface AutoRequestPlanView {
  mediaType: 'movie' | 'tv'
  generatedAt: string
  enabled: boolean
  popularitySource: string
  externalSource: string | null
  rankBasis: 'external' | 'blended'
  perRunCap: number
  targetCount: number
  candidateCount: number
  warnings: string[]
  planId: string
  rules: AutoRequestRules
  result: { entries: AutoRequestPlanEntry[]; summary: AutoRequestPlanSummary }
}

export interface AutoRequestPreviewResponse {
  generatedAt: string
  staleAfterSeconds: number
  plans: AutoRequestPlanView[]
}
