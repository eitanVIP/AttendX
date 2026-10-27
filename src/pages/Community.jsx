import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import DataTable from '../components/DataTable'
import { useCommunityLogs, useCommunitySettings, useStudents } from '../lib/firestore-hooks'
import { formatDate, todayISO } from '../lib/calc'
import { deleteCommunityLog } from '../lib/actions'
import { downloadCSV } from '../lib/csv'

// Same shape as a log's own `date` field (local YYYY-MM-DD), so a period is
// just a plain string comparison against it.
function isoDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PERIODS = [
  { key: 'all', label: 'All time', from: () => '' },
  { key: 'month', label: 'This month', from: () => `${todayISO().slice(0, 7)}-01` },
  { key: '30', label: 'Last 30 days', from: () => isoDaysAgo(30) },
  { key: '90', label: 'Last 90 days', from: () => isoDaysAgo(90) },
]

const formatHours = (h) => String(Math.round(h * 100) / 100)

// The admin's view of everything students log on their own Community Hours
// page (see CommunityHours.jsx) - students are the only ones who add
// entries, this page reads them back: totals, hours per community type
// (the type IS the project/event, e.g. "FLL Junior"), who did what, and
// the raw log with a delete for mis-logged entries (same deleteCommunityLog
// the student profile uses). The target-met count always looks at all-time
// hours, since the target itself isn't per period - everything else follows
// the filters.
export default function Community() {
  const { team } = useAuth()
  const { data: students, loading: studentsLoading } = useStudents(team)
  const { data: logs, loading: logsLoading } = useCommunityLogs(team?.id)
  const { settings, loading: settingsLoading } = useCommunitySettings(team?.id)
  const [period, setPeriod] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [studentFilter, setStudentFilter] = useState('all')

  useEffect(() => {
    document.title = 'AttendX | Community'
  }, [])

  const target = Number(settings.hoursTarget) || 0
  const studentsById = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students])
  const activeStudents = useMemo(() => students.filter((s) => s.active), [students])
  const studentName = (id) => studentsById[id]?.fullName || 'Removed student'

  // Settings' own order first, then any type a log still uses that's since
  // been removed from Settings, so old hours never silently drop out.
  const types = useMemo(() => {
    const list = [...(settings.types || [])]
    for (const l of logs) if (l.type && !list.includes(l.type)) list.push(l.type)
    return list
  }, [settings.types, logs])

  const filtered = useMemo(() => {
    const from = PERIODS.find((p) => p.key === period).from()
    return logs
      .filter((l) => !from || (l.date || '') >= from)
      .filter((l) => typeFilter === 'all' || l.type === typeFilter)
      .filter((l) => studentFilter === 'all' || l.studentId === studentFilter)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [logs, period, typeFilter, studentFilter])

  const totalHours = useMemo(() => filtered.reduce((sum, l) => sum + (Number(l.hours) || 0), 0), [filtered])

  const allTimeByStudent = useMemo(() => {
    const map = {}
    for (const l of logs) map[l.studentId] = (map[l.studentId] || 0) + (Number(l.hours) || 0)
    return map
  }, [logs])
  const metTarget = target ? activeStudents.filter((s) => (allTimeByStudent[s.id] || 0) >= target).length : null

  // One row per community type: hours, entries and how many different
  // students took part, in the filtered set.
  const byType = useMemo(() => {
    const rows = types.map((type) => ({ type, hours: 0, entries: 0, students: new Set() }))
    const index = Object.fromEntries(rows.map((r) => [r.type, r]))
    for (const l of filtered) {
      const row = index[l.type]
      if (!row) continue
      row.hours += Number(l.hours) || 0
      row.entries += 1
      row.students.add(l.studentId)
    }
    return rows
      .filter((r) => typeFilter === 'all' || r.type === typeFilter)
      .map((r) => ({ ...r, students: r.students.size }))
      .sort((a, b) => b.hours - a.hours)
  }, [types, filtered, typeFilter])
  const maxTypeHours = Math.max(1, ...byType.map((r) => r.hours))

  // Who did what: one row per student, hours split by type. Every active
  // student shows (zero hours is exactly who an admin wants to see), plus
  // anyone inactive/removed who still has hours in the filtered set.
  const byStudent = useMemo(() => {
    const rows = new Map()
    const rowFor = (id) => {
      if (!rows.has(id)) rows.set(id, { id, total: 0, entries: 0, lastDate: '', byType: {} })
      return rows.get(id)
    }
    if (studentFilter === 'all') for (const s of activeStudents) rowFor(s.id)
    else rowFor(studentFilter)
    for (const l of filtered) {
      const row = rowFor(l.studentId)
      const h = Number(l.hours) || 0
      row.total += h
      row.entries += 1
      row.byType[l.type] = (row.byType[l.type] || 0) + h
      if ((l.date || '') > row.lastDate) row.lastDate = l.date
    }
    const name = (id) => studentsById[id]?.fullName || ''
    return [...rows.values()].sort((a, b) => b.total - a.total || name(a.id).localeCompare(name(b.id)))
  }, [filtered, activeStudents, studentFilter, studentsById])
  const maxStudentHours = Math.max(1, target, ...byStudent.map((r) => r.total))
  const studentsWhoLogged = byStudent.filter((r) => r.entries > 0).length
  const shownTypes = typeFilter === 'all' ? types : [typeFilter]
  // With one student picked, the "average" is just that student's hours -
  // dividing by every active student would understate it.
  const avgOver = studentFilter === 'all' ? activeStudents.length : 1

  function exportCSV() {
    downloadCSV(
      `community-hours-${todayISO()}.csv`,
      ['Date', 'Student', 'Type', 'Hours', 'Notes'],
      filtered.map((l) => [l.date, studentName(l.studentId), l.type, l.hours, l.notes || ''])
    )
  }

  async function handleDelete(log) {
    if (!confirm(`Delete this entry (${studentName(log.studentId)}, ${log.hours}h, ${log.type}, ${formatDate(log.date)})?`)) return
    await deleteCommunityLog(team.id, log)
  }

  if (studentsLoading || logsLoading || settingsLoading) return <div className="page-loading">Loading community hours…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Community hours</h1>
          <div className="page-header-actions">
            <button className="secondary" onClick={exportCSV} disabled={filtered.length === 0}>
              Export CSV
            </button>
          </div>
        </div>

        <div className="filter-row">
          {PERIODS.map((p) => (
            <button key={p.key} className={period === p.key ? 'chip active' : 'chip'} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Community type">
            <option value="all">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)} aria-label="Student">
            <option value="all">All students</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {types.length === 0 && (
        <p className="muted">
          No community types set up yet - add them in <Link to="/settings">Settings</Link> so students can start logging.
        </p>
      )}

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Hours logged</span>
          <span className="stat-value">{formatHours(totalHours)}</span>
          <span className="muted">
            {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Students who logged</span>
          <span className="stat-value">{studentsWhoLogged}</span>
          <span className="muted">of {activeStudents.length} active</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">{studentFilter === 'all' ? 'Avg. per active student' : 'Hours for this student'}</span>
          <span className="stat-value">{avgOver ? formatHours(totalHours / avgOver) : '—'}</span>
          <span className="muted">hours</span>
        </div>
        {target > 0 && (
          <div className="card stat-card">
            <span className="stat-label">Met the target</span>
            <span className="stat-value">
              {metTarget}/{activeStudents.length}
            </span>
            <span className="muted">{target} hrs required · all time</span>
          </div>
        )}
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-col">
          <h3>Hours by type</h3>
          <div className="card bar-chart">
            {byType.map((r) => (
              <button
                key={r.type}
                type="button"
                className={`bar-row bar-row-button${typeFilter === r.type ? ' active' : ''}`}
                title={`${r.entries} entries · ${r.students} student${r.students === 1 ? '' : 's'}`}
                onClick={() => setTypeFilter(typeFilter === r.type ? 'all' : r.type)}
              >
                <span className="bar-row-name">{r.type}</span>
                <span className="bar-row-track">
                  <span className="bar-row-fill" style={{ width: `${(r.hours / maxTypeHours) * 100}%` }} />
                </span>
                <span className="bar-row-value">{formatHours(r.hours)}h</span>
              </button>
            ))}
            {byType.length === 0 && <p className="muted">No types yet.</p>}
          </div>
        </div>

        <div className="dashboard-col">
          <h3>{target > 0 ? `Hours by student (target ${target}h)` : 'Hours by student'}</h3>
          <div className="card bar-chart">
            {byStudent.map((r) => (
              <Link to={`/students/${r.id}`} key={r.id} className="bar-row">
                <span className="bar-row-name">{studentName(r.id)}</span>
                <span className="bar-row-track">
                  <span className="bar-row-fill" style={{ width: `${(r.total / maxStudentHours) * 100}%` }} />
                </span>
                <span className="bar-row-value">{formatHours(r.total)}h</span>
              </Link>
            ))}
            {byStudent.length === 0 && <p className="muted">No students yet.</p>}
          </div>
        </div>
      </div>

      <h3>Who did what</h3>
      <DataTable
        columns={[
          {
            key: 'student',
            header: 'Student',
            sticky: 'left',
            cell: (r) => <Link to={`/students/${r.id}`}>{studentName(r.id)}</Link>,
          },
          ...shownTypes.map((t) => ({
            key: `type-${t}`,
            header: t,
            align: 'center',
            cell: (r) => (r.byType[t] ? formatHours(r.byType[t]) : <span className="muted">—</span>),
            footerCell: (data) => formatHours(data.byType[t] || 0),
          })),
          {
            key: 'total',
            header: 'Total',
            align: 'center',
            cell: (r) => <strong>{formatHours(r.total)}</strong>,
            footerCell: (data) => <strong>{formatHours(data.total)}</strong>,
          },
          ...(target > 0
            ? [
                {
                  key: 'target',
                  header: 'All-time vs target',
                  nowrap: true,
                  cell: (r) => {
                    const done = allTimeByStudent[r.id] || 0
                    return (
                      <span className={done >= target ? undefined : 'muted'}>
                        {formatHours(done)}/{target}
                        {done >= target ? ' ✓' : ''}
                      </span>
                    )
                  },
                },
              ]
            : []),
          {
            key: 'last',
            header: 'Last logged',
            nowrap: true,
            cellClassName: 'muted',
            cell: (r) => (r.lastDate ? formatDate(r.lastDate) : '—'),
          },
        ]}
        rows={byStudent}
        footer={byStudent.length > 0}
        footerData={{
          total: totalHours,
          byType: Object.fromEntries(byType.map((r) => [r.type, r.hours])),
        }}
        emptyMessage="No students yet."
      />

      <h3>All entries</h3>
      <DataTable
        columns={[
          { key: 'date', header: 'Date', nowrap: true, cell: (l) => formatDate(l.date) },
          {
            key: 'student',
            header: 'Student',
            sticky: 'left',
            cell: (l) => <Link to={`/students/${l.studentId}`}>{studentName(l.studentId)}</Link>,
          },
          { key: 'type', header: 'Type', cell: (l) => l.type },
          { key: 'hours', header: 'Hours', cell: (l) => l.hours },
          { key: 'notes', header: 'Notes', spread: true, cellClassName: 'muted', cell: (l) => l.notes || '—' },
          {
            key: 'actions',
            header: '',
            sticky: 'right',
            cell: (l) => (
              <button className="link-btn danger" onClick={() => handleDelete(l)}>
                Delete
              </button>
            ),
          },
        ]}
        rows={filtered}
        emptyMessage="No hours logged for these filters."
      />
    </div>
  )
}
