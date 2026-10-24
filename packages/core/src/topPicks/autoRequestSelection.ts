/**
 * The one selection engine for automatic Top Picks requests. Both the read-only preview and the
 * real job call selectAutoRequests() with the same inputs, so they cannot disagree.
 *
 * It is free of I/O: library status comes from the candidates, and Seerr request status and TMDB
 * metadata arrive through injected async lookups (fakes in tests, read-only clients in production).
 * Nothing here can create a request.
 */
import type { AutoRequestRules, KeywordRef } from './autoRequestRules.js'
import { effectiveTargetCount } from './autoRequestRules.js'

export interface RankedCandidate {
  tmdbId: number
  title: string
  year: number | null
  /** 1-based position in the ranked list (the "original rank" shown in preview and logs) */
  rank: number
  /** already in the media library */
  inLibrary: boolean
  /** genre ids known from list data; undefined = not known without a details lookup */
  genreIds?: number[]
  /** origin country codes known from list data (TV); undefined = need a details lookup */
  countries?: string[]
  originalLanguage?: string | null
  /** YYYY-MM-DD release date (movie) or first air date (TV) known from list data; undefined = need a details lookup */
  releaseDate?: string | null
  /** hybrid score components when the blended ranking is used (for display) */
  scores?: { local: number; external: number; blended: number }
}

export type TitleMetadata =
  | { status: 'ok'; genreIds?: number[]; countries?: string[]; keywords?: KeywordRef[]; releaseDate?: string | null }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

export interface SelectionDeps {
  /** true/false, or 'unknown' when Seerr could not be asked (never treated as "not requested") */
  isRequested(c: RankedCandidate): Promise<boolean | 'unknown'>
  getMetadata(c: RankedCandidate): Promise<TitleMetadata>
}

export type Decision =
  | 'selected' //   will be requested
  | 'skipped' //    already in library, already requested, or a duplicate
  | 'excluded' //   matched a content filter (country, genre, keyword)
  | 'uncertain' //  could not be verified; never requested
  | 'over-cap' //   eligible, but the per-run request cap was reached

export interface Reason {
  code:
    | 'duplicate'
    | 'in-library'
    | 'already-requested'
    | 'requested-unknown'
    | 'country-excluded'
    | 'country-not-included'
    | 'genre-excluded'
    | 'keyword-excluded'
    | 'not-released'
    | 'manually-skipped'
    | 'metadata-unavailable'
    | 'metadata-missing'
    | 'cap-reached'
  detail?: string
}

export interface PlanEntry {
  rank: number
  tmdbId: number
  title: string
  year: number | null
  inLibrary: boolean
  requested: boolean | 'unknown' | null
  decision: Decision
  reasons: Reason[]
  countries: string[] | null
  genreIds: number[] | null
  matchedKeywords: KeywordRef[]
  scores?: RankedCandidate['scores']
  /** chart strategy: 1-based place in the final chart; undefined for titles that take no slot */
  chartPosition?: number
  /** chart strategy: what the title needs; undefined outside the chart */
  availability?: ChartAvailability
}

export type ChartAvailability = 'in-library' | 'requested' | 'will-request' | 'over-cap'

export interface ChartSummary {
  size: number
  inLibrary: number
  alreadyRequested: number
  willRequest: number
  overCap: number
  /** fewer than N eligible titles were found */
  short: boolean
}

export interface SelectionSummary {
  strategy: AutoRequestRules['strategy']
  targetCount: number
  perRunCap: number
  windowSize: number
  evaluated: number
  /** window entries never examined because the target was reached first */
  notEvaluated: number
  /** fill: every ranked title was examined and the target still was not reached */
  exhausted: boolean
  /** fill: stopped at the depth cap (maxCandidates) before reaching the target */
  depthCapped: boolean
  selected: number
  skipped: number
  excluded: number
  uncertain: number
  overCap: number
  chart?: ChartSummary
}

export interface SelectionResult {
  entries: PlanEntry[]
  selected: PlanEntry[]
  summary: SelectionSummary
}

function rulesActiveForGenres(rules: AutoRequestRules) {
  return rules.excludedGenreIds.length > 0
}
function rulesActiveForCountries(rules: AutoRequestRules) {
  return rules.countries.codes.length > 0
}
function rulesActiveForKeywords(rules: AutoRequestRules) {
  return rules.excludedKeywords.length > 0
}

/** Evaluate the content filters for one candidate once its metadata is known. Pure. */
export function evaluateFilters(
  candidate: Pick<RankedCandidate, 'genreIds' | 'countries' | 'releaseDate'>,
  metadata: TitleMetadata | null,
  rules: AutoRequestRules,
  today: string = todayUtc()
): {
  excluded: Reason[]
  uncertain: Reason[]
  countries: string[] | null
  genreIds: number[] | null
  matchedKeywords: KeywordRef[]
} {
  const excluded: Reason[] = []
  const uncertain: Reason[] = []
  const okMeta = metadata?.status === 'ok' ? metadata : null
  const failed = metadata !== null && metadata.status !== 'ok'

  const genreIds = candidate.genreIds ?? okMeta?.genreIds ?? null
  const countries = candidate.countries ?? okMeta?.countries ?? null
  const matchedKeywords: KeywordRef[] = []

  const unavailable = (field: string) =>
    uncertain.push({ code: 'metadata-unavailable', detail: field })
  const missing = (field: string) => {
    if (rules.missingMetadata === 'skip') uncertain.push({ code: 'metadata-missing', detail: field })
  }

  // Genres
  if (rulesActiveForGenres(rules)) {
    if (genreIds === null) {
      if (failed) unavailable('genres')
      else missing('genres')
    } else if (genreIds.length === 0) {
      missing('genres')
    } else {
      for (const id of genreIds) {
        if (rules.excludedGenreIds.includes(id)) excluded.push({ code: 'genre-excluded', detail: String(id) })
      }
    }
  }

  // Countries (origin countries; never the original language)
  if (rulesActiveForCountries(rules)) {
    if (countries === null) {
      if (failed) unavailable('countries')
      else missing('countries')
    } else if (countries.length === 0) {
      missing('countries')
    } else {
      const wanted = new Set(rules.countries.codes)
      const hits = countries.filter((c) => wanted.has(c.toUpperCase()))
      const matches = rules.countries.match === 'any' ? hits.length > 0 : hits.length === countries.length
      if (rules.countries.mode === 'exclude' && matches) {
        for (const c of hits) excluded.push({ code: 'country-excluded', detail: c.toUpperCase() })
      } else if (rules.countries.mode === 'include' && !matches) {
        excluded.push({ code: 'country-not-included', detail: countries.map((c) => c.toUpperCase()).join(',') })
      }
    }
  }

  // Release date: a title is released once its date is today or earlier (UTC date, YYYY-MM-DD).
  if (rules.skipUnreleased) {
    const date = normalizeDate(candidate.releaseDate !== undefined ? candidate.releaseDate : okMeta?.releaseDate)
    if (date === undefined) {
      if (failed) unavailable('release date')
      else missing('release date')
    } else if (date === null) {
      missing('release date')
    } else if (date > today) {
      excluded.push({ code: 'not-released', detail: date })
    }
  }

  // Keywords (TMDB keywords; an empty list is a valid answer, a failed lookup is not)
  if (rulesActiveForKeywords(rules)) {
    const kws = okMeta?.keywords
    if (kws === undefined) {
      if (failed) unavailable('keywords')
      else missing('keywords')
    } else {
      const wanted = new Map(rules.excludedKeywords.map((k) => [k.id, k.name]))
      for (const k of kws) {
        if (wanted.has(k.id)) {
          matchedKeywords.push({ id: k.id, name: wanted.get(k.id) ?? k.name })
          excluded.push({ code: 'keyword-excluded', detail: k.name })
        }
      }
    }
  }

  return { excluded, uncertain, countries, genreIds, matchedKeywords }
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** undefined = not known (needs a lookup); null = known to be missing/unusable; else YYYY-MM-DD. */
function normalizeDate(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
  return m ? m[1] : null
}

function needsMetadata(c: RankedCandidate, rules: AutoRequestRules): boolean {
  return (
    (rules.skipUnreleased && c.releaseDate === undefined) ||
    (rulesActiveForGenres(rules) && c.genreIds === undefined) ||
    (rulesActiveForCountries(rules) && c.countries === undefined) ||
    rulesActiveForKeywords(rules)
  )
}

export async function selectAutoRequests(
  ranked: readonly RankedCandidate[],
  rules: AutoRequestRules,
  limits: { perRunCap: number; now?: Date },
  deps: SelectionDeps
): Promise<SelectionResult> {
  if (rules.strategy === 'chart') return selectTopNEligible(ranked, rules, limits, deps)
  const today = todayUtc(limits.now)
  const perRunCap = Math.max(0, Math.floor(limits.perRunCap))
  const target = effectiveTargetCount(rules, perRunCap)
  const windowSize =
    rules.strategy === 'strict'
      ? Math.min(target, ranked.length)
      : Math.min(rules.maxCandidates, ranked.length)
  // Fill/legacy stop as soon as enough titles are found to satisfy the target and the cap.
  const stopAt = Math.min(target, perRunCap)

  const entries: PlanEntry[] = []
  const seen = new Set<number>()
  const skipped = new Set(rules.skippedTitles.map((t) => t.tmdbId))
  let eligible = 0
  let evaluated = 0
  // legacy: slots used by titles we will request plus titles already requested in Seerr
  let slots = 0

  for (let i = 0; i < windowSize; i++) {
    if (rules.strategy === 'fill' && eligible >= stopAt) break
    if (rules.strategy === 'legacy' && slots >= stopAt) break
    const c = ranked[i]
    evaluated++
    const base = {
      rank: c.rank,
      tmdbId: c.tmdbId,
      title: c.title,
      year: c.year,
      inLibrary: c.inLibrary,
      scores: c.scores,
    }
    const finish = (
      decision: Decision,
      reasons: Reason[],
      extra: Partial<PlanEntry> = {}
    ) =>
      entries.push({
        ...base,
        requested: null,
        countries: c.countries ?? null,
        genreIds: c.genreIds ?? null,
        matchedKeywords: [],
        decision,
        reasons,
        ...extra,
      })

    if (seen.has(c.tmdbId)) {
      finish('skipped', [{ code: 'duplicate' }])
      continue
    }
    seen.add(c.tmdbId)

    if (skipped.has(c.tmdbId)) {
      finish('excluded', [{ code: 'manually-skipped' }])
      continue
    }

    if (c.inLibrary) {
      finish('skipped', [{ code: 'in-library' }])
      continue
    }

    const requested = await deps.isRequested(c)
    if (requested === true) {
      finish('skipped', [{ code: 'already-requested' }], { requested: true })
      slots++
      continue
    }
    if (requested === 'unknown') {
      finish('uncertain', [{ code: 'requested-unknown' }], { requested: 'unknown' })
      continue
    }

    const metadata = needsMetadata(c, rules) ? await deps.getMetadata(c) : null
    const f = evaluateFilters(c, metadata, rules, today)
    const common = {
      requested: false as const,
      countries: f.countries,
      genreIds: f.genreIds,
      matchedKeywords: f.matchedKeywords,
    }
    if (f.excluded.length > 0) {
      finish('excluded', [...f.excluded, ...f.uncertain], common)
      continue
    }
    if (f.uncertain.length > 0) {
      finish('uncertain', f.uncertain, common)
      continue
    }

    eligible++
    slots++
    if (eligible <= perRunCap) finish('selected', [], common)
    else finish('over-cap', [{ code: 'cap-reached' }], common)
  }

  const count = (d: Decision) => entries.filter((e) => e.decision === d).length
  const selected = entries.filter((e) => e.decision === 'selected')
  return {
    entries,
    selected,
    summary: {
      strategy: rules.strategy,
      targetCount: target,
      perRunCap,
      windowSize,
      evaluated,
      notEvaluated: windowSize - evaluated,
      selected: selected.length,
      skipped: count('skipped'),
      excluded: count('excluded'),
      uncertain: count('uncertain'),
      overCap: count('over-cap'),
      exhausted:
        rules.strategy !== 'strict' &&
        (rules.strategy === 'fill' ? eligible : slots) < stopAt &&
        evaluated === ranked.length &&
        ranked.length < rules.maxCandidates,
      depthCapped:
        rules.strategy !== 'strict' &&
        (rules.strategy === 'fill' ? eligible : slots) < stopAt &&
        evaluated >= rules.maxCandidates,
    },
  }
}

/**
 * "Top N Eligible": build a chart of the first N ranked titles that pass every filter.
 *
 * Titles keep their source rank. A title that is already in the library, or already requested in
 * Seerr, holds its chart place without producing a request; an eligible missing title is requested
 * (subject to the per-run cap). Excluded and unreleased titles take no place. A title whose
 * eligibility or request status cannot be verified takes no place either and is never requested.
 * The walk stops at the Nth eligible title or at the depth cap, so requests are never generated
 * just to reach N.
 *
 * Filters run before the library and request checks so that excluded titles cost no Seerr call and
 * owned titles are held to the same rules as everything else.
 */
async function selectTopNEligible(
  ranked: readonly RankedCandidate[],
  rules: AutoRequestRules,
  limits: { perRunCap: number; now?: Date },
  deps: SelectionDeps
): Promise<SelectionResult> {
  const perRunCap = Math.max(0, Math.floor(limits.perRunCap))
  const target = effectiveTargetCount(rules, perRunCap)
  const today = todayUtc(limits.now)
  const windowSize = Math.min(rules.maxCandidates, ranked.length)

  const entries: PlanEntry[] = []
  const seen = new Set<number>()
  const skipped = new Set(rules.skippedTitles.map((t) => t.tmdbId))
  let chartSize = 0
  let toRequest = 0
  let evaluated = 0

  for (let i = 0; i < windowSize && chartSize < target; i++) {
    const c = ranked[i]
    evaluated++
    const base = {
      rank: c.rank,
      tmdbId: c.tmdbId,
      title: c.title,
      year: c.year,
      inLibrary: c.inLibrary,
      scores: c.scores,
    }
    const finish = (decision: Decision, reasons: Reason[], extra: Partial<PlanEntry> = {}) =>
      entries.push({
        ...base,
        requested: null,
        countries: c.countries ?? null,
        genreIds: c.genreIds ?? null,
        matchedKeywords: [],
        decision,
        reasons,
        ...extra,
      })

    if (seen.has(c.tmdbId)) {
      finish('skipped', [{ code: 'duplicate' }])
      continue
    }
    seen.add(c.tmdbId)

    if (skipped.has(c.tmdbId)) {
      finish('excluded', [{ code: 'manually-skipped' }])
      continue
    }

    const metadata = needsMetadata(c, rules) ? await deps.getMetadata(c) : null
    const f = evaluateFilters(c, metadata, rules, today)
    const common = {
      countries: f.countries,
      genreIds: f.genreIds,
      matchedKeywords: f.matchedKeywords,
    }
    if (f.excluded.length > 0) {
      finish('excluded', [...f.excluded, ...f.uncertain], common)
      continue
    }
    if (f.uncertain.length > 0) {
      finish('uncertain', f.uncertain, common)
      continue
    }

    const place = () => {
      chartSize++
      return { ...common, chartPosition: chartSize }
    }

    if (c.inLibrary) {
      finish('skipped', [{ code: 'in-library' }], { ...place(), availability: 'in-library' })
      continue
    }

    const requested = await deps.isRequested(c)
    if (requested === 'unknown') {
      finish('uncertain', [{ code: 'requested-unknown' }], { ...common, requested: 'unknown' })
      continue
    }
    if (requested === true) {
      finish('skipped', [{ code: 'already-requested' }], { ...place(), requested: true, availability: 'requested' })
      continue
    }

    toRequest++
    if (toRequest <= perRunCap) {
      finish('selected', [], { ...place(), requested: false, availability: 'will-request' })
    } else {
      finish('over-cap', [{ code: 'cap-reached' }], { ...place(), requested: false, availability: 'over-cap' })
    }
  }

  const count = (d: Decision) => entries.filter((e) => e.decision === d).length
  const countAvail = (a: ChartAvailability) => entries.filter((e) => e.availability === a).length
  const selected = entries.filter((e) => e.decision === 'selected')
  const short = chartSize < target
  return {
    entries,
    selected,
    summary: {
      strategy: rules.strategy,
      targetCount: target,
      perRunCap,
      windowSize,
      evaluated,
      notEvaluated: windowSize - evaluated,
      selected: selected.length,
      skipped: count('skipped'),
      excluded: count('excluded'),
      uncertain: count('uncertain'),
      overCap: count('over-cap'),
      exhausted: short && evaluated === ranked.length && ranked.length < rules.maxCandidates,
      depthCapped: short && evaluated >= rules.maxCandidates,
      chart: {
        size: chartSize,
        inLibrary: countAvail('in-library'),
        alreadyRequested: countAvail('requested'),
        willRequest: countAvail('will-request'),
        overCap: countAvail('over-cap'),
        short,
      },
    },
  }
}
