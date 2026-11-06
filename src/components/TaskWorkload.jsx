import { workloadRows } from '../lib/tasks'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Who is busy over the next two weeks: a row per student with their open and
// overdue tasks and, per day, how many of their open tasks are running that
// day. Darker = more at once.
export default function TaskWorkload({ tasks, statuses, students }) {
  const { days, rows } = workloadRows(tasks, statuses, students)
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
