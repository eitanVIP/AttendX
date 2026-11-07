import { divisionColor, statusOf, taskDateLabel, waitingOn } from '../lib/tasks'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// A task covers startDate..dueDate (either alone is a single day).
function taskRange(task) {
  const start = task.startDate || task.dueDate
  const end = task.dueDate || task.startDate
  return start ? [start, end < start ? start : end] : null
}

function dayHeading(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })
}

// The calendar on a phone (TaskCalendar swaps this in below 640px - the month
// grid is unchanged on a computer): the month's tasks listed under the day each
// one starts, plus the tasks with no date. Tap one to open it.
export default function TaskAgenda({ tasks, cursor, today, allTasks, statuses, students, divisions, onOpen }) {
  const monthStart = iso(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
  const monthEnd = iso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0))

  const groups = new Map()
  for (const t of tasks) {
    const range = taskRange(t)
    if (!range || range[0] > monthEnd || range[1] < monthStart) continue
    const key = range[0] < monthStart ? 'earlier' : range[0]
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const keys = [...groups.keys()].sort((a, b) => (a === 'earlier' ? -1 : b === 'earlier' ? 1 : a < b ? -1 : 1))
  const undated = tasks.filter((t) => !taskRange(t))

  const row = (t) => {
    const range = taskRange(t)
    const assignee = students.find((s) => s.id === t.assigneeId)
    const done = statusOf(t, statuses).done
    const waiting = waitingOn(t, allTasks, statuses).length > 0
    const runningToday = range && range[0] <= today && today <= range[1]
    return (
      <button
        key={t.id}
        type="button"
        className="agenda-task"
        disabled={!onOpen}
        onClick={onOpen ? () => onOpen(t) : undefined}
        style={{ borderLeftColor: divisionColor(t.division, divisions) }}
      >
        <span className="agenda-title" style={done ? { textDecoration: 'line-through' } : undefined}>
          {waiting && '🔒 '}
          {t.title}
        </span>
        <span className="agenda-meta">
          {[assignee ? assignee.fullName : 'Unassigned', taskDateLabel(t), t.division].filter(Boolean).join(' · ')}
          {runningToday && !done && <span className="agenda-today"> · running today</span>}
        </span>
      </button>
    )
  }

  return (
    <div className="agenda">
      {keys.map((key) => (
        <section key={key} className="agenda-day">
          <h3 className={key === today ? 'agenda-heading agenda-heading-today' : 'agenda-heading'}>
            {key === 'earlier' ? 'Started earlier' : dayHeading(key)}
            {key === today && ' · Today'}
          </h3>
          {groups.get(key).map(row)}
        </section>
      ))}
      {keys.length === 0 && <p className="muted">No dated tasks this month.</p>}
      {undated.length > 0 && (
        <section className="agenda-day">
          <h3 className="agenda-heading">No date ({undated.length})</h3>
          {undated.map(row)}
        </section>
      )}
    </div>
  )
}
