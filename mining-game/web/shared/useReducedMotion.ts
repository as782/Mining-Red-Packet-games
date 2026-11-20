import { useSyncExternalStore } from 'react'

// The installed Motion hook snapshots this preference only when it mounts.
// Subscribe here so an OS preference change also updates active game sequences.
const preference = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')
const snapshot = () => preference?.matches ?? false
const serverSnapshot = () => false
const subscribe = (notify: () => void) => {
  preference?.addEventListener('change', notify)
  return () => preference?.removeEventListener('change', notify)
}

export const useReducedMotion = () => useSyncExternalStore(subscribe, snapshot, serverSnapshot)
