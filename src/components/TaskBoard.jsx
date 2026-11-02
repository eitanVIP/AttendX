import { useState } from 'react'
import TaskCalendar from './TaskCalendar'
import { TASK_PRIORITIES, checklistProgress, divisionColor, isOverdue, repeatLabel, sortTasks, sortTasksByDate, statusOf, taskDateLabel, waitingOn } from '../lib/tasks'
import { todayISO } from '../lib/calc'

const PRIORITY_NAME = Object.fromEntries(TASK_PRIORITIES.map((p) => [p.id, p.name]))

// Small marks for a task's checklist progress, repeat and comments.
function TaskExtras({ task }) {
  const { done, total } = checklistProgress(task)
  const comments = (task.comments || []).length
  if (!total && !task.repeat && !comments && !task.doneRequested) return null
  return (
    <span style={{ display: 'inline-flex', gap: 8 }}>
      {total > 0 && <span title="Checklist">☑ {done}/{total}</span>}
      {task.repeat && <span title={repeatLabel(task)}>🔁</span>}
      {comments > 0 && <span title="Comments">💬 {comments}</span>}
      {task.doneRequested && <span style={{ color: 'var(--warn-text)' }}>✋ Awaiting approval</span>}
    </span>
  )
}

// The "+ Add task" box at the bottom of a column: type a title, press Enter.
function QuickAdd({ onAdd }) {
  const [title, setTitle] = useState('')
  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && title.trim()) {
          onAdd(title.trim())
          setTitle('')
        }
      }}
      placeholder="+ Add task"
      aria-label="Add a task here"
      style={{ width: '100%', marginTop: 4, fontSize: 13, padding: '5px 8px' }}
    />
  )
}

function TaskCard({ task, students, statuses, divisions, allTasks, canMove, moveOptions, ownId, onRequestDone, onApprove, onReject, onMove, onOpen, today }) {
  const assignee = students.find((s) => s.id === task.assigneeId)
  const overdue = isOverdue(task, statuses, today)
  const waiting = waitingOn(task, allTasks, statuses)
  return (
    <div
      className="card"
      draggable={canMove}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
      style={{ padding: 10, marginBottom: 8, cursor: canMove ? 'grab' : 'default', borderLeft: `4px solid ${divisionColor(task.division, divisions)}` }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        {onOpen ? (
          <button type="button" className="link-btn" style={{ textAlign: 'left', fontWeight: 600, padding: 0 }} onClick={() => onOpen(task)}>
            {task.title}
          </button>
        ) : (
          <strong>{task.title}</strong>
        )}
        {task.priority === 'high' && <span style={{ color: 'var(--danger)', fontSize: 12 }}>High</span>}
      </div>
      {waiting.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>🔒 Waiting on {waiting.map((t) => t.title).join(', ')}</div>
      )}
      {task.blockedReason && statusOf(task, statuses).blocked && (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>⛔ {task.blockedReason}</div>
      )}
      {task.description && (
        <div className="muted" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
          {task.description}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span>{assignee ? assignee.fullName : task.assigneeId ? '(removed student)' : 'Unassigned'}</span>
        {taskDateLabel(task) && <span style={overdue ? { color: 'var(--danger)' } : undefined}>{taskDateLabel(task)}</span>}
        {task.division && <span>{task.division}</span>}
        {task.priority === 'low' && <span>Low</span>}
        <TaskExtras task={task} />
      </div>
      {canMove && (
        <select
          value={statusOf(task, statuses).id}
          onChange={(e) => onMove(task, e.target.value)}
          aria-label={`Status of ${task.title}`}
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
            Approve done
          </button>
          <button type="button" className="secondary" onClick={() => onReject(task)} style={{ fontSize: 12, padding: '3px 8px' }}>
            Send back
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
          {task.doneRequested ? 'Cancel finish request' : 'Request done'}
        </button>
      )}
    </div>
  )
}

// One column per status (drag a card to another to change its status, or use
// the select on it) or a plain list. `canMove` is who may change a status;
// `onOpen` is set only for people who may edit the task's details.
export default function TaskBoard({ tasks, allTasks = tasks, statuses, students, divisions = [], weekStartsOn = 0, view, canMove, onMove, onOpen, onSchedule, onAssign, ownId, onRequestDone, onApprove, onReject, onQuickAdd }) {
  const [overStatus, setOverStatus] = useState(null)
  const [overUnassign, setOverUnassign] = useState(false)
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
      className="muted"
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
      Unassigned - drop a task here to take its assignee off
    </div>
  )

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
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Task</th>
              <th>Assignee</th>
              <th>Status</th>
              <th>Division</th>
              <th>Priority</th>
              <th>Dates</th>
            </tr>
          </thead>
          <tbody>
            {sortTasksByDate(tasks).map((t) => {
              const assignee = students.find((s) => s.id === t.assigneeId)
              const overdue = isOverdue(t, statuses, today)
              return (
                <tr key={t.id}>
                  <td>
                    {onOpen ? (
                      <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => onOpen(t)}>
                        {t.title}
                      </button>
                    ) : (
                      t.title
                    )}
                    <div className="muted" style={{ fontSize: 12 }}>
                      <TaskExtras task={t} />
                    </div>
                    {waitingOn(t, allTasks, statuses).length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--danger)' }}>🔒 Waiting on {waitingOn(t, allTasks, statuses).map((w) => w.title).join(', ')}</div>
                    )}
                  </td>
                  <td>{assignee ? assignee.fullName : t.assigneeId ? '(removed student)' : '—'}</td>
                  <td>
                    {canMoveTask(t) ? (
                      <select
                        value={statusOf(t, statuses).id}
                        onChange={(e) => onMove(t, e.target.value)}
                        aria-label={`Status of ${t.title}`}
                        style={{ fontSize: 13, padding: '3px 6px' }}
                      >
                        {moveOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      statusOf(t, statuses).name
                    )}
                  </td>
                  <td>{t.division || '—'}</td>
                  <td>{PRIORITY_NAME[t.priority] || 'Normal'}</td>
                  <td style={overdue ? { color: 'var(--danger)' } : undefined}>{taskDateLabel(t) || '—'}</td>
                </tr>
              )
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No tasks.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </>
    )
  }

  return (
    <>
    {legend}
    {unassignZone}
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 8 }}>
      {statuses.map((status) => {
        const column = sorted.filter((t) => statusOf(t, statuses).id === status.id)
        return (
          <div
            key={status.id}
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
              <TaskCard key={t.id} task={t} students={students} statuses={statuses} divisions={divisions} allTasks={allTasks} canMove={canMoveTask(t)} moveOptions={moveOptions} ownId={ownId} onRequestDone={onRequestDone} onApprove={onApprove} onReject={onReject} onMove={onMove} onOpen={onOpen} today={today} />
            ))}
            {column.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nothing here</div>}
            {onQuickAdd && <QuickAdd onAdd={(title) => onQuickAdd(title, status.id)} />}
          </div>
        )
      })}
    </div>
    </>
  )
}
