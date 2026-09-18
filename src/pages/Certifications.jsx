import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import MoveButtons from '../components/MoveButtons'
import { useStudents, useTrainings } from '../lib/firestore-hooks'
import {
  certHolders,
  certProgress,
  groupByScope,
  movedWithinGroup,
  swappedRows,
  trainingAppliesToScope,
} from '../lib/calc'
import { addTraining, deleteTraining, reorderDocs, updateTraining } from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'

// The trainings offered in the required-trainings picker: every training
// that actually matches the given scope, PLUS whichever of `selectedIds`
// don't (tagged `outOfScope`) - never just silently dropped. A cert made
// before subdivisions existed (or edited into a narrower scope) can already
// have requiredTrainingIds that don't match its current scope; hiding those
// checkboxes made it look like the cert had lost them, when they were still
// saved all along - this keeps them visible (and their checkbox checked)
// until an admin actually unchecks them.
function requirableTrainingsFor(all, scopeDivision, scopeSubdivision, selectedIds) {
  const eligible = all.filter((t) => trainingAppliesToScope(t, scopeDivision || null, scopeSubdivision || null))
  const eligibleIds = new Set(eligible.map((t) => t.id))
  const stillSelected = all.filter((t) => selectedIds.includes(t.id) && !eligibleIds.has(t.id))
  return [...eligible.map((t) => ({ ...t, outOfScope: false })), ...stillSelected.map((t) => ({ ...t, outOfScope: true }))]
}

const emptyForm = {
  name: '',
  targetCount: '',
  targetDate: '',
  scopeDivision: '',
  scopeSubdivision: '',
  requiredTrainingIds: [],
}

export default function Certifications() {
  const { team } = useAuth()
  const { data: students } = useStudents(team)
  const { data: allTrainings, loading } = useTrainings(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [divisionFilter, setDivisionFilter] = useState('')

  const divisions = useMemo(() => team?.divisions || [], [team])
  const subdivisionsByDivision = useMemo(() => team?.subdivisionsByDivision || {}, [team])
  const formSubdivisions = form.scopeDivision ? subdivisionsByDivision[form.scopeDivision] || [] : []
  const activeStudents = useMemo(() => students.filter((s) => s.active), [students])
  // Same order the ↑/↓ (here ←/→) arrows control - see the useTrainings hook,
  // which already sorts the whole collection (trainings and certifications
  // alike) by `order`.
  const certifications = useMemo(() => allTrainings.filter((t) => t.category === 'professional'), [allTrainings])
  // A cert's required trainings can only come from trainings every student
  // who'd hold it would actually see - a Mechanical cert has no business
  // requiring a Controls training a Mechanical student would never even
  // see, and a Mechanical/Design cert can't require a Mechanical/
  // Manufacturing-only training either.
  const requirableTrainings = useMemo(() => allTrainings.filter((t) => t.category !== 'professional'), [allTrainings])
  const formRequirableTrainings = useMemo(
    () => requirableTrainingsFor(requirableTrainings, form.scopeDivision, form.scopeSubdivision, form.requiredTrainingIds),
    [requirableTrainings, form.scopeDivision, form.scopeSubdivision, form.requiredTrainingIds]
  )

  // Division-only, same as Trainings.jsx's own filter - picking one keeps
  // General certs visible alongside it (they apply regardless of division)
  // but hides every OTHER division's, subdivisions included.
  const visible = useMemo(() => {
    if (!divisionFilter) return certifications
    return certifications.filter((c) => !c.scopeDivision || c.scopeDivision === divisionFilter)
  }, [certifications, divisionFilter])

  // Sorted and titled exactly like Trainings.jsx's groups - same division/
  // subdivision order from Settings, "General" last. Still broken down by
  // subdivision within whichever division(s) survived the filter above.
  const groups = useMemo(() => {
    const knownDivisions = divisionFilter ? [divisionFilter] : divisions
    return groupByScope(visible, knownDivisions, subdivisionsByDivision).map(({ key, division: d, subdivision: s, items }) => ({
      key,
      title: d ? (s ? `${d} / ${s}` : d) : 'General',
      certs: items,
    }))
  }, [visible, divisions, subdivisionsByDivision, divisionFilter])

  // Swaps with the neighbour within the group's own cards; the whole
  // trainings collection (regular trainings included) is what gets
  // renumbered, same as Trainings.jsx's arrows.
  function move(groupCerts, index, direction) {
    const neighbour = groupCerts[index + direction]
    if (!neighbour) return
    reorderDocs(team.id, 'trainings', swappedRows(allTrainings, groupCerts[index].id, neighbour.id))
  }

  function moveTo(groupCerts, index, toIndex) {
    reorderDocs(team.id, 'trainings', movedWithinGroup(allTrainings, groupCerts, groupCerts[index].id, toIndex))
  }

  function handleSubmit(e) {
    e.preventDefault()
    rememberForm('certifications', form, 'name')
    addTraining(team.id, {
      name: form.name,
      category: 'professional',
      scopeDivision: form.scopeDivision || null,
      scopeSubdivision: form.scopeSubdivision || null,
      targetDate: form.targetDate || null,
      targetCount: form.targetCount ? Number(form.targetCount) : activeStudents.length,
      requiredTrainingIds: form.requiredTrainingIds,
    })
    setShowForm(false)
  }

  if (loading) return <div className="page-loading">Loading certifications…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Certifications</h1>
          <button
            onClick={() => {
              setForm(withLastValues('certifications', emptyForm))
              setShowForm(true)
            }}
          >
            + Add certification
          </button>
        </div>
        {divisions.length > 0 && (
          <div className="filter-row">
            <button className={!divisionFilter ? 'chip active' : 'chip'} onClick={() => setDivisionFilter('')}>
              All ({certifications.length})
            </button>
            {divisions.map((d) => (
              <button
                key={d}
                className={divisionFilter === d ? 'chip active' : 'chip'}
                onClick={() => setDivisionFilter(d)}
              >
                {d} ({certifications.filter((c) => c.scopeDivision === d).length})
              </button>
            ))}
          </div>
        )}
      </div>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
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
              onChange={(e) => setForm({ ...form, scopeDivision: e.target.value, scopeSubdivision: '' })}
            >
              <option value="">General (no division)</option>
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
              {formSubdivisions.map((sd) => (
                <option key={sd} value={sd}>
                  {sd}
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
        <div key={group.key} className="cert-group">
          <h2>{group.title}</h2>
          <div className="cert-grid">
            {group.certs.map((cert, i) => (
              <CertCard
                key={cert.id}
                cert={cert}
                students={students}
                trainings={allTrainings}
                requirableTrainings={requirableTrainings}
                divisions={divisions}
                subdivisionsByDivision={subdivisionsByDivision}
                teamId={team.id}
                index={i}
                count={group.certs.length}
                onMove={(direction) => move(group.certs, i, direction)}
                onMoveTo={(toIndex) => moveTo(group.certs, i, toIndex)}
              />
            ))}
          </div>
        </div>
      ))}
      {certifications.length === 0 && <p className="muted">No certifications tracked yet.</p>}
      {certifications.length > 0 && groups.length === 0 && (
        <p className="muted">No certifications match this filter.</p>
      )}
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
                {t.outOfScope && (
                  <span className="muted">
                    {' '}
                    (from {t.scopeDivision ? (t.scopeSubdivision ? `${t.scopeDivision} / ${t.scopeSubdivision}` : t.scopeDivision) : 'General'})
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CertCard({
  cert,
  students,
  trainings,
  requirableTrainings,
  divisions,
  subdivisionsByDivision,
  teamId,
  index,
  count,
  onMove,
  onMoveTo,
}) {
  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [editForm, setEditForm] = useState(null)

  const progress = certProgress(cert, students, trainings)
  const percent = Math.min(progress.percent ?? 0, 100)
  const holders = certHolders(cert, students, trainings)
  const requiredNames = (cert.requiredTrainingIds || [])
    .map((id) => trainings.find((t) => t.id === id)?.name)
    .filter(Boolean)
  const editFormSubdivisions = editForm?.scopeDivision ? subdivisionsByDivision[editForm.scopeDivision] || [] : []
  const editFormRequirableTrainings = useMemo(
    () =>
      editForm
        ? requirableTrainingsFor(
            requirableTrainings,
            editForm.scopeDivision,
            editForm.scopeSubdivision,
            editForm.requiredTrainingIds
          )
        : [],
    [requirableTrainings, editForm]
  )

  function startEdit() {
    setEditForm({
      name: cert.name,
      targetCount: cert.targetCount ?? '',
      targetDate: cert.targetDate || '',
      scopeDivision: cert.scopeDivision || '',
      scopeSubdivision: cert.scopeSubdivision || '',
      requiredTrainingIds: cert.requiredTrainingIds || [],
    })
    setMode('edit')
  }

  function saveEdit(e) {
    e.preventDefault()
    updateTraining(teamId, cert.id, {
      name: editForm.name,
      targetCount: editForm.targetCount ? Number(editForm.targetCount) : students.filter((s) => s.active).length,
      targetDate: editForm.targetDate || null,
      scopeDivision: editForm.scopeDivision || null,
      scopeSubdivision: editForm.scopeSubdivision || null,
      requiredTrainingIds: editForm.requiredTrainingIds,
    })
    setMode('view')
  }

  async function handleDelete() {
    if (!confirm('Delete this certification?')) return
    await deleteTraining(teamId, cert)
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
            onChange={(e) => setEditForm({ ...editForm, scopeDivision: e.target.value, scopeSubdivision: '' })}
          >
            <option value="">General (no division)</option>
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
            value={editForm.scopeSubdivision}
            onChange={(e) => setEditForm({ ...editForm, scopeSubdivision: e.target.value })}
            disabled={!editForm.scopeDivision}
          >
            <option value="">Any</option>
            {editFormSubdivisions.map((sd) => (
              <option key={sd} value={sd}>
                {sd}
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
          <span
            key={s.id}
            className={`badge ${s.active ? 'cert-holder-chip' : 'badge-muted'}`}
            title={s.active ? undefined : 'Inactive - not counted toward the target'}
          >
            {s.fullName}
          </span>
        ))}
      </div>

      <div className="cert-card-actions">
        <MoveButtons
          onUp={() => onMove(-1)}
          onDown={() => onMove(1)}
          canUp={index > 0}
          canDown={index < count - 1}
          index={index}
          count={count}
          onMoveTo={onMoveTo}
          label="certification"
          orientation="horizontal"
          spread
        >
          <button type="button" className="link-btn" onClick={startEdit}>
            Edit
          </button>
          <button type="button" className="link-btn danger" onClick={handleDelete}>
            Delete
          </button>
        </MoveButtons>
      </div>
    </div>
  )
}
