/**
 * Plan = the full, read-only decision for one media type: which ranked titles would be requested
 * and why every other title was skipped, excluded or left uncertain.
 *
 * The scheduled job, the manual run and the admin preview ALL build their plan here, so they run
 * the same code on the same inputs. Planning can only READ (library database, TMDB, Seerr status);
 * it has no access to anything that creates a request.
 */
import { createHash } from 'crypto'
import { getMediaStatus } from '../seerr/index.js'
import { createMetadataGetter } from './autoRequestMetadata.js'
import { effectiveTargetCount, type AutoRequestRules } from './autoRequestRules.js'
import { gatherRankedCandidates, type AutoRequestMediaType, type GatheredCandidates } from './autoRequestCandidates.js'
import {
  selectAutoRequests,
  type RankedCandidate,
  type SelectionDeps,
  type SelectionResult,
} from './autoRequestSelection.js'
import type { TopPicksConfig } from './config.js'

export type { AutoRequestMediaType } from './autoRequestCandidates.js'

export interface AutoRequestPlan {
  mediaType: AutoRequestMediaType
  generatedAt: string
  /** config.updatedAt at planning time; a plan is stale if settings changed after it */
  configVersion: string
  /** whether auto-request is switched on for this media type (a preview works either way) */
  enabled: boolean
  popularitySource: string
  externalSource: string | null
  rankBasis: GatheredCandidates['rankBasis']
  rules: AutoRequestRules
  perRunCap: number
  targetCount: number
  candidateCount: number
  result: SelectionResult
  warnings: string[]
  /** fingerprint of what this plan would request; equal ids mean "same selection" */
  planId: string
}

export interface PlanDeps {
  gather?: typeof gatherRankedCandidates
  selection?: SelectionDeps
}

/** Fingerprint of the settings version and the selected titles, in request order. */
export function computePlanId(
  mediaType: AutoRequestMediaType,
  configVersion: string,
  selectedTmdbIds: readonly number[]
): string {
  return createHash('sha256').update(`${mediaType}|${configVersion}|${selectedTmdbIds.join(',')}`).digest('hex').slice(0, 24)
}

/**
 * Seerr request lookup (read-only GET). A lookup that returns nothing is treated as "not requested",
 * which matches the long-standing behavior; the request itself is re-checked right before it is made.
 */
export function seerrReadDeps(mediaType: AutoRequestMediaType, getMetadata: SelectionDeps['getMetadata']): SelectionDeps {
  return {
    async isRequested(c: RankedCandidate) {
      const status = await getMediaStatus(c.tmdbId, mediaType)
      return status?.requested ?? false
    },
    getMetadata,
  }
}

export async function planAutoRequests(
  mediaType: AutoRequestMediaType,
  config: TopPicksConfig,
  deps: PlanDeps = {}
): Promise<AutoRequestPlan> {
  const movie = mediaType === 'movie'
  const rules = movie ? config.moviesAutoRequestRules : config.seriesAutoRequestRules
  const perRunCap = movie ? config.moviesAutoRequestLimit : config.seriesAutoRequestLimit
  const enabled = movie ? config.moviesAutoRequestEnabled : config.seriesAutoRequestEnabled

  const gathered = await (deps.gather ?? gatherRankedCandidates)(mediaType, config, rules)
  const result = await selectAutoRequests(
    gathered.candidates,
    rules,
    { perRunCap },
    deps.selection ?? seerrReadDeps(mediaType, createMetadataGetter(mediaType))
  )
  const configVersion = new Date(config.updatedAt).toISOString()
  return {
    mediaType,
    generatedAt: new Date().toISOString(),
    configVersion,
    enabled,
    popularitySource: gathered.popularitySource,
    externalSource: gathered.externalSource,
    rankBasis: gathered.rankBasis,
    rules,
    perRunCap,
    targetCount: effectiveTargetCount(rules, perRunCap),
    candidateCount: gathered.candidates.length,
    result,
    warnings: gathered.warnings,
    planId: computePlanId(mediaType, configVersion, result.selected.map((e) => e.tmdbId)),
  }
}
