// Pure calculation helpers that replace the Google Sheet's formulas.
// Keeping these as plain functions (not stored fields) means percentages
// and statuses are always derived fresh from raw attendance/training data.

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused']

export const GRADES = ['ט', 'י', 'יא', 'יב']

// Local calendar date as YYYY-MM-DD, matching how session/target dates are
// stored (toISOString would roll over at UTC midnight, hours before it
// does in Israel).
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Time left until an event's date (local midnight at its start). Past
// events report `past`; the event's own day is `today` rather than a
// negative countdown.
export function eventCountdown(dateISO, now = new Date()) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + 1)
  const ms = start - now
  const today = now >= start && now < end
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return {
    past: now >= end,
    today,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

// Training completion per division, broken down by grade: within each
// division, each grade's active students' completed applicable trainings
// over their total applicable trainings. Grades with no students in the
// division are left out; students without a grade pool under "—".
export function trainingCompletionByGrade(students, trainings, divisions) {
  return divisions
    .map((division) => {
      const inDivision = students.filter((s) => s.active && s.divisions.includes(division))
      const grades = [...GRADES, '—'].filter((g) => inDivision.some((s) => (s.grade || '—') === g))
      const rows = grades
        .map((grade) => {
          const members = inDivision.filter((s) => (s.grade || '—') === grade)
          let completed = 0
          let total = 0
          for (const s of members) {
            const stats = studentTrainingStats(s, trainings)
            completed += stats.completed
            total += stats.total
          }
          return {
            grade,
            students: members.length,
            completed,
            total,
            percent: total > 0 ? Math.round((completed / total) * 100) : null,
          }
        })
        .filter((row) => row.total > 0)
      return { division, rows }
    })
    .filter((block) => block.rows.length > 0)
}

// Rows are listed in creation order - `order` is stamped with Date.now()
// when a doc is created - and can be moved with the arrows in each table,
// which renumbers the whole collection 0..n (see reorderDocs). Docs from
// before `order` existed sort first, among themselves by `tieBreak`, until
// the first reorder gives them real positions.
export function sortByOrder(items, tieBreak = () => 0) {
  return [...items].sort((a, b) => (a.order ?? -1) - (b.order ?? -1) || tieBreak(a, b))
}

// The full list to hand reorderDocs after swapping two rows' positions.
export function swappedRows(items, idA, idB) {
  const rows = [...items]
  const i = rows.findIndex((x) => x.id === idA)
  const j = rows.findIndex((x) => x.id === idB)
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  return rows
}

// A student is active unless marked inactive by hand OR their attendance
// has fallen under the team's minimum (see useStudents, which derives
// `active`/`autoInactive` for every student). The label distinguishes the
// two so an admin can tell why someone dropped out.
export function activityLabel(student) {
  if (student.active) return 'active'
  return student.status === 'inactive' ? 'inactive' : 'auto inactive'
}

export function attendancePercent(counts) {
  const relevant = counts.present + counts.late + counts.absent
  if (relevant === 0) return null
  return Math.round(((counts.present + counts.late) / relevant) * 100)
}

export function attendanceStatusLabel(percent) {
  if (percent === null) return 'No data'
  if (percent >= 80) return 'On target'
  if (percent >= 60) return 'Needs improvement'
  return 'Low'
}

export function summarizeAttendance(records) {
  const counts = { present: 0, late: 0, absent: 0, excused: 0 }
  for (const r of records) {
    if (counts[r.status] !== undefined) counts[r.status] += 1
  }
  const percent = attendancePercent(counts)
  return {
    ...counts,
    relevantSessions: counts.present + counts.late + counts.absent,
    percent,
    statusLabel: attendanceStatusLabel(percent),
  }
}

export function trainingScopeStudents(training, students) {
  return students.filter((s) => s.active && trainingAppliesToStudent(training, s))
}

export function trainingProgress(training, students) {
  const completed = training.completedStudentIds?.length ?? 0
  const target =
    training.targetCount ?? trainingScopeStudents(training, students).length
  const percent = target > 0 ? Math.round((completed / target) * 100) : null
  return {
    completed,
    target,
    percent,
    missing: Math.max(target - completed, 0),
    onTarget: completed >= target && target > 0,
  }
}

// Students used to hold a single `division`/`subdivision` pair; they now
// hold `divisions: string[]` plus `subdivisions: { [division]: string[] }`.
// Docs written before that change are reshaped here on read (see
// useStudents), so nothing downstream ever sees the old fields, and they're
// cleared off the doc the next time it's edited (see updateStudent).
export function normalizeStudent(raw) {
  if (Array.isArray(raw.divisions)) {
    return { ...raw, subdivisions: raw.subdivisions || {} }
  }
  const { division, subdivision, ...rest } = raw
  return {
    ...rest,
    divisions: division ? [division] : [],
    subdivisions: division && subdivision ? { [division]: [subdivision] } : {},
  }
}

function sameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// Reconciles a student's memberships against the team's division structure:
// renamed divisions/subdivisions follow the rename (`renames` maps old name
// to new, subdivision renames keyed by the division's *old* name), and
// anything the team no longer has is dropped. Returns the corrected fields,
// or null when the student already matches.
export function remapStudentDivisions(student, structure, renames = { divisions: {}, subdivisions: {} }) {
  const teamDivisions = structure.divisions || []
  const teamSubs = structure.subdivisionsByDivision || {}
  const divisions = []
  const subdivisions = {}
  for (const d of student.divisions) {
    const nd = renames.divisions[d] ?? d
    if (!teamDivisions.includes(nd) || divisions.includes(nd)) continue
    divisions.push(nd)
    const validSubs = teamSubs[nd] || []
    const subs = []
    for (const s of student.subdivisions[d] || []) {
      const ns = renames.subdivisions[d]?.[s] ?? s
      if (validSubs.includes(ns) && !subs.includes(ns)) subs.push(ns)
    }
    if (subs.length) subdivisions[nd] = subs
  }
  const unchanged =
    sameList(divisions, student.divisions) &&
    Object.keys(student.subdivisions).length === Object.keys(subdivisions).length &&
    Object.entries(subdivisions).every(([d, subs]) => sameList(subs, student.subdivisions[d] || []))
  return unchanged ? null : { divisions, subdivisions }
}

export function trainingAppliesToStudent(training, student) {
  if (training.scopeDivision && !student.divisions.includes(training.scopeDivision)) return false
  if (
    training.scopeSubdivision &&
    !(student.subdivisions[training.scopeDivision] || []).includes(training.scopeSubdivision)
  ) {
    return false
  }
  return true
}

export function studentTrainingStats(student, trainings) {
  const applicable = trainings.filter((t) => trainingAppliesToStudent(t, student))
  const completed = applicable.filter((t) => t.completedStudentIds?.includes(student.id))
  const total = applicable.length
  const percent = total > 0 ? Math.round((completed.length / total) * 100) : null
  return { total, completed: completed.length, percent }
}

export function isSessionRelevantToStudent(session, student) {
  if (!session.targetDivision || session.targetDivision === 'all') return true
  return student.divisions.includes(session.targetDivision)
}

// "Mechanical (Design, CAD) · Controls" - the one-line summary of where a
// student sits, used wherever there's room for a single cell of text.
export function describeStudentDivisions(student) {
  return student.divisions
    .map((d) => {
      const subs = student.subdivisions[d] || []
      return subs.length ? `${d} (${subs.join(', ')})` : d
    })
    .join(' · ')
}

export function studentCommunityHours(logs, studentId) {
  return logs
    .filter((l) => l.studentId === studentId)
    .reduce((sum, l) => sum + (Number(l.hours) || 0), 0)
}

// Certifications are earned automatically: an admin picks which trainings
// are required, and a student holds the cert once they've completed every
// one of them - no manual "certify this student" step.
export function studentHasCert(cert, studentId, trainings) {
  const required = cert.requiredTrainingIds || []
  if (required.length === 0) return false
  return required.every((tid) => trainings.find((t) => t.id === tid)?.completedStudentIds?.includes(studentId))
}

// Everyone who holds the cert, inactive students included - that's for
// display; certProgress below counts only active holders toward the target.
export function certHolders(cert, students, trainings) {
  return students.filter((s) => studentHasCert(cert, s.id, trainings))
}

export function certProgress(cert, students, trainings) {
  const activeStudents = students.filter((s) => s.active)
  const completed = certHolders(cert, activeStudents, trainings).length
  const target = cert.targetCount ?? activeStudents.length
  const percent = target > 0 ? Math.round((completed / target) * 100) : null
  return {
    completed,
    target,
    percent,
    missing: Math.max(target - completed, 0),
    onTarget: completed >= target && target > 0,
  }
}
