import { addDoc, arrayUnion, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { todayISO } from './calc'

// Tasks live at teams/{teamId}/tasks. Admins and task leads (students with
// `taskLead` on their roster doc) write them; every other student only reads
// their own. Both sides share these helpers - `database` is the admin `db` or
// the student `communityDb`.
//
// A task: { title, description, assigneeId (a student id, '' = nobody),
// startDate and dueDate ('YYYY-MM-DD' or '' - together a range), division
// (a team division name or ''), blockedBy (ids of tasks that must be
// finished before this one can leave the first status), priority, statusId, createdAt, updatedAt,
// updatedBy, doneRequested (the assignee asked for it to be marked done; a lead or admin approves), checklist [{ id, text, done }], comments [{ id, authorName, text, at }],
// repeat ('' | 'daily' | 'weekly' | 'biweekly' | 'monthly'), repeatSpawned }. The status list is team-wide and editable, kept at
// teams/{teamId}/settings/tasks as { statuses: [{ id, name, done? }] } (done = counts as finished) - students can
// already read every settings doc.

export const DEFAULT_TASK_STATUSES = [
  { id: 'todo', name: 'To do' },
  { id: 'doing', name: 'Doing' },
  { id: 'done', name: 'Done', done: true },
]

export const TASK_PRIORITIES = [
  { id: 'high', name: 'High' },
  { id: 'normal', name: 'Normal' },
  { id: 'low', name: 'Low' },
]

export const EMPTY_TASK = { title: '', description: '', assigneeId: '', startDate: '', dueDate: '', priority: 'normal', statusId: '', division: '', blockedBy: [], checklist: [], repeat: '' }

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 }

export function taskStatuses(settings) {
  const list = settings?.statuses
  return Array.isArray(list) && list.length > 0 ? list : DEFAULT_TASK_STATUSES
}

// A task whose status was deleted (or is unset) shows in the first column.
export function statusOf(task, statuses) {
  return statuses.find((s) => s.id === task.statusId) || statuses[0]
}

// Highest priority first, then the soonest due date (no date last), then oldest.
export function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
      (a.dueDate || a.startDate || '9999').localeCompare(b.dueDate || b.startDate || '9999') ||
      (a.createdAt || '').localeCompare(b.createdAt || '')
  )
}

// A task's division (one of the team's divisions - Mechanical, Electrical...)
// is shown as a colour, taken from the division's place in the team's list so
// it stays the same everywhere. No division = grey.
const DIVISION_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777']
export function divisionColor(division, divisions) {
  const i = division ? (divisions || []).indexOf(division) : -1
  return i >= 0 ? DIVISION_COLORS[i % DIVISION_COLORS.length] : '#71717a'
}

// Earliest first by the day it starts (or is due); tasks with no date last.
// Ties go by due date, then priority.
export function sortTasksByDate(tasks) {
  return [...tasks].sort(
    (a, b) =>
      (a.startDate || a.dueDate || '9999').localeCompare(b.startDate || b.dueDate || '9999') ||
      (a.dueDate || a.startDate || '9999').localeCompare(b.dueDate || b.startDate || '9999') ||
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
      (a.createdAt || '').localeCompare(b.createdAt || '')
  )
}

// Dates are stored as 'YYYY-MM-DD' and shown as dd/mm/yy.
export function formatDMY(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '')
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''
}

// "3/11/26", "03/11/2026", "3.11.26" -> '2026-11-03'; '' -> ''; anything that
// isn't a real date -> null.
export function parseDMY(text) {
  const t = String(text ?? '').trim()
  if (!t) return ''
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t)
  if (!m) return null
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]))
  if (d.getFullYear() !== year || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[1])) return null
  return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Whole-day arithmetic on ISO dates (UTC, so daylight saving can't skew it).
const toUTC = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
export function daysBetween(fromISO, toISO) {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / 86400000)
}
export function addDays(iso, days) {
  const d = new Date(toUTC(iso) + days * 86400000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// "03/11/26 → 05/11/26", "Due 2026-03-05" or "Starts 2026-03-03".
export function taskDateLabel(task) {
  if (task.startDate && task.dueDate && task.startDate !== task.dueDate) return `${formatDMY(task.startDate)} → ${formatDMY(task.dueDate)}`
  if (task.dueDate) return `Due ${formatDMY(task.dueDate)}`
  if (task.startDate) return `Starts ${formatDMY(task.startDate)}`
  return ''
}

// The tasks this one is still waiting on: its prerequisites that exist and
// aren't in a finished status. A prerequisite that was deleted counts as done.
export function waitingOn(task, allTasks, statuses) {
  return (task.blockedBy || []).map((id) => allTasks.find((t) => t.id === id)).filter((t) => t && !statusOf(t, statuses).done)
}

// Why a task can't go to `statusId` right now ('' when it can): while it's
// waiting on others it has to stay in the first status.
export function moveBlockedReason(task, statusId, allTasks, statuses) {
  if (statusId === statuses[0].id) return ''
  const waiting = waitingOn(task, allTasks, statuses)
  if (waiting.length === 0) return ''
  return `"${task.title}" is waiting on ${waiting.map((t) => `"${t.title}"`).join(', ')} - finish that first.`
}

// Why a task can't be scheduled to start on `startDate` ('' when it can): it
// may not begin before the day an unfinished prerequisite ends (the same day
// is fine).
// Prerequisites with no date don't hold it back.
export function scheduleBlockedReason(task, startDate, dueDate, allTasks, statuses) {
  const start = startDate || dueDate
  if (!start) return ''
  for (const p of waitingOn(task, allTasks, statuses)) {
    const ends = p.dueDate || p.startDate
    if (ends && start < ends) {
      return `"${task.title}" can't start before "${p.title}" is done - that one ends ${formatDMY(ends)}, so this can start on that day or later.`
    }
  }
  return ''
}

// Tasks that can be picked as prerequisites of `taskId`: everything except
// itself and the tasks that (directly or not) already wait on it, so a loop
// can't be made.
export function prerequisiteCandidates(taskId, allTasks) {
  const downstream = new Set([taskId])
  let grew = true
  while (grew) {
    grew = false
    for (const t of allTasks) {
      if (!downstream.has(t.id) && (t.blockedBy || []).some((id) => downstream.has(id))) {
        downstream.add(t.id)
        grew = true
      }
    }
  }
  return allTasks.filter((t) => !downstream.has(t.id))
}

// Repeating tasks: when one is finished, the next copy is created with the
// dates moved on by the interval (and pushed on further if that would still be
// in the past, e.g. a weekly task finished three weeks late).
export const REPEATS = [
  { id: '', name: 'Does not repeat' },
  { id: 'daily', name: 'Every day', unit: 'day', n: 1 },
  { id: 'weekly', name: 'Every week', unit: 'day', n: 7 },
  { id: 'biweekly', name: 'Every 2 weeks', unit: 'day', n: 14 },
  { id: 'monthly', name: 'Every month', unit: 'month', n: 1 },
]
const REPEAT_BY_ID = Object.fromEntries(REPEATS.map((r) => [r.id, r]))

function addMonths(iso, months) {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 + months
  const first = new Date(Date.UTC(y, m, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(Number(iso.slice(8, 10)), last)
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function repeatLabel(task) {
  return task.repeat ? REPEAT_BY_ID[task.repeat]?.name || '' : ''
}

// The fields of the next copy of a repeating task, or null when it doesn't
// repeat or has no date to move on from.
export function nextOccurrence(task, today = todayISO()) {
  const rule = REPEAT_BY_ID[task.repeat]
  if (!rule || !rule.n || !(task.startDate || task.dueDate)) return null
  const shift = (iso, times) => (iso ? (rule.unit === 'month' ? addMonths(iso, times * rule.n) : addDays(iso, times * rule.n)) : '')
  let times = 1
  while (times < 1000 && (shift(task.dueDate, times) || shift(task.startDate, times)) < today) times++
  return {
    title: task.title,
    description: task.description || '',
    assigneeId: task.assigneeId || '',
    priority: task.priority || 'normal',
    division: task.division || '',
    repeat: task.repeat,
    repeatSpawned: false,
    blockedBy: [],
    startDate: shift(task.startDate, times),
    dueDate: shift(task.dueDate, times),
    checklist: (task.checklist || []).map((item) => ({ ...item, done: false })),
  }
}

// The status a finished task moves to (the first one marked as finished), or
// undefined when none is.
export const firstDoneStatus = (statuses) => statuses.find((s) => s.done)

// True when moving `task` to `statusId` takes it from unfinished to finished.
export function becameDone(task, statusId, statuses) {
  return !statusOf(task, statuses).done && !!statuses.find((s) => s.id === statusId)?.done
}

// Creates the next copy of a finished repeating task and marks the finished
// one so reopening and finishing it again can't make a second copy. Both
// writes go in one batch. Resolves to the new task, or null when there was
// nothing to create.
export async function spawnNextOccurrence(database, teamId, task, firstStatusId, actorId) {
  if (task.repeatSpawned) return null
  const next = nextOccurrence(task)
  if (!next) return null
  const now = new Date().toISOString()
  const ref = doc(collection(database, 'teams', teamId, 'tasks'))
  const batch = writeBatch(database)
  batch.set(ref, { ...next, statusId: firstStatusId, createdAt: now, updatedAt: now, updatedBy: actorId })
  batch.update(doc(database, 'teams', teamId, 'tasks', task.id), { repeatSpawned: true, updatedBy: actorId, updatedAt: now })
  await batch.commit()
  return { id: ref.id, ...next }
}

export function checklistProgress(task) {
  const items = task.checklist || []
  return { done: items.filter((i) => i.done).length, total: items.length }
}

export function addTaskComment(database, teamId, taskId, text, authorName, actorId) {
  const now = new Date().toISOString()
  const comment = { id: Math.random().toString(36).slice(2, 10), authorName, text, at: now }
  return updateDoc(doc(database, 'teams', teamId, 'tasks', taskId), { comments: arrayUnion(comment), updatedBy: actorId, updatedAt: now })
}

// A student's unfinished tasks that are overdue or fall (end, or start when
// there is no end) within the next `days` days, soonest first.
export function dueSoon(tasks, statuses, studentId, today = todayISO(), days = 7) {
  const horizon = addDays(today, days)
  return tasks
    .filter((t) => t.assigneeId === studentId && !statusOf(t, statuses).done)
    .filter((t) => {
      const end = t.dueDate || t.startDate
      return end && end <= horizon
    })
    .sort((a, b) => (a.dueDate || a.startDate).localeCompare(b.dueDate || b.startDate))
}

// Overdue = past its due date and not in a status marked finished.
export function isOverdue(task, statuses, today) {
  if (!task.dueDate || task.dueDate >= today) return false
  return !statusOf(task, statuses)?.done
}

export function writeTask(database, teamId, taskId, data, actorId) {
  const now = new Date().toISOString()
  const payload = { ...data, updatedBy: actorId, updatedAt: now }
  if (taskId) return updateDoc(doc(database, 'teams', teamId, 'tasks', taskId), payload)
  return addDoc(collection(database, 'teams', teamId, 'tasks'), { ...payload, createdAt: now })
}

export function moveTask(database, teamId, taskId, statusId, actorId, extra = {}) {
  return updateDoc(doc(database, 'teams', teamId, 'tasks', taskId), {
    ...extra,
    statusId,
    updatedBy: actorId,
    updatedAt: new Date().toISOString(),
  })
}

// Admins only (students have no delete rule).
export function removeTask(database, teamId, taskId) {
  return deleteDoc(doc(database, 'teams', teamId, 'tasks', taskId))
}

export function saveTaskStatuses(database, teamId, statuses) {
  return setDoc(doc(database, 'teams', teamId, 'settings', 'tasks'), { statuses }, { merge: true })
}

// Live tasks plus the status list. `onlyAssigneeId` limits the query to one
// student's tasks (what a plain student sees), so they don't download the
// whole team's.
export function useTaskData(database, teamId, onlyAssigneeId) {
  const [tasks, setTasks] = useState([])
  const [settings, setSettings] = useState(null)
  const [ready, setReady] = useState({ tasks: false, settings: false })

  useEffect(() => {
    if (!teamId) return
    const base = collection(database, 'teams', teamId, 'tasks')
    const source = onlyAssigneeId ? query(base, where('assigneeId', '==', onlyAssigneeId)) : base
    const mark = (key) => setReady((r) => ({ ...r, [key]: true }))
    const unsubTasks = onSnapshot(
      source,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        mark('tasks')
      },
      () => mark('tasks')
    )
    const unsubSettings = onSnapshot(
      doc(database, 'teams', teamId, 'settings', 'tasks'),
      (snap) => {
        setSettings(snap.exists() ? snap.data() : null)
        mark('settings')
      },
      () => mark('settings')
    )
    return () => {
      unsubTasks()
      unsubSettings()
    }
  }, [database, teamId, onlyAssigneeId])

  return { tasks, statuses: taskStatuses(settings), loading: !(ready.tasks && ready.settings) }
}
