// Pure calculation helpers that replace the Google Sheet's formulas.
// Keeping these as plain functions (not stored fields) means percentages
// and statuses are always derived fresh from raw attendance/training data.

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused']

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
  return students.filter((s) => s.status !== 'inactive' && trainingAppliesToStudent(training, s))
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

export function trainingAppliesToStudent(training, student) {
  if (training.scopeDivision && student.division !== training.scopeDivision) return false
  if (training.scopeSubdivision && student.subdivision !== training.scopeSubdivision) return false
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
  return session.targetDivision === student.division
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

export function certHolders(cert, students, trainings) {
  return students.filter((s) => s.status !== 'inactive' && studentHasCert(cert, s.id, trainings))
}

export function certProgress(cert, students, trainings) {
  const activeStudents = students.filter((s) => s.status !== 'inactive')
  const completed = certHolders(cert, students, trainings).length
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
