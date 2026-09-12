import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { normalizeStudent } from './calc'

function useCollection(path, orderByField) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!path) return
    setLoading(true)
    const ref = collection(db, ...path)
    const q = orderByField ? query(ref, orderBy(orderByField)) : ref
    const unsubscribe = onSnapshot(
      q,
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
  }, [JSON.stringify(path), orderByField])

  return { data, loading, error }
}

export function useStudents(teamId) {
  const result = useCollection(teamId ? ['teams', teamId, 'students'] : null, 'fullName')
  const data = useMemo(() => result.data.map(normalizeStudent), [result.data])
  return { ...result, data }
}

export function useTrainings(teamId) {
  return useCollection(teamId ? ['teams', teamId, 'trainings'] : null, 'order')
}

export function useSessions(teamId) {
  return useCollection(teamId ? ['teams', teamId, 'sessions'] : null, 'date')
}

export function useSessionAttendance(teamId, sessionId) {
  return useCollection(
    teamId && sessionId ? ['teams', teamId, 'sessions', sessionId, 'attendance'] : null
  )
}

export function useCommunityLogs(teamId) {
  return useCollection(teamId ? ['teams', teamId, 'communityLogs'] : null)
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

// Neither of these use a collectionGroup query - fetching "attendance across
// every session" instead fans out into one plain subcollection (or single
// doc) listener per session, using exactly the nested-path reads that
// firestore.rules' teams/{teamId}/{document=**} rule already covers.
// collectionGroup queries need their own separate top-level rule that
// proved unreliable to get working in practice; this avoids needing one at
// all, at the cost of one listener per session instead of a single query -
// fine at the scale this app runs at.

export function useAllAttendance(teamId) {
  const { data: sessions, loading: sessionsLoading } = useSessions(teamId)
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions])
  const sessionIdsKey = sessionIds.join(',')
  const [bySession, setBySession] = useState({})

  useEffect(() => {
    if (!teamId || sessionsLoading) return
    setBySession((prev) => {
      const next = {}
      for (const id of sessionIds) if (prev[id]) next[id] = prev[id]
      return next
    })
    const unsubscribes = sessionIds.map((sessionId) =>
      onSnapshot(
        collection(db, 'teams', teamId, 'sessions', sessionId, 'attendance'),
        (snap) => {
          setBySession((prev) => ({
            ...prev,
            [sessionId]: snap.docs.map((d) => ({ id: d.id, sessionId, ...d.data() })),
          }))
        },
        () => {
          setBySession((prev) => ({ ...prev, [sessionId]: [] }))
        }
      )
    )
    return () => unsubscribes.forEach((unsub) => unsub())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, sessionIdsKey, sessionsLoading])

  const data = useMemo(() => Object.values(bySession).flat(), [bySession])
  return { data, loading: sessionsLoading }
}

export function useStudentAttendance(teamId, studentId) {
  const { data: sessions, loading: sessionsLoading } = useSessions(teamId)
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions])
  const sessionIdsKey = sessionIds.join(',')
  const [bySession, setBySession] = useState({})

  useEffect(() => {
    if (!teamId || !studentId || sessionsLoading) return
    setBySession((prev) => {
      const next = {}
      for (const id of sessionIds) if (id in prev) next[id] = prev[id]
      return next
    })
    const unsubscribes = sessionIds.map((sessionId) =>
      onSnapshot(
        doc(db, 'teams', teamId, 'sessions', sessionId, 'attendance', studentId),
        (snap) => {
          setBySession((prev) => ({
            ...prev,
            [sessionId]: snap.exists() ? { id: snap.id, sessionId, ...snap.data() } : null,
          }))
        },
        () => {
          setBySession((prev) => ({ ...prev, [sessionId]: null }))
        }
      )
    )
    return () => unsubscribes.forEach((unsub) => unsub())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, studentId, sessionIdsKey, sessionsLoading])

  const data = useMemo(() => Object.values(bySession).filter(Boolean), [bySession])
  return { data, loading: sessionsLoading }
}
