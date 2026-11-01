import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase'
import FormPanel from '../components/FormPanel'
import TaskBoard from '../components/TaskBoard'
import TaskFormPanel from '../components/TaskFormPanel'
import { useStudents } from '../lib/firestore-hooks'
import { createTask, deleteTask, setTaskStatus, staleCalendarTasks, syncStaleTaskCalendars, updateTask, updateTaskStatuses } from '../lib/actions'
import { EMPTY_TASK, moveBlockedReason, prerequisiteCandidates, scheduleBlockedReason, statusOf, useTaskData, waitingOn } from '../lib/tasks'

// Admin task management: a board (a column per status) or a list over the
// same tasks. Students see their own on My Tasks; students flagged as task
// leads (Students -> edit) can also create and move tasks from there.
export default function Tasks() {
  const { team } = useAuth()
  const { tasks, statuses, loading } = useTaskData(db, team?.id, null)
  const { data: students } = useStudents(team)
  const [view, setView] = useState('board')
  const [assignee, setAssignee] = useState('all')
  const [division, setDivision] = useState('all')
  const divisions = team?.divisions || []
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_TASK)
  const [showStatuses, setShowStatuses] = useState(false)
  const [statusRows, setStatusRows] = useState([])
  const [statusError, setStatusError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = 'AttendX | Tasks'
  }, [])

  // Tasks a task lead changed (or that were made while Google Calendar wasn't
  // connected) get their calendar entry brought up to date when an admin
  // opens this page. Keyed on which tasks are stale so it can't loop.
  const staleKey = staleCalendarTasks(tasks).map((t) => t.id).join(',')
  useEffect(() => {
    if (loading || !staleKey || !team?.id) return
    syncStaleTaskCalendars(team.id, tasks, students)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleKey, loading])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks
      .filter((t) => assignee === 'all' || (assignee === 'none' ? !t.assigneeId : t.assigneeId === assignee))
      .filter((t) => division === 'all' || (division === 'none' ? !t.division : t.division === division))
      .filter((t) => !q || `${t.title} ${t.description || ''}`.toLowerCase().includes(q))
  }, [tasks, assignee, division, search])

  function startNew() {
    setFormError('')
    setEditing(null)
    setForm({ ...EMPTY_TASK, statusId: statuses[0].id })
    setShowForm(true)
  }

  function startEdit(task) {
    setFormError('')
    setEditing(task)
    setForm({
      title: task.title || '',
      description: task.description || '',
      assigneeId: task.assigneeId || '',
      startDate: task.startDate || '',
      dueDate: task.dueDate || '',
      priority: task.priority || 'normal',
      statusId: statusOf(task, statuses).id,
      division: task.division || '',
      blockedBy: task.blockedBy || [],
    })
    setShowForm(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const task = { ...form, title: form.title.trim(), statusId: form.statusId || statuses[0].id }
    if (!task.title) return
    // Choosing a later status for a waiting task is refused. A task that is
    // already past the first status and now has unfinished prerequisites is
    // sent back to the first status instead, so it never sits "started" while
    // blocked.
    const scheduleReason = scheduleBlockedReason({ ...task, id: editing?.id }, task.startDate, task.dueDate, tasks, statuses)
    if (scheduleReason) {
      setFormError(scheduleReason)
      return
    }
    const statusChanged = !editing || statusOf(editing, statuses).id !== task.statusId
    const reason = statusChanged ? moveBlockedReason({ ...task, id: editing?.id }, task.statusId, tasks, statuses) : ''
    if (reason) {
      setFormError(reason)
      return
    }
    setFormError('')
    const waiting = waitingOn({ ...task, id: editing?.id }, tasks, statuses)
    if (!statusChanged && waiting.length > 0 && task.statusId !== statuses[0].id) {
      task.statusId = statuses[0].id
      setNotice(`"${task.title}" is waiting on ${waiting.map((t) => `"${t.title}"`).join(', ')}, so it was moved back to ${statuses[0].name}.`)
      setTimeout(() => setNotice(''), 8000)
    }
    const assigneeName = students.find((s) => s.id === task.assigneeId)?.fullName || ''
    if (editing) updateTask(team.id, editing, task, assigneeName)
    else createTask(team.id, task, assigneeName)
    setShowForm(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete "${editing.title}"?`)) return
    await deleteTask(team.id, editing)
    setShowForm(false)
  }

  function handleMove(task, statusId) {
    const reason = moveBlockedReason(task, statusId, tasks, statuses)
    if (reason) {
      setNotice(reason)
      setTimeout(() => setNotice(''), 6000)
      return
    }
    setNotice('')
    setTaskStatus(team.id, task, statuses.find((s) => s.id === statusId)?.name || statusId, statusId)
  }

  function handleAssign(task, assigneeId) {
    updateTask(team.id, task, { title: task.title, assigneeId }, students.find((s) => s.id === assigneeId)?.fullName || '')
  }

  // Dragging a task on the calendar (see TaskCalendar) just changes its dates.
  function handleSchedule(task, startDate, dueDate) {
    const reason = scheduleBlockedReason(task, startDate, dueDate, tasks, statuses)
    if (reason) {
      setNotice(reason)
      setTimeout(() => setNotice(''), 6000)
      return
    }
    setNotice('')
    const assigneeName = students.find((s) => s.id === task.assigneeId)?.fullName || ''
    updateTask(team.id, task, { title: task.title, startDate, dueDate }, assigneeName)
  }

  function openStatuses() {
    setStatusRows(statuses.map((s) => ({ ...s })))
    setStatusError('')
    setShowStatuses(true)
  }

  const updateStatusRow = (id, changes) => setStatusRows(statusRows.map((s) => (s.id === id ? { ...s, ...changes } : s)))

  function moveStatusRow(index, delta) {
    const next = [...statusRows]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setStatusRows(next)
  }

  function removeStatusRow(row) {
    const inUse = tasks.filter((t) => statusOf(t, statuses).id === row.id).length
    if (inUse > 0) {
      setStatusError(`"${row.name}" still has ${inUse} task${inUse === 1 ? '' : 's'} - move them to another status first.`)
      return
    }
    if (statusRows.length <= 1) {
      setStatusError('Keep at least one status.')
      return
    }
    setStatusError('')
    setStatusRows(statusRows.filter((s) => s.id !== row.id))
  }

  function handleSaveStatuses(e) {
    e.preventDefault()
    const clean = statusRows.map((s) => ({ ...s, name: s.name.trim(), done: !!s.done })).filter((s) => s.name)
    if (clean.length === 0) {
      setStatusError('Keep at least one status.')
      return
    }
    if (new Set(clean.map((s) => s.name.toLowerCase())).size !== clean.length) {
      setStatusError('Two statuses have the same name.')
      return
    }
    updateTaskStatuses(team.id, clean)
    setShowStatuses(false)
  }

  if (loading) return <div className="page-loading">Loading tasks…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>Tasks</h2>
        <div className="page-header-actions">
          <button type="button" className="secondary" onClick={openStatuses}>
            Statuses
          </button>
          <button type="button" onClick={startNew}>
            + New task
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" style={{ maxWidth: 220 }} />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filter by assignee">
          <option value="all">Everyone</option>
          <option value="none">Unassigned</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName}
            </option>
          ))}
        </select>
        {divisions.length > 0 && (
          <select value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Filter by division">
            <option value="all">All divisions</option>
            <option value="none">No division</option>
            {divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <button type="button" className={view === 'board' ? '' : 'secondary'} onClick={() => setView('board')}>
          Board
        </button>
        <button type="button" className={view === 'list' ? '' : 'secondary'} onClick={() => setView('list')}>
          List
        </button>
        <button type="button" className={view === 'calendar' ? '' : 'secondary'} onClick={() => setView('calendar')}>
          Calendar
        </button>
      </div>

      {notice && <p className="form-error">{notice}</p>}

      <TaskBoard tasks={shown} allTasks={tasks} statuses={statuses} students={students} divisions={divisions} weekStartsOn={team?.weekStartsOn ?? 0} view={view} canMove onMove={handleMove} onOpen={startEdit} onSchedule={handleSchedule} onAssign={handleAssign} />

      <TaskFormPanel
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmit}
        form={form}
        setForm={setForm}
        students={students}
        statuses={statuses}
        divisions={divisions}
        candidates={prerequisiteCandidates(editing?.id, tasks)}
        error={formError}
        editing={!!editing}
        onDelete={editing ? handleDelete : undefined}
      />

      <FormPanel open={showStatuses} onClose={() => setShowStatuses(false)} onSubmit={handleSaveStatuses}>
        <h3>Task statuses</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {statusRows.map((row, i) => (
            <div key={row.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={row.name} onChange={(e) => updateStatusRow(row.id, { name: e.target.value })} aria-label="Status name" style={{ flex: 1 }} />
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13, whiteSpace: 'nowrap' }} title="Tasks in a finished status are never shown as overdue">
                <input type="checkbox" checked={!!row.done} onChange={(e) => updateStatusRow(row.id, { done: e.target.checked })} style={{ width: 'auto' }} />
                Finished
              </label>
              <button type="button" className="link-btn" onClick={() => moveStatusRow(i, -1)} disabled={i === 0} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="link-btn" onClick={() => moveStatusRow(i, 1)} disabled={i === statusRows.length - 1} aria-label="Move down">
                ↓
              </button>
              <button type="button" className="link-btn danger" onClick={() => removeStatusRow(row)}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="link-btn"
          style={{ alignSelf: 'flex-start', marginTop: 8 }}
          onClick={() => setStatusRows([...statusRows, { id: `s-${Date.now().toString(36)}`, name: '' }])}
        >
          + Add a status
        </button>
        {statusError && <span className="form-error">{statusError}</span>}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowStatuses(false)}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </FormPanel>
    </div>
  )
}
