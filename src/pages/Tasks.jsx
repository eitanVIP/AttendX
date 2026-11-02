import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase'
import FormPanel from '../components/FormPanel'
import TaskBoard from '../components/TaskBoard'
import TaskFormPanel from '../components/TaskFormPanel'
import { useProducts, useStudents, useSystems } from '../lib/firestore-hooks'
import { commentOnTask, createTask, decideTaskRequest, deleteTask, setTaskStatus, spawnRecurringTask, staleCalendarTasks, syncStaleTaskCalendars, updateTask, updateTaskStatuses } from '../lib/actions'
import CompletionCelebration from '../components/CompletionCelebration'
import UndoBar from '../components/UndoBar'
import { TaskRequestList } from '../components/TaskRequests'
import BlockedPrompt from '../components/BlockedPrompt'
import SendBackPrompt from '../components/SendBackPrompt'
import { EMPTY_TASK, becameDone, completionFields, firstDoneStatus, isBlockedStatus, moveBlockedReason, prerequisiteCandidates, scheduleBlockedReason, statusOf, taskDateLabel, useTaskData, useTaskRequests, waitingOn, waitingParts, isOldDone, duplicateOf, projectNames } from '../lib/tasks'

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
  const [info, setInfo] = useState('')
  const [undo, setUndo] = useState(null)
  const [sendBackTask, setSendBackTask] = useState(null)
  const [system, setSystem] = useState('all')
  const [showOld, setShowOld] = useState(false)
  const [project, setProject] = useState('all')
  const { data: systems } = useSystems(team?.id)
  // The inventory is only read when a task needs parts or the form is open.
  const needStock = tasks.some((t) => (t.partIds || []).length > 0) || showForm
  const { data: products } = useProducts(needStock ? team?.id : null)
  const partsFor = (task) => waitingParts(task, products, team?.productTypes || [])
  const requests = useTaskRequests(db, team?.id, null)
  const [acceptingRequest, setAcceptingRequest] = useState(null)
  const [blockedAsk, setBlockedAsk] = useState(null)

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
      .filter((t) => system === 'all' || (system === 'none' ? !t.systemId : t.systemId === system))
      .filter((t) => project === 'all' || (project === 'none' ? !t.project : t.project === project))
      .filter((t) => !q || `${t.title} ${t.description || ''}`.toLowerCase().includes(q))
      .filter((t) => view === 'stats' || showOld || !isOldDone(t, statuses))
  }, [tasks, assignee, division, system, project, search, view, showOld, statuses])
  const projectList = projectNames(tasks)
  const hiddenOld = tasks.filter((t) => isOldDone(t, statuses)).length

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
      checklist: task.checklist || [],
      repeat: task.repeat || '',
      blockedReason: task.blockedReason || '',
      partIds: task.partIds || [],
      systemId: task.systemId || '',
      links: task.links || [],
      project: task.project || '',
    })
    setShowForm(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const task = { ...form, title: form.title.trim(), statusId: form.statusId || statuses[0].id }
    if (!task.title) return
    task.blockedReason = isBlockedStatus(statuses, task.statusId) ? (task.blockedReason || '').trim() : ''
    if (isBlockedStatus(statuses, task.statusId) && !task.blockedReason) {
      setFormError('Say why it is blocked.')
      return
    }
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
    const reason = statusChanged ? moveBlockedReason({ ...task, id: editing?.id }, task.statusId, tasks, statuses, partsFor(task)) : ''
    if (reason) {
      setFormError(reason)
      return
    }
    setFormError('')
    const waiting = [...waitingOn({ ...task, id: editing?.id }, tasks, statuses).map((t) => `"${t.title}"`), ...partsFor(task).map((p) => `the part "${p.name}"`)]
    if (!statusChanged && waiting.length > 0 && task.statusId !== statuses[0].id) {
      task.statusId = statuses[0].id
      setNotice(`"${task.title}" is waiting on ${waiting.join(', ')}, so it was moved back to ${statuses[0].name}.`)
      setTimeout(() => setNotice(''), 8000)
    }
    if (statuses.find((s) => s.id === task.statusId)?.done) task.doneRequested = false
    Object.assign(task, completionFields(editing, task.statusId, statuses))
    const assigneeName = students.find((s) => s.id === task.assigneeId)?.fullName || ''
    if (editing) updateTask(team.id, editing, task, assigneeName)
    else createTask(team.id, task, assigneeName)
    if (!editing && acceptingRequest) {
      decideTaskRequest(team.id, acceptingRequest, 'accepted')
      setAcceptingRequest(null)
    }
    if (editing && becameDone(editing, task.statusId, statuses)) afterDone({ ...editing, ...task })
    setShowForm(false)
  }

  function handleDuplicate() {
    createTask(team.id, duplicateOf(editing, statuses[0].id), students.find((s) => s.id === editing.assigneeId)?.fullName || '')
    setShowForm(false)
    setInfo(`Duplicated "${editing.title}".`)
    setTimeout(() => setInfo(''), 6000)
  }

  async function handleDelete() {
    if (!confirm(`Delete "${editing.title}"?`)) return
    await deleteTask(team.id, editing)
    setShowForm(false)
  }

  // Offers to take back the last drag or move for a few seconds.
  function offerUndo(message, run) {
    const stamp = Date.now()
    setUndo({ message, run, stamp })
    setTimeout(() => setUndo((u) => (u && u.stamp === stamp ? null : u)), 8000)
  }

  // "+ Add task" at the bottom of a column. The current filters carry over.
  function quickAdd(title, statusId) {
    const task = {
      ...EMPTY_TASK,
      title,
      statusId,
      division: division !== 'all' && division !== 'none' ? division : '',
      assigneeId: assignee !== 'all' && assignee !== 'none' ? assignee : '',
      ...completionFields(null, statusId, statuses),
    }
    createTask(team.id, task, students.find((s) => s.id === task.assigneeId)?.fullName || '')
  }

  // Accepting a request opens the new-task form filled in from it.
  function acceptRequest(request) {
    setFormError('')
    setEditing(null)
    setAcceptingRequest(request)
    setForm({ ...EMPTY_TASK, title: request.title, description: request.description || '', division: request.division || '', statusId: statuses[0].id })
    setShowForm(true)
  }

  // Approving a finish request moves the task to the first finished status.
  function approveDone(task) {
    const done = firstDoneStatus(statuses)
    if (!done) {
      setNotice('Mark one of the statuses as Finished first.')
      return
    }
    handleMove(task, done.id)
  }

  // Sending a finish request back asks for an optional note, kept as a comment.
  function rejectDone(task) {
    setSendBackTask(task)
  }

  function sendBack(task, note) {
    updateTask(team.id, task, { title: task.title, doneRequested: false }, students.find((s) => s.id === task.assigneeId)?.fullName || '')
    if (note) commentOnTask(team.id, task.id, `Sent back: ${note}`)
    setSendBackTask(null)
  }

  // A finished repeating task makes its next copy.
  async function afterDone(task) {
    if (!task.repeat) return
    const created = await spawnRecurringTask(team.id, task, statuses[0].id, students).catch(() => null)
    if (created) {
      setInfo(`Next "${task.title}" created: ${taskDateLabel(created)}`)
      setTimeout(() => setInfo(''), 8000)
    }
  }

  // `reason` is the answer to "why is it blocked?" for a blocked status.
  function handleMove(task, statusId, { reason: blockedWhy, skipUndo = false } = {}) {
    const reason = moveBlockedReason(task, statusId, tasks, statuses, partsFor(task))
    if (reason) {
      setNotice(reason)
      setTimeout(() => setNotice(''), 6000)
      return
    }
    const blocked = isBlockedStatus(statuses, statusId)
    if (blocked && blockedWhy === undefined) {
      setBlockedAsk({ task, statusId })
      return
    }
    setNotice('')
    const name = statuses.find((s) => s.id === statusId)?.name || statusId
    const blockedFields = blocked ? { blockedReason: blockedWhy } : task.blockedReason ? { blockedReason: '' } : {}
    setTaskStatus(team.id, task, name, statusId, { ...completionFields(task, statusId, statuses), ...blockedFields })
    const finished = becameDone(task, statusId, statuses)
    if (finished) afterDone(task)
    if (!skipUndo && !(finished && task.repeat)) {
      const before = statusOf(task, statuses).id
      offerUndo(`Moved "${task.title}" to ${name}`, () => handleMove({ ...task, statusId }, before, { reason: task.blockedReason || '', skipUndo: true }))
    }
  }

  function handleAssign(task, assigneeId, skipUndo = false) {
    updateTask(team.id, task, { title: task.title, assigneeId }, students.find((s) => s.id === assigneeId)?.fullName || '')
    if (!skipUndo) offerUndo(`Unassigned "${task.title}"`, () => handleAssign({ ...task, assigneeId }, task.assigneeId || '', true))
  }

  // Dragging a task on the calendar (see TaskCalendar) just changes its dates.
  function handleSchedule(task, startDate, dueDate, skipUndo = false) {
    const reason = scheduleBlockedReason(task, startDate, dueDate, tasks, statuses)
    if (reason) {
      setNotice(reason)
      setTimeout(() => setNotice(''), 6000)
      return
    }
    setNotice('')
    const assigneeName = students.find((s) => s.id === task.assigneeId)?.fullName || ''
    updateTask(team.id, task, { title: task.title, startDate, dueDate }, assigneeName)
    if (!skipUndo) offerUndo(`Rescheduled "${task.title}"`, () => handleSchedule({ ...task, startDate, dueDate }, task.startDate || '', task.dueDate || '', true))
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
    const clean = statusRows.map((s) => ({ ...s, name: s.name.trim(), done: !!s.done, blocked: !!s.blocked })).filter((s) => s.name)
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
        {systems.length > 0 && (
          <select value={system} onChange={(e) => setSystem(e.target.value)} aria-label="Filter by robot system">
            <option value="all">All systems</option>
            <option value="none">No system</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {projectList.length > 0 && (
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
            <option value="all">All projects</option>
            <option value="none">No project</option>
            {projectList.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        {(hiddenOld > 0 || showOld) && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />
            Show finished over 2 weeks ago{hiddenOld > 0 && !showOld ? ` (${hiddenOld} hidden)` : ''}
          </label>
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
        <button type="button" className={view === 'stats' ? '' : 'secondary'} onClick={() => setView('stats')}>
          Stats
        </button>
        <button type="button" className={view === 'workload' ? '' : 'secondary'} onClick={() => setView('workload')}>
          Workload
        </button>
        <button type="button" className={view === 'projects' ? '' : 'secondary'} onClick={() => setView('projects')}>
          Projects
        </button>
      </div>

      {notice && <p className="form-error">{notice}</p>}
      {info && <p style={{ color: 'var(--ok-text)' }}>{info}</p>}
      {tasks.some((t) => t.doneRequested && !statusOf(t, statuses).done) && (
        <p style={{ color: 'var(--warn-text)' }}>✋ {tasks.filter((t) => t.doneRequested && !statusOf(t, statuses).done).length} task(s) waiting for your approval</p>
      )}

      <CompletionCelebration tasks={tasks} statuses={statuses} />
      <UndoBar undo={undo} onClose={() => setUndo(null)} />
      <SendBackPrompt task={sendBackTask} onClose={() => setSendBackTask(null)} onSubmit={(note) => sendBack(sendBackTask, note)} />
      <TaskRequestList requests={requests} onAccept={acceptRequest} onDecline={(r, reason) => decideTaskRequest(team.id, r, 'declined', reason)} />
      <BlockedPrompt ask={blockedAsk} onClose={() => setBlockedAsk(null)} onSubmit={(why) => { handleMove(blockedAsk.task, blockedAsk.statusId, { reason: why }); setBlockedAsk(null) }} />

      <TaskBoard tasks={shown} allTasks={tasks} statuses={statuses} students={students} divisions={divisions} weekStartsOn={team?.weekStartsOn ?? 0} view={view} canMove onMove={handleMove} onOpen={startEdit} onSchedule={handleSchedule} onAssign={handleAssign} onApprove={approveDone} onReject={rejectDone} onQuickAdd={quickAdd} partsFor={partsFor} systems={systems} />

      <TaskFormPanel
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setAcceptingRequest(null)
        }}
        onSubmit={handleSubmit}
        form={form}
        setForm={setForm}
        students={students}
        statuses={statuses}
        divisions={divisions}
        candidates={prerequisiteCandidates(editing?.id, tasks)}
        error={formError}
        blockedIds={statuses.filter((s) => s.blocked).map((s) => s.id)}
        products={products}
        systems={systems}
        projects={projectList}
        comments={tasks.find((t) => t.id === editing?.id)?.comments || []}
        onAddComment={(text) => commentOnTask(team.id, editing.id, text)}
        editing={!!editing}
        onDelete={editing ? handleDelete : undefined}
        onDuplicate={editing ? handleDuplicate : undefined}
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
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13, whiteSpace: 'nowrap' }} title="Moving a task here asks why it is blocked">
                <input type="checkbox" checked={!!row.blocked} onChange={(e) => updateStatusRow(row.id, { blocked: e.target.checked })} style={{ width: 'auto' }} />
                Blocked
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
