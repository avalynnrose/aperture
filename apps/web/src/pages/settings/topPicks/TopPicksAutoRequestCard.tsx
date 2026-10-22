import { useEffect, useState } from 'react'
import { Alert, Box, Card, CardContent, Collapse, FormControlLabel, Grid, MenuItem, Switch, TextField, Typography } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'; import MovieIcon from '@mui/icons-material/Movie'; import SendIcon from '@mui/icons-material/Send'; import TvIcon from '@mui/icons-material/Tv'
import { Trans, useTranslation } from 'react-i18next'
import type { TopPicksConfig } from './types'
export interface TopPicksAutoRequestCardProps { config: TopPicksConfig; updateConfig: (u: Partial<TopPicksConfig>) => void }
interface SeerrUserOption { id: number; name: string }
type SeerrUsersState = { status: 'loading' } | { status: 'ready'; users: SeerrUserOption[] } | { status: 'not-configured' } | { status: 'error' }

/** Loads Seerr users for the Top Picks Requester dropdown (admin endpoint; never changes the saved value). */
function useSeerrUsers(): SeerrUsersState {
  const [state, setState] = useState<SeerrUsersState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/seerr/users', { credentials: 'include' })
        if (cancelled) return
        if (response.status === 400) return setState({ status: 'not-configured' })
        if (!response.ok) return setState({ status: 'error' })
        const data = await response.json()
        setState({ status: 'ready', users: Array.isArray(data.users) ? data.users : [] })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [])
  return state
}

export function TopPicksAutoRequestCard({ config, updateConfig }: TopPicksAutoRequestCardProps) {
  const { t } = useTranslation()
  const seerrUsers = useSeerrUsers()
  const requesterId = config.autoRequestSeerrUserId
  const knownUsers = seerrUsers.status === 'ready' ? seerrUsers.users : []
  const requesterMissing = seerrUsers.status === 'ready' && requesterId !== null && !knownUsers.some((u) => u.id === requesterId)
  const requesterHelper = seerrUsers.status === 'not-configured' ? t('topPicksAdmin.autoRequest.requesterNotConfigured')
    : seerrUsers.status === 'error' ? t('topPicksAdmin.autoRequest.requesterLoadError')
    : requesterMissing ? t('topPicksAdmin.autoRequest.requesterUnavailableWarning', { id: requesterId })
    : `${t('topPicksAdmin.autoRequest.requesterHelper')} ${t('topPicksAdmin.autoRequest.requesterHelperAll')}`
  return (      <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <SendIcon fontSize="small" color="primary" />
            {t('topPicksAdmin.autoRequest.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('topPicksAdmin.autoRequest.subtitle')}
          </Typography>

          <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 3 }}>
            <Typography variant="body2" component="div">
              {t('topPicksAdmin.autoRequest.infoLine1')}
            </Typography>
            <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
              <Trans i18nKey="topPicksAdmin.autoRequest.infoLine2" components={{ 1: <strong /> }} />
            </Typography>
          </Alert>

          <TextField
            select
            fullWidth
            size="small"
            sx={{ mb: 3, maxWidth: 480 }}
            label={t('topPicksAdmin.autoRequest.requesterLabel')}
            value={requesterId === null ? '' : String(requesterId)}
            onChange={(e) => updateConfig({ autoRequestSeerrUserId: e.target.value === '' ? null : Number(e.target.value) })}
            disabled={!config.isEnabled || seerrUsers.status === 'loading'}
            error={requesterMissing}
            helperText={seerrUsers.status === 'loading' ? t('topPicksAdmin.autoRequest.requesterLoading') : requesterHelper}
          >
            <MenuItem value="">{t('topPicksAdmin.autoRequest.requesterDefault')}</MenuItem>
            {knownUsers.map((u) => (
              <MenuItem key={u.id} value={String(u.id)}>{u.name}</MenuItem>
            ))}
            {requesterId !== null && !knownUsers.some((u) => u.id === requesterId) && (
              <MenuItem value={String(requesterId)}>
                {seerrUsers.status === 'ready'
                  ? t('topPicksAdmin.autoRequest.requesterUnavailable', { id: requesterId })
                  : t('topPicksAdmin.autoRequest.requesterUnverified', { id: requesterId })}
              </MenuItem>
            )}
          </TextField>

          <Grid container spacing={4}>
            {/* Movies Auto-Request */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <MovieIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2">{t('topPicksAdmin.autoRequest.moviesSection')}</Typography>
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={config.moviesAutoRequestEnabled}
                      onChange={(e) => updateConfig({ moviesAutoRequestEnabled: e.target.checked })}
                      disabled={!config.isEnabled || config.moviesPopularitySource === 'emby_history'}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2">
                      {t('topPicksAdmin.autoRequest.enableMovies')}
                    </Typography>
                  }
                />
                {config.moviesPopularitySource === 'emby_history' && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, ml: 4 }}>
                    {t('topPicksAdmin.autoRequest.requiresExternal')}
                  </Typography>
                )}
                <Collapse in={config.moviesAutoRequestEnabled}>
                  <Box sx={{ mt: 2, ml: 4 }}>
                    <TextField
                      fullWidth
                      label={t('topPicksAdmin.fields.maxRequestsPerRun')}
                      type="number"
                      value={config.moviesAutoRequestLimit}
                      onChange={(e) => updateConfig({ moviesAutoRequestLimit: Math.max(1, parseInt(e.target.value) || 10) })}
                      size="small"
                      disabled={!config.isEnabled}
                      InputProps={{
                        inputProps: { min: 1, max: 100 }
                      }}
                      helperText={t('topPicksAdmin.autoRequest.moviesHelper')}
                    />
                  </Box>
                </Collapse>
              </Card>
            </Grid>

            {/* Series Auto-Request */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <TvIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2">{t('topPicksAdmin.autoRequest.seriesSection')}</Typography>
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={config.seriesAutoRequestEnabled}
                      onChange={(e) => updateConfig({ seriesAutoRequestEnabled: e.target.checked })}
                      disabled={!config.isEnabled || config.seriesPopularitySource === 'emby_history'}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2">
                      {t('topPicksAdmin.autoRequest.enableSeries')}
                    </Typography>
                  }
                />
                {config.seriesPopularitySource === 'emby_history' && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, ml: 4 }}>
                    {t('topPicksAdmin.autoRequest.requiresExternal')}
                  </Typography>
                )}
                <Collapse in={config.seriesAutoRequestEnabled}>
                  <Box sx={{ mt: 2, ml: 4 }}>
                    <TextField
                      fullWidth
                      label={t('topPicksAdmin.fields.maxRequestsPerRun')}
                      type="number"
                      value={config.seriesAutoRequestLimit}
                      onChange={(e) => updateConfig({ seriesAutoRequestLimit: Math.max(1, parseInt(e.target.value) || 10) })}
                      size="small"
                      disabled={!config.isEnabled}
                      InputProps={{
                        inputProps: { min: 1, max: 100 }
                      }}
                      helperText={t('topPicksAdmin.autoRequest.seriesHelper')}
                    />
                    <TextField
                      select
                      fullWidth
                      size="small"
                      sx={{ mt: 2 }}
                      label={t('topPicksAdmin.autoRequest.seasonsLabel')}
                      value={config.seriesAutoRequestSeasons}
                      onChange={(e) => updateConfig({ seriesAutoRequestSeasons: e.target.value === 'first' ? 'first' : 'all' })}
                      disabled={!config.isEnabled}
                      helperText={t('topPicksAdmin.autoRequest.seasonsHelper')}
                    >
                      <MenuItem value="all">{t('topPicksAdmin.autoRequest.seasonsAll')}</MenuItem>
                      <MenuItem value="first">{t('topPicksAdmin.autoRequest.seasonsFirst')}</MenuItem>
                    </TextField>
                  </Box>
                </Collapse>
              </Card>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
  )
}
