import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useTranslation } from 'react-i18next'
import { useTmdbGenres } from './hooks/useTmdbGenres'
import { countryName } from './countries'
import type { AutoRequestAvailability, AutoRequestDecision, AutoRequestPlanEntry, AutoRequestPlanView, AutoRequestPreviewResponse } from './types'

const DECISION_COLOR: Record<AutoRequestDecision, 'success' | 'default' | 'error' | 'warning'> = {
  selected: 'success',
  skipped: 'default',
  excluded: 'error',
  uncertain: 'warning',
  'over-cap': 'default',
}

const AVAILABILITY_COLOR: Record<AutoRequestAvailability, 'success' | 'default' | 'info' | 'warning'> = {
  'in-library': 'default',
  requested: 'info',
  'will-request': 'success',
  'over-cap': 'warning',
}

interface Props {
  open: boolean
  onClose: () => void
  /** unsaved edits exist; the preview uses the SAVED settings, so ask the user to save first */
  hasUnsavedChanges: boolean
}

type RunState = { status: 'idle' } | { status: 'running' } | { status: 'started' } | { status: 'error'; message: string }

export function AutoRequestPreviewDialog({ open, onClose, hasUnsavedChanges }: Props) {
  const { t, i18n } = useTranslation()
  const p = 'topPicksAdmin.autoRequest.preview'
  const [data, setData] = useState<AutoRequestPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [changedNotice, setChangedNotice] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [skipBusy, setSkipBusy] = useState(false)
  const [skipError, setSkipError] = useState<string | null>(null)

  const movieGenres = useTmdbGenres('movie')
  const tvGenres = useTmdbGenres('tv')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setRun({ status: 'idle' })
    setChangedNotice(false)
    try {
      const r = await fetch('/api/settings/top-picks/auto-request/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`)
      setData((await r.json()) as AutoRequestPreviewResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  /** Skip (or un-skip) one title for automatic requests, then rebuild the preview so the next eligible title fills the place. */
  const changeSkip = async (mediaType: 'movie' | 'tv', entry: { tmdbId: number; title: string }, skip: boolean) => {
    setSkipBusy(true)
    setSkipError(null)
    try {
      const r = skip
        ? await fetch('/api/settings/top-picks/auto-request/skipped', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaType, tmdbId: entry.tmdbId, title: entry.title }),
          })
        : await fetch(`/api/settings/top-picks/auto-request/skipped?mediaType=${mediaType}&tmdbId=${entry.tmdbId}`, {
            method: 'DELETE',
            credentials: 'include',
          })
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`)
      await load()
    } catch (err) {
      setSkipError(err instanceof Error ? err.message : String(err))
    } finally {
      setSkipBusy(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [open])

  const plans = data?.plans ?? []
  const plan: AutoRequestPlanView | undefined = plans[tab]
  const totalSelected = plans.reduce((n, pl) => n + pl.result.summary.selected, 0)
  const stale = data ? now - new Date(data.generatedAt).getTime() > data.staleAfterSeconds * 1000 : false

  const genreNames = useMemo(() => {
    const maps = { movie: new Map(movieGenres.genres.map((g) => [g.id, g.name])), tv: new Map(tvGenres.genres.map((g) => [g.id, g.name])) }
    return maps
  }, [movieGenres.genres, tvGenres.genres])

  const reasonText = (code: string, detail?: string) => {
    const base = t(`${p}.reasons.${code}`, { defaultValue: code })
    if (!detail) return base
    if (code === 'country-excluded') return `${base}: ${countryName(detail, i18n.language)} (${detail})`
    if (code === 'genre-excluded' && plan) {
      const name = genreNames[plan.mediaType].get(Number(detail))
      return `${base}: ${name ?? detail}`
    }
    return `${base}: ${detail}`
  }

  const statusText = (e: AutoRequestPlanEntry) =>
    e.inLibrary ? t(`${p}.status.library`) : e.requested === true ? t(`${p}.status.requested`) : e.requested === 'unknown' ? t(`${p}.status.unknown`) : t(`${p}.status.missing`)

  const startRun = async () => {
    if (!data) return
    setRun({ status: 'running' })
    const planIds: Record<string, string> = {}
    for (const pl of data.plans) planIds[pl.mediaType] = pl.planId
    try {
      const r = await fetch('/api/jobs/auto-request-top-picks/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, planIds }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string; code?: string; plans?: AutoRequestPlanView[] }
      if (r.status === 409 && body.code === 'PLAN_CHANGED' && body.plans) {
        // Replace the changed plans, keep the rest, and make the user look again before confirming.
        setData({
          ...data,
          generatedAt: new Date().toISOString(),
          plans: data.plans.map((old) => body.plans!.find((n) => n.mediaType === old.mediaType) ?? old),
        })
        setChangedNotice(true)
        setRun({ status: 'idle' })
        setConfirmOpen(false)
        return
      }
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setRun({ status: 'started' })
      setConfirmOpen(false)
    } catch (err) {
      setRun({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      setConfirmOpen(false)
    }
  }

  const renderTable = (entries: AutoRequestPlanEntry[], pl: AutoRequestPlanView, chart: boolean) => (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {chart && <TableCell>{t(`${p}.col.place`)}</TableCell>}
            <TableCell>{t(`${p}.col.rank`)}</TableCell>
            <TableCell>{t(`${p}.col.title`)}</TableCell>
            <TableCell>{t(`${p}.col.status`)}</TableCell>
            <TableCell>{t(`${p}.col.countries`)}</TableCell>
            <TableCell>{t(`${p}.col.genres`)}</TableCell>
            <TableCell>{t(`${p}.col.keywords`)}</TableCell>
            <TableCell>{t(`${p}.col.decision`)}</TableCell>
            <TableCell>{t(`${p}.col.reasons`)}</TableCell>
            <TableCell>{t(`${p}.col.actions`)}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={`${e.tmdbId}-${e.rank}`} sx={e.decision === 'selected' ? { backgroundColor: 'action.hover' } : undefined}>
              {chart && <TableCell>{e.chartPosition}</TableCell>}
              <TableCell>#{e.rank}</TableCell>
              <TableCell>
                {e.title}
                {e.year ? ` (${e.year})` : ''}
              </TableCell>
              <TableCell>{statusText(e)}</TableCell>
              <TableCell>{e.countries === null ? '—' : e.countries.length === 0 ? t(`${p}.none`) : e.countries.join(', ')}</TableCell>
              <TableCell>
                {e.genreIds === null ? '—' : e.genreIds.map((id) => genreNames[pl.mediaType].get(id) ?? String(id)).join(', ') || t(`${p}.none`)}
              </TableCell>
              <TableCell>{e.matchedKeywords.map((k) => k.name).join(', ') || '—'}</TableCell>
              <TableCell>
                {e.availability ? (
                  <Chip size="small" variant={e.availability === 'will-request' ? 'filled' : 'outlined'} color={AVAILABILITY_COLOR[e.availability]} label={t(`${p}.availability.${e.availability}`)} />
                ) : (
                  <Chip size="small" variant="outlined" color={DECISION_COLOR[e.decision]} label={t(`${p}.decision.${e.decision}`)} />
                )}
              </TableCell>
              <TableCell>{e.reasons.map((r) => reasonText(r.code, r.detail)).join('; ')}</TableCell>
              <TableCell>
                {e.reasons.some((r) => r.code === 'manually-skipped') ? (
                  <Button size="small" disabled={skipBusy} onClick={() => void changeSkip(pl.mediaType, e, false)}>
                    {t(`${p}.undoSkip`)}
                  </Button>
                ) : e.chartPosition !== undefined || e.decision === 'selected' || e.decision === 'over-cap' ? (
                  <Tooltip title={t(`${p}.skipTooltip`)}>
                    <span>
                      <IconButton size="small" aria-label={t(`${p}.skipAria`, { title: e.title })} disabled={skipBusy} onClick={() => void changeSkip(pl.mediaType, e, true)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )

  const s = plan?.result.summary
  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
        <DialogTitle>{t(`${p}.title`)}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t(`${p}.readOnlyNote`)}
          </Alert>
          {hasUnsavedChanges && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t(`${p}.unsaved`)}
            </Alert>
          )}
          {changedNotice && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t(`${p}.planChanged`)}
            </Alert>
          )}
          {skipError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {t(`${p}.skipError`)}: {skipError}
            </Alert>
          )}
          {stale && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t(`${p}.stale`)}
            </Alert>
          )}
          {run.status === 'started' && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {t(`${p}.started`)}
            </Alert>
          )}
          {run.status === 'error' && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {run.message}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {t(`${p}.loadError`)}: {error}
            </Alert>
          )}
          {loading && !data && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          )}
          {data && plan && s && (
            <>
              <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} sx={{ mb: 2 }}>
                {plans.map((pl) => (
                  <Tab key={pl.mediaType} label={`${pl.mediaType === 'movie' ? t(`${p}.movies`) : t(`${p}.series`)} (${pl.result.summary.selected})`} />
                ))}
              </Tabs>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                <Chip size="small" label={t(`${p}.strategyChip`, { strategy: t(`topPicksAdmin.autoRequest.rules.strategy.${s.strategy}`) })} />
                <Chip size="small" label={t(`${p}.targetChip`, { n: plan.targetCount, cap: plan.perRunCap })} />
                <Chip size="small" label={t(`${p}.rankChip`, { basis: t(`topPicksAdmin.autoRequest.rules.rankBasis.${plan.rankBasis}`) })} />
                <Chip size="small" color={plan.enabled ? 'success' : 'default'} label={plan.enabled ? t(`${p}.enabled`) : t(`${p}.disabled`)} />
              </Stack>
              {s.chart && (
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {t(`${p}.chartSummary`, {
                    target: plan.targetCount,
                    size: s.chart.size,
                    evaluated: s.evaluated,
                    inLibrary: s.chart.inLibrary,
                    requestedAlready: s.chart.alreadyRequested,
                    willRequest: s.chart.willRequest,
                    overCap: s.chart.overCap,
                  })}
                  {s.chart.short ? ` ${t(`${p}.chartShort`, { target: plan.targetCount })}` : ''}
                  {s.exhausted ? ` ${t(`${p}.exhausted`)}` : ''}
                  {s.depthCapped ? ` ${t(`${p}.depthCapped`)}` : ''}
                </Typography>
              )}
              {!s.chart && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t(`${p}.summary`, { evaluated: s.evaluated, selected: s.selected, skipped: s.skipped, excluded: s.excluded, uncertain: s.uncertain, overCap: s.overCap })}
                {s.exhausted ? ` ${t(`${p}.exhausted`)}` : ''}
                {s.depthCapped ? ` ${t(`${p}.depthCapped`)}` : ''}
              </Typography>
              )}
              {plan.warnings.map((w) => (
                <Alert key={w} severity="warning" sx={{ mb: 1 }}>
                  {w}
                </Alert>
              ))}
              {plan.result.entries.length === 0 ? (
                <Typography color="text.secondary">{t(`${p}.empty`)}</Typography>
              ) : s.chart ? (
                <>
                  <Typography variant="subtitle2" sx={{ mt: 1 }}>
                    {t(`${p}.chartTitle`, { target: plan.targetCount })}
                  </Typography>
                  {renderTable(
                    plan.result.entries.filter((e) => e.chartPosition !== undefined),
                    plan,
                    true
                  )}
                  <Typography variant="subtitle2" sx={{ mt: 2 }}>
                    {t(`${p}.notInChartTitle`)}
                  </Typography>
                  {plan.result.entries.some((e) => e.chartPosition === undefined) ? (
                    renderTable(
                      plan.result.entries.filter((e) => e.chartPosition === undefined),
                      plan,
                      false
                    )
                  ) : (
                    <Typography color="text.secondary">{t(`${p}.notInChartEmpty`)}</Typography>
                  )}
                </>
              ) : (
                renderTable(plan.result.entries, plan, false)
              )}
              {plan.rules.skippedTitles.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2">{t(`${p}.skippedTitle`, { count: plan.rules.skippedTitles.length })}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {t(`${p}.skippedHelp`)}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {plan.rules.skippedTitles.map((st) => (
                      <Chip
                        key={st.tmdbId}
                        size="small"
                        label={st.title}
                        disabled={skipBusy}
                        onDelete={() => void changeSkip(plan.mediaType, st, false)}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t(`${p}.generated`, { time: new Date(data.generatedAt).toLocaleTimeString(i18n.language) })}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => void load()} disabled={loading}>
            {t(`${p}.refresh`)}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button onClick={onClose} color="inherit">
            {t(`${p}.close`)}
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => setConfirmOpen(true)}
            disabled={!data || loading || totalSelected === 0 || hasUnsavedChanges || stale || run.status === 'running' || run.status === 'started'}
          >
            {t(`${p}.runNow`)}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Separate, explicit confirmation before anything is requested */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{t(`${p}.confirmTitle`)}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t(`${p}.confirmBody`, {
              count: totalSelected,
              movies: plans.find((x) => x.mediaType === 'movie')?.result.summary.selected ?? 0,
              series: plans.find((x) => x.mediaType === 'tv')?.result.summary.selected ?? 0,
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit">
            {t(`${p}.cancel`)}
          </Button>
          <Button onClick={() => void startRun()} color="warning" variant="contained" disabled={run.status === 'running'}>
            {run.status === 'running' ? t(`${p}.starting`) : t(`${p}.confirmRun`)}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
