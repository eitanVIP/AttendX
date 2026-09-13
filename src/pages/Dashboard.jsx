import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import StickyTableScroll from '../components/StickyTableScroll'
import {
  useAllAttendance,
  useCommunityLogs,
  useCommunitySettings,
  useEvents,
  useNow,
  useStudents,
  useTrainings,
} from '../lib/firestore-hooks'
import {
  certProgress,
  eventCountdown,
  studentCommunityHours,
  summarizeAttendance,
  trainingCompletionByGrade,
} from '../lib/calc'

export default function Dashboard() {
  const { team } = useAuth()
  const { data: students, loading: studentsLoading } = useStudents(team)
  const { data: trainings, loading: trainingsLoading } = useTrainings(team?.id)
  const { data: attendance, loading: attLoading } = useAllAttendance(team?.id)
  const { data: communityLogs, loading: logsLoading } = useCommunityLogs(team?.id)
  const { settings: communitySettings, loading: settingsLoading } = useCommunitySettings(team?.id)
  const { data: events } = useEvents(team?.id)

  const activeStudents = useMemo(() => students.filter((s) => s.active), [students])
  const certifications = useMemo(
    () => trainings.filter((t) => t.category === 'professional').sort((a, b) => a.name.localeCompare(b.name)),
    [trainings]
  )
  const regularTrainings = useMemo(() => trainings.filter((t) => t.category !== 'professional'), [trainings])

  const completionByGrade = useMemo(
    () => trainingCompletionByGrade(students, regularTrainings, team?.divisions || []),
    [students, regularTrainings, team?.divisions]
  )

  const attendanceByStudent = useMemo(() => {
    const grouped = {}
    for (const s of students) grouped[s.id] = []
    for (const r of attendance) {
      if (grouped[r.studentId]) grouped[r.studentId].push(r)
    }
    const summaries = {}
    for (const [id, records] of Object.entries(grouped)) {
      summaries[id] = summarizeAttendance(records)
    }
    return summaries
  }, [attendance, students])

  // Everyone, inactive included (dimmed) - the students with the lowest
  // attendance are exactly the ones this chart is for.
  const attendanceBars = useMemo(
    () =>
      students
        .map((s) => ({ student: s, percent: attendanceByStudent[s.id]?.percent ?? null }))
        .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1)),
    [students, attendanceByStudent]
  )

  const divisionStats = useMemo(() => {
    return (team?.divisions || []).map((d) => {
      const divStudents = activeStudents.filter((s) => s.divisions.includes(d))
      const percents = divStudents
        .map((s) => attendanceByStudent[s.id]?.percent)
        .filter((p) => p !== null && p !== undefined)
      const avg = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null
      return { division: d, count: divStudents.length, avgAttendance: avg }
    })
  }, [team, activeStudents, attendanceByStudent])

  const hoursByStudent = useMemo(() => {
    const map = {}
    for (const s of activeStudents) map[s.id] = studentCommunityHours(communityLogs, s.id)
    return map
  }, [communityLogs, activeStudents])

  const studentsMetHours = useMemo(() => {
    if (!communitySettings.hoursTarget) return null
    return activeStudents.filter((s) => hoursByStudent[s.id] >= communitySettings.hoursTarget).length
  }, [activeStudents, hoursByStudent, communitySettings.hoursTarget])

  const loading = studentsLoading || trainingsLoading || attLoading || logsLoading || settingsLoading
  if (loading) return <div className="page-loading">Loading dashboard…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <NoDivisionsNotice team={team} />

      <EventCountdowns events={events} />

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Active students</span>
          <span className="stat-value">
            {activeStudents.length}
            <span className="stat-value-sub">
              {' '}
              · {students.length ? Math.round((activeStudents.length / students.length) * 100) : 0}%
            </span>
          </span>
          <span className="muted">
            of {students.length} total · {students.length - activeStudents.length} inactive
          </span>
        </div>
        {communitySettings.hoursTarget > 0 && (
          <div className="card stat-card">
            <span className="stat-label">Completed community hours</span>
            <span className="stat-value">
              {studentsMetHours}/{activeStudents.length}
            </span>
            <span className="muted">{communitySettings.hoursTarget} hrs required</span>
          </div>
        )}
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-col">
          <h2>By division</h2>
          <StickyTableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Division</th>
                  <th>Students</th>
                  <th>Avg. attendance</th>
                </tr>
              </thead>
              <tbody>
                {divisionStats.map((d) => (
                  <tr key={d.division}>
                    <td>{d.division}</td>
                    <td>{d.count}</td>
                    <td>{d.avgAttendance === null ? '—' : `${d.avgAttendance}%`}</td>
                  </tr>
                ))}
                {divisionStats.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-cell">
                      No divisions set up.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </StickyTableScroll>

          <h2>Attendance by student</h2>
          <div className="card bar-chart">
            {attendanceBars.map(({ student, percent }) => (
              <Link
                to={`/students/${student.id}`}
                key={student.id}
                className={`bar-row ${student.active ? '' : 'row-inactive'}`}
                title={student.active ? undefined : 'Inactive'}
              >
                <span className="bar-row-name">{student.fullName}</span>
                <span className="bar-row-track">
                  <span className="bar-row-fill" style={{ width: `${percent ?? 0}%` }} />
                </span>
                <span className="bar-row-value">{percent === null ? '—' : `${percent}%`}</span>
              </Link>
            ))}
            {attendanceBars.length === 0 && <p className="muted">No students yet.</p>}
          </div>

          <h2>Training completion by grade</h2>
          <div className="card bar-chart grade-chart">
            {completionByGrade.map(({ division, rows }) => (
              <div key={division} className="grade-chart-block">
                <div className="grade-chart-division">{division}</div>
                {rows.map((row) => (
                  <div
                    key={row.grade}
                    className="bar-row"
                    title={`${row.completed} of ${row.total} trainings completed across ${row.students} student${row.students === 1 ? '' : 's'}`}
                  >
                    <span className="bar-row-name">{row.grade}</span>
                    <span className="bar-row-track">
                      <span className="bar-row-fill" style={{ width: `${row.percent ?? 0}%` }} />
                    </span>
                    <span className="bar-row-value">{row.percent === null ? '—' : `${row.percent}%`}</span>
                  </div>
                ))}
              </div>
            ))}
            {completionByGrade.length === 0 && <p className="muted">No trainings apply to any active student yet.</p>}
          </div>
        </div>

        <div className="dashboard-col">
          <h2>Certifications</h2>
          <StickyTableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Certification</th>
                  <th>Division</th>
                  <th>Certified</th>
                </tr>
              </thead>
              <tbody>
                {certifications.map((cert) => {
                  const progress = certProgress(cert, students, trainings)
                  return (
                    <tr key={cert.id}>
                      <td>{cert.name}</td>
                      <td className="muted">{cert.scopeDivision || 'General'}</td>
                      <td>
                        <span className={progress.onTarget ? 'badge badge-ok' : 'badge badge-warn'}>
                          {progress.completed}/{progress.target}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {certifications.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-cell">
                      No certifications tracked yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </StickyTableScroll>
        </div>
      </div>
    </div>
  )
}

const pad = (n) => String(n).padStart(2, '0')

function EventCountdowns({ events }) {
  const now = useNow(1000)
  const upcoming = events
    .map((event) => ({ ...event, countdown: eventCountdown(event.date, now) }))
    .filter((event) => !event.countdown.past)
  if (upcoming.length === 0) return null
  const [next, ...rest] = upcoming
  return (
    <div className="events">
      <EventCard event={next} hero />
      {rest.length > 0 && (
        <div className="events-rest">
          {rest.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function EventCard({ event, hero }) {
  const { countdown } = event
  const time = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`
  return (
    <div className={`card event-card ${hero ? 'event-hero' : ''}`}>
      <span className="stat-label">{hero ? 'Next event' : 'Upcoming'}</span>
      <span className="event-name">{event.name}</span>
      <span className="event-countdown">
        {countdown.today ? (
          'Today'
        ) : (
          <>
            {countdown.days}
            <span className="event-unit">d</span> {time}
          </>
        )}
      </span>
      <span className="muted">{event.date}</span>
    </div>
  )
}
