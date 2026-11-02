import { useEffect, useMemo, useState } from 'react'
import { communityDb } from '../firebase'
import { useStudentAuth } from '../context/StudentAuthContext'
import TaskBoard from '../components/TaskBoard'
import TaskFormPanel from '../components/TaskFormPanel'
import { logStudentChange } from '../lib/communityLog'
import { EMPTY_TASK, addTaskComment, becameDone, firstDoneStatus, moveBlockedReason, moveTask, prerequisiteCandidates, scheduleBlockedReason, spawnNextOccurrence, statusOf, taskDateLabel, useTaskData, waitingOn, writeTask } from '../lib/tasks'
import DueSoon from '../components/DueSoon'
import TaskDetailPanel from '../components/TaskDetailPanel'

// A StudentLayout tab. Students only watch their own tasks; a task lead
// (taskLead on their roster doc, set by an admin on the Students page) sees
// every task and can create, edit and move them. The database check behind
// that is only "the claimed updater is a task lead" - there's no per-student
// identity here (see hasStudentAccess in firestore.rules).
export default function MyTasks() {
  const { verified, studentId, student } = useStudentAuth()
  const isLead = !!student?.taskLead
  const { tasks: allTasks, statuses, loading } = useTaskData(communityDb, verified.teamId, null)
  const tasks = useMemo(() => (isLead ? allTasks : allTasks.filter((t) => t.assigneeId === studentId)), [allTasks, isLead, studentId])
  const [view, setView] = useState('board')
  const [mineOnly, setMineOnly] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [info, setInfo] = useState('')
  const [division, setDivision] = useState('all')
  const divisions = verified.divisions || []
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [form, setForm] = useState(EMPTY_TASK)

  useEffect(() => {
    document.title = 'AttendX | My Tasks'
  }, [])

  const shown = useMemo(
    () =>
      tasks
        .filter((t) => !(isLead && mineOnly) || t.assigneeId === studentId)
        .filter((t) => division === 'all' || (division === 'none' ? !t.division : t.division === division)),
    [tasks, isLead, mineOnly, studentId, division]
  )

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
    })
    setShowForm(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const task = { ...form, title: form.title.trim(), statusId: form.statusId || statuses[0].id }
    if (!task.title) return
    const scheduleReason = scheduleBlockedReason({ ...task, id: editing?.id }, task.startDate, task.dueDate, allTasks, statuses)
    if (scheduleReason) {
      setFormError(scheduleReason)
      return
    }
    const statusChanged = !editing || statusOf(editing, statuses).id !== task.statusId
    const reason = statusChanged ? moveBlockedReason({ ...task, id: editing?.id }, task.statusId, allTasks, statuses) : ''
    if (reason) {
      setFormError(reason)
      return
    }
    setFormError('')
    const waiting = waitingOn({ ...task, id: editing?.id }, allTasks, statuses)
    if (!statusChanged && waiting.length > 0 && task.statusId !== statuses[0].id) {
      task.statusId = statuses[0].id
      setNotice(`"${task.title}" is waiting on ${waiting.map((t) => `"${t.title}"`).join(', ')}, so it was moved back to ${statuses[0].name}.`)
      setTimeout(() => setNotice(''), 8000)
    }
    if (statuses.find((s) => s.id === task.statusId)?.done) task.doneRequested = false
    writeTask(communityDb, verified.teamId, editing?.id ?? null, task, studentId)
    logStudentChange(verified.teamId, 'task', editing ? 'update' : 'create', `${editing ? 'Updated' : 'Added'} task "${task.title}"`, student.fullName)
    if (editing && becameDone(editing, task.statusId, statuses)) afterDone({ ...editing, ...task })
    setShowForm(false)
  }

  // The assignee asks for a task to be marked done; a lead or admin approves.
  function requestDone(task, wanted) {
    writeTask(communityDb, verified.teamId, task.id, { doneRequested: wanted }, studentId)
    logStudentChange(verified.teamId, 'task', 'update', `${wanted ? 'Asked to finish' : 'Withdrew the finish request for'} task "${task.title}"`, student.fullName)
  }

  function approveDone(task) {
    const done = firstDoneStatus(statuses)
    if (!done) {
      setNotice('Mark one of the statuses as Finished first.')
      return
    }
    handleMove(task, done.id)
  }

  function rejectDone(task) {
    writeTask(communityDb, verified.teamId, task.id, { doneRequested: false }, studentId)
    logStudentChange(verified.teamId, 'task', 'update', `Sent task "${task.title}" back`, student.fullName)
  }

  function toggleItem(task, itemId) {
    writeTask(communityDb, verified.teamId, task.id, { checklist: (task.checklist || []).map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)) }, studentId)
  }

  // A finished repeating task makes its next copy.
  async function afterDone(task) {
    if (!task.repeat) return
    const created = await spawnNextOccurrence(communityDb, verified.teamId, task, statuses[0].id, studentId).catch(() => null)
    if (created) {
      logStudentChange(verified.teamId, 'task', 'create', `Added next "${task.title}" (repeating task)`, student.fullName)
      setInfo(`Next "${task.title}" created: ${taskDateLabel(created)}`)
      setTimeout(() => setInfo(''), 8000)
    }
  }

  function handleMove(task, statusId) {
    if (!isLead) {
      if (task.assigneeId !== studentId) return
      if (statuses.find((s) => s.id === statusId)?.done) {
        setNotice('A task lead has to approve finishing a task - use "Request done" instead.')
        setTimeout(() => setNotice(''), 6000)
        return
      }
    }
    const reason = moveBlockedReason(task, statusId, allTasks, statuses)
    if (reason) {
      setNotice(reason)
      setTimeout(() => setNotice(''), 6000)
      return
    }
    setNotice('')
    const name = statuses.find((s) => s.id === statusId)?.name || statusId
    moveTask(communityDb, verified.teamId, task.id, statusId, studentId, { doneRequested: false })
    logStudentChange(verified.teamId, 'task', 'update', `Moved task "${task.title}" to ${name}`, student.fullName)
    if (becameDone(task, statusId, statuses)) afterDone(task)
  }

  function handleAssign(task, assigneeId) {
    writeTask(communityDb, verified.teamId, task.id, { assigneeId }, studentId)
    logStudentChange(verified.teamId, 'task', 'update', `Unassigned task "${task.title}"`, student.fullName)
  }

  function handleSchedule(task, startDate, dueDate) {
    const reason = scheduleBlockedReason(task, startDate, dueDate, allTasks, statuses)
    if (reason) {
      setNotice(reason)
      setTimeout(() => setNotice(''), 6000)
      return
    }
    setNotice('')
    writeTask(communityDb, verified.teamId, task.id, { startDate, dueDate }, studentId)
    logStudentChange(verified.teamId, 'task', 'update', `Rescheduled task "${task.title}"`, student.fullName)
  }

  if (loading) return <div className="page-loading">Loading tasks…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>{isLead ? 'Tasks' : 'My tasks'}</h2>
        <div className="page-header-actions">
          {isLead && (
            <button type="button" onClick={startNew}>
              + New task
            </button>
          )}
        </div>
      </div>

      <DueSoon tasks={allTasks} statuses={statuses} studentId={studentId} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {isLead && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Only mine
          </label>
        )}
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
      {info && <p style={{ color: 'var(--ok-text)' }}>{info}</p>}
      {isLead && tasks.some((t) => t.doneRequested && !statusOf(t, statuses).done) && (
        <p style={{ color: 'var(--warn-text)' }}>✋ {tasks.filter((t) => t.doneRequested && !statusOf(t, statuses).done).length} task(s) waiting for approval</p>
      )}

      {!isLead && tasks.length === 0 ? (
        <p className="muted">No tasks assigned to you.</p>
      ) : (
        <TaskBoard
          tasks={shown}
          allTasks={allTasks}
          statuses={statuses}
          students={verified.students}
          divisions={divisions}
          weekStartsOn={verified.weekStartsOn ?? 0}
          view={view}
          canMove={isLead}
          ownId={studentId}
          onRequestDone={requestDone}
          onApprove={isLead ? approveDone : undefined}
          onReject={isLead ? rejectDone : undefined}
          onMove={handleMove}
          onOpen={isLead ? startEdit : (t) => setDetailId(t.id)}
          onSchedule={isLead ? handleSchedule : undefined}
          onAssign={isLead ? handleAssign : undefined}
        />
      )}

      {!isLead && detailId && allTasks.some((t) => t.id === detailId) && (
        <TaskDetailPanel
          open
          onClose={() => setDetailId(null)}
          task={allTasks.find((t) => t.id === detailId)}
          statuses={statuses}
          currentStatusId={statusOf(allTasks.find((t) => t.id === detailId), statuses).id}
          onMove={(statusId) => handleMove(allTasks.find((t) => t.id === detailId), statusId)}
          onToggleItem={(itemId) => toggleItem(allTasks.find((t) => t.id === detailId), itemId)}
          onAddComment={(text) => addTaskComment(communityDb, verified.teamId, detailId, text, student.fullName, studentId)}
          onRequestDone={(wanted) => requestDone(allTasks.find((t) => t.id === detailId), wanted)}
        />
      )}

      {isLead && (
        <TaskFormPanel
          open={showForm}
          onClose={() => setShowForm(false)}
          onSubmit={handleSubmit}
          form={form}
          setForm={setForm}
          students={verified.students}
          statuses={statuses}
          divisions={divisions}
          candidates={prerequisiteCandidates(editing?.id, allTasks)}
          error={formError}
          comments={allTasks.find((t) => t.id === editing?.id)?.comments || []}
          onAddComment={(text) => addTaskComment(communityDb, verified.teamId, editing.id, text, student.fullName, studentId)}
          editing={!!editing}
        />
      )}
    </div>
  )
}
