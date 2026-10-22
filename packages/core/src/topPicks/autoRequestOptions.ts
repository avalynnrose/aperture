/**
 * Pure helpers for automatic Top Picks requests: who is credited as the requester
 * and which seasons a TV request asks for. No I/O, so they are unit-testable.
 */
import type { SeriesAutoRequestSeasons } from './config.js'

export type RequesterResolution =
  /** No requester configured: send no user id (original upstream behavior). */
  | { status: 'default' }
  /** Configured user exists in Seerr. */
  | { status: 'ok'; userId: number }
  /** Seerr returned users but the configured one is not among them (deleted). */
  | { status: 'missing'; userId: number }
  /** Seerr returned no users (unreachable or error); the configured user cannot be verified. */
  | { status: 'unverified'; userId: number }

/**
 * Decide how to attribute automatic requests. Never substitutes a different account:
 * a configured but missing/unverifiable user yields a non-ok status the caller must act on.
 */
export function resolveRequester(
  configuredUserId: number | null | undefined,
  seerrUsers: ReadonlyArray<{ id: number }>
): RequesterResolution {
  if (configuredUserId === null || configuredUserId === undefined) {
    return { status: 'default' }
  }
  if (seerrUsers.length === 0) {
    return { status: 'unverified', userId: configuredUserId }
  }
  return seerrUsers.some((u) => u.id === configuredUserId)
    ? { status: 'ok', userId: configuredUserId }
    : { status: 'missing', userId: configuredUserId }
}

export interface AutoRequestCreateOptions {
  userId?: number
  seasons?: number[]
}

/**
 * Options passed to createRequest for an automatic request.
 * - userId applies to movies and TV alike (only when a requester is configured).
 * - seasons applies to TV only: 'first' requests season 1; 'all' passes nothing so
 *   the Seerr provider requests every season (original upstream behavior).
 */
export function buildAutoRequestOptions(
  mediaType: 'movie' | 'tv',
  settings: { requesterUserId: number | null; seriesSeasons: SeriesAutoRequestSeasons }
): AutoRequestCreateOptions {
  const options: AutoRequestCreateOptions = {}
  if (settings.requesterUserId !== null) {
    options.userId = settings.requesterUserId
  }
  if (mediaType === 'tv' && settings.seriesSeasons === 'first') {
    options.seasons = [1]
  }
  return options
}
