import { workloadRows } from '../lib/tasks'
import usePhone from '../lib/usePhone'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Who is busy over the next two weeks: a row per student with their open and
// overdue tasks and, per day, how many of their open tasks are running that
// day. Darker = more at once.
export default function TaskWorkload({ tasks, statuses, students }) {
  const phone = usePhone()
  const { days, rows } = workloadRows(tasks, statuses, students)
  const heat = (n) => (n ? `color-mix(in srgb, var(--accent) ${Math.min(80, 20 + n * 20)}%, transparent)` : 'transparent')

  if (phone) {
    // A card per student: their open / overdue count and the two-week strip.
    return (
      <div className="wl-cards">
        {rows.map((r) => (
          <div key={r.student.id} className="card wl-card">
            <div className="wl-head">
              <strong>{r.student.fullName}</strong>
              <span className="muted">
                {r.open} open
                {r.overdue > 0 && <span className="wl-late">, {r.overdue} overdue</span>}
              </span>
            </div>
            {r.cells.some((n) => n > 0) && (
              <div className="wl-strip">
                {r.cells.map((n, i) => (
                  <span key={days[i].iso} className="wl-cell" title={`${days[i].label}: ${n} task${n === 1 ? '' : 's'}`} style={{ background: heat(n) }}>
                    <span className="wl-day">{WEEKDAYS[days[i].weekday]}</span>
                    <span className="wl-n">{n || ''}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="muted">No students.</p>}
      </div>
    )
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Student</th>
            <th>Open</th>
            <th>Overdue</th>
            {days.map((d) => (
              <th key={d.iso} style={{ textAlign: 'center', fontSize: 11, fontWeight: 400, padding: '2px 3px' }}>
                <div>{WEEKDAYS[d.weekday]}</div>
                <div className="muted">{d.label}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.student.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{r.student.fullName}</td>
              <td>{r.open}</td>
              <td style={r.overdue ? { color: 'var(--danger)' } : undefined}>{r.overdue}</td>
              {r.cells.map((n, i) => (
                <td
                  key={days[i].iso}
                  title={`${r.student.fullName}, ${days[i].label}: ${n} task${n === 1 ? '' : 's'}`}
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    minWidth: 26,
                    background: n ? `color-mix(in srgb, var(--accent) ${Math.min(80, 20 + n * 20)}%, transparent)` : 'transparent',
                  }}
                >
                  {n || ''}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3 + days.length} className="muted">
                No students.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
