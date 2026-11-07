import { useState } from 'react'
import { ATTENDANCE_STATUSES, formatDate, isSessionRelevantToStudent } from '../lib/calc'

const STATUS_LABELS = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' }

// The Attendance page on a phone (Sessions.jsx swaps this in below 640px - the
// student-per-column grid is unchanged on a computer). One card per session:
// name, date and a count of how it went; tap it to mark each student with one
// tap on Present / Late / Absent / Excused. Tapping the status a student
// already has clears it again.
export default function PhoneSessionList({ sessions, students, statusBySessionAndStudent, onStatusChange, onEdit, onDelete }) {
  const [open, setOpen] = useState(() => new Set())

  function toggle(id) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (sessions.length === 0) return <p className="muted">No sessions in this group.</p>

  return (
    <div className="tcards">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          students={students}
          statusBySessionAndStudent={statusBySessionAndStudent}
          isOpen={open.has(session.id)}
          onToggle={() => toggle(session.id)}
          onStatusChange={onStatusChange}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

function SessionCard({ session, students, statusBySessionAndStudent, isOpen, onToggle, onStatusChange, onEdit, onDelete }) {
  const [query, setQuery] = useState('')
  const [unmarkedOnly, setUnmarkedOnly] = useState(false)

  const relevant = students.filter((s) => isSessionRelevantToStudent(session, s))
  const statusOf = (s) => statusBySessionAndStudent[`${session.id}_${s.id}`] || ''

  // How the session went. On an optional meeting a blank is an automatic
  // excuse, so there is no "not marked" there.
  const counts = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 }
  for (const s of relevant) {
    const st = statusOf(s)
    if (st) counts[st] += 1
    else if (session.optional) counts.excused += 1
    else counts.unmarked += 1
  }

  const q = query.trim().toLowerCase()
  const shown = relevant.filter(
    (s) => (!q || s.fullName.toLowerCase().includes(q)) && (!unmarkedOnly || !statusOf(s))
  )

  // Optional meeting: nobody is marked absent (a blank is an automatic
  // excuse), so only Present / Late are offered - plus Absent for a record
  // that already has it, so it can still be seen and cleared.
  const optionsFor = (s) =>
    session.optional
      ? ATTENDANCE_STATUSES.filter((st) => st === 'present' || st === 'late' || (st === 'absent' && statusOf(s) === 'absent'))
      : ATTENDANCE_STATUSES

  return (
    <section className={session.optional ? 'tcard tcard-optional' : 'tcard'}>
      <button type="button" className="tcard-head" aria-expanded={isOpen} onClick={onToggle}>
        <span className="tcard-title">
          {session.name}
          {session.optional && <span className="optional-badge">Optional</span>}
        </span>
        <span className="tcard-meta">
          <span className="tcard-due">{formatDate(session.date)}</span>
          {['present', 'late', 'absent', 'excused'].map(
            (st) =>
              counts[st] > 0 && (
                <span key={st} className={`badge status-badge-${st}`} title={STATUS_LABELS[st]}>
                  {counts[st]} {STATUS_LABELS[st].toLowerCase()}
                </span>
              )
          )}
          {counts.unmarked > 0 && <span className="tcard-due">{counts.unmarked} not marked</span>}
          <span className="tcard-chevron" aria-hidden="true">
            {isOpen ? '▲' : '▼'}
          </span>
        </span>
        {session.notes && <span className="tcard-notes">{session.notes}</span>}
      </button>

      {isOpen && (
        <div className="tcard-body">
          {relevant.length === 0 ? (
            <p className="muted tcard-empty">This session does not apply to any student.</p>
          ) : (
            <div className="tcard-students">
              <div className="tcard-tools">
                {relevant.length > 8 && (
                  <input type="search" placeholder="Search students…" value={query} onChange={(e) => setQuery(e.target.value)} />
                )}
                {!session.optional && (
                  <label className="tcard-missing">
                    <input type="checkbox" checked={unmarkedOnly} onChange={(e) => setUnmarkedOnly(e.target.checked)} />
                    Not marked only
                  </label>
                )}
              </div>
              {shown.map((s) => {
                const current = statusOf(s)
                return (
                  <div key={s.id} className={s.active ? 'scard-student' : 'scard-student tcard-student-inactive'}>
                    <div className="scard-name">
                      {s.fullName}
                      {!s.active && <span className="muted tcard-inactive-tag"> inactive</span>}
                    </div>
                    <div className="scard-status" role="group" aria-label={`Status for ${s.fullName}`}>
                      {optionsFor(s).map((st) => (
                        <button
                          key={st}
                          type="button"
                          aria-pressed={current === st}
                          className={current === st ? `scard-btn scard-btn-on status-badge-${st}` : 'scard-btn'}
                          onClick={() => onStatusChange(session, s, current === st ? null : st)}
                        >
                          {STATUS_LABELS[st]}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {shown.length === 0 && <p className="muted tcard-empty">No students match.</p>}
            </div>
          )}

          <div className="tcard-actions">
            <button type="button" className="link-btn" onClick={() => onEdit(session)}>
              Edit
            </button>
            <button type="button" className="link-btn danger" onClick={() => onDelete(session)}>
              Delete
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
