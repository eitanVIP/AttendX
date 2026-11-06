import { dueSoon, taskDateLabel } from '../lib/tasks'
import { todayISO } from '../lib/calc'

// A student's own unfinished tasks that are overdue or due in the next 7 days.
export default function DueSoon({ tasks, statuses, studentId }) {
  const today = todayISO()
  const list = dueSoon(tasks, statuses, studentId, today)
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <strong>Due this week</strong>
      {list.length === 0 ? (
        <p className="muted" style={{ margin: '4px 0 0' }}>Nothing due in the next 7 days.</p>
      ) : (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {list.map((t) => {
            const overdue = (t.dueDate || t.startDate) < today
            return (
              <li key={t.id} style={overdue ? { color: 'var(--danger)' } : undefined}>
                {t.title} <span className="muted">{taskDateLabel(t)}</span>
                {overdue && ' - overdue'}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
