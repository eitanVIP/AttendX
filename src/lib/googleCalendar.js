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
// The access token itself is deliberately NOT persisted: it lives in memory
// only (a module-level variable, not localStorage/cookies), so no Google
// credential is ever stored at rest. Staying connected across reloads and
// the token's hour-long lifetime is done by silently asking Google for a new
// one instead - see ensureGoogleCalendarToken below. Anything created while
// that couldn't happen (signed out of Google, popup blocked) is caught up by
// the "Add every existing date" button in Settings.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email'
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

let tokenClient = null
let state = { accessToken: null, email: null, expiresAt: 0, reconnecting: false }
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

// Google only hands a browser-only app an access token that lasts about an
// hour, and this one is never stored (see the top of the file) - so a page
// reload or the hour running out would otherwise disconnect it. What IS
// remembered, in localStorage, is just that someone connected (and the
// account's email, as a sign-in hint): never a credential. While that flag
// is set, the next click anywhere in the app quietly asks Google for a
// fresh token with no consent prompt (Google already has the approval) -
// it has to wait for a click because browsers block popups that aren't
// started by one - and a save that needs Calendar waits for that to land
// (see ensureGoogleCalendarToken).
const REMEMBER_KEY = 'attendx-google-calendar'
const RETRY_AFTER_FAILURE_MS = 60_000

function readRemembered() {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY))
  } catch {
    return null
  }
}

function remember(email) {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email: email || null }))
  } catch {
    // Storage blocked (private window) - just means no auto-reconnect.
  }
}

function forget() {
  try {
    localStorage.removeItem(REMEMBER_KEY)
  } catch {
    // See remember().
  }
}

// `prompt: 'consent'` is the real connect (Google's sign-in/consent popup);
// `prompt: ''` is the silent refresh, which only shows anything if Google
// needs the person to sign in again.
async function requestToken({ prompt, hint }) {
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
          email: hint || null,
          // A minute of slack before the token's real expiry so a sync
          // that starts right at the edge doesn't get cut off mid-request.
          expiresAt: Date.now() + Math.max(0, (response.expires_in || 0) - 60) * 1000,
        })
        remember(hint)
        try {
          const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${response.access_token}` },
          })
          const info = await res.json()
          setState({ ...state, email: info.email || hint || null })
          remember(info.email || hint)
        } catch {
          // Cosmetic only (shows "Connected as ...") - the connection
          // itself already succeeded above.
        }
        resolve(state)
      },
      error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was cancelled.')),
    })
    tokenClient.requestAccessToken({ prompt, ...(hint ? { hint } : {}) })
  })
}

// Opens Google's own sign-in/consent popup. Resolves once a token comes
// back (throws if the admin closes the popup or Google refuses it, e.g.
// the OAuth client isn't configured for this origin yet).
export async function connectGoogleCalendar() {
  if (!CLIENT_ID) {
    throw new Error("Google Calendar isn't set up for this deployment yet - see Settings for what's missing.")
  }
  return requestToken({ prompt: 'consent' })
}

export function disconnectGoogleCalendar() {
  if (state.accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(state.accessToken, () => {})
  }
  forget()
  setState({ accessToken: null, email: null, expiresAt: 0, reconnecting: false })
}

// The account that was connected before this page load, if any (what the
// Settings UI shows while the token is being renewed or waiting on a click).
export function getRememberedGoogleAccount() {
  return readRemembered()
}

let pendingReconnect = null
let lastFailedAt = 0

// Resolves true when a valid token is available - already connected, or
// just silently renewed from an earlier connection - false otherwise. Never
// throws. After a failed silent attempt it leaves the popup alone for a
// minute, so a signed-out Google session doesn't pop a window on every save.
export function ensureGoogleCalendarToken() {
  if (isGoogleCalendarConnected()) return Promise.resolve(true)
  if (pendingReconnect) return pendingReconnect
  const remembered = readRemembered()
  if (!CLIENT_ID || !remembered || Date.now() - lastFailedAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve(false)
  setState({ ...state, reconnecting: true })
  pendingReconnect = requestToken({ prompt: '', hint: remembered.email || undefined })
    .then(
      () => true,
      () => {
        lastFailedAt = Date.now()
        return false
      }
    )
    .finally(() => {
      pendingReconnect = null
      setState({ ...state, reconnecting: false })
    })
  return pendingReconnect
}

if (CLIENT_ID && typeof document !== 'undefined') {
  // Loaded up front so the script is ready by the time a click needs it.
  if (readRemembered()) loadGoogleIdentityServices().catch(() => {})
  // Always listening (it's a no-op until something was remembered), since a
  // token can also run out mid-session after a connect made in this tab.
  document.addEventListener('pointerdown', () => void ensureGoogleCalendarToken(), { capture: true, passive: true })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Google throttles calendar writes per user per second, so a burst (e.g. the
// "Add every existing date" button) gets "Rate Limit Exceeded" - retried here
// with exponential backoff, as Google's docs ask, instead of failing.
async function calendarFetch(path, options) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${EVENTS_URL}${path}`, {
      ...options,
      headers: { ...options?.headers, Authorization: `Bearer ${state.accessToken}`, 'Content-Type': 'application/json' },
    })
    if (res.ok) return res.status === 204 ? null : res.json()
    const body = await res.json().catch(() => null)
    const reason = body?.error?.errors?.[0]?.reason
    const throttled = res.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'
    if (throttled && attempt < 5) {
      await sleep(600 * 2 ** attempt + Math.random() * 300)
      continue
    }
    throw new Error(body?.error?.message || `Google Calendar API error (${res.status})`)
  }
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
// ensureGoogleCalendarToken() first and decide what "not connected" means
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
