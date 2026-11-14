import { useState } from 'react'
import MoveButtons from './MoveButtons'
import { formatDate, trainingAppliesToStudent } from '../lib/calc'
import { setTrainingCompletion } from '../lib/actions'

// The Trainings page on a phone (Trainings.jsx swaps this in for the
// student-per-column grid below 640px - the grid is unchanged on a computer).
// One card per training: name, due date and progress up top; tap it to see
// who has done it and tick people off. Sub-trainings sit inside their
// parent's card, each with its own list.
//
// `rows` are the same row objects the grid uses: { training, progress,
// overdue, children }.
export default function PhoneTrainingList({
  rows,
  students,
  teamId,
  allTrainings,
  streakResetDays,
  onEdit,
  onDelete,
  onAddSub,
  onMove,
  onMoveTo,
}) {
  const [open, setOpen] = useState(() => new Set())

  function toggle(id) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const shared = { students, teamId, allTrainings, streakResetDays, open, toggle }

  if (rows.length === 0) return <p className="muted">No trainings in this group.</p>

  return (
    <div className="tcards">
      {rows.map((row, index) => (
        <TrainingCard
          key={row.training.id}
          row={row}
          {...shared}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddSub={onAddSub}
          reorder={onMove ? { index, count: rows.length, onMove, onMoveTo } : null}
        />
      ))}
    </div>
  )
}

function Progress({ progress }) {
  const pct = progress.target > 0 ? Math.min(100, Math.round((progress.completed / progress.target) * 100)) : 0
  return (
    <>
      <span className={progress.onTarget ? 'badge badge-ok' : 'badge badge-warn'}>
        {progress.completed}/{progress.target}
      </span>
      <span className="tcard-bar" aria-hidden="true">
        <span className="tcard-bar-fill" style={{ width: `${pct}%` }} />
      </span>
    </>
  )
}

function TrainingCard({ row, students, teamId, allTrainings, streakResetDays, open, toggle, onEdit, onDelete, onAddSub, reorder }) {
  const { training, progress, overdue, children } = row
  const isOpen = open.has(training.id)
  const actionButtons = (
    <>
      <button type="button" className="link-btn" onClick={() => onAddSub(training)}>
        + Sub-training
      </button>
      <button type="button" className="link-btn" onClick={() => onEdit(training)}>
        Edit
      </button>
      <button type="button" className="link-btn danger" onClick={() => onDelete(training)}>
        Delete
      </button>
    </>
  )

  return (
    <section className={overdue ? 'tcard tcard-overdue' : 'tcard'}>
      <button type="button" className="tcard-head" aria-expanded={isOpen} onClick={() => toggle(training.id)}>
        <span className="tcard-title">{training.name}</span>
        <span className="tcard-meta">
          {training.targetDate && (
            <span className={overdue ? 'tcard-due tcard-due-late' : 'tcard-due'}>Due {formatDate(training.targetDate)}</span>
          )}
          <Progress progress={progress} />
          <span className="tcard-chevron" aria-hidden="true">
            {isOpen ? '▲' : '▼'}
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="tcard-body">
          <StudentChecklist
            training={training}
            students={students}
            teamId={teamId}
            allTrainings={allTrainings}
            streakResetDays={streakResetDays}
          />

          {children?.map((sub) => {
            const subOpen = open.has(sub.training.id)
            return (
              <div key={sub.training.id} className="tcard-sub">
                <button type="button" className="tcard-head tcard-sub-head" aria-expanded={subOpen} onClick={() => toggle(sub.training.id)}>
                  <span className="tcard-title">{sub.training.name}</span>
                  <span className="tcard-meta">
                    {sub.training.targetDate && (
                      <span className={sub.overdue ? 'tcard-due tcard-due-late' : 'tcard-due'}>Due {formatDate(sub.training.targetDate)}</span>
                    )}
                    <Progress progress={sub.progress} />
                    <span className="tcard-chevron" aria-hidden="true">
                      {subOpen ? '▲' : '▼'}
                    </span>
                  </span>
                </button>
                {subOpen && (
                  <div className="tcard-body">
                    <StudentChecklist
                      training={sub.training}
                      students={students}
                      teamId={teamId}
                      allTrainings={allTrainings}
                      streakResetDays={streakResetDays}
                    />
                    <div className="tcard-actions">
                      <button type="button" className="link-btn" onClick={() => onEdit(sub.training)}>
                        Edit
                      </button>
                      <button type="button" className="link-btn danger" onClick={() => onDelete(sub.training)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <div className="tcard-actions">
            {reorder ? (
              // Arrows pinned to the edges (hold one to jump to a position),
              // the buttons between them.
              <MoveButtons
                spread
                onUp={() => reorder.onMove(reorder.index, -1)}
                onDown={() => reorder.onMove(reorder.index, 1)}
                canUp={reorder.index > 0}
                canDown={reorder.index < reorder.count - 1}
                index={reorder.index}
                count={reorder.count}
                onMoveTo={(toIndex) => reorder.onMoveTo(reorder.index, toIndex)}
                label="training"
              >
                {actionButtons}
              </MoveButtons>
            ) : (
              actionButtons
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// Everyone the training applies to, each with a checkbox. A search box
// appears once the list is long, and "Not done only" narrows it to who is
// still missing.
function StudentChecklist({ training, students, teamId, allTrainings, streakResetDays }) {
  const [query, setQuery] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)

  const applicable = students.filter((s) => trainingAppliesToStudent(training, s))
  const done = (s) => !!training.completedStudentIds?.includes(s.id)
  const q = query.trim().toLowerCase()
  const shown = applicable.filter((s) => (!q || s.fullName.toLowerCase().includes(q)) && (!missingOnly || !done(s)))

  if (applicable.length === 0) return <p className="muted tcard-empty">This training does not apply to any student.</p>

  return (
    <div className="tcard-students">
      <div className="tcard-tools">
        {applicable.length > 8 && (
          <input type="search" placeholder="Search students…" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
        <label className="tcard-missing">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          Not done only
        </label>
      </div>
      {shown.map((s) => (
        <label key={s.id} className={s.active ? 'tcard-student' : 'tcard-student tcard-student-inactive'}>
          <input
            type="checkbox"
            checked={done(s)}
            onChange={(e) => setTrainingCompletion(teamId, training, s, e.target.checked, streakResetDays, allTrainings)}
          />
          <span>{s.fullName}</span>
          {!s.active && <span className="muted tcard-inactive-tag">inactive</span>}
        </label>
      ))}
      {shown.length === 0 && <p className="muted tcard-empty">{missingOnly && !q ? 'Everyone has done this one.' : 'No students match.'}</p>}
    </div>
  )
}
