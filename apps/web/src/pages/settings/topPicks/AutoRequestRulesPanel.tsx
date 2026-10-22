import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  Divider,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { buildCountryOptions, type CountryOption } from './countries'
import type { AutoRequestRules } from './types'

interface GenreOption {
  id: number
  name: string
}

/** TMDB genre list for one media type (movie and TV genre ids differ for some genres). */
export function useTmdbGenres(mediaType: 'movie' | 'tv'): { genres: GenreOption[]; error: boolean } {
  const [genres, setGenres] = useState<GenreOption[]>([])
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/settings/top-picks/auto-request/genres?mediaType=${mediaType}`, { credentials: 'include' })
        if (!r.ok) throw new Error(String(r.status))
        const data = (await r.json()) as { genres: GenreOption[] }
        if (!cancelled) setGenres(data.genres)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mediaType])
  return { genres, error }
}

/** Debounced TMDB keyword search. TMDB keywords are not the same thing as Emby tags. */
function useKeywordSearch(text: string): { options: GenreOption[]; error: boolean; loading: boolean } {
  const [options, setOptions] = useState<GenreOption[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) {
      setOptions([])
      setError(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/settings/top-picks/auto-request/keywords?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        if (!r.ok) throw new Error(String(r.status))
        const data = (await r.json()) as { results: GenreOption[] }
        if (!cancelled) {
          setOptions(data.results)
          setError(false)
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text])
  return { options, error, loading }
}

export interface AutoRequestRulesPanelProps {
  mediaType: 'movie' | 'tv'
  rules: AutoRequestRules
  onChange: (rules: AutoRequestRules) => void
  perRunLimit: number
  sourceIsHybrid: boolean
  disabled?: boolean
}

export function AutoRequestRulesPanel({ mediaType, rules, onChange, perRunLimit, sourceIsHybrid, disabled }: AutoRequestRulesPanelProps) {
  const { t, i18n } = useTranslation()
  const prefix = 'topPicksAdmin.autoRequest.rules'
  const set = (patch: Partial<AutoRequestRules>) => onChange({ ...rules, ...patch })

  const countryOptions = useMemo<CountryOption[]>(() => buildCountryOptions(i18n.language), [i18n.language])
  const selectedCountries = rules.countries.codes.map(
    (code) => countryOptions.find((o) => o.code === code) ?? { code, label: code }
  )

  const { genres, error: genresError } = useTmdbGenres(mediaType)
  const selectedGenres = rules.excludedGenreIds.map(
    (id) => genres.find((g) => g.id === id) ?? { id, name: t(`${prefix}.genreFallback`, { id }) }
  )

  const [keywordText, setKeywordText] = useState('')
  const { options: keywordOptions, error: keywordError, loading: keywordLoading } = useKeywordSearch(keywordText)

  return (
    <Box sx={{ mt: 2, display: 'grid', gap: 2 }}>
      <TextField
        select
        size="small"
        label={t(`${prefix}.strategyLabel`)}
        value={rules.strategy}
        onChange={(e) => set({ strategy: e.target.value as AutoRequestRules['strategy'] })}
        disabled={disabled}
        helperText={t(`${prefix}.strategyHelp.${rules.strategy}`)}
      >
        <MenuItem value="legacy">{t(`${prefix}.strategy.legacy`)}</MenuItem>
        <MenuItem value="strict">{t(`${prefix}.strategy.strict`)}</MenuItem>
        <MenuItem value="fill">{t(`${prefix}.strategy.fill`)}</MenuItem>
      </TextField>

      <TextField
        size="small"
        type="number"
        label={t(`${prefix}.targetLabel`)}
        value={rules.targetCount ?? ''}
        placeholder={String(perRunLimit)}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          set({ targetCount: Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : null })
        }}
        disabled={disabled}
        helperText={t(`${prefix}.targetHelp`, { limit: perRunLimit })}
        InputProps={{ inputProps: { min: 1, max: 100 } }}
      />

      {rules.strategy !== 'strict' && (
        <TextField
          size="small"
          type="number"
          label={t(`${prefix}.depthLabel`)}
          value={rules.maxCandidates}
          onChange={(e) => set({ maxCandidates: Math.min(500, Math.max(10, parseInt(e.target.value, 10) || 200)) })}
          disabled={disabled}
          helperText={t(`${prefix}.depthHelp`)}
          InputProps={{ inputProps: { min: 10, max: 500 } }}
        />
      )}

      {sourceIsHybrid && (
        <TextField
          select
          size="small"
          label={t(`${prefix}.rankBasisLabel`)}
          value={rules.rankBasis}
          onChange={(e) => set({ rankBasis: e.target.value as AutoRequestRules['rankBasis'] })}
          disabled={disabled}
          helperText={t(`${prefix}.rankBasisHelp.${rules.rankBasis}`)}
        >
          <MenuItem value="external">{t(`${prefix}.rankBasis.external`)}</MenuItem>
          <MenuItem value="blended">{t(`${prefix}.rankBasis.blended`)}</MenuItem>
        </TextField>
      )}

      <Divider />
      <Typography variant="caption" color="text.secondary">
        {t(`${prefix}.filtersNote`)}
      </Typography>

      {/* Countries of origin */}
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Typography variant="subtitle2">{t(`${prefix}.countriesTitle`)}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={rules.countries.mode}
            onChange={(_e, v: 'exclude' | 'include' | null) => v && set({ countries: { ...rules.countries, mode: v } })}
            disabled={disabled}
          >
            <ToggleButton value="exclude">{t(`${prefix}.countryExclude`)}</ToggleButton>
            <ToggleButton value="include">{t(`${prefix}.countryInclude`)}</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            select
            size="small"
            sx={{ minWidth: 220 }}
            label={t(`${prefix}.countryMatchLabel`)}
            value={rules.countries.match}
            onChange={(e) => set({ countries: { ...rules.countries, match: e.target.value as 'any' | 'all' } })}
            disabled={disabled}
          >
            <MenuItem value="any">{t(`${prefix}.countryMatch.any`)}</MenuItem>
            <MenuItem value="all">{t(`${prefix}.countryMatch.all`)}</MenuItem>
          </TextField>
        </Box>
        <Autocomplete
          multiple
          size="small"
          options={countryOptions}
          value={selectedCountries}
          isOptionEqualToValue={(o, v) => o.code === v.code}
          getOptionLabel={(o) => o.label}
          onChange={(_e, v) => set({ countries: { ...rules.countries, codes: v.map((o) => o.code) } })}
          disabled={disabled}
          renderTags={(value, getTagProps) =>
            value.map((o, index) => <Chip size="small" label={o.label} {...getTagProps({ index })} key={o.code} />)
          }
          renderInput={(params) => (
            <TextField {...params} label={t(`${prefix}.countriesLabel`)} helperText={t(`${prefix}.countriesHelp`)} />
          )}
        />
      </Box>

      {/* Genres */}
      <Autocomplete
        multiple
        size="small"
        options={genres}
        value={selectedGenres}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        getOptionLabel={(o) => o.name}
        onChange={(_e, v) => set({ excludedGenreIds: v.map((o) => o.id) })}
        disabled={disabled}
        renderTags={(value, getTagProps) =>
          value.map((o, index) => <Chip size="small" label={o.name} {...getTagProps({ index })} key={o.id} />)
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={t(`${prefix}.genresLabel`)}
            error={genresError}
            helperText={genresError ? t(`${prefix}.genresError`) : t(`${prefix}.genresHelp`)}
          />
        )}
      />

      {/* TMDB keywords */}
      <Autocomplete
        multiple
        size="small"
        options={keywordOptions}
        value={rules.excludedKeywords}
        loading={keywordLoading}
        filterOptions={(x) => x}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        getOptionLabel={(o) => o.name}
        onInputChange={(_e, text, reason) => reason === 'input' && setKeywordText(text)}
        onChange={(_e, v) => set({ excludedKeywords: v.map((k) => ({ id: k.id, name: k.name })) })}
        disabled={disabled}
        noOptionsText={keywordText.trim().length < 2 ? t(`${prefix}.keywordsType`) : t(`${prefix}.keywordsNone`)}
        renderTags={(value, getTagProps) =>
          value.map((o, index) => <Chip size="small" label={o.name} {...getTagProps({ index })} key={o.id} />)
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={t(`${prefix}.keywordsLabel`)}
            error={keywordError}
            helperText={keywordError ? t(`${prefix}.keywordsError`) : t(`${prefix}.keywordsHelp`)}
          />
        )}
      />

      <TextField
        select
        size="small"
        label={t(`${prefix}.missingLabel`)}
        value={rules.missingMetadata}
        onChange={(e) => set({ missingMetadata: e.target.value as 'skip' | 'allow' })}
        disabled={disabled}
        helperText={t(`${prefix}.missingHelp.${rules.missingMetadata}`)}
      >
        <MenuItem value="skip">{t(`${prefix}.missing.skip`)}</MenuItem>
        <MenuItem value="allow">{t(`${prefix}.missing.allow`)}</MenuItem>
      </TextField>
      <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
        {t(`${prefix}.failureNote`)}
      </Alert>
    </Box>
  )
}
