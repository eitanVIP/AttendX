import { useSyncExternalStore } from 'react'

// True on a phone-width screen - the same 640px breakpoint the phone rules in
// index.css use - and it updates live if the window is resized. For the few
// places where a phone needs different content (not just different styling).
const PHONE_QUERY = '(max-width: 640px)'

export default function usePhone() {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(PHONE_QUERY)
      mq.addEventListener('change', notify)
      return () => mq.removeEventListener('change', notify)
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  )
}
