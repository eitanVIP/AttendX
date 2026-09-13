import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import MoveButtons from '../components/MoveButtons'
import StickyTableScroll from '../components/StickyTableScroll'
import { useStudents, useTrainings } from '../lib/firestore-hooks'
import { useMatrixLayout } from '../lib/useMatrixLayout'
import { movedWithinGroup, swappedRows, todayISO, trainingAppliesToStudent, trainingProgress } from '../lib/calc'
import { addTraining, deleteTraining, reorderDocs, setTrainingCompletion, updateTraining } from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'

// Joins division + subdivision into one group key; NUL can't appear in a
// name typed into Settings, unlike spaces or slashes.
const SCOPE_SEP = '\u0000'

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
}

export default function Trainings() {
  const { team } = useAuth()
  const { data: students } = useStudents(team)
  const { data: allTrainings, loading } = useTrainings(team?.id)
  const [divisionFilter, setDivisionFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const divisions = useMemo(() => team?.divisions || [], [team])
  const subdivisionsByDivision = useMemo(() => team?.subdivisionsByDivision || {}, [team])
  const subdivisions = form.scopeDivision ? subdivisionsByDivision[form.scopeDivision] || [] : []

  const trainings = useMemo(() => allTrainings.filter((t) => t.category !== 'professional'), [allTrainings])

  const visible = useMemo(() => {
    if (!divisionFilter) return trainings
    return trainings.filter((t) => !t.scopeDivision || t.scopeDivision === divisionFilter)
  }, [trainings, divisionFilter])

  // One table per scope - a division, or a subdivision within it - so each
  // block's columns are exactly the students the training applies to
  // (subdivision trainings don't list the whole division). Inactive
  // students stay in as dimmed columns: they don't count toward a
  // training's target, but they can still be marked. Ordered by the
  // team's division order, division-wide block first, then its
  // subdivisions in team order; scopes that no longer match a real
  // division/subdivision (renamed or removed in Settings) still show, after
  // the known ones, rather than silently disappearing. General last.
  const groups = useMemo(() => {
    const byScope = new Map()
    for (const t of visible) {
      const key = `${t.scopeDivision || ''}${SCOPE_SEP}${t.scopeSubdivision || ''}`
      if (!byScope.has(key)) byScope.set(key, [])
      byScope.get(key).push(t)
    }
    const knownDivisions = divisionFilter ? [divisionFilter] : divisions
    const divisionRank = (d) => {
      if (!d) return Number.MAX_SAFE_INTEGER
      const i = knownDivisions.indexOf(d)
      return i === -1 ? knownDivisions.length : i
    }
    const subdivisionRank = (d, s) => {
      if (!s) return -1
      const subs = subdivisionsByDivision[d] || []
      const i = subs.indexOf(s)
      return i === -1 ? subs.length : i
    }
    return [...byScope.keys()]
      .map((key) => {
        const [d, s] = key.split(SCOPE_SEP)
        return { key, d, s }
      })
      .sort(
        (a, b) =>
          divisionRank(a.d) - divisionRank(b.d) ||
          a.d.localeCompare(b.d) ||
          subdivisionRank(a.d, a.s) - subdivisionRank(b.d, b.s) ||
          a.s.localeCompare(b.s)
      )
      .map(({ key, d, s }) => ({
        key,
        title: d ? (s ? `${d} / ${s}` : d) : 'General (all students)',
        trainings: byScope.get(key),
        columnStudents: students.filter((st) =>
          trainingAppliesToStudent({ scopeDivision: d || null, scopeSubdivision: s || null }, st)
        ),
      }))
  }, [visible, divisions, subdivisionsByDivision, divisionFilter, students])

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
      rememberForm('trainings', form, 'name')
      addTraining(team.id, { ...payload, targetCount: null })
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
    })
    setEditingId(training.id)
    setShowForm(true)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this training?')) return
    await deleteTraining(team.id, id)
  }

  // Swaps with the neighbour within the group's rows; the whole trainings
  // collection (certifications included) is what gets renumbered.
  function move(groupTrainings, index, direction) {
    const neighbour = groupTrainings[index + direction]
    if (!neighbour) return
    reorderDocs(team.id, 'trainings', swappedRows(allTrainings, groupTrainings[index].id, neighbour.id))
  }

  function moveTo(groupTrainings, index, toIndex) {
    reorderDocs(team.id, 'trainings', movedWithinGroup(allTrainings, groupTrainings, groupTrainings[index].id, toIndex))
  }

  if (loading) return <div className="page-loading">Loading trainings…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Trainings</h1>
          <button
            onClick={() => {
              setEditingId(null)
              setForm(withLastValues('trainings', emptyForm))
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
              {d} ({trainings.filter((t) => t.scopeDivision === d).length})
            </button>
          ))}
        </div>
      </div>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
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
          key={group.key}
          title={group.title}
          trainings={group.trainings}
          students={group.columnStudents}
          teamId={team.id}
          allStudents={students}
          onEdit={startEdit}
          onDelete={handleDelete}
          onMove={(index, direction) => move(group.trainings, index, direction)}
          onMoveTo={(index, toIndex) => moveTo(group.trainings, index, toIndex)}
        />
      ))}
      {groups.length === 0 && <p className="muted">No trainings yet.</p>}
    </div>
  )
}

// After checking a box in the rightmost column still clear of the frozen
// Progress/Actions columns, scrolls over by one column so the next
// checkbox lands in that spot instead of staying hidden underneath them.
function scrollToRevealNext(checkbox) {
  const cell = checkbox.closest('td')
  const scrollEl = checkbox.closest('.table-scroll')
  const frozen = cell?.closest('tr')?.querySelector('.matrix-progress-col')
  if (!cell || !scrollEl || !frozen) return
  const cellRect = cell.getBoundingClientRect()
  const frozenLeft = frozen.getBoundingClientRect().left
  if (frozenLeft - cellRect.right < 6) {
    scrollEl.scrollBy({ left: cellRect.width, behavior: 'smooth' })
  }
}

function TrainingGroupTable({ title, trainings, students, teamId, allStudents, onEdit, onDelete, onMove, onMoveTo }) {
  const tableRef = useRef(null)
  useMatrixLayout(tableRef, students.map((s) => s.fullName).join(' '))
  const today = todayISO()

  return (
    <>
      <h2>{title}</h2>
      <StickyTableScroll>
        <table className="data-table matrix" ref={tableRef}>
          <thead>
            <tr>
              <th className="matrix-name-col">Training</th>
              <th>Due</th>
              {students.map((s) => (
                <th key={s.id} className={`matrix-student-col ${s.active ? '' : 'col-inactive'}`} title={s.active ? undefined : 'Inactive'}>
                  {s.fullName}
                </th>
              ))}
              <th className="matrix-progress-col">Progress</th>
              <th className="matrix-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            {trainings.map((t, i) => {
              const progress = trainingProgress(t, allStudents)
              const overdue = !!t.targetDate && t.targetDate < today && progress.missing > 0
              return (
                <tr key={t.id} className={overdue ? 'row-overdue' : ''}>
                  <td className="matrix-name-col">
                    <strong>{t.name}</strong>
                  </td>
                  <td className="muted due-cell" title={overdue ? 'Past due with students still missing' : undefined}>
                    {t.targetDate || '—'}
                  </td>
                  {students.map((s) => {
                    const applies = trainingAppliesToStudent(t, s)
                    const checked = t.completedStudentIds?.includes(s.id)
                    return (
                      <td key={s.id} className={`matrix-student-col ${s.active ? '' : 'col-inactive'}`}>
                        {applies ? (
                          <input
                            type="checkbox"
                            checked={!!checked}
                            onChange={(e) => {
                              setTrainingCompletion(teamId, t.id, s.id, e.target.checked)
                              scrollToRevealNext(e.target)
                            }}
                          />
                        ) : (
                          <span className="muted">–</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="matrix-progress-col">
                    <span className={progress.onTarget ? 'badge badge-ok' : 'badge badge-warn'}>
                      {progress.completed}/{progress.target}
                    </span>
                  </td>
                  <td className="matrix-actions-col">
                    <div className="row-actions">
                      <MoveButtons
                        onUp={() => onMove(i, -1)}
                        onDown={() => onMove(i, 1)}
                        canUp={i > 0}
                        canDown={i < trainings.length - 1}
                        index={i}
                        count={trainings.length}
                        onMoveTo={(toIndex) => onMoveTo(i, toIndex)}
                        label="training"
                      />
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
      </StickyTableScroll>
    </>
  )
}
