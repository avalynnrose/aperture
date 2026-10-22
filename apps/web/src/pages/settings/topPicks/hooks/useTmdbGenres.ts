import { useEffect, useState } from 'react'

export interface GenreOption {
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
