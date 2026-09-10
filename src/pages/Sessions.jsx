import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAllAttendance, useSessions, useStudents } from '../lib/firestore-hooks'
import { ATTENDANCE_STATUSES, isSessionRelevantToStudent } from '../lib/calc'
import { addSession, clearAttendance, deleteSession, setAttendance, updateSession } from '../lib/actions'

const today = () => new Date().toISOString().slice(0, 10)

const emptyForm = { date: today(), name: '', targetDivision: 'all' }

const STATUS_LABELS = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' }

export default function Sessions() {
  const { team } = useAuth()
  const { data: sessions, loading } = useSessions(team?.id)
  const { data: students, loading: studentsLoading } = useStudents(team?.id)
  const { data: attendance, loading: attLoading } = useAllAttendance(team?.id)
  const [divisionFilter, setDivisionFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const divisions = useMemo(() => team?.divisions || [], [team])
  const activeStudents = useMemo(() => students.filter((s) => s.status !== 'inactive'), [students])

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

  const sorted = useMemo(() => [...visible].sort((a, b) => (a.date < b.date ? 1 : -1)), [visible])

  // Group by division so there's always a clear heading over each block of
  // rows - mirrors the Trainings page layout for consistency.
  const groups = useMemo(() => {
    const byDivision = new Map()
    for (const s of sorted) {
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
        columnStudents: key ? activeStudents.filter((s) => s.division === key) : activeStudents,
      }))
  }, [sorted, divisions, divisionFilter, activeStudents])

  async function handleSubmit(e) {
    e.preventDefault()
    if (editingId) {
      await updateSession(team.id, editingId, form)
    } else {
      await addSession(team.id, form)
    }
    setForm({ ...emptyForm, date: form.date })
    setEditingId(null)
    setShowForm(false)
  }

  function startEdit(session) {
    setForm({
      date: session.date || today(),
      name: session.name || '',
      targetDivision: session.targetDivision || 'all',
    })
    setEditingId(session.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this session and its attendance records?')) return
    await deleteSession(team.id, id)
  }

  async function handleStatusChange(sessionId, studentId, next) {
    if (next) await setAttendance(team.id, sessionId, studentId, next)
    else await clearAttendance(team.id, sessionId, studentId)
  }

  if (loading || studentsLoading || attLoading) return <div className="page-loading">Loading sessions…</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Attendance</h1>
          <p className="muted" style={{ marginTop: -12 }}>
            Pick a status for each student directly in the table below.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null)
            setForm(emptyForm)
            setShowForm(true)
          }}
        >
          + New session
        </button>
      </div>

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
            {d} ({sessions.filter((s) => !s.targetDivision || s.targetDivision === 'all' || s.targetDivision === d).length})
          </button>
        ))}
      </div>

      {showForm && (
        <form className="card form-card" onSubmit={handleSubmit}>
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
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={cancelForm}>
              Cancel
            </button>
            <button type="submit">{editingId ? 'Save' : 'Create'}</button>
          </div>
        </form>
      )}

      {groups.map((group) => (
        <SessionGroupTable
          key={group.title}
          title={group.title}
          sessions={group.sessions}
          students={group.columnStudents}
          statusBySessionAndStudent={statusBySessionAndStudent}
          onEdit={startEdit}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
        />
      ))}
      {groups.length === 0 && <p className="muted">No sessions yet.</p>}
    </div>
  )
}

function SessionGroupTable({ title, sessions, students, statusBySessionAndStudent, onEdit, onDelete, onStatusChange }) {
  return (
    <div className="sheet-block">
      <h2>{title}</h2>
      <div className="sheet-scroll">
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="sheet-sticky-col">Session</th>
              {students.map((s) => (
                <th key={s.id} className="sheet-student-col">
                  {s.fullName}
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="sheet-sticky-col">
                  <strong>{session.name}</strong>
                  <div className="muted">{session.date}</div>
                </td>
                {students.map((s) => {
                  if (!isSessionRelevantToStudent(session, s)) {
                    return (
                      <td key={s.id} className="sheet-student-col muted">
                        –
                      </td>
                    )
                  }
                  const status = statusBySessionAndStudent[`${session.id}_${s.id}`]
                  return (
                    <td key={s.id} className="sheet-student-col">
                      <select
                        className={`status-cell-select ${status ? `status-badge-${status}` : ''}`}
                        value={status || ''}
                        onChange={(e) => onStatusChange(session.id, s.id, e.target.value || null)}
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
                <td>
                  <div className="row-actions">
                    <button className="link-btn" onClick={() => onEdit(session)}>
                      Edit
                    </button>
                    <button className="link-btn danger" onClick={() => onDelete(session.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
