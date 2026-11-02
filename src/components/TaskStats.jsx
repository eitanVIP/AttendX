import { divisionColor, taskStats } from '../lib/tasks'

const Stat = ({ label, value }) => (
  <div className="card" style={{ padding: 10, minWidth: 110 }}>
    <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
  </div>
)

// The Stats view of the task board: how much is open, overdue and getting
// finished, split by week, division and student.
export default function TaskStats({ tasks, statuses, students, divisions }) {
  const stats = taskStats(tasks, statuses)
  const max = Math.max(1, ...stats.weekly.map((w) => w.count))
  const studentRows = Object.entries(stats.byStudent)
    .map(([id, v]) => ({ id, name: students.find((s) => s.id === id)?.fullName || '(removed student)', ...v }))
    .sort((a, b) => b.recent - a.recent || b.open - a.open)
  const divisionRows = Object.entries(stats.byDivision).sort((a, b) => b[1].open + b[1].done - (a[1].open + a[1].done))
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat label="Open" value={stats.open} />
        <Stat label="Overdue" value={stats.overdue} />
        <Stat label="Finished (30 days)" value={stats.recent} />
        <Stat label="Avg days to finish" value={stats.avgDays ?? '-'} />
      </div>

      <h3>Finished per week</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 130, marginBottom: 6 }} role="img" aria-label="Tasks finished per week">
        {stats.weekly.map((w) => (
          <div key={w.start} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <span style={{ fontSize: 12 }}>{w.count}</span>
            <div style={{ width: '100%', height: `${(w.count / max) * 100}%`, minHeight: w.count ? 4 : 1, background: 'var(--accent)', borderRadius: 3 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {stats.weekly.map((w) => (
          <span key={w.start} className="muted" style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
            {w.label}
          </span>
        ))}
      </div>

      <h3>By division</h3>
      <div className="card" style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Division</th>
              <th>Open</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {divisionRows.map(([name, v]) => (
              <tr key={name || 'none'}>
                <td>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: divisionColor(name, divisions), marginRight: 6 }} />
                  {name || 'No division'}
                </td>
                <td>{v.open}</td>
                <td>{v.done}</td>
              </tr>
            ))}
            {divisionRows.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">No tasks.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3>By student</h3>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Student</th>
              <th>Open</th>
              <th>Overdue</th>
              <th>Finished (30 days)</th>
              <th>Finished (all)</th>
            </tr>
          </thead>
          <tbody>
            {studentRows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.open}</td>
                <td style={r.overdue ? { color: 'var(--danger)' } : undefined}>{r.overdue}</td>
                <td>{r.recent}</td>
                <td>{r.done}</td>
              </tr>
            ))}
            {studentRows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">No assigned tasks.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
