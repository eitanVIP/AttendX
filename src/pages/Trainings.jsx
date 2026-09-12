import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import { useStudents, useTrainings } from '../lib/firestore-hooks'
import { trainingAppliesToStudent, trainingProgress } from '../lib/calc'
import { addTraining, deleteTraining, setTrainingCompletion, updateTraining } from '../lib/actions'

const CATEGORIES = [
  { id: 'team', label: 'Team training' },
  { id: 'general', label: 'General training' },
]

const emptyForm = {
  name: '',
  category: 'team',
  scopeDivision: '',
  scopeSubdivision: '',
  targetDate: '',
  order: 0,
}

export default function Trainings() {
  const { team } = useAuth()
  const { data: students } = useStudents(team?.id)
  const { data: allTrainings, loading } = useTrainings(team?.id)
  const [divisionFilter, setDivisionFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const divisions = useMemo(() => team?.divisions || [], [team])
  const subdivisions = form.scopeDivision ? team?.subdivisionsByDivision?.[form.scopeDivision] || [] : []
  const activeStudents = useMemo(() => students.filter((s) => s.status !== 'inactive'), [students])

  const trainings = useMemo(() => allTrainings.filter((t) => t.category !== 'professional'), [allTrainings])

  const visible = useMemo(() => {
    if (!divisionFilter) return trainings
    return trainings.filter((t) => !t.scopeDivision || t.scopeDivision === divisionFilter)
  }, [trainings, divisionFilter])

  // Group by division so there's always a clear heading over each block of
  // rows - all groups when no filter is picked, just the one when filtered.
  const groups = useMemo(() => {
    const byDivision = new Map()
    for (const t of visible) {
      const key = t.scopeDivision || null
      if (!byDivision.has(key)) byDivision.set(key, [])
      byDivision.get(key).push(t)
    }
    // Include any scopeDivision values that no longer match a real division
    // (e.g. renamed/removed in Settings) so those trainings don't silently
    // disappear - they just show up under their old, stale division name.
    const knownKeys = divisionFilter ? [divisionFilter] : divisions
    const orphanKeys = [...byDivision.keys()].filter((k) => k !== null && !knownKeys.includes(k))
    const order = [...knownKeys, ...orphanKeys, null]
    return order
      .filter((key, i) => order.indexOf(key) === i && byDivision.has(key))
      .map((key) => ({
        title: key || 'General (all students)',
        trainings: byDivision.get(key),
        columnStudents: key ? activeStudents.filter((s) => s.divisions.includes(key)) : activeStudents,
      }))
  }, [visible, divisions, divisionFilter, activeStudents])

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      name: form.name,
      category: form.category,
      scopeDivision: form.scopeDivision || null,
      scopeSubdivision: form.scopeSubdivision || null,
      targetDate: form.targetDate || null,
    }
    if (editingId) {
      updateTraining(team.id, editingId, payload)
    } else {
      addTraining(team.id, { ...payload, targetCount: null, order: Number(form.order) || 0 })
    }
    setShowForm(false)
  }

  function startEdit(training) {
    setForm({
      name: training.name,
      category: training.category,
      scopeDivision: training.scopeDivision || '',
      scopeSubdivision: training.scopeSubdivision || '',
      targetDate: training.targetDate || '',
      order: training.order || 0,
    })
    setEditingId(training.id)
    setShowForm(true)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this training?')) return
    await deleteTraining(team.id, id)
  }

  if (loading) return <div className="page-loading">Loading trainings…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>Trainings</h1>
        <button
          onClick={() => {
            setEditingId(null)
            setForm(emptyForm)
            setShowForm(true)
          }}
        >
          + Add training
        </button>
      </div>

      <NoDivisionsNotice team={team} />

      <div className="filter-row">
        <button className={!divisionFilter ? 'chip active' : 'chip'} onClick={() => setDivisionFilter('')}>
          All ({trainings.length})
        </button>
        {divisions.map((d) => (
          <button
            key={d}
            className={divisionFilter === d ? 'chip active' : 'chip'}
            onClick={() => setDivisionFilter(d)}
          >
            {d} ({trainings.filter((t) => !t.scopeDivision || t.scopeDivision === d).length})
          </button>
        ))}
      </div>

      <FormPanel open={showForm} onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit training' : 'New training'}</h2>
        <div className="form-grid">
          <label className="span-2">
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target date
            <input
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            />
          </label>
          <label>
            Division (leave blank for "applies to everyone")
            <select
              value={form.scopeDivision}
              onChange={(e) => setForm({ ...form, scopeDivision: e.target.value, scopeSubdivision: '' })}
            >
              <option value="">All students</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subdivision (optional)
            <select
              value={form.scopeSubdivision}
              onChange={(e) => setForm({ ...form, scopeSubdivision: e.target.value })}
              disabled={!form.scopeDivision}
            >
              <option value="">Any</option>
              {subdivisions.map((sd) => (
                <option key={sd} value={sd}>
                  {sd}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingId ? 'Save' : 'Add'}</button>
        </div>
      </FormPanel>

      {groups.map((group) => (
        <TrainingGroupTable
          key={group.title}
          title={group.title}
          trainings={group.trainings}
          students={group.columnStudents}
          teamId={team.id}
          allStudents={students}
          onEdit={startEdit}
          onDelete={handleDelete}
        />
      ))}
      {groups.length === 0 && <p className="muted">No trainings yet.</p>}
    </div>
  )
}

function TrainingGroupTable({ title, trainings, students, teamId, allStudents, onEdit, onDelete }) {
  return (
    <>
      <h2>{title}</h2>
      <div className="table-scroll">
        <table className="data-table matrix">
          <thead>
            <tr>
              <th className="matrix-name-col">Training</th>
              <th>Due</th>
              {students.map((s) => (
                <th key={s.id} className="matrix-student-col">
                  {s.fullName}
                </th>
              ))}
              <th>Progress</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {trainings.map((t) => {
              const progress = trainingProgress(t, allStudents)
              return (
                <tr key={t.id}>
                  <td className="matrix-name-col">
                    <strong>{t.name}</strong>
                    {t.scopeSubdivision && <div className="muted">{t.scopeSubdivision}</div>}
                  </td>
                  <td className="muted">{t.targetDate || '—'}</td>
                  {students.map((s) => {
                    const applies = trainingAppliesToStudent(t, s)
                    const checked = t.completedStudentIds?.includes(s.id)
                    return (
                      <td key={s.id} className="matrix-student-col">
                        {applies ? (
                          <input
                            type="checkbox"
                            checked={!!checked}
                            onChange={(e) => setTrainingCompletion(teamId, t.id, s.id, e.target.checked)}
                          />
                        ) : (
                          <span className="muted">–</span>
                        )}
                      </td>
                    )
                  })}
                  <td>
                    <span className={progress.onTarget ? 'badge badge-ok' : 'badge badge-warn'}>
                      {progress.completed}/{progress.target}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="link-btn" onClick={() => onEdit(t)}>
                        Edit
                      </button>
                      <button className="link-btn danger" onClick={() => onDelete(t.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
