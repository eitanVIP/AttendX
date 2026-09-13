// Remembers a student's team ID + code on this device (localStorage) so they
// don't have to retype it every visit to /student-login. Wrapped in
// try/catch since localStorage can throw (private browsing, disabled
// storage, etc.) - falling back to "not saved" is fine, it just means
// retyping is required.
const STORAGE_KEY = 'attendx.logHoursCode'

export function loadSavedLogHoursCode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.teamId !== 'string' || typeof parsed?.code !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function saveLogHoursCode(teamId, code) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId, code }))
  } catch {
    // ignore - just means it won't be remembered next time
  }
}
