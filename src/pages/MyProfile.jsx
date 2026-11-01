import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { communityDb } from '../firebase'
import { loadAttendanceRecords } from '../lib/attendanceRecords'
import { useStudentAuth } from '../context/StudentAuthContext'
import StudentProfileView from '../components/StudentProfileView'
import { normalizeStudentForView } from '../lib/calc'

// A StudentLayout tab - the same profile an admin sees at /students/:id
// (see StudentProfileView), but read-only (no onDeleteLog passed down, so
// StudentProfileView never renders that button) and scoped to whichever
// student signed in. Attendance is fetched per-session (there's no
// collectionGroup rule for it, same reason admin's own hooks avoid one -
// see the comment in firestore-hooks.js), keeping only this student's own
// record out of each session's attendance subcollection.
export default function MyProfile() {
  const { verified, studentId, student: rawStudent } = useStudentAuth()
  const [trainings, setTrainings] = useState([])
  const [sessions, setSessions] = useState([])
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [communityLogs, setCommunityLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'AttendX | My Profile'
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [trainingsSnap, sessionsSnap, logsSnap] = await Promise.all([
        getDocs(collection(communityDb, 'teams', verified.teamId, 'trainings')),
        getDocs(collection(communityDb, 'teams', verified.teamId, 'sessions')),
        getDocs(collection(communityDb, 'teams', verified.teamId, 'communityLogs')),
      ])
      if (cancelled) return
      const sessionDocs = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setTrainings(trainingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setSessions(sessionDocs)
      setCommunityLogs(logsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
      const records = await loadAttendanceRecords(communityDb, verified.teamId, sessionDocs, studentId)
      if (cancelled) return
      setAttendanceRecords(records)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [verified.teamId, studentId])

  const structure = useMemo(
    () => ({
      divisions: verified.divisions,
      subdivisionsByDivision: verified.subdivisionsByDivision,
      minAttendancePercent: verified.minAttendancePercent,
      attendancePlans: verified.attendancePlans,
      weekStartsOn: verified.weekStartsOn,
      attendanceFlagWeeks: verified.attendanceFlagWeeks,
      skippedWeeks: verified.skippedWeeks,
    }),
    [
      verified.divisions,
      verified.subdivisionsByDivision,
      verified.minAttendancePercent,
      verified.attendancePlans,
      verified.weekStartsOn,
      verified.attendanceFlagWeeks,
      verified.skippedWeeks,
    ]
  )
  const sessionById = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])
  const student = useMemo(
    () => normalizeStudentForView(rawStudent, structure, attendanceRecords, sessionById),
    [rawStudent, structure, attendanceRecords, sessionById]
  )

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <StudentProfileView
      student={student}
      attendanceRecords={attendanceRecords}
      sessions={sessions}
      trainings={trainings}
      communityLogs={communityLogs}
      communitySettings={{ hoursTarget: verified.hoursTarget, types: verified.communityTypes }}
      divisions={verified.divisions}
      subdivisionsByDivision={verified.subdivisionsByDivision}
      streakResetDays={verified.streakResetDays}
    />
  )
}
