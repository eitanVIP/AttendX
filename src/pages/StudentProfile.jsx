import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  useCommunityLogs,
  useCommunitySettings,
  useSessions,
  useStudentAttendance,
  useStudents,
  useTrainings,
} from '../lib/firestore-hooks'
import {
  describeStudentDivisions,
  studentCommunityHours,
  studentHasCert,
  studentTrainingStats,
  summarizeAttendance,
  trainingAppliesToStudent,
} from '../lib/calc'

export default function StudentProfile() {
  const { studentId } = useParams()
  const { team } = useAuth()
  const { data: students } = useStudents(team?.id)
  const { data: trainings } = useTrainings(team?.id)
  const { data: sessions } = useSessions(team?.id)
  const { data: attendanceRecords, loading } = useStudentAttendance(team?.id, studentId)
  const { data: communityLogs } = useCommunityLogs(team?.id)
  const { settings: communitySettings } = useCommunitySettings(team?.id)

  const student = students.find((s) => s.id === studentId)

  const summary = useMemo(() => summarizeAttendance(attendanceRecords), [attendanceRecords])
  const regularTrainings = useMemo(() => trainings.filter((t) => t.category !== 'professional'), [trainings])
  const certifications = useMemo(() => trainings.filter((t) => t.category === 'professional'), [trainings])
  const trainingStats = useMemo(
    () => (student ? studentTrainingStats(student, regularTrainings) : null),
    [student, regularTrainings]
  )
  const applicableTrainings = useMemo(
    () => (student ? regularTrainings.filter((t) => trainingAppliesToStudent(t, student)) : []),
    [student, regularTrainings]
  )
  const applicableCerts = useMemo(
    () => (student ? certifications.filter((t) => trainingAppliesToStudent(t, student)) : []),
    [student, certifications]
  )
  const communityHours = useMemo(() => studentCommunityHours(communityLogs, studentId), [communityLogs, studentId])
  const studentCommunityLogs = useMemo(
    () => communityLogs.filter((l) => l.studentId === studentId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [communityLogs, studentId]
  )

  const history = useMemo(() => {
    const sessionById = Object.fromEntries(sessions.map((s) => [s.id, s]))
    return [...attendanceRecords]
      .map((r) => ({ ...r, session: sessionById[r.sessionId] }))
      .filter((r) => r.session)
      .sort((a, b) => (a.session.date < b.session.date ? 1 : -1))
  }, [attendanceRecords, sessions])

  if (!student) return <div className="page-loading">Loading student…</div>

  return (
    <div className="page">
      <Link to="/students" className="back-link">
        ← Students
      </Link>
      <div className="page-header">
        <h1>{student.fullName}</h1>
      </div>
      <p className="muted">
        {describeStudentDivisions(student) || 'No division'} · Grade {student.grade || '—'} ·{' '}
        <span className={`badge ${student.status === 'inactive' ? 'badge-muted' : 'badge-ok'}`}>{student.status}</span>
      </p>

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Attendance</span>
          <span className="stat-value">{summary.percent === null ? '—' : `${summary.percent}%`}</span>
          <span className="muted">{summary.statusLabel}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Present / Late / Absent / Excused</span>
          <span className="stat-value">
            {summary.present} / {summary.late} / {summary.absent} / {summary.excused}
          </span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Trainings completed</span>
          <span className="stat-value">
            {trainingStats.completed}/{trainingStats.total}
          </span>
          <span className="muted">{trainingStats.percent === null ? '—' : `${trainingStats.percent}%`}</span>
        </div>
        {communitySettings.hoursTarget > 0 && (
          <div className="card stat-card">
            <span className="stat-label">Community hours</span>
            <span className="stat-value">
              {communityHours}/{communitySettings.hoursTarget}
            </span>
            <span className="muted">{communityHours >= communitySettings.hoursTarget ? 'Complete' : 'In progress'}</span>
          </div>
        )}
      </div>

      <h2>Trainings</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {applicableTrainings.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.category}</td>
                <td>
                  <span className={`badge ${t.completedStudentIds?.includes(student.id) ? 'badge-ok' : 'badge-warn'}`}>
                    {t.completedStudentIds?.includes(student.id) ? 'Completed' : 'Not yet'}
                  </span>
                </td>
              </tr>
            ))}
            {applicableTrainings.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-cell">
                  No trainings apply to this student.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Certifications</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {applicableCerts.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  <span className={`badge ${studentHasCert(c, student.id, trainings) ? 'badge-ok' : 'badge-warn'}`}>
                    {studentHasCert(c, student.id, trainings) ? 'Earned' : 'Not yet'}
                  </span>
                </td>
              </tr>
            ))}
            {applicableCerts.length === 0 && (
              <tr>
                <td colSpan={2} className="empty-cell">
                  No certifications apply to this student.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Attendance history</h2>
      {loading ? (
        <p className="muted">Loading history…</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Session</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{r.session.date}</td>
                  <td>{r.session.name}</td>
                  <td>
                    <span className={`badge status-badge-${r.status}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-cell">
                    No attendance recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {communitySettings.hoursTarget > 0 && (
        <>
          <h2>Community hours log</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Hours</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {studentCommunityLogs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.date}</td>
                    <td>{l.type}</td>
                    <td>{l.hours}</td>
                    <td className="muted">{l.notes || '—'}</td>
                  </tr>
                ))}
                {studentCommunityLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      No hours logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
