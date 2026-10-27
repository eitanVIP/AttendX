import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import MoveButtons from '../components/MoveButtons'
import DataTable from '../components/DataTable'
import { useStudents, useTrainings } from '../lib/firestore-hooks'
import {
  formatDate,
  groupByScope,
  movedWithinGroup,
  swappedRows,
  todayISO,
  trainingAppliesToStudent,
  trainingProgress,
} from '../lib/calc'
import { addTraining, deleteTraining, reorderDocs, setTrainingCompletion, updateTraining } from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'

// Same breakpoint DataTable's own stickyBudget uses (and index.css's
// @media queries) - so "mobile" means the same width everywhere. Below it
// the Name column's own maxWidth shrinks (see TrainingGroupTable): on a
// narrow phone Name+Due (both frozen left) were eating enough of the
// screen that only a single student checkbox fit at a time, which is what
// was confusing the auto-scroll reveal - two neighbouring columns is the
// minimum it needs to tell "closer to the left edge" from "closer to the
// right edge" (see reveal() in DataTable.jsx).
const MOBILE_WIDTH = 800

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_WIDTH)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_WIDTH)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

const emptyForm = {
  name: '',
  scopeDivision: '',
  scopeSubdivision: '',
  targetDate: '',
}

// A sub-training's own form - just a name and an optional target date, no
// scope of its own (see startEditSub below for why): it's only ever shown
// nested under its parent's row, in whichever scoped table the parent
// itself already sorted into.
const emptySubForm = { name: '', targetDate: '' }

export default function Trainings() {
  const { team } = useAuth()
  const { data: students } = useStudents(team, { withPlans: false })
  const { data: allTrainings, loading } = useTrainings(team?.id)
  const [divisionFilter, setDivisionFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [showSubForm, setShowSubForm] = useState(false)
  const [subParent, setSubParent] = useState(null)
  const [editingSubId, setEditingSubId] = useState(null)
  const [subForm, setSubForm] = useState(emptySubForm)

  const divisions = useMemo(() => team?.divisions || [], [team])
  const subdivisionsByDivision = useMemo(() => team?.subdivisionsByDivision || {}, [team])
  const subdivisions = form.scopeDivision ? subdivisionsByDivision[form.scopeDivision] || [] : []

  // Top-level trainings only - a sub-training (training.parentTrainingId)
  // never gets its own row in these scoped tables, only a nested one under
  // its parent (see subTrainingsByParent/groups below). Also excludes
  // certifications, same as before.
  const trainings = useMemo(
    () => allTrainings.filter((t) => t.category !== 'professional' && !t.parentTrainingId),
    [allTrainings]
  )
  // Every sub-training, bucketed by the parent it belongs to.
  const subTrainingsByParent = useMemo(() => {
    const map = new Map()
    for (const t of allTrainings) {
      if (!t.parentTrainingId) continue
      if (!map.has(t.parentTrainingId)) map.set(t.parentTrainingId, [])
      map.get(t.parentTrainingId).push(t)
    }
    return map
  }, [allTrainings])

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
    const knownDivisions = divisionFilter ? [divisionFilter] : divisions
    return groupByScope(visible, knownDivisions, subdivisionsByDivision).map(({ key, division: d, subdivision: s, items }) => ({
      key,
      title: d ? (s ? `${d} / ${s}` : d) : 'General (all students)',
      trainings: items,
      subTrainingsByParent,
      columnStudents: students.filter((st) =>
        trainingAppliesToStudent({ scopeDivision: d || null, scopeSubdivision: s || null }, st)
      ),
    }))
  }, [visible, divisions, subdivisionsByDivision, divisionFilter, students, subTrainingsByParent])

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      name: form.name,
      scopeDivision: form.scopeDivision || null,
      scopeSubdivision: form.scopeSubdivision || null,
      targetDate: form.targetDate || null,
    }
    if (editingId) {
      updateTraining(team.id, editingId, payload, allTrainings.find((t) => t.id === editingId))
    } else {
      rememberForm('trainings', form, 'name')
      addTraining(team.id, { ...payload, category: 'training', targetCount: null })
    }
    setShowForm(false)
  }

  function startEdit(training) {
    if (training.parentTrainingId) {
      startEditSub(training)
      return
    }
    setForm({
      name: training.name,
      scopeDivision: training.scopeDivision || '',
      scopeSubdivision: training.scopeSubdivision || '',
      targetDate: training.targetDate || '',
    })
    setEditingId(training.id)
    setShowForm(true)
  }

  async function handleDelete(training) {
    const subs = subTrainingsByParent.get(training.id) || []
    const message = training.parentTrainingId
      ? 'Delete this sub-training?'
      : subs.length > 0
        ? `Delete this training and its ${subs.length} sub-training${subs.length === 1 ? '' : 's'}?`
        : 'Delete this training?'
    if (!confirm(message)) return
    await deleteTraining(team.id, training, subs)
  }

  function startNewSub(parent) {
    setSubParent(parent)
    setEditingSubId(null)
    setSubForm(emptySubForm)
    setShowSubForm(true)
  }

  function startEditSub(sub) {
    setSubParent(allTrainings.find((t) => t.id === sub.parentTrainingId) || null)
    setEditingSubId(sub.id)
    setSubForm({ name: sub.name, targetDate: sub.targetDate || '' })
    setShowSubForm(true)
  }

  function handleSubSubmit(e) {
    e.preventDefault()
    const payload = { name: subForm.name, targetDate: subForm.targetDate || null }
    if (editingSubId) {
      updateTraining(team.id, editingSubId, payload, allTrainings.find((t) => t.id === editingSubId))
    } else {
      addTraining(team.id, { ...payload, category: 'training', targetCount: null, parentTrainingId: subParent.id })
    }
    setShowSubForm(false)
  }

  // Swaps with the neighbour within the group's rows; the whole trainings
  // collection (certifications included) is what gets renumbered. Only
  // top-level trainings are reorderable - a sub-training's position under
  // its parent doesn't have its own arrows.
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

      <FormPanel open={showSubForm} onClose={() => setShowSubForm(false)} onSubmit={handleSubSubmit}>
        <h2>
          {editingSubId ? 'Edit sub-training' : 'New sub-training'}
          {subParent && <span className="muted"> - {subParent.name}</span>}
        </h2>
        <p className="muted" style={{ marginTop: -8 }}>
          A smaller piece of "{subParent?.name}" tracked on its own row. It doesn't count toward streaks,
          certifications, or the dashboard's completion charts by itself - only completing every one of a
          training's sub-trainings finishes the training itself (and finishing the training finishes all of
          them), same as checking it off directly always has.
        </p>
        <div className="form-grid">
          <label className="span-2">
            Name
            <input value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} required />
          </label>
          <label>
            Target date
            <input
              type="date"
              value={subForm.targetDate}
              onChange={(e) => setSubForm({ ...subForm, targetDate: e.target.value })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowSubForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingSubId ? 'Save' : 'Add'}</button>
        </div>
      </FormPanel>

      {groups.map((group) => (
        <TrainingGroupTable
          key={group.key}
          title={group.title}
          trainings={group.trainings}
          subTrainingsByParent={group.subTrainingsByParent}
          students={group.columnStudents}
          teamId={team.id}
          allStudents={students}
          allTrainings={allTrainings}
          streakResetDays={team.streakResetDays}
          onEdit={startEdit}
          onDelete={handleDelete}
          onAddSub={startNewSub}
          onMove={(index, direction) => move(group.trainings, index, direction)}
          onMoveTo={(index, toIndex) => moveTo(group.trainings, index, toIndex)}
        />
      ))}
      {groups.length === 0 && <p className="muted">No trainings yet.</p>}
    </div>
  )
}

function TrainingGroupTable({
  title,
  trainings,
  subTrainingsByParent,
  students,
  teamId,
  allStudents,
  allTrainings,
  streakResetDays,
  onEdit,
  onDelete,
  onAddSub,
  onMove,
  onMoveTo,
}) {
  const today = todayISO()
  const isMobile = useIsMobile()

  // Wraps a training doc (top-level or sub) with its own progress/overdue,
  // and recurses into its children (if it's a top-level one with
  // sub-trainings) - DataTable's default getSubRows (row.children) then
  // just works at every depth without the cell/subCell renderers needing
  // to special-case where a row's data came from.
  // A sub-training has no scope of its own (its form only asks for a name and
  // date), so on its own it would "apply to everyone" and its target would be
  // every active student on the team - not just the parent's division. It
  // inherits the parent's scope for the target instead.
  const toRow = (t, parent) => {
    const scoped = parent ? { ...t, scopeDivision: parent.scopeDivision, scopeSubdivision: parent.scopeSubdivision } : t
    const progress = trainingProgress(scoped, allStudents, allTrainings)
    const overdue = !!t.targetDate && t.targetDate < today && progress.missing > 0
    const subs = subTrainingsByParent.get(t.id)
    return { training: t, progress, overdue, children: subs?.map((sub) => toRow(sub, t)) }
  }
  const rows = useMemo(
    () => trainings.map((t) => toRow(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trainings, subTrainingsByParent, allStudents, allTrainings, today]
  )

  // Two right-frozen columns (Progress then Actions) and one per student in
  // between - clicking/tabbing to a checkbox tucked under either of them
  // now auto-scrolls to reveal it, same as any other DataTable, rather than
  // this page's own scroll-by-one-column handler.
  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Training',
        sticky: 'left',
        // See ProductTable.jsx's Name column for why this needs to be
        // explicit and high, not left at its default.
        stickyPriority: 2000,
        // Capped so a long name wraps onto a second line rather than
        // widening the whole frozen block - the more of the width the
        // student columns keep, the fewer of them scroll out of view.
        // Tighter still on a phone: at 300 there, Name+Due could leave room
        // for only one checkbox column at a time, and the auto-scroll
        // reveal needs at least two neighbouring cells to tell which edge
        // a tap is actually closer to (see reveal() in DataTable.jsx).
        maxWidth: isMobile ? 140 : 300,
        cell: ({ training }) => <strong>{training.name}</strong>,
        subCell: ({ training }) => training.name,
      },
      {
        key: 'due',
        header: 'Due',
        // Part of the frozen left block with the name - drops just before
        // it on a phone (see the Progress column's note on priorities).
        sticky: 'left',
        stickyPriority: 1950,
        nowrap: true,
        cellClassName: 'muted due-cell',
        cell: ({ training, overdue }) => (
          <span title={overdue ? 'Past due with students still missing' : undefined}>{formatDate(training.targetDate)}</span>
        ),
      },
      ...students.map((s) => ({
        key: `student-${s.id}`,
        header: s.active ? s.fullName : <span title="Inactive">{s.fullName}</span>,
        headerAlign: 'center',
        align: 'center',
        // An even grid: every student column the same width, sharing
        // whatever the frozen blocks at either edge leave over.
        spread: true,
        className: s.active ? undefined : 'col-inactive',
        cell: ({ training }) => {
          const applies = trainingAppliesToStudent(training, s)
          if (!applies) return <span className="muted">–</span>
          const checked = training.completedStudentIds?.includes(s.id)
          return (
            <input
              type="checkbox"
              className="training-check"
              checked={!!checked}
              onChange={(e) => setTrainingCompletion(teamId, training, s, e.target.checked, streakResetDays, allTrainings)}
            />
          )
        },
      })),
      {
        key: 'progress',
        header: 'Progress',
        align: 'center',
        sticky: 'right',
        // Otherwise defaults to just below Actions' own default (see
        // planSticky in DataTable.jsx) - with enough student columns their
        // combined frozen width alone could already clear the budget on an
        // ordinary desktop width, not just a phone, unsticking this first.
        // Kept just under Name's so a truly narrow screen still drops this
        // before that.
        stickyPriority: 1900,
        nowrap: true,
        cell: ({ progress }) => (
          <span className={progress.onTarget ? 'badge badge-ok' : 'badge badge-warn'}>
            {progress.completed}/{progress.target}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        sticky: 'right',
        // See Progress's own comment just above.
        stickyPriority: 1800,
        nowrap: true,
        cell: ({ training }, { index }) => (
          <div className="row-actions">
            <MoveButtons
              onUp={() => onMove(index, -1)}
              onDown={() => onMove(index, 1)}
              canUp={index > 0}
              canDown={index < trainings.length - 1}
              index={index}
              count={trainings.length}
              onMoveTo={(toIndex) => onMoveTo(index, toIndex)}
              label="training"
            />
            <button className="link-btn" onClick={() => onAddSub(training)} title="Add sub-training" aria-label="Add sub-training">
              +
            </button>
            <button className="link-btn" onClick={() => onEdit(training)}>
              Edit
            </button>
            <button className="link-btn danger" onClick={() => onDelete(training)}>
              Delete
            </button>
          </div>
        ),
        subCell: ({ training }) => (
          <div className="row-actions">
            <button className="link-btn" onClick={() => onEdit(training)}>
              Edit
            </button>
            <button className="link-btn danger" onClick={() => onDelete(training)}>
              Delete
            </button>
          </div>
        ),
      },
    ],
    [students, teamId, streakResetDays, allTrainings, onMove, onMoveTo, onAddSub, onEdit, onDelete, trainings.length, isMobile]
  )

  return (
    <>
      <h2>{title}</h2>
      <DataTable
        columns={columns}
        rows={rows}
        expanderColumn="name"
        getRowId={({ training }) => training.id}
        rowClassName={({ overdue }) => (overdue ? 'row-overdue' : '')}
      />
    </>
  )
}
