/**
 * TMDB metadata for auto-request filters: genres, origin countries and TMDB keywords.
 *
 * One request per title (`/movie|tv/{id}?append_to_response=keywords`). The outcome is tri-state:
 *   ok         - the lookup worked; individual fields are `undefined` when TMDB did not return them
 *   not-found  - TMDB has no such title (HTTP 404)
 *   error      - the lookup failed (network, rate limit, HTTP error, missing API key)
 * A failed lookup is never turned into a match or a non-match; the selection engine reports such
 * titles as uncertain and does not request them.
 *
 * Results are kept in memory only (no database writes, so the admin preview stays read-only).
 */
import { tmdbRequest } from '../tmdb/index.js'
import type { KeywordRef } from './autoRequestRules.js'
import type { AutoRequestMediaType } from './autoRequestCandidates.js'
import type { SelectionDeps, TitleMetadata } from './autoRequestSelection.js'

interface RawMovie {
  genres?: { id: number }[]
  production_countries?: { iso_3166_1: string }[]
  keywords?: { keywords?: { id: number; name: string }[] }
}
interface RawTv {
  genres?: { id: number }[]
  origin_country?: string[]
  production_countries?: { iso_3166_1: string }[]
  keywords?: { results?: { id: number; name: string }[] }
}

/** Parse a TMDB movie details response (with keywords appended). Missing sections stay undefined. */
export function parseMovieMetadata(raw: RawMovie): Extract<TitleMetadata, { status: 'ok' }> {
  return {
    status: 'ok',
    genreIds: raw.genres?.map((g) => g.id),
    countries: raw.production_countries?.map((c) => c.iso_3166_1.toUpperCase()),
    keywords: raw.keywords?.keywords?.map((k): KeywordRef => ({ id: k.id, name: k.name })),
  }
}

/**
 * Parse a TMDB TV details response. TV keywords live under `keywords.results` (movies use
 * `keywords.keywords`). Origin countries come from `origin_country`, falling back to production countries.
 */
export function parseTvMetadata(raw: RawTv): Extract<TitleMetadata, { status: 'ok' }> {
  const countries =
    raw.origin_country?.map((c) => c.toUpperCase()) ??
    raw.production_countries?.map((c) => c.iso_3166_1.toUpperCase())
  return {
    status: 'ok',
    genreIds: raw.genres?.map((g) => g.id),
    countries,
    keywords: raw.keywords?.results?.map((k): KeywordRef => ({ id: k.id, name: k.name })),
  }
}

export type RawLookup = (endpoint: string) => Promise<{ outcome: 'ok'; data: unknown } | { outcome: 'not-found' } | { outcome: 'error'; message: string }>

/** Default lookup: the existing rate-limited TMDB client, with its log hook used to tell 404 from failure. */
export const tmdbLookup: RawLookup = async (endpoint) => {
  let last: 'success' | 'error' | 'not_found' | null = null
  let detail = ''
  const data = await tmdbRequest<unknown>(endpoint, {
    onLog: (_service, _endpoint, status, details) => {
      last = status
      if (details) detail = details
    },
  })
  if (data !== null && data !== undefined) return { outcome: 'ok', data }
  if (last === 'not_found') return { outcome: 'not-found' }
  return { outcome: 'error', message: detail || (last === null ? 'TMDB API key not configured or request not sent' : 'request failed') }
}

export interface MetadataCacheOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

/** Small in-memory TTL cache with in-flight de-duplication. Errors are never cached. */
export class TitleMetadataCache {
  private entries = new Map<string, { at: number; value: TitleMetadata }>()
  private inflight = new Map<string, Promise<TitleMetadata>>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(opts: MetadataCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000
    this.maxEntries = opts.maxEntries ?? 2000
    this.now = opts.now ?? Date.now
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
    this.inflight.clear()
  }

  async get(key: string, load: () => Promise<TitleMetadata>): Promise<TitleMetadata> {
    const hit = this.entries.get(key)
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value
    const pending = this.inflight.get(key)
    if (pending) return pending
    const p = load()
      .then((value) => {
        if (value.status !== 'error') {
          if (this.entries.size >= this.maxEntries) {
            const oldest = this.entries.keys().next().value
            if (oldest !== undefined) this.entries.delete(oldest)
          }
          this.entries.set(key, { at: this.now(), value })
        }
        return value
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }
}

const sharedCache = new TitleMetadataCache()

/** Drop all cached lookups (tests, or after changing the TMDB key). */
export function clearTitleMetadataCache(): void {
  sharedCache.clear()
}

export async function fetchTitleMetadata(
  mediaType: AutoRequestMediaType,
  tmdbId: number,
  lookup: RawLookup = tmdbLookup
): Promise<TitleMetadata> {
  const path = mediaType === 'movie' ? 'movie' : 'tv'
  const r = await lookup(`/${path}/${tmdbId}?append_to_response=keywords`)
  if (r.outcome === 'not-found') return { status: 'not-found' }
  if (r.outcome === 'error') return { status: 'error', message: r.message }
  try {
    return mediaType === 'movie' ? parseMovieMetadata(r.data as RawMovie) : parseTvMetadata(r.data as RawTv)
  } catch (err) {
    return { status: 'error', message: `unexpected TMDB response: ${err instanceof Error ? err.message : 'unknown'}` }
  }
}

/** Metadata lookup for the selection engine, cached for the life of the process. */
export function createMetadataGetter(
  mediaType: AutoRequestMediaType,
  options: { cache?: TitleMetadataCache; lookup?: RawLookup } = {}
): SelectionDeps['getMetadata'] {
  const cache = options.cache ?? sharedCache
  return (c) => cache.get(`${mediaType}:${c.tmdbId}`, () => fetchTitleMetadata(mediaType, c.tmdbId, options.lookup))
}

export type KeywordSearchResult =
  | { ok: true; results: KeywordRef[] }
  | { ok: false; reason: 'error'; message: string }

/** Search TMDB keywords by text for the keyword picker. TMDB keywords are not Emby tags. */
export async function searchTmdbKeywords(query: string, lookup: RawLookup = tmdbLookup): Promise<KeywordSearchResult> {
  const q = query.trim()
  if (q.length < 2) return { ok: true, results: [] }
  const r = await lookup(`/search/keyword?query=${encodeURIComponent(q)}&page=1`)
  if (r.outcome === 'error') return { ok: false, reason: 'error', message: r.message }
  if (r.outcome === 'not-found') return { ok: true, results: [] }
  const raw = (r.data as { results?: { id: number; name: string }[] }).results ?? []
  return { ok: true, results: raw.slice(0, 20).map((k) => ({ id: k.id, name: k.name })) }
}
