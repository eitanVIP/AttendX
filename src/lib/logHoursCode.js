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

// Which student this device was last signed in as ("Remember me on this
// phone"). Together with the saved team + code it lets the site sign the
// student straight back in after a reload or when an installed app is opened.
const STUDENT_KEY = 'attendx.rememberedStudent'

export function loadRememberedStudent() {
  try {
    return localStorage.getItem(STUDENT_KEY) || null
  } catch {
    return null
  }
}

export function saveRememberedStudent(studentId) {
  try {
    localStorage.setItem(STUDENT_KEY, studentId)
  } catch {
    // ignore - just means it won't be remembered next time
  }
}

export function clearRememberedStudent() {
  try {
    localStorage.removeItem(STUDENT_KEY)
  } catch {
    // ignore
  }
}

export function saveLogHoursCode(teamId, code) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamId, code }))
  } catch {
    // ignore - just means it won't be remembered next time
  }
}
