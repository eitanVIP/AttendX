import { useState } from 'react'
import { divisionColor, formatDMY, statusOf, taskDateLabel, weekPlan } from '../lib/tasks'
import { todayISO } from '../lib/calc'
import { dateLocale, t } from '../lib/i18n'

const dayHeading = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short' })

function Row({ task, students, statuses, divisions, onOpen, onAssign }) {
  const assignee = students.find((s) => s.id === task.assigneeId)
  const status = statusOf(task, statuses)
  const date = taskDateLabel(task)
  return (
    <li className="needs-row" style={{ borderInlineStart: `4px solid ${divisionColor(task.division, divisions)}`, paddingInlineStart: 8 }}>
      <div className="needs-row-text">
        {onOpen ? (
          <button type="button" className="link-btn" style={{ padding: 0, fontWeight: 600, textAlign: 'start' }} onClick={() => onOpen(task)}>
            {task.title}
          </button>
        ) : (
          <strong>{task.title}</strong>
        )}{' '}
        {task.priority === 'high' && <span style={{ color: 'var(--danger)', fontSize: 12 }}>High</span>}
        <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {assignee ? <span>{assignee.fullName}</span> : task.assigneeId ? <span>{t('(removed student)')}</span> : <span style={{ color: 'var(--danger)' }}>{t('Unassigned')}</span>}
          <span>{status.name}</span>
          {date && <span>{date}</span>}
          {task.doneRequested && <span style={{ color: 'var(--warn-text)' }}>✋ {t('Awaiting approval')}</span>}
          {task.blockedReason && status.blocked && <span style={{ color: 'var(--danger)' }}>⛔ {task.blockedReason}</span>}
        </div>
      </div>
      {onAssign && !task.assigneeId && (
        <div className="needs-row-actions">
          <select value="" onChange={(e) => e.target.value && onAssign(task, e.target.value)} aria-label={t('Assign {title}', { title: task.title })} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }}>
            <option value="">{t('Assign to…')}</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  )
}

function Section({ title, count, color, tasks, collapsed = false, ...rowProps }) {
  if (tasks.length === 0) return null
  const list = (
    <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tasks.map((t) => (
        <Row key={t.id} task={t} {...rowProps} />
      ))}
    </ul>
  )
  if (collapsed) {
    return (
      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          {title} <span className="muted">{count ?? tasks.length}</span>
        </summary>
        {list}
      </details>
    )
  }
  return (
    <section style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 600, color }}>
        {title} <span className="muted">{count ?? tasks.length}</span>
      </div>
      {list}
    </section>
  )
}

// A planning list instead of a board: what is late, what is due each day this
// week, then next week and the rest. "Only unassigned" narrows it to the
// tasks nobody has picked up yet.
export default function TaskWeek({ tasks, statuses, students, divisions = [], weekStartsOn = 0, onOpen, onAssign }) {
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const today = todayISO()
  const base = weekPlan(tasks, statuses, today, weekStartsOn)
  const unassignedCount = [base.overdue, base.next, base.later, base.unscheduled, ...base.days.map((d) => d.tasks)].flat().filter((t) => !t.assigneeId).length
  const keep = (list) => (onlyUnassigned ? list.filter((t) => !t.assigneeId) : list)
  const plan = { ...base, overdue: keep(base.overdue), next: keep(base.next), later: keep(base.later), unscheduled: keep(base.unscheduled), days: base.days.map((d) => ({ ...d, tasks: keep(d.tasks) })).filter((d) => d.tasks.length > 0) }
  const thisWeek = plan.days.flatMap((d) => d.tasks)
  const nothing = plan.overdue.length + thisWeek.length + plan.next.length + plan.later.length + plan.unscheduled.length === 0
  const rowProps = { students, statuses, divisions, onOpen, onAssign }
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <strong>{t('This week')}</strong> <span className="muted">{formatDMY(base.weekStart)} – {formatDMY(base.weekEnd)}</span>
        </div>
        <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} style={{ width: 'auto' }} />
          {t('Only unassigned')} ({unassignedCount})
        </label>
      </div>
      {nothing && <p className="muted">{onlyUnassigned ? t('Every open task has someone on it.') : t('No open tasks.')}</p>}
      <Section title={`⚠ ${t('Overdue')}`} color="var(--danger)" tasks={plan.overdue} {...rowProps} />
      {plan.days.map((d) => (
        <Section key={d.date} title={d.date === today ? t('Today - {day}', { day: dayHeading(d.date) }) : dayHeading(d.date)} tasks={d.tasks} {...rowProps} />
      ))}
      {thisWeek.length === 0 && plan.overdue.length > 0 && <p className="muted" style={{ marginTop: 14 }}>{t('Nothing else is due this week.')}</p>}
      <Section title={t('Next week')} tasks={plan.next} collapsed {...rowProps} />
      <Section title={t('Later')} tasks={plan.later} collapsed {...rowProps} />
      <Section title={t('No date yet')} tasks={plan.unscheduled} collapsed {...rowProps} />
    </div>
  )
}
