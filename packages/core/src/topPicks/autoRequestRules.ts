/**
 * Auto-request rules: per-media-type settings that decide which Top Picks titles are requested
 * automatically. These apply ONLY to automatic requests; they never change the displayed Top Picks.
 *
 * Stored as JSON on the top_picks_config row; an empty object means "all defaults", which
 * reproduces the behavior from before these rules existed (see DEFAULT_AUTO_REQUEST_RULES).
 */
import { z } from 'zod'

export type SelectionStrategy = 'legacy' | 'strict' | 'fill'
export type RankBasis = 'external' | 'blended'
export type CountryMode = 'exclude' | 'include'
export type CountryMatch = 'any' | 'all'
export type MissingMetadataPolicy = 'skip' | 'allow'

export interface KeywordRef {
  /** TMDB keyword id (not an Emby tag) */
  id: number
  name: string
}

export interface AutoRequestRules {
  /**
   * legacy: the behavior from before these rules existed and the default. Take the first N titles
   *         that are missing from the library; titles already requested in Seerr use up a slot and
   *         are skipped WITHOUT being replaced.
   * strict: only the first N ranked titles are evaluated (requests may be fewer than N, even zero).
   * fill:   keep walking down the ranking until N eligible titles are found or the depth cap is hit.
   */
  strategy: SelectionStrategy
  /** N. null = use the per-run request limit (the pre-existing setting). */
  targetCount: number | null
  /** Fill only: how many ranked titles may be examined at most. */
  maxCandidates: number
  /**
   * Hybrid sources only. external: rank by position in the external list (pre-existing behavior).
   * blended: rank by the same hybrid score as the Top Picks display, including titles not in the library.
   */
  rankBasis: RankBasis
  countries: {
    mode: CountryMode
    /** ISO 3166-1 alpha-2 codes, upper case */
    codes: string[]
    /** any: any origin country matches. all: every origin country must match. */
    match: CountryMatch
  }
  /** TMDB genre ids (movie and TV genre ids differ for some genres, so ids not names). */
  excludedGenreIds: number[]
  excludedKeywords: KeywordRef[]
  /**
   * What to do when a title's metadata was fetched successfully but a field needed by an active
   * filter is empty. skip: do not request (shown as uncertain). allow: treat as not matching.
   * A failed metadata lookup is NEVER allowed through, regardless of this setting.
   */
  missingMetadata: MissingMetadataPolicy
}

export const DEFAULT_AUTO_REQUEST_RULES: AutoRequestRules = {
  strategy: 'legacy',
  targetCount: null,
  maxCandidates: 200,
  rankBasis: 'external',
  countries: { mode: 'exclude', codes: [], match: 'any' },
  excludedGenreIds: [],
  excludedKeywords: [],
  missingMetadata: 'skip',
}

const uniqueSorted = <T extends number | string>(xs: T[]): T[] =>
  [...new Set(xs)].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  )

export const AutoRequestRulesSchema = z
  .object({
    strategy: z.enum(['legacy', 'strict', 'fill']).default('legacy'),
    targetCount: z.number().int().min(1).max(100).nullable().default(null),
    maxCandidates: z.number().int().min(10).max(500).default(200),
    rankBasis: z.enum(['external', 'blended']).default('external'),
    countries: z
      .object({
        mode: z.enum(['exclude', 'include']).default('exclude'),
        codes: z
          .array(z.string().transform((c) => c.trim().toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/)))
          .max(300)
          .default([]),
        match: z.enum(['any', 'all']).default('any'),
      })
      .strict()
      .default({}),
    excludedGenreIds: z.array(z.number().int().positive()).max(100).default([]),
    excludedKeywords: z
      .array(z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(100) }).strict())
      .max(200)
      .default([]),
    missingMetadata: z.enum(['skip', 'allow']).default('skip'),
  })
  .strict()

function normalize(parsed: z.infer<typeof AutoRequestRulesSchema>): AutoRequestRules {
  const seen = new Set<number>()
  const keywords = parsed.excludedKeywords.filter((k) => (seen.has(k.id) ? false : (seen.add(k.id), true)))
  return {
    ...parsed,
    countries: { ...parsed.countries, codes: uniqueSorted(parsed.countries.codes) },
    excludedGenreIds: uniqueSorted(parsed.excludedGenreIds),
    excludedKeywords: keywords,
  }
}

/** Strict parse for API input: throws an Error whose message names the first problem. */
export function parseAutoRequestRules(raw: unknown): AutoRequestRules {
  const result = AutoRequestRulesSchema.safeParse(raw ?? {})
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`autoRequestRules invalid: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return normalize(result.data)
}

/**
 * Lenient parse for stored values: anything unreadable falls back to defaults, and `invalid`
 * tells the caller so it can log a warning. Never throws.
 */
export function readStoredAutoRequestRules(raw: unknown): { rules: AutoRequestRules; invalid: boolean } {
  const result = AutoRequestRulesSchema.safeParse(raw ?? {})
  if (!result.success) return { rules: { ...DEFAULT_AUTO_REQUEST_RULES }, invalid: true }
  return { rules: normalize(result.data), invalid: false }
}

/** N for a run: the explicit target, or the pre-existing per-run limit when none is set. */
export function effectiveTargetCount(rules: AutoRequestRules, perRunLimit: number): number {
  return rules.targetCount ?? perRunLimit
}

export function rulesNeedMetadata(rules: AutoRequestRules): boolean {
  return (
    rules.countries.codes.length > 0 ||
    rules.excludedGenreIds.length > 0 ||
    rules.excludedKeywords.length > 0
  )
}
