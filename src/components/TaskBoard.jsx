import { useState } from 'react'
import TaskCalendar from './TaskCalendar'
import TaskStats from './TaskStats'
import TaskWorkload from './TaskWorkload'
import TaskProjects from './TaskProjects'
import TaskTimeline from './TaskTimeline'
import TaskWeek from './TaskWeek'
import usePhone from '../lib/usePhone'
import { TASK_PRIORITIES, checklistProgress, divisionColor, isOverdue, repeatLabel, sortTasks, sortTasksByDate, statusOf, taskDateLabel, waitingOn } from '../lib/tasks'
import { todayISO } from '../lib/calc'
import { t } from '../lib/i18n'

const PRIORITY_NAME = Object.fromEntries(TASK_PRIORITIES.map((p) => [p.id, p.name]))

// Small marks for a task's checklist progress, repeat and comments.
function TaskExtras({ task }) {
  const { done, total } = checklistProgress(task)
  const comments = (task.comments || []).length
  if (!total && !task.repeat && !comments && !task.doneRequested) return null
  return (
    <span style={{ display: 'inline-flex', gap: 8 }}>
      {total > 0 && <span title={t('Checklist')}>☑ {done}/{total}</span>}
      {task.repeat && <span title={repeatLabel(task)}>🔁</span>}
      {comments > 0 && <span title={t('Comments')}>💬 {comments}</span>}
      {task.doneRequested && <span style={{ color: 'var(--warn-text)' }}>✋ {t('Awaiting approval')}</span>}
    </span>
  )
}

// The "+ Add task" box at the bottom of a column: type a title, press Enter.
function QuickAdd({ onAdd }) {
  const [title, setTitle] = useState('')
  function add() {
    if (!title.trim()) return
    onAdd(title.trim())
    setTitle('')
  }
  return (
    <div className="quick-add">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
        placeholder={t('+ Add task')}
        aria-label={t('Add a task here')}
        style={{ width: '100%', marginTop: 4, fontSize: 13, padding: '5px 8px' }}
      />
      <button type="button" className="quick-add-btn" onClick={add}>
        {t('Add')}
      </button>
    </div>
  )
}

function TaskCard({ task, students, statuses, divisions, allTasks, partsWaiting = [], canMove, showStatusSelect, moveOptions, ownId, onRequestDone, onApprove, onReject, onMove, onOpen, today }) {
  const assignee = students.find((s) => s.id === task.assigneeId)
  const overdue = isOverdue(task, statuses, today)
  const waiting = waitingOn(task, allTasks, statuses)
  const { done: stepsDone, total: steps } = checklistProgress(task)
  const when = taskDateLabel(task)
  // A card shows the title, who and when, and only the things that need a
  // look (waiting, blocked, awaiting approval). The rest - description, links,
  // project, system, repeat, comments - is one click away in the task itself.
  return (
    <div
      className="card task-card"
      draggable={canMove}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
      title={task.division || undefined}
      style={{ padding: 10, marginBottom: 8, cursor: canMove ? 'grab' : 'default', borderInlineStart: `4px solid ${divisionColor(task.division, divisions)}` }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        {onOpen ? (
          <button type="button" className="link-btn" style={{ textAlign: 'start', fontWeight: 600, padding: 0 }} onClick={() => onOpen(task)}>
            {task.title}
          </button>
        ) : (
          <strong>{task.title}</strong>
        )}
        {task.priority === 'high' && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t('High')}</span>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span>{assignee ? assignee.fullName : task.assigneeId ? t('(removed student)') : t('Unassigned')}</span>
        {when && <span style={overdue ? { color: 'var(--danger)' } : undefined}>{when}</span>}
        {steps > 0 && <span title={t('Checklist')}>☑ {stepsDone}/{steps}</span>}
      </div>
      {waiting.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>🔒 {t('Waiting on {names}', { names: waiting.map((w) => w.title).join(', ') })}</div>
      )}
      {partsWaiting.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>🛒 {t('Waiting for parts:')} {partsWaiting.map((p) => p.name).join(', ')}</div>
      )}
      {task.blockedReason && statusOf(task, statuses).blocked && (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>⛔ {task.blockedReason}</div>
      )}
      {task.doneRequested && <div style={{ fontSize: 12, color: 'var(--warn-text)' }}>✋ {t('Awaiting approval')}</div>}
      {canMove && showStatusSelect && (
        <select
          value={statusOf(task, statuses).id}
          onChange={(e) => onMove(task, e.target.value)}
          aria-label={t('Status of {title}', { title: task.title })}
          className="task-status-select"
          style={{ marginTop: 6, fontSize: 12, padding: '3px 6px' }}
        >
          {moveOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {task.doneRequested && onApprove && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button type="button" onClick={() => onApprove(task)} style={{ fontSize: 12, padding: '3px 8px' }}>
            {t('Approve done')}
          </button>
          <button type="button" className="secondary" onClick={() => onReject(task)} style={{ fontSize: 12, padding: '3px 8px' }}>
            {t('Send back')}
          </button>
        </div>
      )}
      {ownId && task.assigneeId === ownId && !onApprove && !statusOf(task, statuses).done && (
        <button
          type="button"
          className={task.doneRequested ? 'secondary' : ''}
          onClick={() => onRequestDone(task, !task.doneRequested)}
          style={{ marginTop: 6, fontSize: 12, padding: '3px 8px' }}
        >
          {task.doneRequested ? t('Cancel finish request') : t('Request done')}
        </button>
      )}
    </div>
  )
}

// One column per status (drag a card to another to change its status, or use
// the select on it) or a plain list. `canMove` is who may change a status;
// `onOpen` is set only for people who may edit the task's details.
export default function TaskBoard({ tasks, allTasks = tasks, statuses, students, divisions = [], weekStartsOn = 0, view, canMove, onMove, onOpen, onSchedule, onAssign, ownId, onRequestDone, onApprove, onReject, onQuickAdd, partsFor = () => [] }) {
  const [overStatus, setOverStatus] = useState(null)
  const [overUnassign, setOverUnassign] = useState(false)
  const phone = usePhone()
  const [phoneStatus, setPhoneStatus] = useState(null)
  const today = todayISO()
  const sorted = sortTasks(tasks)
  // Admins and task leads move any task anywhere. An assignee (ownId) moves
  // only their own unfinished tasks, and never into a finished status here -
  // they ask for approval instead.
  const canMoveTask = (t) => canMove || (!!ownId && t.assigneeId === ownId && !statusOf(t, statuses).done)
  const moveOptions = canMove ? statuses : statuses.filter((s) => !s.done)

  const legend = divisions.length > 0 && (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, fontSize: 13 }}>
      {divisions.map((d) => (
        <span key={d} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: divisionColor(d, divisions) }} />
          {d}
        </span>
      ))}
    </div>
  )

  // Drop a task here to take its assignee off (cards and calendar chips both work).
  const unassignZone = onAssign && (
    <div
      className="muted task-dnd-hint"
      onDragOver={(e) => {
        e.preventDefault()
        setOverUnassign(true)
      }}
      onDragLeave={() => setOverUnassign(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOverUnassign(false)
        const raw = e.dataTransfer.getData('text/plain')
        let id = raw
        try {
          id = JSON.parse(raw).id ?? raw
        } catch {
          // a plain task id from a board card
        }
        const task = tasks.find((t) => t.id === id)
        if (task && task.assigneeId) onAssign(task, '')
      }}
      style={{
        padding: '6px 10px',
        marginBottom: 10,
        borderRadius: 8,
        border: '1px dashed var(--border)',
        fontSize: 13,
        background: overUnassign ? 'var(--accent-soft)' : 'transparent',
      }}
    >
      {t('Unassigned - drop a task here to take its assignee off')}
    </div>
  )

  if (view === 'timeline') return <TaskTimeline tasks={tasks} allTasks={allTasks} statuses={statuses} students={students} divisions={divisions} onOpen={onOpen} />

  if (view === 'week') return <TaskWeek tasks={tasks} statuses={statuses} students={students} divisions={divisions} weekStartsOn={weekStartsOn} onOpen={onOpen} onAssign={onAssign} />

  if (view === 'projects') return <TaskProjects tasks={tasks} statuses={statuses} />

  if (view === 'workload') return <TaskWorkload tasks={tasks} statuses={statuses} students={students} />

  if (view === 'stats') return <TaskStats tasks={tasks} statuses={statuses} students={students} divisions={divisions} />

  if (view === 'calendar') {
    return (
      <>
        {legend}
        {unassignZone}
        <TaskCalendar tasks={tasks} allTasks={allTasks} statuses={statuses} students={students} divisions={divisions} weekStartsOn={weekStartsOn} onOpen={onOpen} onSchedule={onSchedule} />
      </>
    )
  }

  if (view === 'list') {
    return (
      <>
      {legend}
      <div className="card phone-cards-wrap" style={{ overflowX: 'auto' }}>
        <table className="phone-cards" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'start' }}>
              <th>{t('Task')}</th>
              <th>{t('Assignee')}</th>
              <th>{t('Status')}</th>
              <th>{t('Division')}</th>
              <th>{t('Priority')}</th>
              <th>{t('Dates')}</th>
            </tr>
          </thead>
          <tbody>
            {sortTasksByDate(tasks).map((task) => {
              const assignee = students.find((s) => s.id === task.assigneeId)
              const overdue = isOverdue(task, statuses, today)
              return (
                <tr key={task.id}>
                  <td>
                    {onOpen ? (
                      <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => onOpen(task)}>
                        {task.title}
                      </button>
                    ) : (
                      task.title
                    )}
                    <div className="muted" style={{ fontSize: 12 }}>
                      <TaskExtras task={task} />
                    </div>
                    {waitingOn(task, allTasks, statuses).length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--danger)' }}>🔒 {t('Waiting on {names}', { names: waitingOn(task, allTasks, statuses).map((w) => w.title).join(', ') })}</div>
                    )}
                    {partsFor(task).length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--danger)' }}>🛒 {t('Waiting for parts:')} {partsFor(task).map((p) => p.name).join(', ')}</div>
                    )}
                  </td>
                  <td data-label={t('Assignee')}>{assignee ? assignee.fullName : task.assigneeId ? t('(removed student)') : '—'}</td>
                  <td data-label={t('Status')}>
                    {canMoveTask(task) ? (
                      <select
                        value={statusOf(task, statuses).id}
                        onChange={(e) => onMove(task, e.target.value)}
                        aria-label={t('Status of {title}', { title: task.title })}
                        style={{ fontSize: 13, padding: '3px 6px' }}
                      >
                        {moveOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      statusOf(task, statuses).name
                    )}
                  </td>
                  <td data-label={t('Division')}>{task.division || '—'}</td>
                  <td data-label={t('Priority')}>{t(PRIORITY_NAME[task.priority] || 'Normal')}</td>
                  <td data-label={t('Dates')} style={overdue ? { color: 'var(--danger)' } : undefined}>{taskDateLabel(task) || '—'}</td>
                </tr>
              )
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t('No tasks.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </>
    )
  }

  if (phone) {
    // A phone gets a tab per status (with its count) and just that status's
    // cards, instead of columns to swipe through. Change a card's status with
    // the select on it.
    const active = statuses.find((s) => s.id === phoneStatus) || statuses[0]
    const inStatus = (s) => sorted.filter((t) => statusOf(t, statuses).id === s.id)
    const column = inStatus(active)
    return (
      <>
        {legend}
        <div className="task-status-tabs" role="tablist" aria-label={t('Status')}>
          {statuses.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === active.id} className={s.id === active.id ? 'chip active' : 'chip'} onClick={() => setPhoneStatus(s.id)}>
              {s.name} <span className="task-status-count">{inStatus(s).length}</span>
            </button>
          ))}
        </div>
        <div className="task-phone-column">
          {column.map((t) => (
            <TaskCard key={t.id} task={t} students={students} statuses={statuses} divisions={divisions} allTasks={allTasks} partsWaiting={partsFor(t)} canMove={canMoveTask(t)} showStatusSelect={phone} moveOptions={moveOptions} ownId={ownId} onRequestDone={onRequestDone} onApprove={onApprove} onReject={onReject} onMove={onMove} onOpen={onOpen} today={today} />
          ))}
          {column.length === 0 && <div className="muted task-phone-empty">{t('Nothing in {name}.', { name: active.name })}</div>}
          {onQuickAdd && <QuickAdd onAdd={(title) => onQuickAdd(title, active.id)} />}
        </div>
      </>
    )
  }

  return (
    <>
    {legend}
    {unassignZone}
    <div className="task-columns" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 8 }}>
      {statuses.map((status) => {
        const column = sorted.filter((t) => statusOf(t, statuses).id === status.id)
        return (
          <div
            key={status.id}
            className="task-column"
            onDragOver={canMove || ownId ? (e) => { e.preventDefault(); setOverStatus(status.id) } : undefined}
            onDragLeave={canMove || ownId ? () => setOverStatus(null) : undefined}
            onDrop={
              canMove || ownId
                ? (e) => {
                    e.preventDefault()
                    setOverStatus(null)
                    const task = tasks.find((t) => t.id === e.dataTransfer.getData('text/plain'))
                    if (task && canMoveTask(task) && statusOf(task, statuses).id !== status.id) onMove(task, status.id)
                  }
                : undefined
            }
            style={{
              flex: '1 0 220px',
              minWidth: 220,
              padding: 8,
              borderRadius: 10,
              background: overStatus === status.id ? 'var(--accent-soft)' : 'var(--accent-faint)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {status.name} <span className="muted">{column.length}</span>
            </div>
            {column.map((t) => (
              <TaskCard key={t.id} task={t} students={students} statuses={statuses} divisions={divisions} allTasks={allTasks} partsWaiting={partsFor(t)} canMove={canMoveTask(t)} showStatusSelect={phone} moveOptions={moveOptions} ownId={ownId} onRequestDone={onRequestDone} onApprove={onApprove} onReject={onReject} onMove={onMove} onOpen={onOpen} today={today} />
            ))}
            {column.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('Nothing here')}</div>}
            {onQuickAdd && <QuickAdd onAdd={(title) => onQuickAdd(title, status.id)} />}
          </div>
        )
      })}
    </div>
    </>
  )
}
