import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StickyTableScroll from '../components/StickyTableScroll'
import {
  useCommunityLogs,
  useCommunitySettings,
  useSessions,
  useStudentAttendance,
  useStudents,
  useTrainings,
} from '../lib/firestore-hooks'
import {
  activityLabel,
  describeStudentDivisions,
  groupByScope,
  studentCommunityHours,
  studentHasCert,
  studentTrainingStats,
  summarizeAttendance,
  trainingAppliesToStudent,
} from '../lib/calc'
import { deleteCommunityLog } from '../lib/actions'

const percent = (value) => (value === null ? '—' : `${value}%`)

export default function StudentProfile() {
  const { studentId } = useParams()
  const { team } = useAuth()
  const { data: students } = useStudents(team)
  const { data: trainings } = useTrainings(team?.id)
  const { data: sessions } = useSessions(team?.id)
  const { data: attendanceRecords, loading } = useStudentAttendance(team?.id, studentId)
  const { data: communityLogs } = useCommunityLogs(team?.id)
  const { settings: communitySettings } = useCommunitySettings(team?.id)

  const student = students.find((s) => s.id === studentId)

  const sessionById = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])

  const summary = useMemo(() => summarizeAttendance(attendanceRecords), [attendanceRecords])
  // Total is split into sessions aimed at one division ("division") and
  // sessions for everyone ("general"), so a student's absences from their
  // own division's meetings don't get averaged away by all-hands ones.
  const breakdown = useMemo(() => {
    const division = []
    const general = []
    for (const r of attendanceRecords) {
      const session = sessionById[r.sessionId]
      if (!session) continue
      ;(!session.targetDivision || session.targetDivision === 'all' ? general : division).push(r)
    }
    return { division: summarizeAttendance(division), general: summarizeAttendance(general) }
  }, [attendanceRecords, sessionById])

  const divisions = useMemo(() => team?.divisions || [], [team])
  const subdivisionsByDivision = useMemo(() => team?.subdivisionsByDivision || {}, [team])
  const regularTrainings = useMemo(() => trainings.filter((t) => t.category !== 'professional'), [trainings])
  // Order preserved from useTrainings (sorted by `order`, same as the
  // Certifications/Trainings pages) rather than re-sorted by name here.
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
  const otherTrainings = useMemo(() => {
    const required = new Set(applicableCerts.flatMap((c) => c.requiredTrainingIds || []))
    return applicableTrainings.filter((t) => !required.has(t.id))
  }, [applicableCerts, applicableTrainings])

  // One section per division/subdivision (same order as Certifications.jsx/
  // Trainings.jsx), each with that scope's certs first and its other
  // (non-cert) trainings under them - built by grouping certs and other
  // trainings separately, then walking the scopes in the order a
  // combined grouping would produce, so a scope with only one of the two
  // still gets a section instead of being dropped.
  const scopeSections = useMemo(() => {
    const certGroups = groupByScope(applicableCerts, divisions, subdivisionsByDivision)
    const trainingGroups = groupByScope(otherTrainings, divisions, subdivisionsByDivision)
    const certsByKey = new Map(certGroups.map((g) => [g.key, g.items]))
    const trainingsByKey = new Map(trainingGroups.map((g) => [g.key, g.items]))
    const order = groupByScope([...applicableCerts, ...otherTrainings], divisions, subdivisionsByDivision)
    return order.map(({ key, division: d, subdivision: s }) => ({
      key,
      title: d ? (s ? `${d} / ${s}` : d) : 'General',
      certs: certsByKey.get(key) || [],
      otherTrainings: trainingsByKey.get(key) || [],
    }))
  }, [applicableCerts, otherTrainings, divisions, subdivisionsByDivision])

  const communityHours = useMemo(() => studentCommunityHours(communityLogs, studentId), [communityLogs, studentId])
  const studentCommunityLogs = useMemo(
    () => communityLogs.filter((l) => l.studentId === studentId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [communityLogs, studentId]
  )

  const history = useMemo(
    () =>
      [...attendanceRecords]
        .map((r) => ({ ...r, session: sessionById[r.sessionId] }))
        .filter((r) => r.session)
        .sort((a, b) => (a.session.date < b.session.date ? 1 : -1)),
    [attendanceRecords, sessionById]
  )

  async function handleDeleteLog(log) {
    if (!confirm(`Delete this entry (${log.hours}h, ${log.type}, ${log.date})?`)) return
    await deleteCommunityLog(team.id, log.id)
  }

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
        <span className={`badge ${student.active ? 'badge-ok' : 'badge-muted'}`}>{activityLabel(student)}</span>
      </p>

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Attendance</span>
          <span className="stat-value">{percent(summary.percent)}</span>
          <span className="muted">
            Division {percent(breakdown.division.percent)} · General {percent(breakdown.general.percent)}
          </span>
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
          <span className="muted">{percent(trainingStats.percent)}</span>
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

      <h2>Attendance history</h2>
      {loading ? (
        <p className="muted">Loading history…</p>
      ) : (
        <StickyTableScroll>
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
        </StickyTableScroll>
      )}

      {communitySettings.hoursTarget > 0 && (
        <>
          <h2>Community hours log</h2>
          <StickyTableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Hours</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {studentCommunityLogs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.date}</td>
                    <td>{l.type}</td>
                    <td>{l.hours}</td>
                    <td className="muted">{l.notes || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="link-btn danger" onClick={() => handleDeleteLog(l)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {studentCommunityLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      No hours logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </StickyTableScroll>
        </>
      )}

      <h2>Certifications &amp; trainings</h2>
      {scopeSections.length === 0 && <p className="muted">No trainings or certifications apply to this student.</p>}
      {scopeSections.map((scope) => (
        <div key={scope.key} className="scope-section">
          <h3 className="scope-section-title">{scope.title}</h3>
          {scope.certs.map((cert) => {
            const earned = studentHasCert(cert, student.id, trainings)
            const required = trainings.filter((t) => cert.requiredTrainingIds?.includes(t.id))
            const done = required.filter((t) => t.completedStudentIds?.includes(student.id)).length
            return (
              <TrainingGroup
                key={cert.id}
                title={cert.name}
                badge={
                  <span className={`badge ${earned ? 'badge-ok' : 'badge-warn'}`}>
                    {earned ? 'Earned' : `${done}/${required.length}`}
                  </span>
                }
                trainings={required}
                studentId={student.id}
                defaultOpen={!earned}
                emptyText="No trainings required for this certification yet."
              />
            )
          })}
          {scope.otherTrainings.length > 0 && (
            <TrainingGroup
              title="Other trainings"
              badge={
                <span className="badge badge-muted">
                  {scope.otherTrainings.filter((t) => t.completedStudentIds?.includes(student.id)).length}/
                  {scope.otherTrainings.length}
                </span>
              }
              trainings={scope.otherTrainings}
              studentId={student.id}
              defaultOpen
            />
          )}
        </div>
      ))}
    </div>
  )
}

// A certification (or the "other" bucket) as a collapsible heading over
// the table of its trainings. `defaultOpen` is read once: earned certs
// start folded, everything else starts open.
function TrainingGroup({ title, badge, trainings, studentId, defaultOpen, emptyText }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="training-group">
      <div className="training-group-header">
        <button
          type="button"
          className="disclosure"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Hide trainings' : 'Show trainings'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <h3>{title}</h3>
        {badge}
      </div>
      {open && (
        <StickyTableScroll>
          <table className="data-table">
            <thead>
              <tr>
                <th>Training</th>
                <th>Category</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {trainings.map((t) => {
                const completed = t.completedStudentIds?.includes(studentId)
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="muted">{t.category}</td>
                    <td>
                      <span className={`badge ${completed ? 'badge-ok' : 'badge-warn'}`}>
                        {completed ? 'Completed' : 'Not yet'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {trainings.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-cell">
                    {emptyText}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </StickyTableScroll>
      )}
    </div>
  )
}
