import { dueSoon, taskDateLabel } from '../lib/tasks'
import { todayISO } from '../lib/calc'
import { t } from '../lib/i18n'

// A student's own unfinished tasks that are overdue or due in the next 7 days.
export default function DueSoon({ tasks, statuses, studentId }) {
  const today = todayISO()
  const list = dueSoon(tasks, statuses, studentId, today)
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <strong>{t('Due this week')}</strong>
      {list.length === 0 ? (
        <p className="muted" style={{ margin: '4px 0 0' }}>{t('Nothing due in the next 7 days.')}</p>
      ) : (
        <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
          {list.map((task) => {
            const overdue = (task.dueDate || task.startDate) < today
            return (
              <li key={task.id} style={overdue ? { color: 'var(--danger)' } : undefined}>
                {task.title} <span className="muted">{taskDateLabel(task)}</span>
                {overdue && ` - ${t('overdue')}`}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
