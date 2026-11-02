import { useEffect, useMemo, useState } from 'react'
import { communityDb } from '../firebase'
import { useStudentAuth } from '../context/StudentAuthContext'
import TaskBoard from '../components/TaskBoard'
import TaskFormPanel from '../components/TaskFormPanel'
import { logStudentChange } from '../lib/communityLog'
import CompletionCelebration from '../components/CompletionCelebration'
import UndoBar from '../components/UndoBar'
import { MyTaskRequests, RequestTaskPanel, TaskRequestList } from '../components/TaskRequests'
import BlockedPrompt from '../components/BlockedPrompt'
import SendBackPrompt from '../components/SendBackPrompt'
import { EMPTY_TASK, addTaskComment, becameDone, completionFields, decideTaskRequest, submitTaskRequest, firstDoneStatus, isBlockedStatus, moveBlockedReason, moveTask, prerequisiteCandidates, scheduleBlockedReason, spawnNextOccurrence, statusOf, taskDateLabel, useTaskData, useProductList, useSystemList, useTaskRequests, waitingOn, waitingParts, writeTask, isOldDone, duplicateOf, projectNames } from '../lib/tasks'
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
  const [undo, setUndo] = useState(null)
  const [sendBackTask, setSendBackTask] = useState(null)
  const requests = useTaskRequests(communityDb, verified.teamId, isLead ? null : studentId)
  const [showRequest, setShowRequest] = useState(false)
  const [acceptingRequest, setAcceptingRequest] = useState(null)
  const [blockedAsk, setBlockedAsk] = useState(null)
  const [division, setDivision] = useState('all')
  const divisions = verified.divisions || []
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [form, setForm] = useState(EMPTY_TASK)
  const [system, setSystem] = useState('all')
  const [showOld, setShowOld] = useState(false)
  const [project, setProject] = useState('all')
  const systems = useSystemList(communityDb, verified.teamId)
  // The inventory is only read when a task needs parts or the form is open.
  const needStock = allTasks.some((t) => (t.partIds || []).length > 0) || showForm
  const products = useProductList(communityDb, verified.teamId, needStock)
  const partsFor = (task) => waitingParts(task, products, verified.productTypes || [])

  useEffect(() => {
    document.title = 'AttendX | My Tasks'
  }, [])

  const shown = useMemo(
    () =>
      tasks
        .filter((t) => !(isLead && mineOnly) || t.assigneeId === studentId)
        .filter((t) => division === 'all' || (division === 'none' ? !t.division : t.division === division))
        .filter((t) => system === 'all' || (system === 'none' ? !t.systemId : t.systemId === system))
        .filter((t) => project === 'all' || (project === 'none' ? !t.project : t.project === project))
        .filter((t) => view === 'stats' || showOld || !isOldDone(t, statuses)),
    [tasks, isLead, mineOnly, studentId, division, system, project, view, showOld, statuses]
  )
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
    const scheduleReason = scheduleBlockedReason({ ...task, id: editing?.id }, task.startDate, task.dueDate, allTasks, statuses)
    if (scheduleReason) {
      setFormError(scheduleReason)
      return
    }
    const statusChanged = !editing || statusOf(editing, statuses).id !== task.statusId
    const reason = statusChanged ? moveBlockedReason({ ...task, id: editing?.id }, task.statusId, allTasks, statuses, partsFor(task)) : ''
    if (reason) {
      setFormError(reason)
      return
    }
    setFormError('')
    const waiting = [...waitingOn({ ...task, id: editing?.id }, allTasks, statuses).map((t) => `"${t.title}"`), ...partsFor(task).map((p) => `the part "${p.name}"`)]
    if (!statusChanged && waiting.length > 0 && task.statusId !== statuses[0].id) {
      task.statusId = statuses[0].id
      setNotice(`"${task.title}" is waiting on ${waiting.join(', ')}, so it was moved back to ${statuses[0].name}.`)
      setTimeout(() => setNotice(''), 8000)
    }
    if (statuses.find((s) => s.id === task.statusId)?.done) task.doneRequested = false
    Object.assign(task, completionFields(editing, task.statusId, statuses))
    writeTask(communityDb, verified.teamId, editing?.id ?? null, task, studentId)
    if (!editing && acceptingRequest) {
      decideTaskRequest(communityDb, verified.teamId, acceptingRequest.id, 'accepted', studentId)
      logStudentChange(verified.teamId, 'task', 'update', `Accepted task request "${acceptingRequest.title}"`, student.fullName)
      setAcceptingRequest(null)
    }
    logStudentChange(verified.teamId, 'task', editing ? 'update' : 'create', `${editing ? 'Updated' : 'Added'} task "${task.title}"`, student.fullName)
    if (editing && becameDone(editing, task.statusId, statuses)) afterDone({ ...editing, ...task })
    setShowForm(false)
  }

  // Offers to take back the last drag or move for a few seconds.
  function offerUndo(message, run) {
    const stamp = Date.now()
    setUndo({ message, run, stamp })
    setTimeout(() => setUndo((u) => (u && u.stamp === stamp ? null : u)), 8000)
  }

  // "+ Add task" at the bottom of a column (task leads).
  function quickAdd(title, statusId) {
    const task = {
      ...EMPTY_TASK,
      title,
      statusId,
      division: division !== 'all' && division !== 'none' ? division : '',
      assigneeId: mineOnly ? studentId : '',
      ...completionFields(null, statusId, statuses),
    }
    writeTask(communityDb, verified.teamId, null, task, studentId)
    logStudentChange(verified.teamId, 'task', 'create', `Added task "${title}"`, student.fullName)
  }

  function handleDuplicate() {
    writeTask(communityDb, verified.teamId, null, duplicateOf(editing, statuses[0].id), studentId)
    logStudentChange(verified.teamId, 'task', 'create', `Duplicated task "${editing.title}"`, student.fullName)
    setShowForm(false)
    setInfo(`Duplicated "${editing.title}".`)
    setTimeout(() => setInfo(''), 6000)
  }

  function sendRequest(request) {
    submitTaskRequest(communityDb, verified.teamId, { ...request, requestedBy: studentId, requestedByName: student.fullName })
    logStudentChange(verified.teamId, 'task', 'create', `Requested task "${request.title}"`, student.fullName)
    setShowRequest(false)
  }

  // A lead accepting a request opens the new-task form filled in from it.
  function acceptRequest(request) {
    setFormError('')
    setEditing(null)
    setAcceptingRequest(request)
    setForm({ ...EMPTY_TASK, title: request.title, description: request.description || '', division: request.division || '', statusId: statuses[0].id })
    setShowForm(true)
  }

  function declineRequest(request, reason) {
    decideTaskRequest(communityDb, verified.teamId, request.id, 'declined', studentId, reason)
    logStudentChange(verified.teamId, 'task', 'update', `Declined task request "${request.title}"`, student.fullName)
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

  // Sending a finish request back asks for an optional note, kept as a comment.
  function rejectDone(task) {
    setSendBackTask(task)
  }

  function sendBack(task, note) {
    writeTask(communityDb, verified.teamId, task.id, { doneRequested: false }, studentId)
    if (note) addTaskComment(communityDb, verified.teamId, task.id, `Sent back: ${note}`, student.fullName, studentId)
    logStudentChange(verified.teamId, 'task', 'update', `Sent task "${task.title}" back`, student.fullName)
    setSendBackTask(null)
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

  // `reason` is the answer to "why is it blocked?" for a blocked status.
  function handleMove(task, statusId, { reason: blockedWhy, skipUndo = false } = {}) {
    if (!isLead) {
      if (task.assigneeId !== studentId) return
      if (statuses.find((s) => s.id === statusId)?.done) {
        setNotice('A task lead has to approve finishing a task - use "Request done" instead.')
        setTimeout(() => setNotice(''), 6000)
        return
      }
    }
    const reason = moveBlockedReason(task, statusId, allTasks, statuses, partsFor(task))
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
    moveTask(communityDb, verified.teamId, task.id, statusId, studentId, { doneRequested: false, ...completionFields(task, statusId, statuses), ...blockedFields })
    logStudentChange(verified.teamId, 'task', 'update', `Moved task "${task.title}" to ${name}`, student.fullName)
    const finished = becameDone(task, statusId, statuses)
    if (finished) afterDone(task)
    if (!skipUndo && !(finished && task.repeat)) {
      const before = statusOf(task, statuses).id
      offerUndo(`Moved "${task.title}" to ${name}`, () => handleMove({ ...task, statusId }, before, { reason: task.blockedReason || '', skipUndo: true }))
    }
  }

  function handleAssign(task, assigneeId, skipUndo = false) {
    writeTask(communityDb, verified.teamId, task.id, { assigneeId }, studentId)
    logStudentChange(verified.teamId, 'task', 'update', `Unassigned task "${task.title}"`, student.fullName)
    if (!skipUndo) offerUndo(`Unassigned "${task.title}"`, () => handleAssign({ ...task, assigneeId }, task.assigneeId || '', true))
  }

  function handleSchedule(task, startDate, dueDate, skipUndo = false) {
    const reason = scheduleBlockedReason(task, startDate, dueDate, allTasks, statuses)
    if (reason) {
      setNotice(reason)
      setTimeout(() => setNotice(''), 6000)
      return
    }
    setNotice('')
    writeTask(communityDb, verified.teamId, task.id, { startDate, dueDate }, studentId)
    logStudentChange(verified.teamId, 'task', 'update', `Rescheduled task "${task.title}"`, student.fullName)
    if (!skipUndo) offerUndo(`Rescheduled "${task.title}"`, () => handleSchedule({ ...task, startDate, dueDate }, task.startDate || '', task.dueDate || '', true))
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

      <CompletionCelebration tasks={tasks} statuses={statuses} />
      <UndoBar undo={undo} onClose={() => setUndo(null)} />
      <SendBackPrompt task={sendBackTask} onClose={() => setSendBackTask(null)} onSubmit={(note) => sendBack(sendBackTask, note)} />
      <BlockedPrompt ask={blockedAsk} onClose={() => setBlockedAsk(null)} onSubmit={(why) => { handleMove(blockedAsk.task, blockedAsk.statusId, { reason: why }); setBlockedAsk(null) }} />

      {isLead && <TaskRequestList requests={requests} onAccept={acceptRequest} onDecline={declineRequest} />}
      <MyTaskRequests requests={requests.filter((r) => r.requestedBy === studentId)} onRequest={() => setShowRequest(true)} />
      <RequestTaskPanel open={showRequest} onClose={() => setShowRequest(false)} onSubmit={sendRequest} divisions={divisions} />

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
        {isLead && (
          <button type="button" className={view === 'stats' ? '' : 'secondary'} onClick={() => setView('stats')}>
            Stats
          </button>
        )}
        {isLead && (
          <button type="button" className={view === 'workload' ? '' : 'secondary'} onClick={() => setView('workload')}>
            Workload
          </button>
        )}
        <button type="button" className={view === 'projects' ? '' : 'secondary'} onClick={() => setView('projects')}>
          Projects
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
          onQuickAdd={isLead ? quickAdd : undefined}
          partsFor={partsFor}
          systems={systems}
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
          onClose={() => {
            setShowForm(false)
            setAcceptingRequest(null)
          }}
          onSubmit={handleSubmit}
          form={form}
          setForm={setForm}
          students={verified.students}
          statuses={statuses}
          divisions={divisions}
          candidates={prerequisiteCandidates(editing?.id, allTasks)}
          error={formError}
          blockedIds={statuses.filter((s) => s.blocked).map((s) => s.id)}
          products={products}
          systems={systems}
          projects={projectList}
          comments={allTasks.find((t) => t.id === editing?.id)?.comments || []}
          onAddComment={(text) => addTaskComment(communityDb, verified.teamId, editing.id, text, student.fullName, studentId)}
          editing={!!editing}
          onDuplicate={editing ? handleDuplicate : undefined}
        />
      )}
    </div>
  )
}
