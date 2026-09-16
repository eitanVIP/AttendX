import { useEffect, useMemo } from 'react'
import { useStudentAuth } from '../context/StudentAuthContext'
import StreakBadge from '../components/StreakBadge'
import { effectiveStreak } from '../lib/calc'

// A StudentLayout tab - the same leaderboard an admin sees on the Dashboard
// (top training streaks), but the full roster rather than just the top 10,
// and with this student's own row highlighted so they can find themselves
// in a long list. `verified.students` already has the whole roster (see
// StudentAuthContext), so this needs no fetch of its own.
export default function Streaks() {
  const { verified, studentId } = useStudentAuth()

  useEffect(() => {
    document.title = 'AttendX | Streaks'
  }, [])

  const board = useMemo(() => {
    return verified.students
      .map((s) => ({ student: s, streak: effectiveStreak(s, verified.streakResetDays) }))
      .sort((a, b) => b.streak - a.streak)
  }, [verified.students, verified.streakResetDays])

  return (
    <div className="page">
      <h1>Training streaks</h1>
      {board.length === 0 ? (
        <p className="muted">No students yet.</p>
      ) : (
        <ol className="streak-board">
          {board.map(({ student, streak }, i) => (
            <li key={student.id}>
              <div className={`streak-board-row ${student.id === studentId ? 'streak-board-row-me' : ''}`}>
                <span className="streak-board-rank">#{i + 1}</span>
                <span className="streak-board-name">{student.fullName}</span>
                <StreakBadge streak={streak} frozen={!!student.trainingStreakFrozen} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
