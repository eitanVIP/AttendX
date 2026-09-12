import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import { useStudents, useTrainings } from '../lib/firestore-hooks'
import { certHolders, certProgress } from '../lib/calc'
import { addTraining, deleteTraining, updateTraining } from '../lib/actions'

const emptyForm = { name: '', targetCount: '', targetDate: '', scopeDivision: '', requiredTrainingIds: [] }

export default function Certifications() {
  const { team } = useAuth()
  const { data: students } = useStudents(team?.id)
  const { data: allTrainings, loading } = useTrainings(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const divisions = useMemo(() => team?.divisions || [], [team])
  const activeStudents = useMemo(() => students.filter((s) => s.status !== 'inactive'), [students])
  const certifications = useMemo(() => allTrainings.filter((t) => t.category === 'professional'), [allTrainings])
  // A cert's required trainings can only come from its own division (or, for
  // a division-less "General" cert, only from other division-less
  // trainings) - a Mechanical cert has no business requiring a Controls
  // training a Mechanical student would never even see.
  const requirableTrainings = useMemo(() => allTrainings.filter((t) => t.category !== 'professional'), [allTrainings])
  const formRequirableTrainings = useMemo(
    () => requirableTrainings.filter((t) => (t.scopeDivision || null) === (form.scopeDivision || null)),
    [requirableTrainings, form.scopeDivision]
  )

  const groups = useMemo(() => {
    const byDivision = new Map()
    for (const cert of certifications) {
      const key = cert.scopeDivision || null
      if (!byDivision.has(key)) byDivision.set(key, [])
      byDivision.get(key).push(cert)
    }
    const orphanKeys = [...byDivision.keys()].filter((k) => k !== null && !divisions.includes(k))
    const order = [...[...divisions].sort(), ...orphanKeys.sort(), null]
    return order
      .filter((key, i) => order.indexOf(key) === i && byDivision.has(key))
      .map((key) => ({
        title: key || 'General',
        certs: [...byDivision.get(key)].sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [certifications, divisions])

  function handleSubmit(e) {
    e.preventDefault()
    addTraining(team.id, {
      name: form.name,
      category: 'professional',
      scopeDivision: form.scopeDivision || null,
      scopeSubdivision: null,
      targetDate: form.targetDate || null,
      targetCount: form.targetCount ? Number(form.targetCount) : activeStudents.length,
      requiredTrainingIds: form.requiredTrainingIds,
      order: 0,
    })
    setShowForm(false)
  }

  if (loading) return <div className="page-loading">Loading certifications…</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Certifications</h1>
          <p className="muted" style={{ marginTop: -12 }}>
            Professional / machine certifications - earned automatically once a student completes every
            training you mark as required. Every one counts, so make them count for something real.
          </p>
        </div>
        <button
          onClick={() => {
            setForm(emptyForm)
            setShowForm(true)
          }}
        >
          + Add certification
        </button>
      </div>

      <FormPanel open={showForm} onSubmit={handleSubmit}>
        <h2>New certification</h2>
        <div className="form-grid">
          <label className="span-2">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. CNC Router"
              required
            />
          </label>
          <label>
            Target headcount
            <input
              type="number"
              min="1"
              value={form.targetCount}
              onChange={(e) => setForm({ ...form, targetCount: e.target.value })}
              placeholder={String(activeStudents.length)}
            />
          </label>
          <label>
            Target date (optional)
            <input
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            />
          </label>
          <label>
            Division (optional)
            <select
              value={form.scopeDivision}
              onChange={(e) => setForm({ ...form, scopeDivision: e.target.value, requiredTrainingIds: [] })}
            >
              <option value="">General (no division)</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <RequiredTrainingsPicker
          trainings={formRequirableTrainings}
          selected={form.requiredTrainingIds}
          onChange={(ids) => setForm({ ...form, requiredTrainingIds: ids })}
        />
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">Add</button>
        </div>
      </FormPanel>

      {groups.map((group) => (
        <div key={group.title} className="cert-group">
          <h2>{group.title}</h2>
          <div className="cert-grid">
            {group.certs.map((cert) => (
              <CertCard
                key={cert.id}
                cert={cert}
                students={students}
                trainings={allTrainings}
                requirableTrainings={requirableTrainings}
                divisions={divisions}
                teamId={team.id}
              />
            ))}
          </div>
        </div>
      ))}
      {certifications.length === 0 && <p className="muted">No certifications tracked yet.</p>}
    </div>
  )
}

function RequiredTrainingsPicker({ trainings, selected, onChange }) {
  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ marginBottom: 6 }}>Required trainings (student needs all of these)</label>
      {trainings.length === 0 ? (
        <p className="muted">No trainings exist yet - add some under Trainings first.</p>
      ) : (
        <ul className="checklist">
          {trainings.map((t) => (
            <li key={t.id}>
              <label>
                <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                {t.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CertCard({ cert, students, trainings, requirableTrainings, divisions, teamId }) {
  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [editForm, setEditForm] = useState(null)

  const progress = certProgress(cert, students, trainings)
  const percent = Math.min(progress.percent ?? 0, 100)
  const holders = certHolders(cert, students, trainings)
  const requiredNames = (cert.requiredTrainingIds || [])
    .map((id) => trainings.find((t) => t.id === id)?.name)
    .filter(Boolean)
  const editFormRequirableTrainings = useMemo(
    () =>
      editForm ? requirableTrainings.filter((t) => (t.scopeDivision || null) === (editForm.scopeDivision || null)) : [],
    [requirableTrainings, editForm]
  )

  function startEdit() {
    setEditForm({
      name: cert.name,
      targetCount: cert.targetCount ?? '',
      targetDate: cert.targetDate || '',
      scopeDivision: cert.scopeDivision || '',
      requiredTrainingIds: cert.requiredTrainingIds || [],
    })
    setMode('edit')
  }

  function saveEdit(e) {
    e.preventDefault()
    updateTraining(teamId, cert.id, {
      name: editForm.name,
      targetCount: editForm.targetCount ? Number(editForm.targetCount) : students.filter((s) => s.status !== 'inactive').length,
      targetDate: editForm.targetDate || null,
      scopeDivision: editForm.scopeDivision || null,
      requiredTrainingIds: editForm.requiredTrainingIds,
    })
    setMode('view')
  }

  async function handleDelete() {
    if (!confirm('Delete this certification?')) return
    await deleteTraining(teamId, cert.id)
  }

  if (mode === 'edit') {
    return (
      <form className="cert-card cert-edit-card" onSubmit={saveEdit}>
        <label>
          Name
          <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
        </label>
        <label>
          Target headcount
          <input
            type="number"
            min="1"
            value={editForm.targetCount}
            onChange={(e) => setEditForm({ ...editForm, targetCount: e.target.value })}
          />
        </label>
        <label>
          Target date
          <input
            type="date"
            value={editForm.targetDate}
            onChange={(e) => setEditForm({ ...editForm, targetDate: e.target.value })}
          />
        </label>
        <label>
          Division
          <select
            value={editForm.scopeDivision}
            onChange={(e) => setEditForm({ ...editForm, scopeDivision: e.target.value, requiredTrainingIds: [] })}
          >
            <option value="">General (no division)</option>
            {divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <RequiredTrainingsPicker
          trainings={editFormRequirableTrainings}
          selected={editForm.requiredTrainingIds}
          onChange={(ids) => setEditForm({ ...editForm, requiredTrainingIds: ids })}
        />
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setMode('view')}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    )
  }

  return (
    <div className={`cert-card ${progress.onTarget ? 'cert-complete' : ''}`}>
      <div className="cert-card-top">
        <svg className="cert-medal" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="9" r="6.5" fill="currentColor" opacity="0.15" />
          <circle cx="12" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 5.5l1.05 2.13 2.35.34-1.7 1.66.4 2.34L12 10.85l-2.1 1.12.4-2.34-1.7-1.66 2.35-.34L12 5.5z" fill="currentColor" />
          <path d="M9 14.5L7 21l5-2.5 5 2.5-2-6.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        <div className="cert-title">
          <h3>{cert.name}</h3>
          {cert.targetDate && <span className="muted">Target {cert.targetDate}</span>}
        </div>
      </div>

      <div className="cert-ring" style={{ '--pct': percent }}>
        <div className="cert-ring-inner">
          <span className="cert-ring-value">{progress.percent ?? 0}%</span>
          <span className="cert-ring-sub">
            {progress.completed}/{progress.target}
          </span>
        </div>
      </div>

      {progress.onTarget ? (
        <span className="badge badge-ok cert-status">Target met</span>
      ) : (
        <span className="badge badge-warn cert-status">{progress.missing} more to go</span>
      )}

      <div className="cert-requirements">
        <span className="muted">Requires: </span>
        {requiredNames.length === 0 ? (
          <span className="muted">no trainings set yet</span>
        ) : (
          requiredNames.join(', ')
        )}
      </div>

      <div className="cert-holders">
        {holders.length === 0 && <span className="muted">Nobody certified yet</span>}
        {holders.map((s) => (
          <span key={s.id} className="badge cert-holder-chip">
            {s.fullName}
          </span>
        ))}
      </div>

      <div className="cert-card-actions">
        <button type="button" className="link-btn" onClick={startEdit}>
          Edit
        </button>
        <button type="button" className="link-btn danger" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
