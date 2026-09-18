import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { communityDb } from '../firebase'
import { useStudentAuth } from '../context/StudentAuthContext'
import StreakBadge from '../components/StreakBadge'
import StreakTabs from '../components/StreakTabs'
import { streakBoard } from '../lib/calc'

// A StudentLayout tab - the same Training/Community/Attendance leaderboard
// an admin sees on the Dashboard, but the full roster rather than just the
// top 10, and with this student's own row highlighted so they can find
// themselves in a long list. `verified.students` already has the whole
// roster (see StudentAuthContext) for the training/community tabs; the
// attendance tab additionally needs every session and every student's
// attendance records, fetched once here the same way MyProfile.jsx fetches
// its own (sessions, then one attendance read per session).
export default function Streaks() {
  const { verified, studentId } = useStudentAuth()
  const [kind, setKind] = useState('training')
  const [sessions, setSessions] = useState([])
  const [recordsByStudent, setRecordsByStudent] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'AttendX | Streaks'
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const sessionsSnap = await getDocs(collection(communityDb, 'teams', verified.teamId, 'sessions'))
      const sessionDocs = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (cancelled) return
      setSessions(sessionDocs)
      const attendanceSnaps = await Promise.all(
        sessionDocs.map((s) => getDocs(collection(communityDb, 'teams', verified.teamId, 'sessions', s.id, 'attendance')))
      )
      if (cancelled) return
      const grouped = {}
      attendanceSnaps.forEach((snap, i) => {
        snap.docs.forEach((d) => {
          const record = { id: d.id, sessionId: sessionDocs[i].id, ...d.data() }
          ;(grouped[record.studentId] ??= []).push(record)
        })
      })
      setRecordsByStudent(grouped)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [verified.teamId])

  const sessionById = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])

  const board = useMemo(
    () => streakBoard(verified.students, kind, verified.streakResetDays, recordsByStudent, sessionById),
    [verified.students, kind, verified.streakResetDays, recordsByStudent, sessionById]
  )

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <h1>Streaks</h1>
      <StreakTabs kind={kind} onChange={setKind} />
      {board.length === 0 ? (
        <p className="muted">No students yet.</p>
      ) : (
        <ol className="streak-board">
          {board.map(({ student, streak }, i) => (
            <li key={student.id}>
              <div className={`streak-board-row ${student.id === studentId ? 'streak-board-row-me' : ''}`}>
                <span className="streak-board-rank">#{i + 1}</span>
                <span className="streak-board-name">{student.fullName}</span>
                <StreakBadge streak={streak} frozen={kind !== 'attendance' && !!student[`${kind}StreakFrozen`]} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
