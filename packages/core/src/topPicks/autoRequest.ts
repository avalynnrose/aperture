/**
 * Top Picks Auto-Request Job
 *
 * Automatically requests missing Top Picks content via Seerr.
 *
 * Which titles are requested is decided by the shared plan (autoRequestPlan.ts), the same code the
 * admin preview uses. This file only runs a plan: it re-checks each title's request status right
 * before requesting it and creates the requests.
 */

import { createChildLogger } from '../lib/logger.js'
import { randomUUID } from 'crypto'
import {
  createJobProgress,
  setJobStep,
  addLog,
  completeJob,
  failJob,
} from '../jobs/progress.js'
import { getTopPicksConfig } from './config.js'
import {
  isSeerrConfigured,
  createRequest,
  listAllSeerrUsers,
  getMediaStatus,
} from '../seerr/index.js'
import { buildAutoRequestOptions, resolveRequester } from './autoRequestOptions.js'
import {
  planAutoRequests,
  type AutoRequestMediaType,
  type AutoRequestPlan,
} from './autoRequestPlan.js'
import type { PlanEntry } from './autoRequestSelection.js'

const logger = createChildLogger('top-picks-auto-request')

export interface AutoRequestResult {
  moviesRequested: number
  seriesRequested: number
  moviesSkipped: number
  seriesSkipped: number
  errors: string[]
  jobId: string
}

export interface RunAutoRequestOptions {
  /** Plans the caller already built and verified (manual run after a confirmed preview). */
  plans?: Partial<Record<AutoRequestMediaType, AutoRequestPlan>>
}

const MAX_LOGGED_ENTRIES = 60

function describeEntry(e: PlanEntry): string {
  const reasons = e.reasons.map((r) => (r.detail ? `${r.code}:${r.detail}` : r.code)).join(', ')
  const year = e.year ? ` (${e.year})` : ''
  return `#${e.rank} "${e.title}"${year} -> ${e.decision}${reasons ? ` [${reasons}]` : ''}`
}

/** Log the plan so a run can be audited afterwards: every ranked title with its original rank. */
function logPlan(jobId: string, label: string, plan: AutoRequestPlan): void {
  const s = plan.result.summary
  addLog(
    jobId,
    'info',
    `📋 ${label} plan: strategy ${s.strategy}, target ${s.targetCount}, cap ${s.perRunCap}, rank basis ${plan.rankBasis}; ` +
      `evaluated ${s.evaluated}, selected ${s.selected}, skipped ${s.skipped}, excluded ${s.excluded}, uncertain ${s.uncertain}, over cap ${s.overCap}` +
      (s.chart
        ? `; chart ${s.chart.size}/${s.targetCount} (in library ${s.chart.inLibrary}, already requested ${s.chart.alreadyRequested}, to request ${s.chart.willRequest}, over cap ${s.chart.overCap})`
        : '') +
      (s.exhausted ? ' (ranking exhausted before reaching the target)' : '') +
      (s.depthCapped ? ' (depth cap reached before reaching the target)' : '')
  )
  for (const w of plan.warnings) addLog(jobId, 'warn', `⚠️ ${w}`)
  const interesting = plan.result.entries.filter((e) => e.decision !== 'skipped')
  for (const e of interesting.slice(0, MAX_LOGGED_ENTRIES)) {
    addLog(jobId, e.decision === 'uncertain' ? 'warn' : 'info', `   ${describeEntry(e)}`)
  }
  if (interesting.length > MAX_LOGGED_ENTRIES) {
    addLog(jobId, 'info', `   ... and ${interesting.length - MAX_LOGGED_ENTRIES} more`)
  }
}

interface RequestSettings {
  requesterUserId: number | null
  seriesSeasons: 'all' | 'first'
}

/** Create the requests for a plan's selected titles. This is the only place requests are made. */
async function executePlan(
  jobId: string,
  plan: AutoRequestPlan,
  settings: RequestSettings,
  tally: { requested: number; skipped: number },
  errors: string[]
): Promise<void> {
  const label = plan.mediaType === 'movie' ? 'Movie' : 'Series'
  for (const entry of plan.result.selected) {
    try {
      // Re-check right before requesting; the request state can change after planning.
      const status = await getMediaStatus(entry.tmdbId, plan.mediaType)
      if (status?.requested) {
        addLog(jobId, 'info', `⏭️ "${entry.title}" already requested`)
        tally.skipped++
        continue
      }

      const requestResult = await createRequest(
        entry.tmdbId,
        plan.mediaType,
        buildAutoRequestOptions(plan.mediaType, settings)
      )
      if (requestResult.success) {
        addLog(jobId, 'info', `✅ Requested "${entry.title}" (${entry.year}) [rank #${entry.rank}]`)
        tally.requested++
      } else {
        addLog(jobId, 'warn', `⚠️ Failed to request "${entry.title}": ${requestResult.message}`)
        tally.skipped++
      }

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      addLog(jobId, 'error', `❌ Error requesting "${entry.title}": ${error}`)
      errors.push(`${label} "${entry.title}": ${error}`)
    }
  }
}

/**
 * Run the auto-request job
 */
export async function runAutoRequestJob(
  existingJobId?: string,
  options: RunAutoRequestOptions = {}
): Promise<AutoRequestResult> {
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, 'auto-request-top-picks', 5)

  const result: AutoRequestResult = {
    moviesRequested: 0,
    seriesRequested: 0,
    moviesSkipped: 0,
    seriesSkipped: 0,
    errors: [],
    jobId,
  }

  try {
    // Step 1: Check configuration
    setJobStep(jobId, 0, 'Checking configuration')

    const config = await getTopPicksConfig()

    if (!config.moviesAutoRequestEnabled && !config.seriesAutoRequestEnabled) {
      addLog(jobId, 'info', '⏭️ Auto-request is disabled for both movies and series')
      completeJob(jobId, { ...result })
      return result
    }

    // Check Seerr configuration
    const seerrConfigured = await isSeerrConfigured()
    if (!seerrConfigured) {
      addLog(jobId, 'warn', '⚠️ Seerr is not configured - cannot auto-request')
      completeJob(jobId, { ...result })
      return result
    }

    // Resolve the configured requester (Top Picks Requester setting) before requesting anything.
    // A deleted or unverifiable user stops the job; we never fall back to another account.
    const requester = resolveRequester(
      config.autoRequestSeerrUserId,
      config.autoRequestSeerrUserId === null ? [] : await listAllSeerrUsers()
    )
    if (requester.status === 'missing' || requester.status === 'unverified') {
      const reason =
        requester.status === 'missing'
          ? `The configured Top Picks Requester (Seerr user ID ${requester.userId}) no longer exists in Seerr. Choose another requester in Top Picks settings.`
          : `Could not verify the configured Top Picks Requester (Seerr user ID ${requester.userId}) because Seerr returned no users. No requests were made.`
      addLog(jobId, 'error', `❌ ${reason}`)
      result.errors.push(reason)
      failJob(jobId, reason)
      return result
    }
    const requestSettings: RequestSettings = {
      requesterUserId: requester.status === 'ok' ? requester.userId : null,
      seriesSeasons: config.seriesAutoRequestSeasons,
    }

    addLog(jobId, 'info', '✅ Configuration loaded')
    addLog(jobId, 'info', requester.status === 'ok'
      ? `👤 Requests credited to Seerr user ID ${requester.userId}`
      : '👤 No Top Picks Requester set - Seerr default account is used')
    addLog(jobId, 'info', `📺 TV seasons requested: ${config.seriesAutoRequestSeasons === 'first' ? 'season 1 only' : 'all seasons'}`)
    addLog(jobId, 'info', `🎬 Movies auto-request: ${config.moviesAutoRequestEnabled ? `enabled (limit: ${config.moviesAutoRequestLimit})` : 'disabled'}`)
    addLog(jobId, 'info', `📺 Series auto-request: ${config.seriesAutoRequestEnabled ? `enabled (limit: ${config.seriesAutoRequestLimit})` : 'disabled'}`)

    // Steps 2-3: movies
    setJobStep(jobId, 1, 'Finding missing movies')
    if (config.moviesAutoRequestEnabled) {
      addLog(jobId, 'info', '🔍 Planning movie requests from the Top Picks source...')
      const plan = options.plans?.movie ?? (await planAutoRequests('movie', config))
      logPlan(jobId, 'Movies', plan)
      setJobStep(jobId, 2, 'Requesting movies')
      const tally = { requested: 0, skipped: 0 }
      await executePlan(jobId, plan, requestSettings, tally, result.errors)
      result.moviesRequested = tally.requested
      result.moviesSkipped = tally.skipped
    }

    // Steps 4-5: series
    setJobStep(jobId, 3, 'Finding missing series')
    if (config.seriesAutoRequestEnabled) {
      addLog(jobId, 'info', '🔍 Planning series requests from the Top Picks source...')
      const plan = options.plans?.tv ?? (await planAutoRequests('tv', config))
      logPlan(jobId, 'Series', plan)
      setJobStep(jobId, 4, 'Requesting series')
      const tally = { requested: 0, skipped: 0 }
      await executePlan(jobId, plan, requestSettings, tally, result.errors)
      result.seriesRequested = tally.requested
      result.seriesSkipped = tally.skipped
    }

    // Complete
    completeJob(jobId, { ...result })
    addLog(jobId, 'info', `🎉 Auto-request complete: ${result.moviesRequested} movies, ${result.seriesRequested} series requested`)
    if (result.moviesSkipped + result.seriesSkipped > 0) {
      addLog(jobId, 'info', `⏭️ Skipped: ${result.moviesSkipped} movies, ${result.seriesSkipped} series (already requested or failed)`)
    }

    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    failJob(jobId, error)
    logger.error({ err }, 'Auto-request job failed')
    throw err
  }
}
