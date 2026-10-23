import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { attendanceRecords } from './attendanceRecords'
import { normalizeProduct, normalizeStudent, remapStudentDivisions, sortByOrder, summarizeAttendance } from './calc'

const byName = (a, b) => (a.fullName || a.name || '').localeCompare(b.fullName || b.name || '')
const byDate = (a, b) => (a.date || '').localeCompare(b.date || '')

function useCollection(path) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!path) return
    setLoading(true)
    const unsubscribe = onSnapshot(
      collection(db, ...path),
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      }
    )
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(path)])

  return { data, loading, error }
}

// Takes the whole team doc (not just its id) for two derived fields:
//
// - Any division/subdivision a student still references that the team no
//   longer defines is hidden on read. Settings rewrites students when the
//   structure changes, but this keeps a stale reference from surfacing
//   regardless of how it got there; the doc is corrected the next time the
//   student is edited or the structure is saved.
// - `active` / `autoInactive`: a student is active unless marked inactive
//   by hand or their attendance is under team.minAttendancePercent. The
//   auto rule always wins over a manual "active" - it's derived here, never
//   written, so it reverses by itself once attendance recovers. `status`
//   stays the stored (manual) value so the edit form round-trips it.
export function useStudents(team) {
  const result = useCollection(team ? ['teams', team.id, 'students'] : null)
  const minPercent = team?.minAttendancePercent || 0
  const { data: attendance, loading: attendanceLoading } = useAllAttendance(minPercent > 0 ? team.id : null)

  const data = useMemo(() => {
    const recordsByStudent = {}
    for (const r of attendance) (recordsByStudent[r.studentId] ??= []).push(r)
    return sortByOrder(result.data, byName).map((raw) => {
      const base = normalizeStudent(raw)
      const student = { ...base, ...remapStudentDivisions(base, team) }
      const percent = minPercent > 0 ? summarizeAttendance(recordsByStudent[student.id] || []).percent : null
      const autoInactive = percent !== null && percent < minPercent
      return { ...student, attendancePercent: percent, autoInactive, active: student.status !== 'inactive' && !autoInactive }
    })
  }, [result.data, team, attendance, minPercent])

  return { ...result, data, loading: result.loading || (minPercent > 0 && attendanceLoading) }
}

export function useTrainings(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'trainings'] : null)
  const data = useMemo(() => sortByOrder(result.data, byName), [result.data])
  return { ...result, data }
}

export function useSessions(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'sessions'] : null)
  const data = useMemo(() => sortByOrder(result.data, byDate), [result.data])
  return { ...result, data }
}

export function useCommunityLogs(teamId) {
  return useCollection(teamId ? ['teams', teamId, 'communityLogs'] : null)
}

export function useEvents(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'events'] : null)
  const data = useMemo(() => [...result.data].sort(byDate), [result.data])
  return { ...result, data }
}

// Inventory and Orders are two views of one products collection - see
// normalizeProduct in calc.js for why a single shared doc is what makes
// them unable to drift into duplicate, unlinked entries.
export function useProducts(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'products'] : null)
  const data = useMemo(() => result.data.map(normalizeProduct).sort(byName), [result.data])
  return { ...result, data }
}

// Pending product requests from the public request-a-product page (see
// src/pages/RequestOrder.jsx) - same doc shape as a product (plus
// requestedBy/requestedAt), so normalizeProduct fills in the same defaults.
export function useOrderRequests(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'orderRequests'] : null)
  const data = useMemo(() => result.data.map(normalizeProduct).sort(byName), [result.data])
  return { ...result, data }
}

// Logged purchases (see logPurchase in actions.js) - newest first, so
// Orders' Bought table and the dashboard's budget section both see the
// latest one at the top without sorting it themselves.
export function usePurchases(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'purchases'] : null)
  const data = useMemo(() => [...result.data].sort((a, b) => byDate(b, a)), [result.data])
  return { ...result, data }
}

// The system log (see logChange in actions.js) - newest first, so an admin
// checking in on it sees the latest changes without sorting themselves.
export function useLog(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'log'] : null)
  const data = useMemo(() => [...result.data].sort((a, b) => (b.at || '').localeCompare(a.at || '')), [result.data])
  return { ...result, data }
}

// Admin view of every student's systems (see DEFAULT_SYSTEM in calc.js) -
// `needs` defaults to [] for a doc somehow missing it, same defensive
// normalization normalizeProduct does for products.
export function useSystems(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'systems'] : null)
  const data = useMemo(() => result.data.map((s) => ({ needs: [], ...s })), [result.data])
  return { ...result, data }
}

// Re-renders on a fixed cadence - for countdowns that should tick.
export function useNow(intervalMs) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

const DEFAULT_COMMUNITY_SETTINGS = { types: [], hoursTarget: 0 }

export function useCommunitySettings(teamId) {
  const [settings, setSettings] = useState(DEFAULT_COMMUNITY_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!teamId) return
    setLoading(true)
    const unsubscribe = onSnapshot(
      doc(db, 'teams', teamId, 'settings', 'community'),
      (snap) => {
        setSettings(snap.exists() ? { ...DEFAULT_COMMUNITY_SETTINGS, ...snap.data() } : DEFAULT_COMMUNITY_SETTINGS)
        setLoading(false)
      },
      () => {
        setSettings(DEFAULT_COMMUNITY_SETTINGS)
        setLoading(false)
      }
    )
    return unsubscribe
  }, [teamId])

  return { settings, loading }
}

// Attendance is stored on each session doc as `attendance: { [studentId]:
// status }` (see setAttendance in actions.js), so the sessions listener
// already carries every record - no per-session subcollection listeners.
// Reading the old teams/{id}/sessions/{id}/attendance docs one session at a
// time cost sessions x students reads on every page load.

export function useAllAttendance(teamId) {
  const { data: sessions, loading } = useSessions(teamId)
  const data = useMemo(() => attendanceRecords(sessions), [sessions])
  return { data, loading }
}

export function useStudentAttendance(teamId, studentId) {
  const { data: sessions, loading } = useSessions(teamId)
  const data = useMemo(() => attendanceRecords(sessions, studentId), [sessions, studentId])
  return { data, loading }
}
