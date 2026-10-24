import { Link } from '@mui/material'
import { useTranslation } from 'react-i18next'

/**
 * AGPL-3.0 section 13: users who interact with this software over a network must be offered its
 * Corresponding Source. This fork's source lives here. If you run a modified version of this fork,
 * change the URL to where YOUR modified source is published.
 */
const SOURCE_CODE_URL = 'https://github.com/avalynnrose/aperture'

export function SourceLink({ fontSize = '0.7rem' }: { fontSize?: string }) {
  const { t } = useTranslation()
  return (
    <Link
      href={SOURCE_CODE_URL}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      color="inherit"
      sx={{ fontSize }}
    >
      {t('about.sourceCode')}
    </Link>
  )
}
