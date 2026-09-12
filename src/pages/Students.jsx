import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import MoveButtons from '../components/MoveButtons'
import { useStudents } from '../lib/firestore-hooks'
import { GRADES, activityLabel, swappedRows } from '../lib/calc'
import { addStudent, deleteStudent, reorderDocs, updateStudent } from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'

const emptyForm = { fullName: '', divisions: [], subdivisions: {}, grade: '', status: 'active', notes: '' }

export default function Students() {
  const { team } = useAuth()
  const { data: students, loading } = useStudents(team)
  const [filterDivision, setFilterDivision] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState('')

  const divisions = team?.divisions || []
  const subdivisionsByDivision = team?.subdivisionsByDivision || {}

  const filtered = useMemo(() => {
    if (filterDivision === 'all') return students
    return students.filter((s) => s.divisions.includes(filterDivision))
  }, [students, filterDivision])

  function startEdit(student) {
    setEditingId(student.id)
    setForm({
      fullName: student.fullName || '',
      divisions: student.divisions,
      subdivisions: student.subdivisions,
      grade: student.grade || '',
      status: student.status || 'active',
      notes: student.notes || '',
    })
    setFormError('')
    setShowForm(true)
  }

  function startNew() {
    setEditingId(null)
    setForm(withLastValues('students', emptyForm))
    setFormError('')
    setShowForm(true)
  }

  function toggleDivision(d) {
    if (form.divisions.includes(d)) {
      const { [d]: _dropped, ...subdivisions } = form.subdivisions
      setForm({ ...form, divisions: form.divisions.filter((x) => x !== d), subdivisions })
    } else {
      setForm({ ...form, divisions: [...form.divisions, d] })
    }
  }

  function toggleSubdivision(d, sd) {
    const current = form.subdivisions[d] || []
    const next = current.includes(sd) ? current.filter((x) => x !== sd) : [...current, sd]
    setForm({ ...form, subdivisions: { ...form.subdivisions, [d]: next } })
  }

  // The write isn't awaited: Firestore applies it to its local cache
  // straight away, so the table already shows it on the next render -
  // awaiting the server round-trip just left the form hanging open. The
  // form's own state is left alone here and reset when it reopens, so it
  // doesn't visibly blank out mid fade-out.
  function handleSubmit(e) {
    e.preventDefault()
    if (form.divisions.length === 0) {
      setFormError(
        divisions.length === 0
          ? 'Set up divisions in Settings before adding students.'
          : 'Pick at least one division.'
      )
      return
    }
    if (editingId) {
      updateStudent(team.id, editingId, form)
    } else {
      rememberForm('students', form, 'fullName')
      addStudent(team.id, form)
    }
    setShowForm(false)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this student? This does not delete their past attendance records.')) return
    await deleteStudent(team.id, id)
  }

  // Swaps with the neighbour in the *visible* list, so moving works the
  // same whether or not a division filter is on.
  function move(index, direction) {
    const neighbour = filtered[index + direction]
    if (!neighbour) return
    reorderDocs(team.id, 'students', swappedRows(students, filtered[index].id, neighbour.id))
  }

  if (loading) return <div className="page-loading">Loading students…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Students</h1>
          <button onClick={startNew}>+ Add student</button>
        </div>

        <NoDivisionsNotice team={team} />

        <div className="filter-row">
          <button className={filterDivision === 'all' ? 'chip active' : 'chip'} onClick={() => setFilterDivision('all')}>
            All ({students.length})
          </button>
          {divisions.map((d) => (
            <button key={d} className={filterDivision === d ? 'chip active' : 'chip'} onClick={() => setFilterDivision(d)}>
              {d} ({students.filter((s) => s.divisions.includes(d)).length})
            </button>
          ))}
        </div>
      </div>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit student' : 'New student'}</h2>
        <div className="form-grid">
          <label className="span-2">
            Full name
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
          </label>
          <div className="span-2">
            <span className="field-label">Divisions</span>
            {divisions.length === 0 ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                None set up yet - add them in Settings first.
              </p>
            ) : (
              <ul className="division-picker">
                {divisions.map((d) => {
                  const inDivision = form.divisions.includes(d)
                  const subs = subdivisionsByDivision[d] || []
                  return (
                    <li key={d}>
                      <label>
                        <input type="checkbox" checked={inDivision} onChange={() => toggleDivision(d)} />
                        {d}
                      </label>
                      {inDivision && subs.length > 0 && (
                        <ul className="division-picker-subs">
                          {subs.map((sd) => (
                            <li key={sd}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={(form.subdivisions[d] || []).includes(sd)}
                                  onChange={() => toggleSubdivision(d, sd)}
                                />
                                {sd}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <label>
            Grade
            <select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
              <option value="">—</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="span-2">
            Notes
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        {formError && <p className="form-error">{formError}</p>}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingId ? 'Save' : 'Add student'}</button>
        </div>
      </FormPanel>

      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Division</th>
            <th>Subdivision</th>
            <th>Grade</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s, i) => (
            <tr key={s.id} className={s.active ? '' : 'row-inactive'}>
              <td>
                <Link to={`/students/${s.id}`}>{s.fullName}</Link>
              </td>
              <td>{s.divisions.join(', ')}</td>
              <td>{s.divisions.flatMap((d) => s.subdivisions[d] || []).join(', ')}</td>
              <td>{s.grade}</td>
              <td>
                <span
                  className={`badge ${s.active ? 'badge-ok' : 'badge-muted'}`}
                  title={
                    s.autoInactive
                      ? `Attendance ${s.attendancePercent}% is under the team's ${team.minAttendancePercent}% minimum`
                      : undefined
                  }
                >
                  {activityLabel(s)}
                </span>
              </td>
              <td>
                <div className="row-actions">
                  <MoveButtons
                    onUp={() => move(i, -1)}
                    onDown={() => move(i, 1)}
                    canUp={i > 0}
                    canDown={i < filtered.length - 1}
                  />
                  <button className="link-btn" onClick={() => startEdit(s)}>
                    Edit
                  </button>
                  <button className="link-btn danger" onClick={() => handleDelete(s.id)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">
                No students yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
