import { useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, assigneeOptions, filterTasksByAssignee, statusOf, taskDateLabel } from '../lib/tasks'
import { todayISO } from '../lib/calc'

const STORAGE_KEY = 'attendx.attentionWho'

// Admin dashboard: what in Tasks needs a look - finish requests waiting for
// approval, student task requests, overdue tasks and ones due in 3 days.
// The task lists can be narrowed to one person (or to unassigned tasks); the
// choice is remembered in this browser only. Student requests are not tasks
// yet, so the filter leaves them alone.
export default function TaskAttention({ tasks, statuses, requests, students = [] }) {
  const today = todayISO()
  const [saved, setSaved] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'all'
    } catch {
      return 'all'
    }
  })
  const allOpen = tasks.filter((t) => !statusOf(t, statuses).done)
  const { people, hasUnassigned } = assigneeOptions(allOpen, students)
  // A remembered person who no longer has open tasks falls back to everyone.
  const who = saved === 'none' ? (hasUnassigned ? 'none' : 'all') : people.some((p) => p.id === saved) ? saved : 'all'
  function pick(value) {
    setSaved(value)
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Not remembered - the filter still works for this visit.
    }
  }

  const open = filterTasksByAssignee(allOpen, who)
  const approvals = open.filter((t) => t.doneRequested)
  const pendingRequests = requests.filter((r) => r.status === 'pending')
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today)
  const soon = open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 3))
  const anyTaskItems = allOpen.some((t) => t.doneRequested || (t.dueDate && t.dueDate <= addDays(today, 3)))
  if (!anyTaskItems && pendingRequests.length === 0) return null
  const names = (list) => list.slice(0, 4).map((t) => t.title).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '')
  const nothing = approvals.length + pendingRequests.length + overdue.length + soon.length === 0
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong>Needs attention</strong>
        {(people.length > 0 || hasUnassigned) && (
          <select value={who} onChange={(e) => pick(e.target.value)} aria-label="Show tasks for" style={{ width: 'auto', maxWidth: '100%' }}>
            <option value="all">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
            {hasUnassigned && <option value="none">Not assigned</option>}
          </select>
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {nothing && <li className="muted">Nothing overdue or due soon for this choice.</li>}
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
