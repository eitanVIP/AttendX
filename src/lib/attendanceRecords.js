import { collection, doc, getDoc, getDocs } from 'firebase/firestore'

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

// For the student pages, which can't write: records for every session, plus -
// only for sessions not migrated yet (no `attendanceMigrated`, see
// migrateSessionAttendance) - the old per-student docs, so attendance never
// shows up empty before an admin has opened the app. Once every session is
// migrated this reads nothing beyond the sessions themselves.
export async function loadAttendanceRecords(db, teamId, sessions, onlyStudentId) {
  const records = attendanceRecords(sessions, onlyStudentId)
  const have = new Set(records.map((r) => `${r.sessionId}/${r.studentId}`))
  const legacy = await Promise.all(
    sessions
      .filter((s) => !s.attendanceMigrated)
      .map(async (s) => {
        const base = ['teams', teamId, 'sessions', s.id, 'attendance']
        const docs = onlyStudentId
          ? [await getDoc(doc(db, ...base, onlyStudentId))].filter((d) => d.exists())
          : (await getDocs(collection(db, ...base))).docs
        return docs.map((d) => ({ id: d.id, sessionId: s.id, ...d.data() }))
      })
  )
  for (const r of legacy.flat()) if (!have.has(`${r.sessionId}/${r.studentId}`)) records.push(r)
  return records
}
