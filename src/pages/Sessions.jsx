import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import MoveButtons from '../components/MoveButtons'
import StickyTableScroll from '../components/StickyTableScroll'
import { useAllAttendance, useSessions, useStudents } from '../lib/firestore-hooks'
import { useMatrixLayout } from '../lib/useMatrixLayout'
import { ATTENDANCE_STATUSES, isSessionRelevantToStudent, movedWithinGroup, swappedRows, todayISO } from '../lib/calc'
import { addSession, clearAttendance, deleteSession, reorderDocs, setAttendance, updateSession } from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'

const emptyForm = { date: todayISO(), name: '', targetDivision: 'all', notes: '' }

const STATUS_LABELS = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' }

export default function Sessions() {
  const { team } = useAuth()
  const { data: sessions, loading } = useSessions(team?.id)
  const { data: students, loading: studentsLoading } = useStudents(team)
  const { data: attendance, loading: attLoading } = useAllAttendance(team?.id)
  const [divisionFilter, setDivisionFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const divisions = useMemo(() => team?.divisions || [], [team])

  const statusBySessionAndStudent = useMemo(() => {
    const map = {}
    for (const r of attendance) {
      map[`${r.sessionId}_${r.studentId}`] = r.status
    }
    return map
  }, [attendance])

  const visible = useMemo(() => {
    if (!divisionFilter) return sessions
    return sessions.filter(
      (s) => !s.targetDivision || s.targetDivision === 'all' || s.targetDivision === divisionFilter,
    )
  }, [sessions, divisionFilter])

  // Group by division so there's always a clear heading over each block of
  // rows - mirrors the Trainings page layout for consistency. Inactive
  // students stay in as dimmed columns so their attendance can still be
  // recorded (and, under the attendance minimum, recover).
  const groups = useMemo(() => {
    const byDivision = new Map()
    for (const s of visible) {
      const key = s.targetDivision && s.targetDivision !== 'all' ? s.targetDivision : null
      if (!byDivision.has(key)) byDivision.set(key, [])
      byDivision.get(key).push(s)
    }
    const knownKeys = divisionFilter ? [divisionFilter] : divisions
    const orphanKeys = [...byDivision.keys()].filter((k) => k !== null && !knownKeys.includes(k))
    const order = [...knownKeys, ...orphanKeys, null]
    return order
      .filter((key, i) => order.indexOf(key) === i && byDivision.has(key))
      .map((key) => ({
        title: key || 'General (all students)',
        sessions: byDivision.get(key),
        columnStudents: key ? students.filter((s) => s.divisions.includes(key)) : students,
      }))
  }, [visible, divisions, divisionFilter, students])

  function handleSubmit(e) {
    e.preventDefault()
    if (editingId) {
      updateSession(team.id, editingId, form)
    } else {
      rememberForm('sessions', form, ['name', 'notes'])
      addSession(team.id, form)
    }
    setShowForm(false)
  }

  function startEdit(session) {
    setForm({
      date: session.date || todayISO(),
      name: session.name || '',
      targetDivision: session.targetDivision || 'all',
      notes: session.notes || '',
    })
    setEditingId(session.id)
    setShowForm(true)
  }

  async function handleDelete(session) {
    if (!confirm('Delete this session and its attendance records?')) return
    await deleteSession(team.id, session)
  }

  async function handleStatusChange(session, student, next) {
    if (next) await setAttendance(team.id, session, student, next)
    else await clearAttendance(team.id, session, student)
  }

  // Swaps with the neighbour within the group's rows; the full collection
  // is what gets renumbered.
  function move(groupSessions, index, direction) {
    const neighbour = groupSessions[index + direction]
    if (!neighbour) return
    reorderDocs(team.id, 'sessions', swappedRows(sessions, groupSessions[index].id, neighbour.id))
  }

  function moveTo(groupSessions, index, toIndex) {
    reorderDocs(team.id, 'sessions', movedWithinGroup(sessions, groupSessions, groupSessions[index].id, toIndex))
  }

  if (loading || studentsLoading || attLoading) return <div className="page-loading">Loading sessions…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Attendance</h1>
          <button
            onClick={() => {
              setEditingId(null)
              setForm(withLastValues('sessions', emptyForm))
              setShowForm(true)
            }}
          >
            + New session
          </button>
        </div>

        <NoDivisionsNotice team={team} />

        <div className="filter-row">
          <button className={!divisionFilter ? 'chip active' : 'chip'} onClick={() => setDivisionFilter('')}>
            All ({sessions.length})
          </button>
          {divisions.map((d) => (
            <button
              key={d}
              className={divisionFilter === d ? 'chip active' : 'chip'}
              onClick={() => setDivisionFilter(d)}
            >
              {d} ({sessions.filter((s) => s.targetDivision === d).length})
            </button>
          ))}
        </div>
      </div>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit session' : 'New session'}</h2>
        <div className="form-grid">
          <label>
            Date
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </label>
          <label>
            Session name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Weekly meeting"
              required
            />
          </label>
          <label>
            Applies to
            <select
              value={form.targetDivision}
              onChange={(e) => setForm({ ...form, targetDivision: e.target.value })}
            >
              <option value="all">Everyone</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Notes
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Guest speaker, ran short"
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingId ? 'Save' : 'Create'}</button>
        </div>
      </FormPanel>

      {groups.map((group) => (
        <SessionGroupTable
          key={group.title}
          title={group.title}
          sessions={group.sessions}
          students={group.columnStudents}
          statusBySessionAndStudent={statusBySessionAndStudent}
          onEdit={startEdit}
          onDelete={handleDelete}
          onMove={(index, direction) => move(group.sessions, index, direction)}
          onMoveTo={(index, toIndex) => moveTo(group.sessions, index, toIndex)}
          onStatusChange={handleStatusChange}
        />
      ))}
      {groups.length === 0 && <p className="muted">No sessions yet.</p>}
    </div>
  )
}

function SessionGroupTable({
  title,
  sessions,
  students,
  statusBySessionAndStudent,
  onEdit,
  onDelete,
  onMove,
  onMoveTo,
  onStatusChange,
}) {
  const tableRef = useRef(null)
  useMatrixLayout(tableRef, students.map((s) => s.fullName).join(' '))

  return (
    <>
      <h2>{title}</h2>
      <StickyTableScroll>
        <table className="data-table matrix" ref={tableRef}>
          <thead>
            <tr>
              <th className="matrix-name-col">Session</th>
              {students.map((s) => (
                <th key={s.id} className={`matrix-student-col ${s.active ? '' : 'col-inactive'}`} title={s.active ? undefined : 'Inactive'}>
                  {s.fullName}
                </th>
              ))}
              <th className="matrix-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session, i) => (
              <tr key={session.id}>
                <td className="matrix-name-col">
                  <strong>{session.name}</strong>
                  <div className="muted">{session.date}</div>
                  {session.notes && (
                    <div className="muted session-notes" title={session.notes}>
                      {session.notes}
                    </div>
                  )}
                </td>
                {students.map((s) => {
                  const cellClass = `matrix-student-col ${s.active ? '' : 'col-inactive'}`
                  if (!isSessionRelevantToStudent(session, s)) {
                    return (
                      <td key={s.id} className={`${cellClass} muted`}>
                        –
                      </td>
                    )
                  }
                  const status = statusBySessionAndStudent[`${session.id}_${s.id}`]
                  return (
                    <td key={s.id} className={cellClass}>
                      <select
                        className={`status-cell-select ${status ? `status-badge-${status}` : ''}`}
                        value={status || ''}
                        onChange={(e) => onStatusChange(session, s, e.target.value || null)}
                      >
                        <option value="">–</option>
                        {ATTENDANCE_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {STATUS_LABELS[st]}
                          </option>
                        ))}
                      </select>
                    </td>
                  )
                })}
                <td className="matrix-actions-col">
                  <div className="row-actions">
                    <MoveButtons
                      onUp={() => onMove(i, -1)}
                      onDown={() => onMove(i, 1)}
                      canUp={i > 0}
                      canDown={i < sessions.length - 1}
                      index={i}
                      count={sessions.length}
                      onMoveTo={(toIndex) => onMoveTo(i, toIndex)}
                      label="session"
                    />
                    <button className="link-btn" onClick={() => onEdit(session)}>
                      Edit
                    </button>
                    <button className="link-btn danger" onClick={() => onDelete(session)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StickyTableScroll>
    </>
  )
}
