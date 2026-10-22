/**
 * Display name for a Seerr user in pickers. Jellyfin/Emby-imported Seerr users often have an
 * empty `username`, so fall back through the other name fields; email is the last resort.
 */
export interface SeerrUserNames {
  id: number
  displayName?: string | null
  username?: string | null
  jellyfinUsername?: string | null
  plexUsername?: string | null
  email?: string | null
}

export function seerrUserLabel(u: SeerrUserNames): string {
  return (
    u.displayName?.trim() ||
    u.username?.trim() ||
    u.jellyfinUsername?.trim() ||
    u.plexUsername?.trim() ||
    u.email?.trim() ||
    `User ${u.id}`
  )
}
