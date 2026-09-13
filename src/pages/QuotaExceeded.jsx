import { useEffect } from 'react'
import Logo from '../components/Logo'
import { waitForQuota } from '../lib/quotaStatus'

const RETRY_MS = 30000

export default function QuotaExceeded() {
  useEffect(() => {
    document.title = 'AttendX | Unavailable'
  }, [])

  useEffect(() => {
    let cancelled = false
    async function wait() {
      while (!cancelled) {
        try {
          await waitForQuota()
          if (cancelled) return
          // A hard reload rather than a client-side redirect: every
          // listener from before the outage is in some backed-off state
          // inside the SDK, and starting over is the only way to be sure
          // none of it is stuck. Writes queued during the outage aren't
          // lost by this - they live in IndexedDB (see firebase.js) and
          // were sent ahead of the probe that just resolved.
          window.location.href = '/'
          return
        } catch {
          await new Promise((r) => setTimeout(r, RETRY_MS))
        }
      }
    }
    wait()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <Logo className="auth-logo" />
        <h1>Temporarily unavailable</h1>
        <p className="login-sub">
          AttendX has hit its Firestore usage limit for the day. This isn't something you can fix
          from here - the limit resets on Google's own schedule (midnight, US Pacific time).
        </p>
        <p className="login-sub">
          Changes you made just before this appeared are held in this browser and will be saved
          once the limit resets - as long as you come back in this same browser. Check them then.
        </p>
        <p className="muted">
          Waiting for Firestore to accept requests again… this page will take you back by itself,
          usually within a minute of the limit resetting.
        </p>
      </div>
    </div>
  )
}
