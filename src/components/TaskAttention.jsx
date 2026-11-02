import { Link } from 'react-router-dom'
import { addDays, statusOf, taskDateLabel } from '../lib/tasks'
import { todayISO } from '../lib/calc'

// Admin dashboard: what in Tasks needs a look - finish requests waiting for
// approval, student task requests, overdue tasks and ones due in 3 days.
export default function TaskAttention({ tasks, statuses, requests }) {
  const today = todayISO()
  const open = tasks.filter((t) => !statusOf(t, statuses).done)
  const approvals = open.filter((t) => t.doneRequested)
  const pendingRequests = requests.filter((r) => r.status === 'pending')
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today)
  const soon = open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 3))
  if (approvals.length + pendingRequests.length + overdue.length + soon.length === 0) return null
  const names = (list) => list.slice(0, 4).map((t) => t.title).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '')
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <strong>Needs attention</strong>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {approvals.length > 0 && (
          <li>
            ✋ <Link to="/tasks">{approvals.length} task(s) waiting for your approval</Link> <span className="muted">{names(approvals)}</span>
          </li>
        )}
        {pendingRequests.length > 0 && (
          <li>
            📝 <Link to="/tasks">{pendingRequests.length} task request(s) from students</Link>
          </li>
        )}
        {overdue.length > 0 && (
          <li style={{ color: 'var(--danger)' }}>
            ⚠ <Link to="/tasks">{overdue.length} overdue task(s)</Link> <span className="muted">{names(overdue)}</span>
          </li>
        )}
        {soon.length > 0 && (
          <li>
            ⏰ <Link to="/tasks">{soon.length} due in the next 3 days</Link>{' '}
            <span className="muted">{soon.slice(0, 3).map((t) => `${t.title} (${taskDateLabel(t)})`).join(', ')}</span>
          </li>
        )}
      </ul>
    </div>
  )
}
