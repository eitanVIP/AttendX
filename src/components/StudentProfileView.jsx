import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import FormPanel from './FormPanel'
import DataTable from './DataTable'
import StreakBadge from './StreakBadge'
import StreakTabs from './StreakTabs'
import {
  STREAK_KINDS,
  activityLabel,
  attendanceStreak,
  countedRecords,
  describeStudentDivisions,
  effectiveStreak,
  formatDate,
  formatLocalDateTime,
  groupByScope,
  isCountableTraining,
  streakContributionsField,
  streakResetHours,
  studentCommunityHours,
  studentHasCert,
  studentTrainingStats,
  summarizeAttendance,
  trainingAppliesToStudent,
} from '../lib/calc'

const percent = (value) => (value === null ? '—' : `${value}%`)

// "Resets in 3 days" / "Resets in 4 hours" under the streak badge - null
// (nothing rendered) once there's no active streak to count down, or while
// it's frozen (see streakResetHours in calc.js).
function describeStreakReset(hours) {
  if (hours === null) return null
  if (hours >= 24) {
    const days = Math.ceil(hours / 24)
    return `Resets in ${days} day${days === 1 ? '' : 's'}`
  }
  const wholeHours = Math.max(1, Math.ceil(hours))
  return `Resets in ${wholeHours} hour${wholeHours === 1 ? '' : 's'}`
}

// One student's full profile: attendance stats/history, community hours
// log, and certifications/trainings grouped by division/subdivision -
// shared by the admin's own student page (StudentProfile.jsx) and the
// read-only one a student sees of themselves (MyProfile.jsx). Every prop
// here is already-fetched data, not a hook - each caller fetches through
// whichever Firestore access level it actually has (the main `db` for the
// admin, `communityDb` for a student) and hands the raw collections over;
// this component does all the deriving so neither caller has to duplicate
// it. `onDeleteLog` and `backLink` are both optional - omitting them is
// what makes the read-only student view read-only, rather than a separate
// prop toggling every action off individually.
export default function StudentProfileView({
  student,
  attendanceRecords,
  attendanceLoading = false,
  sessions,
  trainings,
  communityLogs,
  communitySettings,
  divisions,
  subdivisionsByDivision,
  streakResetDays,
  onDeleteLog,
  onUpdateStreak,
  backLink,
}) {
  const [streakKind, setStreakKind] = useState('training')
  const [streakEditOpen, setStreakEditOpen] = useState(false)
  const [streakValue, setStreakValue] = useState('')
  const [showContributions, setShowContributions] = useState(false)

  const sessionById = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])

  // Attendance has no stored counter to read (see attendanceStreak in
  // calc.js) - it's recomputed from this student's own attendance records
  // every render, same records the history table below already has.
  // Weeks the team switched off are left out of the streak and the numbers
  // (the history table below still lists every meeting).
  const countedAttendance = useMemo(
    () => countedRecords(attendanceRecords, sessionById, student.skippedWeekStarts, student.weekStartsOn),
    [attendanceRecords, sessionById, student.skippedWeekStarts, student.weekStartsOn]
  )
  const attendanceStreakValue = useMemo(
    () => attendanceStreak(countedAttendance, sessionById),
    [countedAttendance, sessionById]
  )
  const streak = streakKind === 'attendance' ? attendanceStreakValue : effectiveStreak(student, streakResetDays, streakKind)
  const streakFrozen = streakKind !== 'attendance' && !!student[`${streakKind}StreakFrozen`]
  const streakResetMessage = describeStreakReset(streakResetHours(student, streakResetDays, streakKind))
  // Newest first - what most recently happened is what someone clicking
  // the streak open is most likely wondering about.
  const streakContributions = useMemo(
    () => [...(student[streakContributionsField(streakKind)] || [])].reverse(),
    [student, streakKind]
  )

  const summary = useMemo(() => summarizeAttendance(countedAttendance), [countedAttendance])
  // Total is split into sessions aimed at one division ("division") and
  // sessions for everyone ("general"), so a student's absences from their
  // own division's meetings don't get averaged away by all-hands ones.
  const breakdown = useMemo(() => {
    const division = []
    const general = []
    for (const r of countedAttendance) {
      const session = sessionById[r.sessionId]
      if (!session) continue
      ;(!session.targetDivision || session.targetDivision === 'all' ? general : division).push(r)
    }
    return { division: summarizeAttendance(division), general: summarizeAttendance(general) }
  }, [countedAttendance, sessionById])

  const regularTrainings = useMemo(() => trainings.filter(isCountableTraining), [trainings])
  // Order preserved from useTrainings (sorted by `order`, same as the
  // Certifications/Trainings pages) rather than re-sorted by name here.
  const certifications = useMemo(() => trainings.filter((t) => t.category === 'professional'), [trainings])
  const trainingStats = useMemo(() => studentTrainingStats(student, regularTrainings), [student, regularTrainings])
  const applicableTrainings = useMemo(
    () => regularTrainings.filter((t) => trainingAppliesToStudent(t, student)),
    [student, regularTrainings]
  )
  const applicableCerts = useMemo(
    () => certifications.filter((t) => trainingAppliesToStudent(t, student)),
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

  const communityHours = useMemo(() => studentCommunityHours(communityLogs, student.id), [communityLogs, student.id])
  const studentCommunityLogs = useMemo(
    () => communityLogs.filter((l) => l.studentId === student.id).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [communityLogs, student.id]
  )

  const history = useMemo(
    () =>
      [...attendanceRecords]
        .map((r) => ({ ...r, session: sessionById[r.sessionId] }))
        .filter((r) => r.session)
        .sort((a, b) => (a.session.date < b.session.date ? 1 : -1)),
    [attendanceRecords, sessionById]
  )

  return (
    <div className="page">
      {backLink && (
        <Link to={backLink.to} className="back-link">
          ← {backLink.label}
        </Link>
      )}
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
          <span className="stat-value">{percent(student.planInfo ? student.planInfo.percent : summary.percent)}</span>
          {student.planInfo ? (
            <>
              <span className="muted">
                {student.planInfo.plan} · {student.planInfo.perWeek} a week
              </span>
              <span className="muted" title="Oldest to newest, last 8 weeks with meetings">
                {student.planInfo.weeks.slice(-8).map((w) => (
                  <span key={w.week} title={`Week of ${w.week}: ${w.attended} of ${w.required} needed`}>
                    {w.met ? '✓' : '✗'}{' '}
                  </span>
                ))}
              </span>
              {student.planInfo.flag && (
                <span className={`badge ${student.planInfo.flag.type === 'short' ? 'badge-warn' : 'badge-ok'}`}>
                  {student.planInfo.flag.message}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="muted">
                Division {percent(breakdown.division.percent)} · General {percent(breakdown.general.percent)}
              </span>
              <span className="muted">{summary.statusLabel}</span>
            </>
          )}
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
        <div className="card stat-card">
          <span className="stat-label">Streak</span>
          <StreakTabs kind={streakKind} onChange={setStreakKind} />
          <StreakBadge streak={streak} frozen={streakFrozen} />
          {streakKind === 'attendance' ? (
            streak > 0 && <span className="muted">Resets immediately after an absence</span>
          ) : (
            <>
              {streak > 0 && <span className="muted">{streakFrozen ? "Frozen - won't reset" : streakResetMessage}</span>}
              <button
                type="button"
                className="link-btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setShowContributions((o) => !o)}
                aria-expanded={showContributions}
              >
                {showContributions ? 'Hide what counts' : 'Show what counts'}
              </button>
              {showContributions && (
                <ul className="streak-contributions">
                  {streakContributions.length === 0 && <li className="muted">Nothing counted yet.</li>}
                  {streakContributions.map((c) => (
                    <li key={c.id}>
                      <span>
                        {c.type === 'manual'
                          ? `Manually set to ${c.value}`
                          : streakKind === 'training'
                            ? c.trainingName
                            : `${c.hours}h of ${c.communityType}`}
                      </span>
                      <span className="muted">{formatLocalDateTime(c.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {onUpdateStreak && (
                <div className="row-actions" style={{ justifyContent: 'flex-start', marginTop: 2 }}>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setStreakValue(String(streak))
                      setStreakEditOpen(true)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onUpdateStreak(streakKind, { [`${streakKind}StreakFrozen`]: !streakFrozen })}
                  >
                    {streakFrozen ? 'Unfreeze' : 'Freeze'}
                  </button>
                </div>
              )}
            </>
          )}
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
      {attendanceLoading ? (
        <p className="muted">Loading history…</p>
      ) : (
        <DataTable
          columns={[
            { key: 'date', header: 'Date', nowrap: true, cell: (r) => formatDate(r.session.date) },
            { key: 'session', header: 'Session', spread: true, cell: (r) => r.session.name },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => <span className={`badge status-badge-${r.status}`}>{r.status}</span>,
            },
            { key: 'notes', header: 'Notes', cellClassName: 'muted', cell: (r) => r.session.notes || '—' },
          ]}
          rows={history}
          emptyMessage="No attendance recorded yet."
        />
      )}

      {communitySettings.hoursTarget > 0 && (
        <>
          <h2>Community hours log</h2>
          <DataTable
            columns={[
              { key: 'date', header: 'Date', nowrap: true, cell: (l) => formatDate(l.date) },
              { key: 'type', header: 'Type', spread: true, cell: (l) => l.type },
              { key: 'hours', header: 'Hours', cell: (l) => l.hours },
              { key: 'notes', header: 'Notes', cellClassName: 'muted', cell: (l) => l.notes || '—' },
              ...(onDeleteLog
                ? [
                    {
                      key: 'actions',
                      header: '',
                      cell: (l) => (
                        <div className="row-actions">
                          <button className="link-btn danger" onClick={() => onDeleteLog(l)}>
                            Delete
                          </button>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
            rows={studentCommunityLogs}
            emptyMessage="No hours logged yet."
          />
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

      {onUpdateStreak && (
        <FormPanel
          open={streakEditOpen}
          onClose={() => setStreakEditOpen(false)}
          onSubmit={(e) => {
            e.preventDefault()
            onUpdateStreak(streakKind, { [`${streakKind}Streak`]: Math.max(0, Math.round(Number(streakValue)) || 0) })
            setStreakEditOpen(false)
          }}
        >
          <h2>Edit {STREAK_KINDS.find((k) => k.id === streakKind)?.label.toLowerCase()} streak</h2>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label>
              Streak
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={streakValue}
                onChange={(e) => setStreakValue(e.target.value)}
                autoFocus
                required
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setStreakEditOpen(false)}>
              Cancel
            </button>
            <button type="submit">Save</button>
          </div>
        </FormPanel>
      )}
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
        <DataTable
          columns={[
            { key: 'name', header: 'Training', spread: true, cell: (t) => t.name },
            { key: 'category', header: 'Category', cellClassName: 'muted', cell: (t) => t.category },
            {
              key: 'status',
              header: 'Status',
              cell: (t) => {
                const completed = t.completedStudentIds?.includes(studentId)
                return (
                  <span className={`badge ${completed ? 'badge-ok' : 'badge-warn'}`}>
                    {completed ? 'Completed' : 'Not yet'}
                  </span>
                )
              },
            },
          ]}
          rows={trainings}
          emptyMessage={emptyText}
        />
      )}
    </div>
  )
}
