// Google Calendar integration - entirely client-side, no backend. An admin
// clicks "Connect Google Calendar" in Settings and signs into the team's
// shared Google account once; every event/training/certification with a
// due date then gets a matching all-day event on that account's own
// ("primary") calendar, kept in sync as the date changes and removed if
// the item is deleted or its date cleared.
//
// This needs a Google Cloud OAuth client ID for the project - see the
// "Google Calendar" section of Settings for exactly what to set up and
// where this ID goes (VITE_GOOGLE_CLIENT_ID in .env.local).
//
// Deliberately NOT persisted across sessions: the access token this gets
// back lives in memory only (a module-level variable, not
// localStorage/cookies), same as it not surviving a page reload is the
// price of never having to store a Google credential anywhere at rest.
// That means automatic sync on create/edit only actually reaches Google
// while someone connected earlier in the current tab - see the "Add every
// existing date" button in Settings for catching up anything that was
// created while nobody was connected, or created before this feature was
// ever turned on.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email'
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

let tokenClient = null
let state = { accessToken: null, email: null, expiresAt: 0 }
const listeners = new Set()

function setState(next) {
  state = next
  for (const listener of listeners) listener(state)
}

// Settings' connection UI subscribes to this rather than polling - returns
// an unsubscribe function, same shape as every other subscribe helper in
// this app (see firestore-hooks.js).
export function subscribeGoogleCalendar(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getGoogleCalendarState() {
  return state
}

export function isGoogleCalendarConfigured() {
  return !!CLIENT_ID
}

export function isGoogleCalendarConnected() {
  return !!state.accessToken && Date.now() < state.expiresAt
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google Identity Services - check your connection and try again.'))
    document.head.appendChild(script)
  })
}

// Opens Google's own sign-in/consent popup. Resolves once a token comes
// back (throws if the admin closes the popup or Google refuses it, e.g.
// the OAuth client isn't configured for this origin yet).
export async function connectGoogleCalendar() {
  if (!CLIENT_ID) {
    throw new Error("Google Calendar isn't set up for this deployment yet - see Settings for what's missing.")
  }
  await loadGoogleIdentityServices()
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: async (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error))
          return
        }
        setState({
          accessToken: response.access_token,
          email: null,
          // A minute of slack before the token's real expiry so a sync
          // that starts right at the edge doesn't get cut off mid-request.
          expiresAt: Date.now() + Math.max(0, (response.expires_in || 0) - 60) * 1000,
        })
        try {
          const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${response.access_token}` },
          })
          const info = await res.json()
          setState({ ...state, email: info.email || null })
        } catch {
          // Cosmetic only (shows "Connected as ...") - the connection
          // itself already succeeded above.
        }
        resolve(state)
      },
      error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was cancelled.')),
    })
    tokenClient.requestAccessToken({ prompt: 'consent' })
  })
}

export function disconnectGoogleCalendar() {
  if (state.accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(state.accessToken, () => {})
  }
  setState({ accessToken: null, email: null, expiresAt: 0 })
}

async function calendarFetch(path, options) {
  const res = await fetch(`${EVENTS_URL}${path}`, {
    ...options,
    headers: { ...options?.headers, Authorization: `Bearer ${state.accessToken}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message || `Google Calendar API error (${res.status})`)
  }
  return res.status === 204 ? null : res.json()
}

// All-day events use an exclusive end date (the day AFTER, per the
// Calendar API) - a one-day event's end.date is always start.date + 1, not
// the same day again.
function nextDay(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Creates a calendar event for `date` if `eventId` is null, otherwise
// updates that existing one in place - either way returns the event's
// Google-assigned id, which the caller stores back on its own Firestore
// doc (see syncDocCalendarEvent in actions.js) so a later edit/delete can
// find it again. Never throws its own connection state - callers check
// isGoogleCalendarConnected() first and decide what "not connected" means
// for them (Settings surfaces an error; a background sync from
// addTraining/addEvent just quietly skips, since the real save already
// went through and must never depend on this succeeding).
export async function upsertCalendarEvent({ eventId, title, date, description }) {
  const body = { summary: title, description, start: { date }, end: { date: nextDay(date) } }
  if (eventId) {
    try {
      await calendarFetch(`/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) })
      return eventId
    } catch {
      // The linked event was deleted on the Google side (or belongs to a
      // calendar this token no longer has - e.g. reconnected as a
      // different account) - fall through and create a fresh one rather
      // than losing the sync entirely.
    }
  }
  const created = await calendarFetch('', { method: 'POST', body: JSON.stringify(body) })
  return created?.id || null
}

export async function deleteCalendarEvent(eventId) {
  if (!eventId) return
  try {
    await calendarFetch(`/${eventId}`, { method: 'DELETE' })
  } catch {
    // Already gone (deleted by hand on the Google side, or never really
    // existed) - nothing left to clean up either way.
  }
}
