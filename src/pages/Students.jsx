import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useStudents } from '../lib/firestore-hooks'
import { addStudent, deleteStudent, updateStudent } from '../lib/actions'

const GRADES = ['ט', 'י', 'יא', 'יב']

const emptyForm = { fullName: '', division: '', subdivision: '', grade: '', status: 'active', notes: '' }

export default function Students() {
  const { team } = useAuth()
  const { data: students, loading } = useStudents(team?.id)
  const [filterDivision, setFilterDivision] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)

  const divisions = team?.divisions || []
  const subdivisions = form.division ? team?.subdivisionsByDivision?.[form.division] || [] : []

  const filtered = useMemo(() => {
    if (filterDivision === 'all') return students
    return students.filter((s) => s.division === filterDivision)
  }, [students, filterDivision])

  function startEdit(student) {
    setEditingId(student.id)
    setForm({
      fullName: student.fullName || '',
      division: student.division || '',
      subdivision: student.subdivision || '',
      grade: student.grade || '',
      status: student.status || 'active',
      notes: student.notes || '',
    })
    setShowForm(true)
  }

  function startNew() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (editingId) {
      await updateStudent(team.id, editingId, form)
    } else {
      await addStudent(team.id, form)
    }
    setShowForm(false)
    setForm(emptyForm)
    setEditingId(null)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this student? This does not delete their past attendance records.')) return
    await deleteStudent(team.id, id)
  }

  if (loading) return <div className="page-loading">Loading students…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>Students</h1>
        <button onClick={startNew}>+ Add student</button>
      </div>

      <div className="filter-row">
        <button className={filterDivision === 'all' ? 'chip active' : 'chip'} onClick={() => setFilterDivision('all')}>
          All ({students.length})
        </button>
        {divisions.map((d) => (
          <button key={d} className={filterDivision === d ? 'chip active' : 'chip'} onClick={() => setFilterDivision(d)}>
            {d} ({students.filter((s) => s.division === d).length})
          </button>
        ))}
      </div>

      {showForm && (
        <form className="card form-card" onSubmit={handleSubmit}>
          <h2>{editingId ? 'Edit student' : 'New student'}</h2>
          <div className="form-grid">
            <label>
              Full name
              <input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                required
              />
            </label>
            <label>
              Division
              <select
                value={form.division}
                onChange={(e) => setForm({ ...form, division: e.target.value, subdivision: '' })}
                required
              >
                <option value="" disabled>
                  Select…
                </option>
                {divisions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subdivision
              <select
                value={form.subdivision}
                onChange={(e) => setForm({ ...form, subdivision: e.target.value })}
                disabled={!form.division}
              >
                <option value="">None</option>
                {subdivisions.map((sd) => (
                  <option key={sd} value={sd}>
                    {sd}
                  </option>
                ))}
              </select>
            </label>
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
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit">{editingId ? 'Save' : 'Add student'}</button>
          </div>
        </form>
      )}

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
          {filtered.map((s) => (
            <tr key={s.id} className={s.status === 'inactive' ? 'row-inactive' : ''}>
              <td>
                <Link to={`/students/${s.id}`}>{s.fullName}</Link>
              </td>
              <td>{s.division}</td>
              <td>{s.subdivision}</td>
              <td>{s.grade}</td>
              <td>
                <span className={`badge ${s.status === 'inactive' ? 'badge-muted' : 'badge-ok'}`}>{s.status}</span>
              </td>
              <td>
                <div className="row-actions">
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
