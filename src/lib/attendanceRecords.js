// Attendance lives on each session doc as `attendance: { [studentId]: status }`,
// so reading the sessions reads every record too. This flattens that back
// into the per-record shape the old attendance subcollection docs had
// ({ id, sessionId, studentId, status }), optionally for one student.
export function attendanceRecords(sessions, onlyStudentId) {
  const records = []
  for (const s of sessions) {
    for (const [studentId, status] of Object.entries(s.attendance || {})) {
      if (onlyStudentId && studentId !== onlyStudentId) continue
      records.push({ id: studentId, sessionId: s.id, studentId, status })
    }
  }
  return records
}
