import { useTranslation } from 'react-i18next'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

interface AutoRequestRunDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * A manual auto-request run creates real Seerr requests, so it needs its own explicit confirmation.
 * The Top Picks settings page offers a preview of exactly what would be requested first.
 */
export function AutoRequestRunDialog({ open, onClose, onConfirm }: AutoRequestRunDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { borderRadius: 3, minWidth: 360 } }}>
      <DialogTitle sx={{ fontWeight: 600 }}>{t('admin.jobsPage.ui.autoRequestRunTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('admin.jobsPage.ui.autoRequestRunBody')}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} color="inherit">
          {t('admin.jobsPage.ui.autoRequestRunCancel')}
        </Button>
        <Button onClick={onConfirm} color="warning" variant="contained">
          {t('admin.jobsPage.ui.autoRequestRunConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
