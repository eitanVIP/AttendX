// One-time migration: copies every team's attendance from the old
// teams/{id}/sessions/{id}/attendance/{studentId} docs onto the session doc as
// `attendance: { [studentId]: status }`, which is where the app now reads it
// (see src/lib/attendanceRecords.js). The old docs are left untouched.
//
// Safe to re-run: a student already in a session's map is skipped, so a mark
// made through the new app is never overwritten by an older subcollection one.
// Run it before deploying the new build, and once more right after (to catch
// marks made by browser tabs still on the old build).
//
// Cost: 1 read per session + 1 per attendance record, 1 write per session
// that needs it - roughly one Dashboard load on the old build.
//
// Usage:
//   node scripts/migrate-attendance.mjs <admin-email> <admin-password> <team-id> [--dry-run]

import { FieldPath, collection, getDocs, updateDoc } from 'firebase/firestore'
import { connectAs } from './lib/firebase-node.mjs'

const [, , email, password, teamId, flag] = process.argv
if (!email || !password || !teamId) {
  console.error('Usage: node scripts/migrate-attendance.mjs <admin-email> <admin-password> <team-id> [--dry-run]')
  process.exit(1)
}
const dryRun = flag === '--dry-run'

const { db } = await connectAs(email, password)
const sessions = await getDocs(collection(db, 'teams', teamId, 'sessions'))

let migratedSessions = 0
let migratedRecords = 0
for (const session of sessions.docs) {
  const existing = session.data().attendance || {}
  const records = await getDocs(collection(session.ref, 'attendance'))
  const args = []
  for (const r of records.docs) {
    const { status } = r.data()
    if (!status || r.id in existing) continue
    args.push(new FieldPath('attendance', r.id), status)
  }
  if (!args.length) continue
  console.log(`${session.id}: ${args.length / 2} record(s)${dryRun ? ' (dry run)' : ''}`)
  if (!dryRun) await updateDoc(session.ref, ...args)
  migratedSessions++
  migratedRecords += args.length / 2
}

console.log(`${dryRun ? 'Would copy' : 'Copied'} ${migratedRecords} record(s) onto ${migratedSessions} of ${sessions.size} session(s).`)
process.exit(0)
