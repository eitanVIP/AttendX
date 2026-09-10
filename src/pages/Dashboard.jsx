import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAllAttendance, useCommunityLogs, useCommunitySettings, useStudents, useTrainings } from '../lib/firestore-hooks'
import { certProgress, studentCommunityHours, summarizeAttendance } from '../lib/calc'

export default function Dashboard() {
  const { team } = useAuth()
  const { data: students, loading: studentsLoading } = useStudents(team?.id)
  const { data: trainings, loading: trainingsLoading } = useTrainings(team?.id)
  const { data: attendance, loading: attLoading } = useAllAttendance(team?.id)
  const { data: communityLogs, loading: logsLoading } = useCommunityLogs(team?.id)
  const { settings: communitySettings, loading: settingsLoading } = useCommunitySettings(team?.id)

  const activeStudents = useMemo(() => students.filter((s) => s.status !== 'inactive'), [students])
  const certifications = useMemo(() => trainings.filter((t) => t.category === 'professional'), [trainings])

  const attendanceByStudent = useMemo(() => {
    const grouped = {}
    for (const s of activeStudents) grouped[s.id] = []
    for (const r of attendance) {
      if (grouped[r.studentId]) grouped[r.studentId].push(r)
    }
    const summaries = {}
    for (const [id, records] of Object.entries(grouped)) {
      summaries[id] = summarizeAttendance(records)
    }
    return summaries
  }, [attendance, activeStudents])

  const attendanceBars = useMemo(
    () =>
      activeStudents
        .map((s) => ({ student: s, percent: attendanceByStudent[s.id]?.percent ?? null }))
        .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1)),
    [activeStudents, attendanceByStudent]
  )

  const divisionStats = useMemo(() => {
    return (team?.divisions || []).map((d) => {
      const divStudents = activeStudents.filter((s) => s.division === d)
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

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Active students</span>
          <span className="stat-value">{activeStudents.length}</span>
          <span className="muted">{students.length - activeStudents.length} inactive</span>
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
          <div className="table-scroll">
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
          </div>

          <h2>Certifications</h2>
          <div className="table-scroll">
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
          </div>
        </div>

        <div className="dashboard-col">
          <h2>Attendance by student</h2>
          <div className="card bar-chart">
            {attendanceBars.map(({ student, percent }) => (
              <Link to={`/students/${student.id}`} key={student.id} className="bar-row">
                <span className="bar-row-name">{student.fullName}</span>
                <span className="bar-row-track">
                  <span className="bar-row-fill" style={{ width: `${percent ?? 0}%` }} />
                </span>
                <span className="bar-row-value">{percent === null ? '—' : `${percent}%`}</span>
              </Link>
            ))}
            {attendanceBars.length === 0 && <p className="muted">No active students yet.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
